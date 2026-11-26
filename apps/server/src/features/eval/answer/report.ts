import { FINDING_CODES, type FindingCode } from "../../answer/index.ts";
import { CATEGORIES, type AnswerCase, type Category } from "./cases.ts";
import { bootstrap, p50, p90, pairedChange, type Interval, type PairedChange } from "./noise.ts";
import type { RunRecord } from "./runner.ts";
import { score, type PassageLookup, type Score } from "./score.ts";

/**
 * Everything here is computed from the stored RunRecords and the scores of the answers in them. The report has no timer of its
 * own. A ConfigReport has no field that could hold text, only numbers, ids and enum values, so what `hpt eval answers-report`
 * prints can be committed. `pnpm check:public` is the backstop, not the mechanism.
 */
export type Dist = {
  readonly n: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p50Interval: Interval | null;
  readonly p90Interval: Interval | null;
};

export type LatencyBlock = { readonly firstText: Dist; readonly headline: Dist; readonly settled: Dist; readonly done: Dist };

export type CategoryReport = {
  readonly n: number;
  readonly delivered: number;
  readonly typeOk: number;
  readonly shapeOk: number;
  readonly basisOk: number | null;
  readonly headline: Dist;
  readonly done: Dist;
  readonly toolCalls: number;
};

export type ConfigReport = {
  readonly runId: string;
  readonly settings: { readonly model: string; readonly effort: string; readonly maxExtraToolCalls: number };
  readonly subsetHash: string;
  readonly promptVersion: string;
  readonly indexFingerprint: string;
  readonly asked: number;
  readonly of: number;
  readonly outcomes: { readonly delivered: number; readonly withheld: number; readonly failed: number; readonly cancelled: number };
  readonly failedCodes: Readonly<Record<string, number>>;
  readonly latency: { readonly all: LatencyBlock; readonly noTool: LatencyBlock; readonly withTool: LatencyBlock };
  /** What the time before the first text is made of. `think` is first text minus retrieval minus the wait for the process. */
  readonly limiter: {
    readonly retrievalMs: Dist;
    readonly providerWaitMs: Dist;
    readonly thinkMs: Dist;
    readonly writeToHeadlineMs: Dist;
    readonly outputTokens: Dist;
    readonly warmShare: number;
  };
  readonly quality: { readonly typeOk: number; readonly shapeOk: number; readonly basisOk: number; readonly basisOf: number; readonly review: number };
  readonly byCategory: Readonly<Record<Category, CategoryReport>>;
  readonly citations: {
    readonly cited: number;
    readonly outsideContext: number;
    readonly unresolved: number;
    readonly supersededOutsideRevision: number;
    readonly fictionalMatches: number;
  };
  readonly checks: {
    /** Answers with at least one finding of the code in ANY attempt: raw model quality before a retry or a repair hides it. */
    readonly answersWith: Readonly<Record<FindingCode, number>>;
    readonly repairs: Readonly<Record<string, number>>;
    readonly answersRetried: number;
    readonly visibleRestarts: number;
  };
  readonly tools: { readonly answersWithCalls: number; readonly calls: number; readonly denied: number; readonly searches: number };
  readonly overlap: { readonly questions: number; readonly expected: number; readonly inContext: number; readonly cited: number };
  /** Cost: attempts are model calls, and each granted extra call is one more model round trip. */
  readonly usage: { readonly attempts: number; readonly toolRoundTrips: number; readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens: number; readonly cacheWriteTokens: number };
  readonly ids: {
    readonly typeMismatch: readonly string[];
    readonly withheld: readonly string[];
    readonly failed: readonly string[];
    readonly restarted: readonly string[];
    readonly testSet: readonly string[];
  };
};

const present = (values: readonly (number | null)[]): number[] => values.filter((value): value is number => value !== null);

export function distOf(values: readonly (number | null)[], seed = 1): Dist {
  const known = present(values);
  if (known.length === 0) return { n: 0, p50: null, p90: null, p50Interval: null, p90Interval: null };
  return { n: known.length, p50: p50(known), p90: p90(known), p50Interval: bootstrap(known, p50, seed), p90Interval: bootstrap(known, p90, seed + 1) };
}

function latencyOf(scores: readonly Score[]): LatencyBlock {
  return {
    firstText: distOf(scores.map((one) => one.timing.firstTextMs)),
    headline: distOf(scores.map((one) => one.timing.headlineMs)),
    settled: distOf(scores.map((one) => one.timing.settledMs)),
    done: distOf(scores.map((one) => one.timing.doneMs)),
  };
}

