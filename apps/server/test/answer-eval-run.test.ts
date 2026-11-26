import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createEngine, loadPromptTemplate, memoryTraceSink } from "../src/features/answer/index.ts";
import {
  formatAnswerComparison,
  formatCategories,
  formatCategoryMatrix,
  formatChecks,
  formatCost,
  formatGate,
  formatLimiter,
  gateOf,
  readRecords,
  runAnswerEval,
  summarizeRun,
  type AnswerCase,
  type PassageLookup,
} from "../src/features/eval/index.ts";
import { scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import type { Passage } from "../src/features/search/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { GOOD_ANSWER, ONE, TWO, answerJson } from "./answer-fixtures.ts";
import { fakeIndex } from "./fake-index.ts";

const SETTINGS = { model: "claude-test", effort: "medium", maxExtraToolCalls: 2, searchLimit: 10, evidenceTokens: 8000 } as const;
const PROMPT = loadPromptTemplate(answerConfig.systemPromptDoc);
const HASH = "a".repeat(64);
const LIMIT = { code: "rate_limited", detail: "limit resets later", resetsAt: null } as const;

const cases: AnswerCase[] = [
  { id: "q-00000001-1", category: "explicit", question: "Pertanyaan rahasia satu?", expectedNotes: [ONE.noteId], origin: "qa_pairs" },
  { id: "q-00000002-1", category: "inferred", question: "Pertanyaan rahasia dua?", expectedNotes: [], origin: "qa_pairs" },
  { id: "q-00000003-1", category: "insufficient", question: "Pertanyaan rahasia tiga?", expectedNotes: [], origin: "written" },
];

const lookup: PassageLookup = (ids) => new Map([ONE, TWO].filter((passage: Passage) => ids.includes(passage.id)).map((passage) => [passage.id, passage]));

function setup(script: ScriptedAttempt[]) {
  const provider = scriptedProvider(script);
  const traces = memoryTraceSink();
  const engine = createEngine({ index: fakeIndex([ONE, TWO]), provider, prompt: PROMPT, canary: "CANARY-test", traces, settings: SETTINGS });
  return { engine, provider, traces };
}

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hpt-answer-eval-")), "answers-test.jsonl");
}

const NONE = { ...GOOD_ANSWER, type: "insufficient", basis: null, headline: null, headline_short: null, summary: null, notes: [], dalil: [], quotes: [], message: "Belum ada." };

describe("running the locked subset", () => {
  it("asks each case once, in order, labels the trace with the case id and applies the overrides", async () => {
    const { engine, provider, traces } = setup([{ chunks: [answerJson()] }, { chunks: [answerJson({ basis: "inferred", inference_note: "Disimpulkan." })] }, { chunks: [answerJson(NONE)] }]);
    const file = tempFile();
    const progress: string[] = [];
    const run = await runAnswerEval({ engine, cases, subsetHash: HASH, runId: "t", runFile: file, overrides: { effort: "low", maxExtraToolCalls: 0 }, onProgress: (done, total, record) => progress.push(`${done}/${total} ${record.caseId}`) });

    assert.deepEqual(run.remaining, []);
    assert.equal(run.stoppedBy, null);
    assert.deepEqual(progress, ["1/3 q-00000001-1", "2/3 q-00000002-1", "3/3 q-00000003-1"]);
    assert.deepEqual(traces.traces.map((trace) => [trace.label, trace.effort, trace.maxExtraToolCalls]), cases.map((item) => [item.id, "low", 0]));
    assert.deepEqual(provider.requests.map((request) => request.profile.tools.length), [0, 0, 0]);
    assert.deepEqual(readRecords(file).map((record) => [record.caseId, record.subsetHash, record.finished.outcome.kind]), cases.map((item) => [item.id, HASH, "delivered"]));
    assert.ok(provider.warmed.length >= 1, "the engine is warmed before the first ask");
  });

  it("stops at a usage limit without recording that question, and a second run finishes without repeating the first", async () => {
    const file = tempFile();
    const first = setup([{ chunks: [answerJson()] }, { chunks: [], fail: LIMIT }]);
    const stopped = await runAnswerEval({ engine: first.engine, cases, subsetHash: HASH, runId: "t", runFile: file });
    assert.deepEqual([stopped.stoppedBy?.code, stopped.stoppedBy?.caseId, stopped.remaining], ["rate_limited", "q-00000002-1", ["q-00000002-1", "q-00000003-1"]]);
    assert.deepEqual(readRecords(file).map((record) => record.caseId), ["q-00000001-1"]);

    const second = setup([{ chunks: [answerJson()] }, { chunks: [answerJson(NONE)] }]);
    const resumed = await runAnswerEval({ engine: second.engine, cases, subsetHash: HASH, runId: "t", runFile: file });
    assert.deepEqual([resumed.stoppedBy, resumed.remaining, second.provider.requests.length], [null, [], 2]);
    assert.deepEqual(readRecords(file).map((record) => record.caseId), cases.map((item) => item.id));
  });

  it("ignores a half-written last line, so the case behind it is asked again", async () => {
    const file = tempFile();
    const full = setup([{ chunks: [answerJson()] }]);
    await runAnswerEval({ engine: full.engine, cases: cases.slice(0, 1), subsetHash: HASH, runId: "t", runFile: file });
    fs.appendFileSync(file, '{"v":1,"runId":"t","caseId":"q-0000');
    const again = setup([{ chunks: [answerJson()] }, { chunks: [answerJson(NONE)] }]);
    await runAnswerEval({ engine: again.engine, cases: cases.slice(0, 2), subsetHash: HASH, runId: "t", runFile: file });
    assert.deepEqual(again.provider.requests.length, 1);
  });

  it("refuses to mix two subsets in one run file", async () => {
    const file = tempFile();
    const first = setup([{ chunks: [answerJson()] }]);
    await runAnswerEval({ engine: first.engine, cases: cases.slice(0, 1), subsetHash: HASH, runId: "t", runFile: file });
    const second = setup([{ chunks: [answerJson()] }]);
    await assert.rejects(() => runAnswerEval({ engine: second.engine, cases, subsetHash: "b".repeat(64), runId: "t", runFile: file }), /another subset/);
  });

  it("records a withheld answer and a failure that a retry cannot fix as results, not as a stop", async () => {
    const bad = answerJson({ summary: "Kompos [S9]." });
    const { engine } = setup([{ chunks: [bad] }, { chunks: [bad] }, { chunks: [], fail: { code: "crashed", detail: "x", resetsAt: null } }, { chunks: [], fail: { code: "crashed", detail: "x", resetsAt: null } }]);
    const file = tempFile();
    const run = await runAnswerEval({ engine, cases: cases.slice(0, 2), subsetHash: HASH, runId: "t", runFile: file });
    assert.deepEqual(run.records.map((record) => record.finished.outcome.kind), ["withheld", "failed"]);
    assert.equal(run.stoppedBy, null);
  });
});

