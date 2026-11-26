import assert from "node:assert/strict";
import { test } from "node:test";
import { ceilingAt, hitAt, rankExpected, recallAt, reciprocalRank, summarizeCases } from "../src/features/eval/metrics.ts";
import { loadCases } from "../src/features/eval/retrieval.ts";

test("a duplicate collapsed into a hit still counts as the expected note", () => {
  const ranks = rankExpected(["putusan/a", "putusan/b", "putusan/c"], [["putusan/x"], ["putusan/b", "putusan/a"]]);
  assert.deepEqual(ranks, { "putusan/a": 2, "putusan/b": 2, "putusan/c": null });
});

test("recall, hit rate and reciprocal rank follow the rank of the expected notes", () => {
  const ranks = { "putusan/a": 3, "putusan/b": 8, "putusan/c": null, "putusan/d": null };
  assert.equal(recallAt(ranks, 5), 0.25);
  assert.equal(recallAt(ranks, 10), 0.5);
  assert.equal(hitAt(ranks, 2), false);
  assert.equal(hitAt(ranks, 3), true);
  assert.equal(reciprocalRank(ranks), 1 / 3);
  assert.equal(reciprocalRank({ "putusan/a": null }), 0);
});

test("k slots cannot cover more than k expected notes, so the ceiling is below 1 for long reference lists", () => {
  assert.equal(ceilingAt(20, 5), 0.25);
  assert.equal(ceilingAt(3, 5), 1);
});

test("a summary averages over cases", () => {
  const summary = summarizeCases([
    { ranks: { "putusan/a": 1 } },
    { ranks: { "putusan/b": null, "putusan/c": 4 } },
    { ranks: { "putusan/d": null } },
  ]);
  assert.equal(summary.byCutoff[5]?.hit, 2 / 3);
  assert.equal(summary.byCutoff[5]?.recall, (1 + 0.5 + 0) / 3);
  assert.equal(summary.mrr, (1 + 0.25 + 0) / 3);
});

const row = (id: string, urls: string[] | undefined) => JSON.stringify({ id, question: "q", answer: "a", references: urls?.map((url) => ({ title: "t", url })) });

test("references map from source cards to putusan and the rest is counted, not guessed", () => {
  const rows = [
    row("one", ["/wiki/sources/alpha", "/wiki/putusan/beta", "/wiki/concepts/gamma", "/wiki/sources/missing"]),
    row("two", []),
    row("three", ["/wiki/concepts/only-a-concept"]),
    row("four", undefined),
    "not json",
    JSON.stringify({ id: 5 }),
  ].join("\n");
  const known = new Set(["putusan/alpha", "putusan/beta"]);
  const loaded = loadCases(rows, (noteId) => known.has(noteId));
  assert.deepEqual(loaded.cases.map((qaCase) => [qaCase.id, qaCase.expected]), [["one", ["putusan/alpha", "putusan/beta"]]]);
  assert.deepEqual(loaded.unreferenced.map((entry) => entry.id), ["two", "four"]);
  assert.deepEqual(loaded.skipped, { badRows: 2, fullyUnmapped: 1, nonCitableReferences: 2 });
});