export function scoresOf(records: readonly RunRecord[], cases: readonly AnswerCase[], lookup: PassageLookup): Score[] {
  const byId = new Map(cases.map((item) => [item.id, item]));
  return records.flatMap((record) => {
    const item = byId.get(record.caseId);
    return item === undefined ? [] : [score(item, record.finished, lookup)];
  });
}

const count = (scores: readonly Score[], test: (one: Score) => boolean) => scores.filter(test).length;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** Single-attempt answers only: a retry's clock includes the first attempt. */
function thinkOf(one: Score): number | null {
  const { firstTextMs } = one.timing;
  const wait = one.retrieval.providerWaitMs;
  return one.attempts !== 1 || firstTextMs === null || wait === null ? null : firstTextMs - one.retrieval.ms - wait;
}

function categoryOf(scores: readonly Score[]): CategoryReport {
  const basis = scores.filter((one) => one.basisOk !== null);
  return {
    n: scores.length,
    delivered: count(scores, (one) => one.outcome === "delivered"),
    typeOk: count(scores, (one) => one.typeOk),
    shapeOk: count(scores, (one) => one.shapeOk),
    basisOk: basis.length === 0 ? null : count(basis, (one) => one.basisOk === true),
    headline: distOf(scores.map((one) => one.timing.headlineMs)),
    done: distOf(scores.map((one) => one.timing.doneMs)),
    toolCalls: sum(scores.map((one) => one.tools.granted)),
  };
}

export type SummarizeInput = {
  readonly runId: string;
  readonly records: readonly RunRecord[];
  readonly cases: readonly AnswerCase[];
  readonly lookup: PassageLookup;
};

export function summarizeRun(input: SummarizeInput): ConfigReport {
  const { records, cases } = input;
  const scores = scoresOf(records, cases, input.lookup);
  const first = records[0]?.finished.trace;
  const delivered = scores.filter((one) => one.outcome === "delivered");
  const answers = delivered.filter((one) => one.answerType === "answer");
  const traces = records.map((record) => record.finished.trace);
  const failedCodes: Record<string, number> = {};
  for (const record of records) {
    const { outcome } = record.finished;
    if (outcome.kind === "failed") failedCodes[outcome.code] = (failedCodes[outcome.code] ?? 0) + 1;
  }
  const basis = scores.filter((one) => one.basisOk !== null);
  const repairs: Record<string, number> = {};
  for (const one of scores) for (const kind of one.repairs) repairs[kind] = (repairs[kind] ?? 0) + 1;
  const withOverlap = scores.flatMap((one) => (one.overlap === null ? [] : [one.overlap]));
  const noTool = delivered.filter((one) => one.path === "no_tool");
  const withTool = delivered.filter((one) => one.path === "tool");

  return {
    runId: input.runId,
    settings: { model: first?.model ?? "", effort: first?.effort ?? "", maxExtraToolCalls: first?.maxExtraToolCalls ?? 0 },
    subsetHash: records[0]?.subsetHash ?? "",
    promptVersion: first?.promptVersion ?? "",
    indexFingerprint: first?.indexFingerprint ?? "",
    asked: records.length,
    of: cases.length,
    outcomes: {
      delivered: delivered.length,
      withheld: count(scores, (one) => one.outcome === "withheld"),
      failed: count(scores, (one) => one.outcome === "failed"),
      cancelled: count(scores, (one) => one.outcome === "cancelled"),
    },
    failedCodes,
    latency: { all: latencyOf(delivered), noTool: latencyOf(noTool), withTool: latencyOf(withTool) },
    limiter: {
      retrievalMs: distOf(answers.map((one) => one.retrieval.ms)),
      providerWaitMs: distOf(answers.map((one) => one.retrieval.providerWaitMs)),
      thinkMs: distOf(answers.map(thinkOf)),
      writeToHeadlineMs: distOf(answers.map((one) => (one.timing.headlineMs === null || one.timing.firstTextMs === null ? null : one.timing.headlineMs - one.timing.firstTextMs))),
      outputTokens: distOf(answers.map((one) => one.usage?.outputTokens ?? null)),
      warmShare: scores.length === 0 ? 0 : count(scores, (one) => one.retrieval.warm === true) / scores.length,
    },
    quality: {
      typeOk: count(scores, (one) => one.typeOk),
      shapeOk: count(scores, (one) => one.shapeOk),
      basisOk: count(basis, (one) => one.basisOk === true),
      basisOf: basis.length,
      review: count(scores, (one) => one.review),
    },
    byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, categoryOf(scores.filter((one) => one.category === category))])) as Record<Category, CategoryReport>,
    citations: {
      cited: sum(delivered.map((one) => one.citations.cited)),
      outsideContext: sum(delivered.map((one) => one.citations.outsideContext)),
      unresolved: sum(delivered.map((one) => one.citations.unresolved)),
      supersededOutsideRevision: sum(delivered.map((one) => one.citations.supersededOutsideRevision)),
      fictionalMatches: count(delivered, (one) => one.citations.matchesFictional),
    },
    checks: {
      answersWith: Object.fromEntries(FINDING_CODES.map((code) => [code, count(scores, (one) => one.findings.includes(code))])) as Record<FindingCode, number>,
      repairs,
      answersRetried: count(scores, (one) => one.attempts > 1),
      visibleRestarts: count(scores, (one) => one.visibleRestart),
    },
    tools: {
      answersWithCalls: count(scores, (one) => one.tools.granted + one.tools.denied > 0),
      calls: sum(scores.map((one) => one.tools.granted)),
      denied: sum(scores.map((one) => one.tools.denied)),
      searches: sum(scores.map((one) => one.tools.searches)),
    },
    overlap: {
      questions: withOverlap.length,
      expected: sum(withOverlap.map((one) => one.expected)),
      inContext: sum(withOverlap.map((one) => one.inContext)),
      cited: sum(withOverlap.map((one) => one.cited)),
    },
    usage: {
      attempts: sum(traces.map((trace) => trace.attempts.length)),
      toolRoundTrips: sum(scores.map((one) => one.tools.granted)),
      inputTokens: sum(traces.flatMap((trace) => trace.attempts.map((attempt) => attempt.usage?.inputTokens ?? 0))),
      outputTokens: sum(traces.flatMap((trace) => trace.attempts.map((attempt) => attempt.usage?.outputTokens ?? 0))),
      cacheReadTokens: sum(traces.flatMap((trace) => trace.attempts.map((attempt) => attempt.usage?.cacheReadTokens ?? 0))),
      cacheWriteTokens: sum(traces.flatMap((trace) => trace.attempts.map((attempt) => attempt.usage?.cacheWriteTokens ?? 0))),
    },
    ids: {
      typeMismatch: scores.filter((one) => !one.typeOk).map((one) => one.caseId),
      withheld: scores.filter((one) => one.outcome === "withheld").map((one) => one.caseId),
      failed: scores.filter((one) => one.outcome === "failed").map((one) => one.caseId),
      restarted: scores.filter((one) => one.visibleRestart).map((one) => one.caseId),
      testSet: scores.filter((one) => one.testSet).map((one) => one.caseId),
    },
  };
}

