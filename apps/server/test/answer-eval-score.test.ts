import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEngine, emptyAnswer, loadPromptTemplate, memoryTraceSink, type CompleteAnswer, type Finished } from "../src/features/answer/index.ts";
import { bootstrap, citedOutsideRevision, p50, pairedChange, score, type AnswerCase, type PassageLookup } from "../src/features/eval/index.ts";
import { chunked, scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import type { Passage } from "../src/features/search/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { ONE, TWO, answerJson, makePassage } from "./answer-fixtures.ts";
import { fakeIndex } from "./fake-index.ts";

const SETTINGS = { model: "claude-test", effort: "medium", maxExtraToolCalls: 2, searchLimit: 10, evidenceTokens: 8000 } as const;
const PROMPT = loadPromptTemplate(answerConfig.systemPromptDoc);
const lookupOf =
  (passages: readonly Passage[]): PassageLookup =>
  (ids) =>
    new Map(passages.filter((passage) => ids.includes(passage.id)).map((passage) => [passage.id, passage]));
const BOTH = lookupOf([ONE, TWO]);

async function finish(script: ScriptedAttempt[], passages: Passage[] = [ONE, TWO]): Promise<Finished> {
  const engine = createEngine({ index: fakeIndex(passages), provider: scriptedProvider(script), prompt: PROMPT, canary: "CANARY-test", traces: memoryTraceSink(), settings: SETTINGS });
  return engine.ask({ question: "Apakah kompos boleh?", history: [], scope: null });
}

const item = (category: AnswerCase["category"], extra: Partial<AnswerCase> = {}): AnswerCase => ({ id: "q-test-1", category, question: "x", expectedNotes: [], origin: "written", ...extra });

const NONE = {
  type: "insufficient",
  basis: null,
  headline: null,
  headline_short: null,
  summary: null,
  inference_note: null,
  notes: [],
  dalil: [],
  quotes: [],
  clarifying_question: null,
  clarifying_options: [],
  message: "Belum ada putusan yang menjawab hal ini.",
};
const note = (kind: string, sources: string[]) => ({ id: "N1", kind, title: "Judul", text: "Isi.", basis: "explicit", quote: null, sources });

describe("scoring one answer", () => {
  it("scores an explicit answer on type, basis, citations, path, timing and the overlap with HPT's references", async () => {
    const finished = await finish([{ chunks: chunked(answerJson(), 20) }]);
    const result = score(item("explicit", { expectedNotes: [ONE.noteId, "putusan/tidak-ada"] }), finished, BOTH);
    assert.deepEqual([result.outcome, result.answerType, result.typeOk, result.shapeOk, result.basisOk, result.path], ["delivered", "answer", true, true, true, "no_tool"]);
    assert.deepEqual(result.citations, { cited: 2, outsideContext: 0, unresolved: 0, supersededOutsideRevision: 0, matchesFictional: false });
    assert.deepEqual(result.overlap, { expected: 2, inContext: 1, cited: 1 });
    assert.ok(result.timing.headlineMs !== null && result.timing.firstTextMs !== null && result.timing.headlineMs >= result.timing.firstTextMs);
    assert.ok(result.timing.contentMs === result.timing.headlineMs && result.timing.doneMs >= result.timing.headlineMs);
    assert.equal(result.review, false);
  });

  it("marks the basis wrong when an inferred question gets an explicit answer, and the type wrong when an insufficient question gets an answer", async () => {
    const finished = await finish([{ chunks: [answerJson()] }]);
    assert.equal(score(item("inferred"), finished, BOTH).basisOk, false);
    const wrong = score(item("insufficient"), finished, BOTH);
    assert.deepEqual([wrong.typeOk, wrong.shapeOk, wrong.basisOk], [false, false, null]);
    const right = score(item("insufficient"), await finish([{ chunks: [answerJson(NONE)] }]), BOTH);
    assert.deepEqual([right.answerType, right.typeOk, right.shapeOk, right.timing.headlineMs, right.timing.contentMs !== null], ["insufficient", true, true, null, true]);
  });

  it("wants a difference note for a differing question and a revision note with two sources for a revision question", async () => {
    const withNote = (kind: string, sources: string[]) => finish([{ chunks: [answerJson({ notes: [note(kind, sources)] })] }]);
    assert.equal(score(item("differing"), await withNote("difference", ["S1"]), BOTH).shapeOk, true);
    assert.equal(score(item("differing"), await withNote("practical", ["S1"]), BOTH).shapeOk, false);
    assert.equal(score(item("revision"), await withNote("revision", ["S1"]), BOTH).shapeOk, false);
    assert.equal(score(item("revision"), await withNote("revision", ["S1", "S2"]), BOTH).shapeOk, true);
  });

  it("passes a fictional question only when the invented reference is listed and no passage with its number and year is cited", async () => {
    const real = makePassage(3, "Teks nyata.", { number: "74", year: 2017 });
    const listed = { unverified_references: [{ as_stated: "Fatwa 74/2017", note: "Tidak ditemukan." }] };
    const ref = { number: "74", year: 2017 };
    const flagged = score(item("fictional", { fictionalRef: ref }), await finish([{ chunks: [answerJson(listed)] }]), BOTH);
    assert.deepEqual([flagged.typeOk, flagged.shapeOk, flagged.review], [true, true, true]);
    const confirmed = await finish([{ chunks: [answerJson({ ...listed, summary: "Isinya begini [S3]." })] }], [ONE, TWO, real]);
    const result = score(item("fictional", { fictionalRef: ref }), confirmed, lookupOf([ONE, TWO, real]));
    assert.deepEqual([result.typeOk, result.shapeOk, result.citations.matchesFictional], [true, false, true]);
    const silent = score(item("fictional", { fictionalRef: ref }), await finish([{ chunks: [answerJson()] }]), BOTH);
    assert.deepEqual([silent.typeOk, silent.shapeOk], [false, false]);
  });

  it("counts a withheld answer as passing nothing, keeps its findings, and counts a visible restart apart from a silent one", async () => {
    const bad = answerJson({ summary: "Kompos [S9]." });
    const withheld = score(item("explicit"), await finish([{ chunks: [bad] }, { chunks: [bad] }]), BOTH);
    assert.deepEqual([withheld.outcome, withheld.typeOk, withheld.shapeOk, withheld.basisOk, withheld.answerType], ["withheld", false, false, false, null]);
    assert.deepEqual([withheld.findings, withheld.attempts, withheld.testSet], [["unknown_source"], 2, false]);
    const restarted = score(item("explicit"), await finish([{ chunks: chunked(bad, 25) }, { chunks: [answerJson()] }]), BOTH);
    assert.deepEqual([restarted.outcome, restarted.visibleRestart, restarted.attempts, restarted.findings], ["delivered", true, 2, ["unknown_source"]]);
    const quiet = score(item("explicit"), await finish([{ chunks: ['{"type" "answer"}'] }, { chunks: [answerJson()] }]), BOTH);
    assert.deepEqual([quiet.visibleRestart, quiet.findings], [false, ["bad_json"]]);
  });

  it("counts granted and denied extra calls and their searches, and puts the answer on the tool path", async () => {
    const call = (name: string, args: Record<string, string>) => ({ afterChunk: 0, name, args });
    const calls = [call("search", { query: "satu" }), call("get_passage", { id: "S1" }), call("search", { query: "tiga" })];
    const finished = await finish([{ chunks: ["Mencari. ", answerJson()], toolCalls: calls }]);
    const result = score(item("explicit"), finished, BOTH);
    assert.deepEqual([result.path, result.tools], ["tool", { granted: 2, denied: 1, searches: 1 }]);
  });

  it("flags a cited id the index cannot resolve", async () => {
    const result = score(item("explicit"), await finish([{ chunks: [answerJson()] }]), lookupOf([ONE]));
    assert.equal(result.citations.unresolved, 1);
  });
});

describe("superseded citations", () => {
  it("leaves out what a revision note cites, because a superseded passage may appear there (D10h)", () => {
    const revision = { id: "N1", kind: "revision", title: "t", text: "t", basis: "explicit", quote: null, sources: [TWO.id] } as const;
    const practical = { ...revision, id: "N2", kind: "practical" } as const;
    const answer: CompleteAnswer = { ...emptyAnswer(), type: "answer", summary: [{ kind: "cite", passages: [ONE.id] }], notes: [revision, practical] };
    assert.deepEqual(citedOutsideRevision(answer), [ONE.id, TWO.id]);
    assert.deepEqual(citedOutsideRevision({ ...answer, notes: [revision] }), [ONE.id]);
  });
});

describe("the noise floor", () => {
  const values = Array.from({ length: 40 }, (_, at) => 2000 + at * 100);

  it("brackets the median with a seeded interval, and the same seed gives the same interval", () => {
    const first = bootstrap(values, p50, 7);
    assert.deepEqual(first, bootstrap(values, p50, 7));
    assert.ok(first.lo <= p50(values) && p50(values) <= first.hi && first.lo < first.hi);
  });

  it("calls a shift larger than the interval a change, and a wobble smaller than it noise", () => {
    const shifted = pairedChange(values, values.map((value) => value + 3000), p50, 3);
    assert.deepEqual([shifted.change, shifted.clears], [3000, true]);
    const wobble = pairedChange(values, values.map((value, at) => value + (at % 2 === 0 ? 200 : -200)), p50, 3);
    assert.equal(wobble.clears, false);
  });
});
