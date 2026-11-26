import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildIndex, IndexUnavailableError, openIndex, type HptIndex } from "../src/features/search/index.ts";
import { fakeEmbedder, type FakeEmbedder } from "./fake-embedder.ts";
import { notes } from "./fixtures.ts";
import { tempDir, writeVault } from "./helpers.ts";

let dir: string;
let embedder: FakeEmbedder;
let loads: number;
let index: HptIndex;

const hybridFile = () => path.join(dir, "hybrid.sqlite");

before(async () => {
  dir = tempDir();
  embedder = fakeEmbedder({ dims: 1024 });
  await buildIndex({
    vaultDir: writeVault(notes),
    outFile: hybridFile(),
    channels: ["keyword", "vector"],
    embedding: { cacheFile: path.join(dir, "embeddings.sqlite"), modelDir: dir, embedder },
  });
  loads = 0;
  index = openIndex({
    path: hybridFile(),
    embedder: async () => {
      loads += 1;
      return embedder;
    },
  });
});

after(() => index.close());

describe("hybrid search", () => {
  test("the index records both channels and the model that embedded it", () => {
    assert.deepEqual(index.info.channels, ["keyword", "vector"]);
    assert.deepEqual(index.info.embedding, { model: "fake-bow", dims: 1024 });
  });

  test("a question with no word in common with the text still finds it through the vector channel", async () => {
    const keywordOnly = await index.search("humus", { channels: ["keyword"] });
    assert.deepEqual(keywordOnly.hits, []);
    const hybrid = await index.search("humus");
    assert.match(hybrid.hits[0]?.passage.noteId ?? "", /pupuk-organik/);
    assert.deepEqual(hybrid.hits[0]?.reasons.filter((reason) => reason.kind === "direct").map((reason) => reason.channel), ["vector"]);
  });

  test("a hit both channels find says so, and the evidence reports how far the channels agree", async () => {
    const result = await index.search("pupuk organik kompos daun jerami");
    const reasons = result.hits[0]?.reasons.filter((reason) => reason.kind === "direct").map((reason) => reason.channel);
    assert.deepEqual(reasons, ["keyword", "vector"]);
    assert.ok((result.evidence.signals.channelAgreement ?? -1) > 0);
    const single = await index.search("pupuk organik kompos daun jerami", { channels: ["keyword"] });
    assert.equal(single.evidence.signals.channelAgreement, null);
  });

  test("a vector-only search uses no keyword list and reports its own timings", async () => {
    const result = await index.search("humus", { channels: ["vector"] });
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((hit) => hit.reasons.every((reason) => reason.channel === "vector")));
    assert.equal(result.ms.keyword, 0);
    assert.ok(result.ms.embed >= 0 && result.ms.total >= result.ms.embed);
  });

  test("link expansion can be switched off, and a filter keeps the vector pool inside its document", async () => {
    const withLinks = await index.search("pengomposan");
    assert.ok(withLinks.hits.some((hit) => hit.reasons.some((reason) => reason.kind === "via_link")));
    const without = await index.search("pengomposan", { linkExpansion: false });
    assert.ok(without.hits.every((hit) => hit.reasons.every((reason) => reason.kind === "direct")));

    const scoped = await index.search("humus perahu", { channels: ["vector"], filter: { noteIds: ["putusan/tja-1-masalah-perahu"] } });
    assert.ok(scoped.hits.length > 0);
    assert.ok(scoped.hits.every((hit) => hit.passage.noteId === "putusan/tja-1-masalah-perahu"));
  });

  test("the model loads once however many questions are asked, and a blank question is not embedded", async () => {
    embedder.queries.length = 0;
    await index.search("hasil panen kebun");
    await index.search("apa itu?");
    await index.search("   ");
    assert.equal(loads, 1);
    assert.deepEqual(embedder.queries, ["hasil panen kebun", "apa itu?"]);
  });
});

describe("opening a hybrid index", () => {
  test("an embedder of another model is refused, and a keyword-only search needs no embedder", async () => {
    const other = openIndex({ path: hybridFile(), embedder: async () => fakeEmbedder({ dims: 1024, id: "another-model" }) });
    try {
      await assert.rejects(other.search("humus"), (error: unknown) => error instanceof IndexUnavailableError && /another-model/.test(error.message));
      const keyword = await other.search("pupuk organik", { channels: ["keyword"] });
      assert.ok(keyword.hits.length > 0);
    } finally {
      other.close();
    }
  });

  test("asking a hybrid index for vectors without giving an embedder fails with a reason", async () => {
    const bare = openIndex({ path: hybridFile() });
    try {
      await assert.rejects(bare.search("humus"), /needs an embedder/);
    } finally {
      bare.close();
    }
  });
});
