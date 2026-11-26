import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TARGETS, assertLocked, candidatesFrom, compositionOf, hashCases, lockOf, pickCases, withoutWhy, type Candidate, type DraftedCase } from "../src/features/eval/index.ts";
import { ONE, TWO } from "../src/testing/answer-fixtures.ts";
import { fakeIndex } from "../src/testing/fake-index.ts";

function candidate(n: number, overrides: Partial<Candidate> = {}): Candidate {
  return { id: `q-${String(n).padStart(8, "0")}-1`, question: `Pertanyaan nomor ${n}`, expectedNotes: [ONE.noteId], evidence: "strong", bestRank: 1, differs: false, ...overrides };
}

const written = (category: DraftedCase["category"], n: number): DraftedCase => ({ id: `w-${n}`, category, question: `Ditulis ${n}`, expectedNotes: [], origin: "written", why: "test" });

function pool(): Candidate[] {
  const strong = Array.from({ length: 30 }, (_, n) => candidate(n));
  const weak = Array.from({ length: 12 }, (_, n) => candidate(100 + n, { evidence: "weak", bestRank: 6 }));
  const differing = Array.from({ length: 8 }, (_, n) => candidate(200 + n, { differs: true }));
  return [...strong, ...weak, ...differing];
}

const WRITTEN: DraftedCase[] = [
  ...[1, 2, 3, 4].map((n) => written("revision", n)),
  ...[5, 6, 7, 8].map((n) => written("insufficient", n)),
  ...[9, 10, 11, 12].map((n) => written("fictional", n)),
];

describe("drafting the answer subset", () => {
  it("fills D13's composition, takes differing questions first, and uses no question twice", () => {
    const draft = pickCases({ candidates: pool(), written: WRITTEN, seed: 13 });
    assert.deepEqual(draft.shortfall, {});
    assert.equal(draft.cases.length, 40);
    const composition = compositionOf(draft.cases);
    for (const [category, target] of Object.entries(TARGETS)) assert.equal(composition[category as keyof typeof composition].actual, target);
    assert.equal(new Set(draft.cases.map((item) => item.id)).size, 40);
    const differing = draft.cases.filter((item) => item.category === "differing");
    assert.ok(differing.every((item) => /^q-0000020\d-1$/.test(item.id)), "the differing pool supplies the differing questions");
    const inferred = draft.cases.filter((item) => item.category === "inferred");
    assert.ok(inferred.every((item) => /^q-0000010\d-1$|^q-0000011\d-1$/.test(item.id)), "weak evidence is inferred, strong is explicit");
  });

  it("is the same draft for the same seed and a different one for another seed", () => {
    const ids = (seed: number) => pickCases({ candidates: pool(), written: WRITTEN, seed }).cases.map((item) => item.id);
    assert.deepEqual(ids(13), ids(13));
    assert.notDeepEqual(ids(13), ids(14));
  });

  it("reports how far a category is short, and records why each case was categorized", () => {
    const draft = pickCases({ candidates: pool(), written: WRITTEN.slice(0, 6), seed: 13 });
    assert.deepEqual(draft.shortfall, { insufficient: 2, fictional: 4 });
    assert.ok(draft.cases.every((item) => item.why.length > 0));
  });

  it("drafts only first turns that stand alone, and maps HPT's references to putusan notes", async () => {
    const index = fakeIndex([ONE, TWO]);
    const rows = [
      { id: "aaaaaaaa-1111", question: "Apakah kompos boleh dibuat dari sisa daun?", answer: "Para ulama berbeda pendapat.", references: [{ url: "/wiki/sources/uji-1" }] },
      { id: "aaaaaaaa-1111", question: "Bagaimana kalau belum matang, ada dalilnya?", answer: "x", references: [{ url: "/wiki/sources/uji-2" }] },
      { id: "bbbbbbbb-2222", question: "Terima kasih atas penjelasannya, lanjutkan.", answer: "x", references: [{ url: "/wiki/sources/uji-1" }] },
      { id: "cccccccc-3333", question: "Tanpa rujukan sama sekali di sini", answer: "x", references: [] },
      { id: "dddddddd-4444", question: "pendek", answer: "x", references: [{ url: "/wiki/sources/uji-1" }] },
    ];
    const found = await candidatesFrom(rows.map((row) => JSON.stringify(row)).join("\n"), index);
    assert.deepEqual(found.map((item) => [item.id, item.expectedNotes, item.bestRank, item.differs]), [["q-aaaaaaaa-1", [ONE.noteId], 1, true]]);
  });
});

describe("locking the subset", () => {
  const cases = withoutWhy(pickCases({ candidates: pool(), written: WRITTEN, seed: 13 }).cases);

  it("freezes ids, categories and a hash, and never the text", () => {
    const lock = lockOf(cases, "2026-11-26");
    assert.equal(lock.items.length, 40);
    assert.equal(lock.hash, hashCases(cases));
    assert.equal(JSON.stringify(lock).includes("Pertanyaan nomor"), false);
    assert.equal(JSON.stringify(lock).includes("Ditulis"), false);
    assert.equal(JSON.stringify(lock).includes("question"), false);
  });

  it("refuses a subset whose question was edited after the lock, and ignores the order of the cases", () => {
    const lock = lockOf(cases, "2026-11-26");
    assert.doesNotThrow(() => assertLocked([...cases].reverse(), lock));
    const edited = cases.map((item, at) => (at === 0 ? { ...item, question: `${item.question} sunting` } : item));
    assert.throws(() => assertLocked(edited, lock), /does not match the lock/);
    assert.throws(() => assertLocked(cases.slice(1), lock), /does not match the lock/);
  });
});