export type GateRule = { readonly rule: string; readonly pass: boolean; readonly detail: string };

/** The protocol's quality gate. `tolerance` is the paired noise of 40 questions: two cases. */
export const GATE_TOLERANCE = 2;

export function gateOf(report: ConfigReport, reference: ConfigReport): GateRule[] {
  const lacking = (mine: number, theirs: number) => mine >= theirs - GATE_TOLERANCE;
  const { citations } = report;
  const clean = citations.outsideContext === 0 && citations.unresolved === 0 && citations.supersededOutsideRevision === 0;
  const unshown = (one: ConfigReport) => one.outcomes.withheld + one.outcomes.failed;
  return [
    { rule: "complete run", pass: report.asked === report.of, detail: `${report.asked} of ${report.of} asked` },
    { rule: "type matches", pass: lacking(report.quality.typeOk, reference.quality.typeOk), detail: `${report.quality.typeOk} against ${reference.quality.typeOk}` },
    { rule: "citations valid", pass: clean, detail: `${citations.outsideContext} outside context, ${citations.unresolved} unresolved, ${citations.supersededOutsideRevision} superseded outside a revision note` },
    { rule: "no fictional match", pass: citations.fictionalMatches === 0, detail: `${citations.fictionalMatches} answers cite the invented reference` },
    { rule: "withheld and failed", pass: unshown(report) <= unshown(reference) + GATE_TOLERANCE, detail: `${unshown(report)} against ${unshown(reference)}` },
    { rule: "basis matches", pass: lacking(report.quality.basisOk, reference.quality.basisOk), detail: `${report.quality.basisOk} of ${report.quality.basisOf} against ${reference.quality.basisOk}` },
  ];
}

export const HEADLINE_TARGET_MS = 4000;

/** `before` and `after` are scores of the same cases. Pairs the questions both answered with a headline. */
export function pairedHeadline(before: readonly Score[], after: readonly Score[]): PairedChange {
  const mine = new Map(before.map((one) => [one.caseId, one.timing.headlineMs]));
  const pairs = after.flatMap((one) => {
    const was = mine.get(one.caseId);
    return was === null || was === undefined || one.timing.headlineMs === null ? [] : [[was, one.timing.headlineMs] as const];
  });
  return pairedChange(pairs.map(([was]) => was), pairs.map(([, now]) => now), p50, 5);
}

