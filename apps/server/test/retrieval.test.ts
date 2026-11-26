import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXCERPT_WORDS, excerptOf, FULL_PASSAGES, estimateTokens, fillLedger, packContext, queriesFor, retrieve, type Retrieved } from "../src/features/answer/retrieval.ts";
import { SourceLedger } from "../src/features/answer/ledger.ts";
import type { HistoryEntry, Turn } from "../src/features/answer/types.ts";
import { ONE, TWO, makePassage } from "../src/testing/answer-fixtures.ts";
import { fakeIndex } from "../src/testing/fake-index.ts";
import { sentences } from "./helpers.ts";

const turn = (question: string, history: HistoryEntry[] = [], scope: Turn["scope"] = null): Turn => ({ question, history, scope });
const entry = (n: number, question: string, cited: HistoryEntry["cited"]): HistoryEntry => ({ n, question, type: "answer", gist: "g", basis: "explicit", cited });
const SETTINGS = { searchLimit: 10, evidenceTokens: 8000 };

const retrievedOf = (passages: ReturnType<typeof makePassage>[], extra: Partial<Retrieved> = {}): Retrieved => ({
  queries: ["q"],
  hits: passages.map((passage, rank) => ({ passage, score: 1, reasons: [{ kind: "direct", channel: "keyword", rank }], duplicates: [] })),
  evidence: { level: "strong", signals: { topCoverage: 1, topIsDirect: true, channelAgreement: null, nearestCosine: null } },
  scoped: [],
  carry: [],
  ms: 1,
  ...extra,
});

describe("retrieving for a turn", () => {
  it("searches the bare question once for a first turn", async () => {
    const index = fakeIndex([ONE, TWO]);
    const retrieved = await retrieve(index, turn("apa itu kompos"), SETTINGS);
    assert.deepEqual(retrieved.queries, ["apa itu kompos"]);
    assert.equal(retrieved.hits.length, 2);
    assert.deepEqual(retrieved.carry, []);
  });

  it("keeps the bare question for a follow-up when its evidence is strong", async () => {
    const index = fakeIndex([ONE, TWO]);
    const retrieved = await retrieve(index, turn("bagaimana kalau hujan", [entry(1, "apa itu kompos", [ONE.id])]), SETTINGS);
    assert.deepEqual(retrieved.queries, ["bagaimana kalau hujan"]);
    assert.deepEqual(retrieved.carry, []);
  });

  it("searches again with the previous question for a weak follow-up, takes the better result, and carries the earlier citations over", async () => {
    const index = fakeIndex([ONE, TWO]);
    index.evidence = (query) => (query.startsWith("apa itu kompos") ? "strong" : "weak");
    const retrieved = await retrieve(index, turn("yang tadi bagaimana", [entry(1, "apa itu kompos", [ONE.id])]), SETTINGS);
    assert.deepEqual(retrieved.queries, ["yang tadi bagaimana", "apa itu kompos yang tadi bagaimana"]);
    assert.equal(retrieved.evidence.level, "strong");
    assert.deepEqual(retrieved.carry.map((passage) => passage.id), [ONE.id]);
  });

  it("keeps the bare question on a tie, which has less topic bleed", async () => {
    const index = fakeIndex([ONE]);
    index.evidence = () => "weak";
    const retrieved = await retrieve(index, turn("lalu", [entry(1, "pertama", [])]), SETTINGS);
    assert.equal(retrieved.queries.length, 2);
    assert.equal(retrieved.evidence.level, "weak");
    assert.deepEqual(queriesFor(turn("lalu", [entry(1, "pertama", [])])), { bare: "lalu", withHistory: "pertama lalu" });
  });

  it("pins both versions first for a revision scope", async () => {
    const index = fakeIndex([ONE, TWO]);
    const retrieved = await retrieve(index, turn("apa bedanya", [], { kind: "revision", active: TWO.id, superseded: ONE.id }), SETTINGS);
    assert.deepEqual(retrieved.scoped.map((passage) => passage.id), [TWO.id, ONE.id]);
  });

  it("answers from the document first for a document scope, searching inside it and then the whole collection", async () => {
    const index = fakeIndex([ONE, TWO]);
    const retrieved = await retrieve(index, turn("apa isinya", [], { kind: "document", noteId: TWO.noteId }), SETTINGS);
    assert.deepEqual(retrieved.scoped.map((passage) => passage.id), [TWO.id]);
    assert.deepEqual(index.queries.map((call) => call.options?.filter?.noteIds ?? null), [[TWO.noteId], null]);
    assert.equal(retrieved.hits.length, 2);
  });
});

