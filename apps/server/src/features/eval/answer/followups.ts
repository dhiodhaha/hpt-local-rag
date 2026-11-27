import { createHash } from "node:crypto";
import fs from "node:fs";
import { citedOf, historyOf, type Finished, type HistoryEntry, type StoredTurn } from "../../answer/index.ts";
import type { PassageId } from "../../search/index.ts";
import { distOf, table, type Dist } from "./report.ts";
import type { RunCase, RunRecord } from "./runner.ts";
import { timingOf } from "./score.ts";

/**
 * Follow-up latency, measured on two-turn conversations. `data/eval/followup-cases.json` holds the question text and stays
 * local, like the locked subset. A case is a first question and the follow-up asked right after its answer. `expect` says
 * what a good follow-up does with the first answer: `continue` builds on it, `shift` changes topic, so it must not cite it.
 *
 * Each case runs as two turns of the same engine the app uses, the follow-up with the history the first turn left. A report
 * carries numbers and case ids only.
 */
export type FollowupCase = {
  readonly id: string;
  readonly first: string;
  readonly followUp: string;
  readonly expect: "continue" | "shift";
};

export type FollowupSet = { readonly cases: readonly FollowupCase[]; readonly hash: string };

export function loadFollowups(file: string): FollowupSet {
  const cases = (JSON.parse(fs.readFileSync(file, "utf8")) as { cases: FollowupCase[] }).cases;
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error(`${file} repeats a case id.`);
  const canonical = [...cases].sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id)).map((item) => [item.id, item.first, item.followUp, item.expect]);
  return { cases, hash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}

export const firstId = (id: string) => `${id}-1`;
export const followId = (id: string) => `${id}-2`;

/** Every conversation is two ordinary cases, in order: the runner skips what a resumed file already holds. */
export function turnsOf(cases: readonly FollowupCase[]): RunCase[] {
  return cases.flatMap((item) => [
    { id: firstId(item.id), question: item.first },
    { id: followId(item.id), question: item.followUp },
  ]);
}

function storedOf(record: RunRecord, question: string): StoredTurn | null {
  const { answer, context, id } = record.finished;
  return answer === null ? null : { id, n: 1, at: record.at, question, scope: null, answer, context };
}

/** The history a follow-up gets: the first turn as the app would have stored it. Empty when the first turn was not delivered. */
export function historyFor(cases: readonly FollowupCase[]): (item: RunCase, records: readonly RunRecord[]) => readonly HistoryEntry[] {
  return (item, records) => {
    const owner = cases.find((candidate) => followId(candidate.id) === item.id);
    if (owner === undefined) return [];
    const first = records.find((record) => record.caseId === firstId(owner.id));
    const stored = first === undefined ? null : storedOf(first, owner.first);
    return stored === null ? [] : historyOf([stored]);
  };
}

type Pair = { readonly item: FollowupCase; readonly first: Finished; readonly follow: Finished };

/** Conversations where both turns ran. */
export function pairsOf(cases: readonly FollowupCase[], records: readonly RunRecord[]): Pair[] {
  const byId = new Map(records.map((record) => [record.caseId, record.finished]));
  return cases.flatMap((item) => {
    const first = byId.get(firstId(item.id));
    const follow = byId.get(followId(item.id));
    return first === undefined || follow === undefined ? [] : [{ item, first, follow }];
  });
}

export type TurnStats = {
  readonly n: number;
  readonly delivered: number;
  readonly firstText: Dist;
  /** The distribution is two humps, answers that searched again and answers that did not, so the mean shows what the median hides. */
  readonly firstTextMean: number | null;
  readonly headline: Dist;
  readonly done: Dist;
  /** Answers that made at least one tool call, granted or denied. */
  readonly calledTool: number;
  readonly searches: number;
  readonly queries: number;
  readonly evidence: Readonly<Record<string, number>>;
  readonly attempts: number;
};

export type RewriteStats = {
  readonly n: number;
  readonly used: number;
  readonly ms: Dist;
  readonly fallbacks: Readonly<Record<string, number>>;
};