const seconds = (ms: number | null) => (ms === null ? "-" : (ms / 1000).toFixed(1));
const span = (interval: Interval | null) => (interval === null ? "" : ` (${seconds(interval.lo)} to ${seconds(interval.hi)})`);
export const distCell = (dist: Dist, which: "p50" | "p90" = "p50") => `${seconds(dist[which])}${span(dist[`${which}Interval`])}`;
const rate = (part: number, whole: number) => (whole === 0 ? "-" : `${part}/${whole}`);

export const label = (report: ConfigReport) => `${report.settings.model.replace(/^claude-/, "")} ${report.settings.effort} x${report.settings.maxExtraToolCalls}`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

/** Side by side. Times are seconds with the 95 percent bootstrap interval of the percentile in brackets. */
export function formatAnswerComparison(reports: readonly ConfigReport[]): string {
  const rows = reports.map((report) => {
    const answers = report.latency.all;
    return [
      label(report),
      `${report.asked}/${report.of}`,
      distCell(answers.headline),
      distCell(answers.headline, "p90"),
      distCell(report.latency.noTool.headline),
      distCell(answers.firstText),
      distCell(answers.settled),
      distCell(answers.done),
      `${report.quality.typeOk}/${report.asked}`,
      `${report.quality.shapeOk}/${report.asked}`,
      rate(report.quality.basisOk, report.quality.basisOf),
      `${report.outcomes.withheld} / ${report.outcomes.failed}`,
      `${report.checks.visibleRestarts}`,
      `${report.tools.calls} (${report.tools.answersWithCalls})`,
    ];
  });
  return table(
    ["configuration", "asked", "headline p50", "headline p90", "headline p50, no tool", "first text p50", "settled p50", "done p50", "type ok", "shape ok", "basis ok", "withheld / failed", "restarts", "extra calls (answers)"],
    rows,
  );
}

export function formatCategories(report: ConfigReport): string {
  return table(
    ["category", "asked", "delivered", "type ok", "shape ok", "basis ok", "headline p50", "done p50", "extra calls"],
    CATEGORIES.map((category) => {
      const one = report.byCategory[category];
      return [category, `${one.n}`, `${one.delivered}`, `${one.typeOk}`, `${one.shapeOk}`, one.basisOk === null ? "-" : `${one.basisOk}`, distCell(one.headline), distCell(one.done), `${one.toolCalls}`];
    }),
  );
}

export function formatLimiter(reports: readonly ConfigReport[]): string {
  return table(
    ["configuration", "retrieval p50", "process wait p50", "think p50", "first text to headline p50", "output tokens p50", "warm"],
    reports.map((report) => {
      const { limiter } = report;
      return [label(report), seconds(limiter.retrievalMs.p50), seconds(limiter.providerWaitMs.p50), distCell(limiter.thinkMs), seconds(limiter.writeToHeadlineMs.p50), `${limiter.outputTokens.p50 ?? "-"}`, `${Math.round(limiter.warmShare * 100)}%`];
    }),
  );
}

export function formatChecks(reports: readonly ConfigReport[]): string {
  const codes = FINDING_CODES.filter((code) => reports.some((report) => report.checks.answersWith[code] > 0));
  const repairs = [...new Set(reports.flatMap((report) => Object.keys(report.checks.repairs)))].sort();
  return table(
    ["configuration", "answers retried", ...codes, ...repairs.map((kind) => `repair ${kind}`)],
    reports.map((report) => [label(report), `${report.checks.answersRetried}`, ...codes.map((code) => `${report.checks.answersWith[code]}`), ...repairs.map((kind) => `${report.checks.repairs[kind] ?? 0}`)]),
  );
}

export function formatCost(reports: readonly ConfigReport[]): string {
  return table(
    ["configuration", "asked", "attempts", "extra-call round trips", "input tokens", "output tokens", "cache read", "cache write"],
    reports.map((report) => {
      const { usage } = report;
      return [label(report), `${report.asked}`, `${usage.attempts}`, `${usage.toolRoundTrips}`, `${usage.inputTokens}`, `${usage.outputTokens}`, `${usage.cacheReadTokens}`, `${usage.cacheWriteTokens}`];
    }),
  );
}

export function formatGate(report: ConfigReport, reference: ConfigReport): string {
  return table(
    ["rule", "result", "detail"],
    gateOf(report, reference).map((rule) => [rule.rule, rule.pass ? "pass" : "fail", rule.detail]),
  );
}
