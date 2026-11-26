import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { buildIndex, BuildError, type BuildReport } from "../src/features/search/index.ts";
import { fakeEmbedder, type FakeEmbedder } from "./fake-embedder.ts";
import { notes } from "./fixtures.ts";
import { tempDir, writeVault, type FixtureNote } from "./helpers.ts";

let dir: string;
let report: BuildReport;

before(async () => {
  dir = tempDir();
  report = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "hpt.sqlite"), channels: ["keyword"] });
});

describe("build", () => {
  test("counts citable and map passages apart, and types each citable passage from its folder", () => {
    assert.equal(report.counts.notes, notes.length);
    assert.ok(report.counts.passages > 0 && report.counts.mapPassages > 0);
    assert.ok(report.passagesBySourceType.fatwa >= 2);
    assert.ok(report.passagesBySourceType.tanya_jawab >= 1);
    assert.ok(report.passagesBySourceType.hpt >= 2);
    assert.ok(report.wordCount.max <= 300);
  });

  test("a compiled book labels only its KEPUTUSAN section a putusan", () => {
    const sections = report.bookSections.map((section) => [section.section, section.sourceType]);
    assert.deepEqual(sections, [["BAGIAN UMUM", "penjelasan"], ["KEPUTUSAN TENTANG LUMBUNG", "putusan"]]);
    assert.equal(report.bookSections[1]?.page, 12);
  });

  test("a rebuild of the same vault has the same fingerprint and no drift", async () => {
    const again = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "again.sqlite"), channels: ["keyword"] });
    assert.equal(again.fingerprint, report.fingerprint);
    const rebuilt = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "again.sqlite"), channels: ["keyword"] });
    assert.deepEqual(rebuilt.drift, { added: 0, removed: 0, changed: [] });
  });

  test("an unmapped folder and a dangling link fail the build once, listing both", async () => {
    const broken: FixtureNote[] = [
      { id: "putusan/aneh", title: "Aneh", folder: "Folder Baru", body: "Isi." },
      { id: "concepts/putus", title: "Putus", body: "Lihat [[putusan/tidak-ada|Hilang]]." },
    ];
    const out = path.join(dir, "broken.sqlite");
    await assert.rejects(buildIndex({ vaultDir: writeVault(broken), outFile: out, channels: ["keyword"] }), (error: unknown) => {
      assert.ok(error instanceof BuildError);
      assert.equal(error.problems.length, 2);
      assert.match(error.problems.join("\n"), /putusan\/aneh/);
      assert.match(error.problems.join("\n"), /putusan\/tidak-ada/);
      return true;
    });
    assert.equal(fs.existsSync(out), false);
  });

  test("a source card that does not link its putusan fails verification and leaves the old index in place", async () => {
    const orphan = notes.map((note) => (note.id === "sources/tja-1-masalah-perahu" ? { ...note, body: "## Summary\n\nTanpa tautan." } : note));
    const out = path.join(dir, "orphan.sqlite");
    fs.writeFileSync(out, "old");
    await assert.rejects(buildIndex({ vaultDir: writeVault(orphan), outFile: out, channels: ["keyword"] }), BuildError);
    assert.equal(fs.readFileSync(out, "utf8"), "old");
  });
});

describe("vector build", () => {
  const vectorBuild = (embedder: FakeEmbedder, vaultNotes: FixtureNote[], cacheFile: string) =>
    buildIndex({
      vaultDir: writeVault(vaultNotes),
      outFile: path.join(dir, "vector.sqlite"),
      channels: ["keyword", "vector"],
      embedding: { cacheFile, modelDir: dir, embedder },
    });

  test("embeds each passage once, and a rebuild against the same cache embeds nothing", async () => {
    const cacheFile = path.join(tempDir(), "embeddings.sqlite");
    const embedder = fakeEmbedder();
    const first = await vectorBuild(embedder, notes, cacheFile);
    const total = first.counts.passages + first.counts.mapPassages;
    assert.equal(first.embedding?.cached, 0);
    assert.ok((first.embedding?.embedded ?? 0) > 0 && (first.embedding?.embedded ?? 0) <= total);
    assert.deepEqual(first.channels, ["keyword", "vector"]);

    const again = await vectorBuild(embedder, notes, cacheFile);
    assert.deepEqual([again.embedding?.embedded, again.embedding?.cached], [0, total]);
    assert.equal(again.fingerprint, first.fingerprint);
  });

  test("an edited note re-embeds only its own passages", async () => {
    const cacheFile = path.join(tempDir(), "embeddings.sqlite");
    const embedder = fakeEmbedder();
    await vectorBuild(embedder, notes, cacheFile);
    const edited = notes.map((note) => (note.id === "putusan/tja-1-masalah-perahu" ? { ...note, body: "Nelayan menambal jaring yang sobek." } : note));
    const report = await vectorBuild(embedder, edited, cacheFile);
    assert.ok((report.embedding?.embedded ?? 0) >= 1 && (report.embedding?.embedded ?? 99) <= 2);
  });

  test("passages longer than the model's token limit are counted, citable and map apart", async () => {
    const cacheFile = path.join(tempDir(), "embeddings.sqlite");
    const roomy = await vectorBuild(fakeEmbedder({ maxTokens: 512 }), notes, cacheFile);
    assert.equal(roomy.embedding?.tokens.citable.overLimit, 0);
    const tight = await vectorBuild(fakeEmbedder({ maxTokens: 100 }), notes, cacheFile);
    assert.ok((tight.embedding?.tokens.citable.overLimit ?? 0) > 0);
    assert.equal(tight.embedding?.tokens.citable.passages, tight.counts.passages);
    assert.equal(tight.embedding?.tokens.map.overLimit, 0);
  });

  test("a keyword-only build never calls the embedder and keeps the keyword fingerprint", async () => {
    const embedder = fakeEmbedder();
    const keywordOnly = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "kw.sqlite"), channels: ["keyword"], embedding: { cacheFile: path.join(dir, "c.sqlite"), modelDir: dir, embedder } });
    assert.equal(keywordOnly.embedding, null);
    assert.deepEqual(embedder.batches, []);
    assert.equal(keywordOnly.fingerprint, report.fingerprint);
    const withVectors = await vectorBuild(embedder, notes, path.join(tempDir(), "embeddings.sqlite"));
    assert.notEqual(withVectors.fingerprint, report.fingerprint);
  });

  test("a vector build without embedding options is refused", async () => {
    await assert.rejects(buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "no.sqlite"), channels: ["keyword", "vector"] }), /embedding options/);
  });
});
