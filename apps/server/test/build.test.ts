import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { buildIndex, BuildError, type BuildReport } from "../src/features/search/index.ts";
import { notes } from "./fixtures.ts";
import { tempDir, writeVault, type FixtureNote } from "./helpers.ts";

let dir: string;
let report: BuildReport;

before(async () => {
  dir = tempDir();
  report = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "hpt.sqlite") });
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
    const again = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "again.sqlite") });
    assert.equal(again.fingerprint, report.fingerprint);
    const rebuilt = await buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "again.sqlite") });
    assert.deepEqual(rebuilt.drift, { added: 0, removed: 0, changed: [] });
  });

  test("an unmapped folder and a dangling link fail the build once, listing both", async () => {
    const broken: FixtureNote[] = [
      { id: "putusan/aneh", title: "Aneh", folder: "Folder Baru", body: "Isi." },
      { id: "concepts/putus", title: "Putus", body: "Lihat [[putusan/tidak-ada|Hilang]]." },
    ];
    const out = path.join(dir, "broken.sqlite");
    await assert.rejects(buildIndex({ vaultDir: writeVault(broken), outFile: out }), (error: unknown) => {
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
    await assert.rejects(buildIndex({ vaultDir: writeVault(orphan), outFile: out }), BuildError);
    assert.equal(fs.readFileSync(out, "utf8"), "old");
  });
});