export type FollowupReport = {
  readonly runId: string;
  readonly conversations: number;
  readonly first: TurnStats;
  readonly follow: TurnStats;
  /** The follow-ups that build on the first answer. A shift is a new question and behaves like a first one. */
  readonly followContinue: TurnStats;
  /** Follow-ups whose context holds a passage the first turn cited, over those whose first turn cited anything. */
  readonly carryOver: readonly [number, number];
  readonly rewrite: RewriteStats | null;
  readonly citations: {
    /** Follow-ups that delivered an answer with a citation. */
    readonly cited: number;
    /** Cited ids outside the answer's own context, or the index does not hold. Must be zero. */
    readonly outsideContext: number;
    readonly unresolved: number;
    /** `continue` follow-ups that cite a passage the first turn cited, over `continue` follow-ups that cite anything. */
    readonly continueReuse: readonly [number, number];
    /** `shift` follow-ups that cite a passage the first turn cited: topic bleed. Over `shift` follow-ups that cite anything. */
    readonly shiftBleed: readonly [number, number];
  };
  readonly ids: { readonly firstNotDelivered: readonly string[]; readonly followNotDelivered: readonly string[]; readonly followCalledTool: readonly string[] };
};

function meanOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
}

function statsOf(finished: readonly Finished[]): TurnStats {
  const timings = finished.map(timingOf);
  const evidence: Record<string, number> = {};
  for (const one of finished) evidence[one.trace.retrieval.evidence] = (evidence[one.trace.retrieval.evidence] ?? 0) + 1;
  return {
    n: finished.length,
    delivered: finished.filter((one) => one.outcome.kind === "delivered").length,
    firstText: distOf(timings.map((one) => one.firstTextMs)),
    firstTextMean: meanOf(timings.map((one) => one.firstTextMs)),
    headline: distOf(timings.map((one) => one.headlineMs)),
    done: distOf(timings.map((one) => one.doneMs)),
    calledTool: finished.filter((one) => one.trace.tools.length > 0).length,
    searches: finished.reduce((sum, one) => sum + one.trace.tools.filter((call) => call.tool === "search" && !call.denied).length, 0),
    queries: finished.reduce((sum, one) => sum + one.trace.retrieval.queries, 0),
    evidence,
    attempts: finished.reduce((sum, one) => sum + one.trace.attempts.length, 0),
  };
}

function rewriteOf(finished: readonly Finished[]): RewriteStats | null {
  const traces = finished.flatMap((one) => one.trace.rewrite ?? []);
  if (traces.length === 0) return null;
  const fallbacks: Record<string, number> = {};
  for (const trace of traces) if (trace.fallback !== null) fallbacks[trace.fallback] = (fallbacks[trace.fallback] ?? 0) + 1;
  return { n: traces.length, used: traces.filter((trace) => trace.used).length, ms: distOf(traces.map((trace) => trace.ms)), fallbacks };
}

export type FollowupLookup = (ids: readonly PassageId[]) => ReadonlyMap<PassageId, unknown>;

