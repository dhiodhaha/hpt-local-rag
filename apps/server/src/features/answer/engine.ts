import { randomUUID } from "node:crypto";
import type { HptIndex, PassageId } from "../search/index.ts";
import type { Effort, Provider, ProviderFailure, RunProfile, Usage } from "../providers/index.ts";
import { FAILURE_COPY, RESTART, WITHHELD } from "./copy.ts";
import { citedOf } from "./fold.ts";
import { SourceLedger } from "./ledger.ts";
import { createPipeline, type Pipeline, type PipelineStep } from "./pipeline.ts";
import { actionOf, MAX_ATTEMPTS, nextStep, queuesForTestSet, type AttemptEnd, type FindingCode, type NextStep } from "./policy.ts";
import { systemPrompt, userMessage, type PromptTemplate } from "./prompt.ts";
import { fillLedger, packContext, retrieve, type Rewriter } from "./retrieval.ts";
import { rewriteProfile, rewriteQuery, type RewriteSettings } from "./rewrite.ts";
import { NO_LIMITS, pickRoute, planOf, withLimit, type Fallbacks, type Limits, type Route } from "./routes.ts";
import { generateTitle, traceOfTitle, type TitleResult, type TitleSettings } from "./title.ts";
import { createToolSession, TOOL_SPECS } from "./tools.ts";
import { createRecorder, type AttemptTrace, type FindingTrace, type Trace, type TraceSink } from "./trace.ts";
import { createTripwire } from "./tripwire.ts";
import type { AnswerEvent, Cause, CompleteAnswer, Outcome, SourceCard, Turn } from "./types.ts";

export type EngineSettings = {
  readonly model: string;
  readonly effort: Effort;
  readonly maxExtraToolCalls: number;
  readonly searchLimit: number;
  readonly evidenceTokens: number;
  /** D20: the route that takes over when a model's usage limit is spent. Absent or empty means a spent limit fails the answer. */
  readonly fallbacks?: Fallbacks;
  /** D33: a follow-up is searched with a standalone rewrite of itself. Absent means follow-ups are searched as written. */
  readonly rewrite?: RewriteSettings;
  /** D36: a conversation is titled after its first answer, when a caller asks (`title`). Absent means `title` makes no call. */
  readonly title?: TitleSettings;
};

export type EngineDeps = {
  readonly index: HptIndex;
  readonly provider: Provider;
  readonly prompt: PromptTemplate;
  readonly canary: string;
  readonly traces: TraceSink;
  readonly settings: EngineSettings;
  readonly now?: () => number;
  /** Epoch milliseconds, to compare with a provider's limit reset time. `now` is a monotonic clock and cannot. */
  readonly wall?: () => number;
};

export type AskOptions = {
  /** Every committed event, in order, as it happens. The only streaming interface. */
  readonly onEvent?: (event: AnswerEvent) => void;
  readonly signal?: AbortSignal;
  readonly label?: string;
  readonly overrides?: Partial<Pick<EngineSettings, "model" | "effort" | "maxExtraToolCalls">>;
  /** Recorded in the trace only. The engine does not read conversations. */
  readonly conversation?: { readonly id: string; readonly turn: number };
};

export type Finished = {
  readonly id: string;
  readonly outcome: Outcome;
  /** Non-null only when delivered. A withheld or failed answer is never exposed. */
  readonly answer: CompleteAnswer | null;
  readonly context: readonly PassageId[];
  readonly trace: Trace;
};

export type WarmOptions = { readonly followUp?: boolean };

export type AnswerEngine = {
  /**
   * Answer one turn. Resolves when the answer is final: the events are all delivered and the trace is written. It never
   * rejects for a provider or check failure (those are `outcome`), only for a programming error or a missing index.
   * Asks run one at a time: a second `ask` while one is running waits its turn (one warm process, one subscription).
   */
  ask(turn: Turn, options?: AskOptions): Promise<Finished>;
  /**
   * D36: one small call that gives the conversation of a delivered first answer a title of 3 to 6 words. Null, with no call, when the
   * engine has no title settings or the reply is not an answer. Otherwise it never rejects and never takes longer than the budget, and
   * it records the call in the ask's trace. Nobody should wait for it: it is not part of `ask`, and it is not queued behind one.
   * `keep` stores the title and says whether it was stored, so the trace says what happened and not only what was generated.
   */
  title(finished: Finished, question: string, keep: (title: string) => boolean): Promise<TitleResult | null>;
  /** Boot the spare process. `followUp` also boots the rewrite's, for a conversation that already has turns. */
  warm(options?: WarmOptions): void;
  close(): Promise<void>;
};

type AttemptResult = { end: AttemptEnd; pipeline: Pipeline; usage: Usage | null; failure: ProviderFailure | null };