describe("packing the context", () => {
  const long = (ordinal: number, words = 300) => makePassage(ordinal, sentences(ordinal, words));

  it("orders scoped passages, then hits in rank order, then carry-over, and collapses duplicates keeping the first", () => {
    const [a, b, c, d] = [long(1, 20), long(2, 20), long(3, 20), long(4, 20)] as const;
    const packed = packContext({ retrieved: retrievedOf([b, a], { scoped: [c, a], carry: [d, b] }), history: [], budgetTokens: 8000 });
    assert.deepEqual(packed.entries.map((item) => [item.passage.id, item.origin]), [[c.id, "scope"], [a.id, "scope"], [b.id, "retrieval"], [d.id, "carry_over"]]);
  });

  it("marks a passage that an earlier turn cited with the earliest such turn", () => {
    const history = [entry(1, "a", [ONE.id]), entry(2, "b", [ONE.id, TWO.id])];
    const packed = packContext({ retrieved: retrievedOf([ONE, TWO]), history, budgetTokens: 8000 });
    assert.deepEqual(packed.entries.map((item) => item.priorTurn), [1, 2]);
  });

  it("shows ranks past the full tier as excerpts, and still keeps their full text for the checks", () => {
    const passages = Array.from({ length: FULL_PASSAGES + 2 }, (_, index) => long(index + 1));
    const packed = packContext({ retrieved: retrievedOf(passages), history: [], budgetTokens: 100_000 });
    assert.deepEqual(packed.entries.map((item) => item.excerpted), [...Array(FULL_PASSAGES).fill(false), true, true]);
    assert.equal(excerptOf(passages[0]!.text).split(/\s+/).length, EXCERPT_WORDS);
    assert.ok(packed.entries[FULL_PASSAGES]!.passage.text.length > excerptOf(passages[0]!.text).length);
  });

  it("never cuts a passage by the budget: it is shown whole, as an excerpt, or not at all", () => {
    const passages = [long(1), long(2), long(3)];
    const oneFull = estimateTokens(passages[0]!.text) + 60;
    const packed = packContext({ retrieved: retrievedOf(passages), history: [], budgetTokens: oneFull + 200 });
    assert.equal(packed.entries[0]!.excerpted, false);
    assert.ok(packed.entries.length < passages.length || packed.entries.some((item) => item.excerpted));
    assert.equal(packed.entries.length + packed.dropped.length, passages.length);
    assert.ok(packed.estimatedTokens <= oneFull + 200);
  });

  it("keeps a superseded passage and its replacement together, or drops them together", () => {
    const newer = makePassage(5, sentences(5, 300), { supersedes: makePassage(4, "x").id });
    const older = makePassage(4, sentences(4, 300), { supersededBy: newer.id });
    const filler = long(6, 300);
    const budget = estimateTokens(older.text) + 60 + 100;
    const packed = packContext({ retrieved: retrievedOf([older, newer, filler]), history: [], budgetTokens: budget });
    const ids = packed.entries.map((item) => item.passage.id);
    assert.equal(ids.includes(older.id), ids.includes(newer.id));
    assert.ok(packed.dropped.includes(older.id));
  });

  it("fills the ledger in packed order with each entry's origin, prior turn and excerpt flag", () => {
    const ledger = new SourceLedger();
    fillLedger(ledger, packContext({ retrieved: retrievedOf([ONE], { carry: [TWO] }), history: [entry(1, "q", [TWO.id])], budgetTokens: 8000 }));
    assert.deepEqual(ledger.entries.map((item) => [item.sid, item.origin, item.priorTurn]), [["S1", "retrieval", null], ["S2", "carry_over", 1]]);
  });
});
