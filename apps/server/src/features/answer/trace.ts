import fs from "node:fs";
import path from "node:path";
import type { EvidenceLevel, PassageId } from "../search/index.ts";
import type { Effort, FailureCode, Usage } from "../providers/index.ts";
import type { AnswerEvent, Edit, Outcome } from "./types.ts";
import type { FindingCode, Site } from "./policy.ts";
import type { ToolCallLog } from "./tools.ts";
import type { Route } from "./routes.ts";

/**
 * One JSONL line per answer under data/traces/, including answers that were withheld, failed or cancelled. Timings are
 * milliseconds from the start of the ask, so any two are comparable by subtraction and nothing depends on wall-clock. A
 * Recorder watches the same AnswerEvents consumers see, so "headline complete" has one definition.
 *
 * The trace holds question-derived text (tool queries) and so lives under data/. Reports built from traces carry ids,
 * counts and numbers only, so `pnpm check:public` stays green.
 */
export type FindingTrace = {
  readonly code: FindingCode;
  readonly site: Site;
  readonly detail: string;
  readonly action: string;
  /** D10f and D10h: goes to the test set as a priority. */
  readonly testSet: boolean;
};

export type AttemptTrace = {
  readonly n: number;
  /** The model and effort this attempt ran on. The trace's own `model` and `effort` are what the ask asked for. */
  readonly route: Route;
  /** Set when the attempt ran on a fallback route: the model whose usage limit was spent, and when it is tried again. */
  readonly fallback: { readonly from: string; readonly until: string } | null;
  /** From run() to the request being sent: the wait for the provider. */
  readonly providerWaitMs: number;
  readonly warm: boolean;
  /** Our own clock on the first text_delta. The SDK's ttft_ms is wrong for long outputs and is not used. */
  readonly firstTextMs: number | null;
  /** When each field or item was committed: "type", "headline", "dalil[0]", ... */
  readonly committedMs: readonly { readonly name: string; readonly ms: number }[];
  readonly endedMs: number;
  readonly end: "complete" | "check_failed" | "provider_failed" | "cancelled";
  readonly findings: readonly FindingTrace[];
  readonly edits: readonly Edit[];
  readonly failure: { readonly code: FailureCode; readonly detail: string } | null;
  /** The retry that followed replaced something the reader had already seen. The eval counts these. */
  readonly visibleRestart: boolean;
  readonly usage: Usage | null;
};

export type Trace = {
  readonly v: 1;
  readonly id: string;
  readonly label: string | null;
  readonly at: string;
  readonly conversation: string | null;
  readonly turn: number | null;
  readonly model: string;
  readonly effort: Effort;
  readonly provider: string;
  readonly promptVersion: string;
  readonly indexFingerprint: string;
  readonly maxExtraToolCalls: number;
  readonly retrieval: {
    readonly ms: number;
    readonly queries: number;
    readonly hits: number;
    readonly evidence: EvidenceLevel;
    readonly packed: number;
    readonly dropped: number;
    readonly estimatedTokens: number;
  };
  /** The S-id table in ledger order, so "S3" in any log line means `ledger[2]`. */
  readonly ledger: readonly PassageId[];
  readonly tools: readonly ToolCallLog[];
  readonly attempts: readonly AttemptTrace[];
  readonly outcome: Outcome;
  readonly totalMs: number;
  /** Passages the delivered answer cites, in first-cited order. Empty unless delivered. */
  readonly cited: readonly PassageId[];
};

export type TraceSink = { write(trace: Trace): void };

/** Appends to `<dir>/YYYY-MM-DD.jsonl`. A write failure goes to stderr and is never thrown: a trace must not fail an answer. */
export function jsonlTraceSink(dir: string): TraceSink {
  return {
    write(trace) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${trace.at.slice(0, 10)}.jsonl`), `${JSON.stringify(trace)}\n`);
      } catch (cause) {
        console.error(`could not write the trace: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
  };
}

/**
 * Deleting a conversation also scrubs its trace lines: the conversation id goes, and so do the search queries, which are
 * question-derived. Timings, outcomes and cited passage ids stay, so the numbers still add up. A line that does not parse
 * is kept as it is. Each changed file is rewritten through a temporary file and a rename.
 */