export function summarizeFollowups(input: { readonly runId: string; readonly cases: readonly FollowupCase[]; readonly records: readonly RunRecord[]; readonly lookup: FollowupLookup }): FollowupReport {
  const { runId, cases, records, lookup } = input;
  const pairs = pairsOf(cases, records);
  const follows = pairs.map((pair) => pair.follow);
  let cited = 0;
  let outsideContext = 0;
  let unresolved = 0;
  const carryOver: [number, number] = [0, 0];
  const reuse = { continue: [0, 0] as [number, number], shift: [0, 0] as [number, number] };
  for (const { item, first, follow } of pairs) {
    const earlierCited = first.answer === null ? [] : citedOf(first.answer);
    if (earlierCited.length > 0) {
      carryOver[1] += 1;
      if (earlierCited.some((id) => follow.context.includes(id))) carryOver[0] += 1;
    }
    if (follow.answer === null) continue;
    const ids = citedOf(follow.answer);
    if (ids.length === 0) continue;
    cited += 1;
    const context = new Set(follow.context);
    const found = lookup(ids);
    outsideContext += ids.filter((id) => !context.has(id)).length;
    unresolved += ids.filter((id) => !found.has(id)).length;
    const earlier = new Set(first.answer === null ? [] : citedOf(first.answer));
    const slot = reuse[item.expect];
    slot[1] += 1;
    if (ids.some((id) => earlier.has(id))) slot[0] += 1;
  }
  return {
    runId,
    conversations: pairs.length,
    first: statsOf(pairs.map((pair) => pair.first)),
    follow: statsOf(follows),
    followContinue: statsOf(pairs.filter((one) => one.item.expect === "continue").map((one) => one.follow)),
    carryOver,
    rewrite: rewriteOf(follows),
    citations: { cited, outsideContext, unresolved, continueReuse: reuse.continue, shiftBleed: reuse.shift },
    ids: {
      firstNotDelivered: pairs.filter((pair) => pair.first.outcome.kind !== "delivered").map((pair) => pair.item.id),
      followNotDelivered: pairs.filter((pair) => pair.follow.outcome.kind !== "delivered").map((pair) => pair.item.id),
      followCalledTool: pairs.filter((pair) => pair.follow.trace.tools.length > 0).map((pair) => pair.item.id),
    },
  };
}

const seconds = (ms: number | null) => (ms === null ? "-" : (ms / 1000).toFixed(1));
const pair = (dist: Dist) => `${seconds(dist.p50)} / ${seconds(dist.p90)}`;
const share = (part: number, whole: number) => (whole === 0 ? "-" : `${part}/${whole}`);
const mix = (counts: Readonly<Record<string, number>>) => (Object.keys(counts).length === 0 ? "-" : Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(", "));

/** Seconds are p50 / p90 over the conversations that ran both turns. */
export function formatFollowups(reports: readonly FollowupReport[]): string {
  const lines: (readonly string[])[] = [];
  for (const report of reports) {
    const { first, follow, followContinue: cont } = report;
    lines.push(
      [`${report.runId}: conversations`, String(first.n), String(follow.n), String(cont.n)],
      ["delivered", share(first.delivered, first.n), share(follow.delivered, follow.n), share(cont.delivered, cont.n)],
      ["first text, s", pair(first.firstText), pair(follow.firstText), pair(cont.firstText)],
      ["first text mean, s", seconds(first.firstTextMean), seconds(follow.firstTextMean), seconds(cont.firstTextMean)],
      ["headline, s", pair(first.headline), pair(follow.headline), pair(cont.headline)],
      ["done, s", pair(first.done), pair(follow.done), pair(cont.done)],
      ["answers that called a tool", share(first.calledTool, first.n), share(follow.calledTool, follow.n), share(cont.calledTool, cont.n)],
      ["search queries before the answer", String(first.queries), String(follow.queries), String(cont.queries)],
      ["evidence", mix(first.evidence), mix(follow.evidence), mix(cont.evidence)],
      ["follow-up context holds a first-turn citation", "-", share(...report.carryOver), "-"],
      ["attempts", String(first.attempts), String(follow.attempts), String(cont.attempts)],
    );
  }
  const out = [table(["", "first turn", "follow-up", "follow-up, continue only"], lines)];
  for (const report of reports) {
    const { citations, rewrite, ids } = report;
    out.push(
      "",
      `${report.runId} citations: ${citations.cited} follow-ups cite, ${citations.outsideContext} ids outside their context, ${citations.unresolved} unresolved. Follow-ups that cite a first-turn passage: continue ${share(...citations.continueReuse)}, shift (topic bleed) ${share(...citations.shiftBleed)}.`,
    );
    if (rewrite !== null) out.push(`${report.runId} rewrite: ${rewrite.used}/${rewrite.n} used, ${pair(rewrite.ms)} s p50 / p90, fallbacks ${mix(rewrite.fallbacks)}.`);
    out.push(`${report.runId} ids: first turn not delivered ${ids.firstNotDelivered.join(", ") || "none"}; follow-up not delivered ${ids.followNotDelivered.join(", ") || "none"}; follow-up called a tool ${ids.followCalledTool.join(", ") || "none"}.`);
  }
  return out.join("\n");
}
