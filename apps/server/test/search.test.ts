import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { openDb } from "../src/shared/db.ts";
import { buildIndex, IndexUnavailableError, openIndex, statusOf, type HptIndex } from "../src/features/search/index.ts";
import { notes } from "./fixtures.ts";
import { tempDir, writeVault } from "./helpers.ts";

let dir: string;
let indexFile: string;
let index: HptIndex;

before(async () => {
  dir = tempDir();
  indexFile = path.join(dir, "hpt.sqlite");
  await buildIndex({ vaultDir: writeVault(notes), outFile: indexFile });
  index = openIndex({ path: indexFile });
});

after(() => index.close());

describe("search", () => {
  test("returns only citable passages, ranked by keyword, with evidence from the question's coverage", async () => {
    const result = await index.search("pupuk organik kompos daun jerami");
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((hit) => hit.passage.noteId.startsWith("putusan/")));
    assert.match(result.hits[0]?.passage.noteId ?? "", /pupuk-organik/);
    assert.equal(result.hits[0]?.reasons[0].kind, "direct");
    assert.equal(result.evidence.level, "strong");
  });

  test("text that is published twice collapses into one hit that remembers the copy", async () => {
    const result = await index.search("pupuk organik kompos");
    const holders = result.hits.filter((hit) => hit.passage.noteId.includes("pupuk-organik"));
    assert.equal(holders.length, 1);
    assert.equal(holders[0]?.duplicates.length, 1);
  });

  test("a match in a concept page reaches the putusan it links to and lists the concept as a lead", async () => {
    const result = await index.search("pengomposan");
    const linked = result.hits.find((hit) => hit.passage.noteId.includes("pupuk-organik-sm-no"));
    assert.ok(linked);
    assert.equal(linked.reasons[0].kind, "via_link");
    assert.deepEqual(result.leads.map((lead) => lead.noteId), ["concepts/pengomposan"]);
    assert.equal(result.evidence.level, "absent");
  });

  test("a document scope computes the pool inside that document and turns link expansion off", async () => {
    const result = await index.search("pupuk perahu jaring", { filter: { noteIds: ["putusan/tja-1-masalah-perahu"] } });
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((hit) => hit.passage.noteId === "putusan/tja-1-masalah-perahu"));
    assert.ok(result.hits.every((hit) => hit.reasons.every((reason) => reason.kind === "direct")));
    assert.deepEqual(result.leads, []);
  });

  test("source type and year filters narrow the pool", async () => {
    const hpt = await index.search("lumbungku", { filter: { sourceTypes: ["hpt"] } });
    assert.ok(hpt.hits.length > 0 && hpt.hits.every((hit) => hit.passage.sourceType === "hpt"));
    const outOfRange = await index.search("pupuk organik", { filter: { years: { from: 2010 } } });
    assert.deepEqual(outOfRange.hits, []);
  });

  test("a question made only of question words finds nothing and says so", async () => {
    const result = await index.search("apa itu?");
    assert.deepEqual(result.hits, []);
    assert.equal(result.evidence.level, "absent");
  });

  test("query syntax in the question is inert", async () => {
    await assert.doesNotReject(index.search('pupuk" OR NEAR( * : -kompos'));
  });

  test("asking for a channel the index lacks is refused", async () => {
    await assert.rejects(index.search("pupuk", { channels: ["vector"] }), /no vector channel/);
  });

  test("passages carry the context fields from their folder, slug and headings", async () => {
    const twin = (await index.search("pupuk organik kompos")).hits[0]?.passage;
    assert.equal(twin?.sourceType, "fatwa");
    assert.equal(twin?.year, 2003);
    assert.equal(twin?.number, "05-a");
    assert.equal(twin?.publishedIn, "Suara Muhammadiyah No. 12-13/2003");
    assert.equal(statusOf(twin as NonNullable<typeof twin>), "active");

    const hpt = (await index.search("lumbungku")).hits[0]?.passage;
    assert.equal(hpt?.sourceType, "hpt");
    assert.deepEqual(hpt?.locator, { volume: "1", kitab: "Gudang" });

    const decision = (await index.search("lumbung", { filter: { noteIds: ["putusan/fikih-contoh-bagian-a"], sourceTypes: ["putusan"] } })).hits[0]?.passage;
    assert.equal(decision?.parent, "Fikih Muhammadiyah");
    assert.deepEqual(decision?.locator, { page: 12 });
  });

  test("ids resolve to passages, and an unknown id is simply absent", async () => {
    const hit = (await index.search("lumbungku")).hits[0];
    const found = index.getPassages([hit?.passage.id ?? "", "putusan/tidak-ada#1", "' OR 1=1 --"]);
    assert.deepEqual([...found.keys()], [hit?.passage.id]);
    assert.equal(found.get(hit?.passage.id as never)?.text, hit?.passage.text);
  });
});

describe("revisions", () => {
  test("a reviewed pair marks the older passage superseded, and a changed text fails the build", async () => {
    const [older, newer] = ["putusan/tja-1-masalah-perahu#1", "putusan/hpt-jilid-1-kitab-gudang#1"].map((id) => index.getPassages([id]).get(id as never));
    assert.ok(older && newer);
    const revisionsFile = path.join(dir, "revisions.json");
    const ref = (passage: typeof older) => ({ id: passage.id, textHash: passage.textHash });
    fs.writeFileSync(revisionsFile, JSON.stringify([{ superseded: ref(older), by: ref(newer) }]));
    const out = path.join(dir, "revised.sqlite");
    await buildIndex({ vaultDir: writeVault(notes), outFile: out, revisionsFile });
    const revised = openIndex({ path: out });
    try {
      const passage = revised.getPassages([older.id]).get(older.id);
      assert.equal(statusOf(passage as NonNullable<typeof passage>), "superseded");
      assert.equal(passage?.supersededBy, newer.id);
      assert.equal(revised.getPassages([newer.id]).get(newer.id)?.supersedes, older.id);
    } finally {
      revised.close();
    }
    fs.writeFileSync(revisionsFile, JSON.stringify([{ superseded: { id: older.id, textHash: "0000000000000000" }, by: ref(newer) }]));
    await assert.rejects(buildIndex({ vaultDir: writeVault(notes), outFile: path.join(dir, "stale.sqlite"), revisionsFile }), /expects another text/);
  });
});

describe("open", () => {
  test("a missing file and an index built by other code are refused with a pointer to hpt build", async () => {
    assert.throws(() => openIndex({ path: path.join(dir, "missing.sqlite") }), IndexUnavailableError);
    const other = path.join(dir, "other.sqlite");
    fs.copyFileSync(indexFile, other);
    const db = openDb(other, { readonly: false });
    db.exec("UPDATE meta SET value = '999' WHERE key = 'fold_version'");
    db.close();
    assert.throws(() => openIndex({ path: other }), /fold_version.*hpt build/);
  });
});