export function scrubConversation(dir: string, conversation: string): number {
  if (!fs.existsSync(dir)) return 0;
  let scrubbed = 0;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".jsonl"))) {
    const file = path.join(dir, name);
    let changed = false;
    const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => {
      const trace = parseTrace(line);
      if (trace === null || trace.conversation !== conversation) return line;
      changed = true;
      scrubbed += 1;
      const tools = trace.tools.map((call) => (call.tool === "search" ? { ...call, arg: "" } : call));
      return JSON.stringify({ ...trace, conversation: null, tools });
    });
    if (!changed) continue;
    const temporary = `${file}.scrub`;
    fs.writeFileSync(temporary, lines.join("\n"));
    fs.renameSync(temporary, file);
  }
  return scrubbed;
}

function parseTrace(line: string): Trace | null {
  if (line.trim() === "") return null;
  try {
    return JSON.parse(line) as Trace;
  } catch {
    return null;
  }
}

export function memoryTraceSink(): TraceSink & { readonly traces: readonly Trace[] } {
  const traces: Trace[] = [];
  return { traces, write: (trace) => void traces.push(trace) };
}

export type Recorder = {
  retrieval(retrieval: Trace["retrieval"]): void;
  attemptStarted(n: number, route: Route, fallback: AttemptTrace["fallback"]): void;
  providerStarted(waitMs: number, warm: boolean): void;
  firstText(): void;
  event(event: AnswerEvent): void;
  attemptEnded(input: {
    readonly end: AttemptTrace["end"];
    readonly findings: readonly FindingTrace[];
    readonly edits: readonly Edit[];
    readonly failure: AttemptTrace["failure"];
    readonly visibleRestart: boolean;
    readonly usage: Usage | null;
  }): void;
  finish(input: { readonly outcome: Outcome; readonly ledger: readonly PassageId[]; readonly tools: readonly ToolCallLog[]; readonly cited: readonly PassageId[] }): Trace;
};

export type RecorderInit = Omit<Trace, "retrieval" | "ledger" | "tools" | "attempts" | "outcome" | "totalMs" | "cited"> & {
  readonly now: () => number;
};

type Draft = { n: number; route: Route; fallback: AttemptTrace["fallback"]; providerWaitMs: number; warm: boolean; firstTextMs: number | null; committed: { name: string; ms: number }[]; items: Map<string, number> };

const NO_RETRIEVAL: Trace["retrieval"] = { ms: 0, queries: 0, hits: 0, evidence: "absent", packed: 0, dropped: 0, estimatedTokens: 0 };

export function createRecorder(init: RecorderInit): Recorder {
  const { now, ...header } = init;
  const t0 = now();
  const since = () => Math.round(now() - t0);
  const attempts: AttemptTrace[] = [];
  let retrieval = NO_RETRIEVAL;
  let draft: Draft | null = null;

  return {
    retrieval(value) {
      retrieval = value;
    },
    attemptStarted(n, route, fallback) {
      draft = { n, route, fallback, providerWaitMs: 0, warm: false, firstTextMs: null, committed: [], items: new Map() };
    },
    providerStarted(waitMs, warm) {
      if (draft === null) return;
      draft.providerWaitMs = Math.round(waitMs);
      draft.warm = warm;
    },
    firstText() {
      if (draft !== null) draft.firstTextMs ??= since();
    },
    event(event) {
      if (draft === null) return;
      if (event.kind === "field") draft.committed.push({ name: event.name, ms: since() });
      else if (event.kind === "settled") draft.committed.push({ name: `${event.name}_settled`, ms: since() });
      else if (event.kind === "item") {
        const index = draft.items.get(event.name) ?? 0;
        draft.items.set(event.name, index + 1);
        draft.committed.push({ name: `${event.name}[${index}]`, ms: since() });
      }
    },
    attemptEnded(ended) {
      if (draft === null) return;
      attempts.push({
        n: draft.n,
        route: draft.route,
        fallback: draft.fallback,
        providerWaitMs: draft.providerWaitMs,
        warm: draft.warm,
        firstTextMs: draft.firstTextMs,
        committedMs: draft.committed,
        endedMs: since(),
        ...ended,
      });
      draft = null;
    },
    finish(done) {
      return { ...header, retrieval, ledger: done.ledger, tools: done.tools, attempts, outcome: done.outcome, totalMs: since(), cited: done.cited };
    },
  };
}