describe("the report", () => {
  async function report(script: ScriptedAttempt[], runCases: AnswerCase[] = cases) {
    const { engine } = setup(script);
    const file = tempFile();
    const run = await runAnswerEval({ engine, cases: runCases, subsetHash: HASH, runId: "t", runFile: file });
    return summarizeRun({ runId: "t", records: run.records, cases: runCases, lookup });
  }

  it("counts outcomes, matches, citations, checks and cost from the stored results", async () => {
    const bad = answerJson({ summary: "Kompos [S9]." });
    const result = await report([{ chunks: [answerJson()], usage: { inputTokens: 5, outputTokens: 70, cacheReadTokens: 100, cacheWriteTokens: 10 } }, { chunks: [bad] }, { chunks: [bad] }, { chunks: [answerJson(NONE)] }]);
    assert.deepEqual([result.asked, result.of, result.outcomes], [3, 3, { delivered: 2, withheld: 1, failed: 0, cancelled: 0 }]);
    assert.deepEqual([result.quality.typeOk, result.quality.shapeOk, result.quality.basisOk, result.quality.basisOf], [2, 2, 1, 2]);
    assert.deepEqual(result.byCategory.insufficient, { ...result.byCategory.insufficient, n: 1, delivered: 1, typeOk: 1, shapeOk: 1, basisOk: null });
    assert.deepEqual([result.citations.cited, result.citations.unresolved, result.citations.outsideContext], [2, 0, 0]);
    assert.deepEqual([result.checks.answersWith.unknown_source, result.checks.answersRetried, result.ids.withheld, result.ids.typeMismatch], [1, 1, ["q-00000002-1"], ["q-00000002-1"]]);
    assert.deepEqual(result.overlap, { questions: 1, expected: 1, inContext: 1, cited: 1 });
    assert.deepEqual([result.usage.attempts, result.usage.outputTokens, result.usage.cacheReadTokens], [4, 70, 100]);
    assert.equal(result.latency.all.headline.n, 1, "the headline time counts delivered answers only");
  });

  it("gates a configuration against the reference with a tolerance of two cases", async () => {
    const reference = await report([{ chunks: [answerJson()] }, { chunks: [answerJson({ basis: "inferred", inference_note: "Disimpulkan." })] }, { chunks: [answerJson(NONE)] }]);
    const weaker = await report([{ chunks: [answerJson(NONE)] }, { chunks: [answerJson({ basis: "inferred", inference_note: "Disimpulkan." })] }, { chunks: [answerJson(NONE)] }]);
    const verdict = (candidate: typeof reference) => gateOf(candidate, reference).map((rule) => rule.pass);
    assert.deepEqual(verdict(reference), [true, true, true, true, true, true]);
    assert.deepEqual(verdict(weaker), [true, true, true, true, true, true], "one case lower is inside the tolerance");
    const partial = await report([{ chunks: [answerJson()] }], cases.slice(0, 1));
    assert.equal(gateOf({ ...partial, of: 3 }, reference)[0]?.pass, false, "an incomplete run does not pass");
  });

  it("prints numbers and ids only, never a question or an answer", async () => {
    const result = await report([{ chunks: [answerJson()] }, { chunks: [answerJson({ basis: "inferred", inference_note: "Disimpulkan." })] }, { chunks: [answerJson(NONE)] }]);
    const text = [formatAnswerComparison([result]), formatLimiter([result]), formatChecks([result]), formatCost([result]), formatCategories(result), formatCategoryMatrix([result]), formatGate(result, result), JSON.stringify(result)].join("\n");
    assert.match(text, /test medium x2/);
    for (const secret of ["Pertanyaan rahasia", String(GOOD_ANSWER.headline), "Kompos belum matang", "Belum ada"]) assert.equal(text.includes(secret), false, secret);
  });
});
