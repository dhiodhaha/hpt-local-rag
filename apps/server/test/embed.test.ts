import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { embedAll, passageInput } from "../src/features/search/embed.ts";
import { openEmbeddingCache } from "../src/features/search/embedding-cache.ts";
import { fakeEmbedder } from "./fake-embedder.ts";
import { tempDir } from "./helpers.ts";

test("a passage is embedded from its title, section and text, and an absent section adds nothing", () => {
  assert.equal(passageInput("Judul", "Bagian", "Isi"), "Judul\nBagian\nIsi");
  assert.equal(passageInput("Judul", null, "Isi"), "Judul\nIsi");
});

test("a rebuild embeds only the inputs the cache has not seen, and an input that repeats is embedded once", async () => {
  const cache = openEmbeddingCache(path.join(tempDir(), "cache", "embeddings.sqlite"));
  const embedder = fakeEmbedder();
  try {
    const first = await embedAll(["kebun tanam", "pasar harga", "kebun tanam"], { embedder, cache });
    assert.deepEqual([first.embedded, first.cached], [2, 0]);
    assert.equal(first.vectors.length, 3);
    assert.deepEqual(first.vectors[0], first.vectors[2]);

    embedder.batches.length = 0;
    const second = await embedAll(["kebun tanam", "pasar harga", "perahu jaring"], { embedder, cache });
    assert.deepEqual([second.embedded, second.cached], [1, 2]);
    assert.deepEqual(embedder.batches, [["perahu jaring"]]);
    assert.deepEqual(second.vectors[0], first.vectors[0]);
  } finally {
    cache.close();
  }
});

test("a cached vector never serves another model", async () => {
  const cache = openEmbeddingCache(path.join(tempDir(), "embeddings.sqlite"));
  try {
    await embedAll(["kebun tanam"], { embedder: fakeEmbedder({ id: "model-a" }), cache });
    const other = await embedAll(["kebun tanam"], { embedder: fakeEmbedder({ id: "model-b" }), cache });
    assert.equal(other.embedded, 1);
  } finally {
    cache.close();
  }
});
