import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { formatReport, runRetrievalEval } from "../src/features/eval/index.ts";
import { ceilingAt, hitAt, pairedDifference, rankExpected, recallAt, reciprocalRank, summarizeCases } from "../src/features/eval/metrics.ts";
import { loadCases } from "../src/features/eval/retrieval.ts";
import { buildIndex, openIndex } from "../src/features/search/index.ts";
import { fakeEmbedder } from "./fake-embedder.ts";
import { notes } from "./fixtures.ts";
import { tempDir, writeVault } from "./helpers.ts";

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

test("a difference counts only when it is larger than the spread of the per-conversation differences", () => {
  const steady = pairedDifference([0, 1, 0, 1, 0, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(steady.mean, 0.5);
  assert.equal(steady.clears, true);
  const noisy = pairedDifference([0, 0, 0, 0], [1, 0, 0, 0]);
  assert.equal(noisy.mean, 0.25);
  assert.equal(noisy.clears, false);
  assert.deepEqual(pairedDifference([1, 0, 1], [1, 0, 1]), { mean: 0, halfWidth: 0, clears: false });
});

describe("comparing channels", () => {
  let dir: string;
  let qaFile: string;

  const slug = "fatwa-05-a-2003-pupuk-organik-sm-no-12-13-2003";
  const qaRows = [
    { id: "synonym-only", question: "humus", references: [{ title: "t", url: `/wiki/sources/${slug}` }] },
    { id: "shared-words", question: "nelayan perahu jaring", references: [{ title: "t", url: "/wiki/sources/tja-1-masalah-perahu" }] },
  ];

  before(async () => {
    dir = tempDir();
    qaFile = path.join(dir, "qa.jsonl");
    fs.writeFileSync(qaFile, qaRows.map((qaRow) => JSON.stringify(qaRow)).join("\n"));
    await buildIndex({
      vaultDir: writeVault(notes),
      outFile: path.join(dir, "hybrid.sqlite"),
      channels: ["keyword", "vector"],
      embedding: { cacheFile: path.join(dir, "embeddings.sqlite"), modelDir: dir, embedder: fakeEmbedder({ dims: 1024 }) },
    });
    await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "keyword.sqlite"), channels: ["keyword"], tokenMeter: fakeEmbedder() });
  });

  const evaluate = async (file: string) => {
    const index = openIndex({ path: path.join(dir, file), embedder: async () => fakeEmbedder({ dims: 1024 }) });
    try {
      return await runRetrievalEval({ index, qaFile });
    } finally {
      index.close();
    }
  };

  test("a hybrid index is scored per channel set and link setting, and the vector channel finds what keywords cannot", async () => {
    const report = await evaluate("hybrid.sqlite");
    assert.deepEqual(report.variants.map((entry) => entry.variant.name), ["keyword", "keyword, no links", "vector", "vector, no links", "hybrid", "hybrid, no links"]);
    const hit10 = (name: string) => report.variants.find((entry) => entry.variant.name === name)?.byCutoff[10]?.hit;
    assert.equal(hit10("keyword"), 0.5);
    assert.equal(hit10("hybrid"), 1);
  });

  test("a keyword-only index is scored for keyword alone", async () => {
    const report = await evaluate("keyword.sqlite");
    assert.deepEqual(report.variants.map((entry) => entry.variant.name), ["keyword", "keyword, no links"]);
    assert.equal(report.variants[0]?.ms.embed, null);
  });

  test("the written report names conversations and numbers and never the question text", async () => {
    const hybrid = formatReport(await evaluate("hybrid.sqlite"), { maxMisses: 10 });
    assert.match(hybrid, /\| hybrid \|/);
    assert.match(hybrid, /Misses at 10 for hybrid \(0\)/);
    const keyword = formatReport(await evaluate("keyword.sqlite"), { maxMisses: 10 });
    assert.match(keyword, /- synonym-only, 1 expected/);
    assert.doesNotMatch(hybrid + keyword, /humus|nelayan/);
  });
});