export function createEngine(deps: EngineDeps): AnswerEngine {
  const now = deps.now ?? (() => performance.now());
  const wall = deps.wall ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  let limits: Limits = NO_LIMITS;
  const titling = new Set<AbortController>();

  const profileFor = (settings: EngineSettings, route: Route): RunProfile => ({
    lane: "answer",
    model: route.model,
    effort: route.effort,
    system: systemPrompt(deps.prompt, { canary: deps.canary, maxExtraCalls: settings.maxExtraToolCalls }),
    tools: settings.maxExtraToolCalls > 0 ? TOOL_SPECS : [],
  });

  const planFor = (settings: EngineSettings) => planOf({ model: settings.model, effort: settings.effort }, settings.fallbacks ?? {});
  const routeFrom = (plan: ReturnType<typeof planFor>): Route => pickRoute(plan, limits, wall()) ?? plan[0];

  async function runAsk(turn: Turn, options: AskOptions): Promise<Finished> {
    const id = randomUUID();
    const given = Object.entries(options.overrides ?? {}).filter(([, value]) => value !== undefined);
    const settings: EngineSettings = { ...deps.settings, ...Object.fromEntries(given) };
    const plan = planFor(settings);
    deps.provider.warm(profileFor(settings, routeFrom(plan)));
    const recorder = createRecorder({
      v: 1,
      id,
      label: options.label ?? null,
      at: new Date().toISOString(),
      conversation: options.conversation?.id ?? null,
      turn: options.conversation?.turn ?? null,
      model: settings.model,
      effort: settings.effort,
      provider: deps.provider.id,
      promptVersion: deps.prompt.version,
      indexFingerprint: deps.index.info.fingerprint,
      maxExtraToolCalls: settings.maxExtraToolCalls,
      now,
    });
    const emit = (event: AnswerEvent) => {
      recorder.event(event);
      options.onEvent?.(event);
    };

    const rewriteSettings = settings.rewrite;
    const isFollowUp = turn.history.length > 0 && turn.scope === null;
    const rewriter: Rewriter | undefined =
      rewriteSettings !== undefined && isFollowUp ? () => rewriteQuery({ provider: deps.provider, settings: rewriteSettings, turn, signal: options.signal, now }) : undefined;
    const retrieved = await retrieve(deps.index, turn, settings, rewriter);
    const packed = packContext({ retrieved, history: turn.history, budgetTokens: settings.evidenceTokens });
    const ledger = new SourceLedger();
    fillLedger(ledger, packed);
    recorder.retrieval(
      {
        ms: Math.round(retrieved.ms),
        queries: retrieved.queries.length,
        hits: retrieved.hits.length,
        evidence: retrieved.evidence.level,
        packed: packed.entries.length,
        dropped: packed.dropped.length,
        estimatedTokens: packed.estimatedTokens,
        carried: packed.entries.filter((entry) => entry.origin === "carry_over").length,
      },
      retrieved.rewrite,
    );
    emit({ kind: "sources", added: ledger.entries.map(cardOf), evidence: retrieved.evidence });

    const tools = createToolSession({
      index: deps.index,
      ledger,
      max: settings.maxExtraToolCalls,
      searchLimit: settings.searchLimit,
      now,
      onCall: (log) => {
        emit({ kind: "tool_call", n: log.n, tool: log.tool, arg: log.arg, denied: log.denied });
        const added = log.added.flatMap((sid) => ledger.resolve(sid) ?? []);
        if (added.length > 0) emit({ kind: "sources", added: added.map(cardOf), evidence: null });
      },
    });

    async function runAttempt(attempt: number, retryReason: FindingCode | null, route: Route, fallback: AttemptTrace["fallback"]): Promise<AttemptResult> {
      const profile = profileFor(settings, route);
      recorder.attemptStarted(attempt, route, fallback);
      const tripwire = createTripwire(deps.canary);
      const pipeline = createPipeline({ ledger, tripwire });
      const result: AttemptResult = { end: { kind: "cancelled" }, pipeline, usage: null, failure: null };
      if (options.signal?.aborted) return result;
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const deliver = (step: PipelineStep): boolean => {
        for (const event of step.events) emit(event);
        if (step.abort === null) return false;
        controller.abort();
        result.end = { kind: "check_failed", finding: step.abort.finding };
        return true;
      };
      try {
        const request = { profile, user: userMessage({ turn, ledger, retryReason }).text, tools: tools.host(attempt, tripwire) };
        for await (const event of deps.provider.run(request, controller.signal)) {
          if (event.kind === "started") recorder.providerStarted(event.waitMs, event.warm);
          else if (event.kind === "text") {
            recorder.firstText();
            if (deliver(pipeline.push(event.delta))) break;
          } else if (event.kind === "tool_use") {
            if (deliver(pipeline.toolUse())) break;
          } else if (event.outcome.ok) {
            result.usage = event.outcome.usage;
            const finished = deliver(pipeline.finish());
            if (!finished) result.end = { kind: "complete" };
            break;
          } else {
            result.failure = event.outcome.failure;
            const cancelled = options.signal?.aborted === true;
            result.end = cancelled ? { kind: "cancelled" } : { kind: "provider_failed", code: event.outcome.failure.code };
            break;
          }
        }
      } catch (cause) {
        result.failure = { code: "unknown", detail: cause instanceof Error ? cause.message : String(cause), resetsAt: null };
        result.end = { kind: "provider_failed", code: "unknown" };
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
      }
      return result;
    }

    let step: NextStep = { kind: "cancel" };
    let last: AttemptResult | null = null;
    let because: Cause | null = null;
    let retryReason: FindingCode | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const route = routeFrom(plan);
      const until = limits.get(plan[0].model);
      const fallback = route === plan[0] || until === undefined ? null : { from: plan[0].model, until: new Date(until).toISOString() };
      emit({ kind: "attempt", attempt, because });
      if (fallback !== null) emit({ kind: "fallback", route, ...fallback });
      last = await runAttempt(attempt, retryReason, route, fallback);
      if (last.end.kind === "provider_failed" && last.end.code === "rate_limited") limits = withLimit(limits, route.model, last.failure?.resetsAt ?? null, wall());
      step = nextStep(last.end, attempt, pickRoute(plan, limits, wall()) !== null);
      const visibleRestart = step.kind === "retry" && last.pipeline.committed;
      recorder.attemptEnded({
        end: last.end.kind,
        findings: last.pipeline.findings.map(traceOf),
        edits: last.pipeline.edits,
        failure: last.failure === null ? null : { code: last.failure.code, detail: last.failure.detail },
        visibleRestart,
        usage: last.usage,
      });
      if (step.kind !== "retry") break;
      if (visibleRestart) emit({ kind: "restart", copy: RESTART });
      because = step.because;
      retryReason = step.because.kind === "check" ? step.because.code : null;
    }

    const outcome = outcomeOf(step);
    const answer = outcome.kind === "delivered" ? completeOf(last?.pipeline) : null;
    emit({ kind: "finished", outcome });
    const trace = recorder.finish({ outcome, ledger: ledger.passageIds, tools: tools.calls, cited: answer === null ? [] : citedOf(answer) });
    deps.traces.write(trace);
    // The next question of a conversation that goes on is a follow-up. Its rewrite process boots while the person reads.
    if (rewriteSettings !== undefined && (isFollowUp || outcome.kind === "delivered")) deps.provider.warm(rewriteProfile(rewriteSettings));
    return { id, outcome, answer, context: ledger.passageIds, trace };
  }

  return {
    ask(turn, options = {}) {
      const run = queue.then(() => runAsk(turn, options));
      queue = run.catch(() => {});
      return run;
    },
    warm(options = {}) {
      deps.provider.warm(profileFor(deps.settings, routeFrom(planFor(deps.settings))));
      if (options.followUp === true && deps.settings.rewrite !== undefined) deps.provider.warm(rewriteProfile(deps.settings.rewrite));
    },
    async title(finished, question, keep) {
      const settings = deps.settings.title;
      const headline = finished.answer?.type === "answer" ? finished.answer.headline : null;
      if (settings === undefined || headline === null) return null;
      const controller = new AbortController();
      titling.add(controller);
      const made = await generateTitle({ provider: deps.provider, settings, question, headline, signal: controller.signal, now }).finally(() => titling.delete(controller));
      const result: TitleResult = made.text === null || keep(made.text) ? made : { text: null, ms: made.ms, fallback: "renamed" };
      deps.traces.update?.({ ...finished.trace, title: traceOfTitle(result) });
      return result;
    },
    async close() {
      for (const controller of titling) controller.abort();
      await queue.catch(() => {});
      await deps.provider.close();
    },
  };
}

function cardOf(entry: SourceLedger["entries"][number]): SourceCard {
  return { n: entry.n, passage: entry.passage, origin: entry.origin, priorTurn: entry.priorTurn };
}

function traceOf(finding: Parameters<typeof actionOf>[0]): FindingTrace {
  return { code: finding.code, site: finding.site, detail: finding.detail, action: actionOf(finding), testSet: queuesForTestSet(finding) };
}

function outcomeOf(step: NextStep): Outcome {
  if (step.kind === "deliver") return { kind: "delivered" };
  if (step.kind === "withhold") return { kind: "withheld", code: step.finding.code, copy: WITHHELD };
  if (step.kind === "fail") return { kind: "failed", code: step.code, copy: FAILURE_COPY[step.code] };
  return { kind: "cancelled" };
}

function completeOf(pipeline: Pipeline | undefined): CompleteAnswer {
  const answer = pipeline?.answer;
  if (answer === undefined || answer.type === null) throw new Error("a delivered attempt has no answer type");
  return { ...answer, type: answer.type };
}
