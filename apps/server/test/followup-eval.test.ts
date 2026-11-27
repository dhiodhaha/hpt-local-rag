import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { Finished } from "../src/features/answer/engine.ts";
import { emptyAnswer } from "../src/features/answer/fold.ts";
import type { CompleteAnswer } from "../src/features/answer/types.ts";
import { followId, firstId, formatFollowups, historyFor, loadFollowups, summarizeFollowups, turnsOf, type FollowupCase } from "../src/features/eval/answer/followups.ts";
import type { RunRecord } from "../src/features/eval/answer/runner.ts";
import type { PassageId } from "../src/features/search/index.ts";
import { ONE, TWO } from "../src/testing/answer-fixtures.ts";
import { tempDir } from "./helpers.ts";

const CASES: FollowupCase[] = [
  { id: "c1", first: "pertanyaan satu", followUp: "lanjutan satu", expect: "continue" },
  { id: "c2", first: "pertanyaan dua", followUp: "ganti topik", expect: "shift" },
];

const answerCiting = (...ids: PassageId[]): CompleteAnswer => ({ ...emptyAnswer(), type: "answer", headline: "ringkas", summary: [{ kind: "cite", passages: ids }] });

type Shape = { readonly cited?: readonly PassageId[]; readonly context?: readonly PassageId[]; readonly firstTextMs?: number; readonly tools?: number; readonly rewrite?: Finished["trace"]["rewrite"] };

function finished(shape: Shape): Finished {
  const answer = answerCiting(...(shape.cited ?? []));
  const attempt = { firstTextMs: shape.firstTextMs ?? 1000, committedMs: [{ name: "headline", ms: (shape.firstTextMs ?? 1000) + 100 }] };
  const tools = Array.from({ length: shape.tools ?? 0 }, () => ({ tool: "search", denied: false }));
  const trace = { retrieval: { evidence: "strong", queries: 1 }, rewrite: shape.rewrite ?? null, tools, attempts: [attempt], totalMs: 5000 };
  return { id: "x", outcome: { kind: "delivered" }, answer, context: shape.context ?? [], trace } as unknown as Finished;
}

const record = (caseId: string, shape: Shape): RunRecord => ({ v: 1, runId: "r", subsetHash: "h", caseId, at: "2026-11-27T00:00:00Z", finished: finished(shape) });

const rewriteTrace = (ms: number) => ({ ms, used: true, fallback: null, picked: "rewrite" as const, text: "kueri" });

describe("the follow-up cases", () => {
  it("run as a first turn and then its follow-up, in that order", () => {
    assert.deepEqual(turnsOf(CASES).map((turn) => turn.id), ["c1-1", "c1-2", "c2-1", "c2-2"]);
    assert.deepEqual(turnsOf(CASES).map((turn) => turn.question), ["pertanyaan satu", "lanjutan satu", "pertanyaan dua", "ganti topik"]);
  });

  it("give the follow-up the first turn as its history, and a first turn none", () => {
    const history = historyFor(CASES);
    const records = [record(firstId("c1"), { cited: [ONE.id, TWO.id] })];
    assert.deepEqual(history({ id: firstId("c1"), question: "" }, records), []);
    const [entry] = history({ id: followId("c1"), question: "" }, records);
    assert.deepEqual([entry?.n, entry?.question, entry?.type, entry?.gist, entry?.cited], [1, "pertanyaan satu", "answer", "ringkas", [ONE.id, TWO.id]]);
    assert.deepEqual(history({ id: followId("c2"), question: "" }, records), []);
  });

  it("refuse a set that repeats an id, and hash the questions", () => {
    const file = path.join(tempDir(), "cases.json");
    fs.writeFileSync(file, JSON.stringify({ cases: [CASES[0], CASES[0]] }));
    assert.throws(() => loadFollowups(file), /repeats a case id/);
    fs.writeFileSync(file, JSON.stringify({ cases: CASES }));
    const one = loadFollowups(file).hash;
    fs.writeFileSync(file, JSON.stringify({ cases: [CASES[0], { ...CASES[1]!, followUp: "lain" }] }));
    assert.notEqual(loadFollowups(file).hash, one);
  });
});

describe("summarizing a follow-up run", () => {
  const records = [
    record(firstId("c1"), { cited: [ONE.id], firstTextMs: 1500 }),
    record(followId("c1"), { cited: [ONE.id], context: [TWO.id, ONE.id], firstTextMs: 3000, rewrite: rewriteTrace(1200) }),
    record(firstId("c2"), { cited: [ONE.id], firstTextMs: 2500, tools: 1 }),
    record(followId("c2"), { cited: [TWO.id], context: [TWO.id], firstTextMs: 13_000, tools: 1, rewrite: rewriteTrace(1400) }),
  ];
  const report = summarizeFollowups({ runId: "r", cases: CASES, records, lookup: (ids) => new Map(ids.map((id) => [id, true])) });

  it("counts tool use, time to first text and the rewrite per turn kind", () => {
    assert.deepEqual([report.conversations, report.first.calledTool, report.follow.calledTool, report.followContinue.calledTool], [2, 1, 1, 0]);
    assert.deepEqual([report.first.firstTextMean, report.follow.firstTextMean, report.followContinue.firstTextMean], [2000, 8000, 3000]);
    assert.deepEqual([report.rewrite?.n, report.rewrite?.used, report.rewrite?.ms.p90], [2, 2, 1400]);
  });

  it("counts a follow-up whose context holds a first-turn citation, and reuse and bleed of first-turn citations by expectation", () => {
    assert.deepEqual(report.carryOver, [1, 2]);
    assert.deepEqual([report.citations.continueReuse, report.citations.shiftBleed], [[1, 1], [0, 1]]);
    assert.deepEqual([report.citations.outsideContext, report.citations.unresolved], [0, 0]);
  });

  it("flags a cited id that the follow-up's own context lacks", () => {
    const broken = [...records.slice(0, 3), record(followId("c2"), { cited: [TWO.id], context: [] })];
    const checked = summarizeFollowups({ runId: "r", cases: CASES, records: broken, lookup: (ids) => new Map(ids.filter((id) => id === ONE.id).map((id) => [id, true])) });
    assert.deepEqual([checked.citations.outsideContext, checked.citations.unresolved], [1, 1]);
  });

  it("leaves out a conversation whose follow-up has not run", () => {
    const partial = summarizeFollowups({ runId: "r", cases: CASES, records: records.slice(0, 3), lookup: () => new Map() });
    assert.equal(partial.conversations, 1);
  });

  it("prints numbers and case ids, never a question", () => {
    const text = formatFollowups([report]);
    assert.match(text, /rewrite: 2\/2 used/);
    for (const item of CASES) assert.equal(text.includes(item.first) || text.includes(item.followUp), false);
  });
});
