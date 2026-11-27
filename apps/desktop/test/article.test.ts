import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARABIC, recordScenario } from "@hpt/server/testing";
import { citedIn, firstCitations, marginPlan, plainTextOf, type Article, type MarginNote } from "../src/renderer/chat/article.ts";
import { placeNotes } from "../src/renderer/chat/margin.ts";
import { runOf } from "../src/renderer/chat/run.ts";
import { viewOf } from "../src/renderer/chat/view.ts";

async function articleOf(name: Parameters<typeof recordScenario>[0], cut?: string): Promise<Article> {
  const view = viewOf(runOf(await recordScenario(name, cut)));
  assert.equal(view.kind, "answer");
  if (view.kind !== "answer") throw new Error("not an answer");
  return view.card;
}

describe("the answer as prose (D9.6)", () => {
  it("opens with the headline and the summary, and numbers the marks in the order the answer cites", async () => {
    const article = await articleOf("settled");
    assert.equal(article.lead.headline?.text, "Menurut HPT, kompos boleh dibuat dari sisa daun.");
    assert.deepEqual(article.lead.margin.map((note) => note.number), [1, 2]);
    assert.deepEqual(article.cited.length, 3);
  });

  it("puts a margin note beside the lead for each passage its summary cites, with the source's title and place", async () => {
    const [first] = (await articleOf("settled")).lead.margin;
    assert.equal(first?.title, "HPT Jilid 1, Bab Kompos");
    assert.equal(first?.where, "Kitab Pertanian · Bab Kompos");
    assert.equal(first?.status, "active");
  });

  it("quotes the words the answer quotes from a passage, in quotation marks, with an ellipsis where the quote is cut", async () => {
    const [first, second] = (await articleOf("settled")).lead.margin;
    assert.equal(first?.quote, "“…menumpuk sisa daun…”");
    assert.equal(second?.quote, null, "the answer quotes nothing from the second passage in its summary");
  });

  it("leaves out the ellipsis where a quote ends with its own sentence", async () => {
    const notes = (await articleOf("settled")).notes?.margin ?? [];
    assert.equal(notes.find((note) => note.number === 2)?.quote, "“Kompos yang belum matang tidak boleh dipakai.”");
  });

  it("writes each note as sentences, led by what kind of note it is", async () => {
    const items = (await articleOf("settled")).notes?.items.map((item) => item.text);
    assert.deepEqual(items, ["Satu pengecualian: Kompos belum matang tidak boleh dipakai. Tunggu sampai matang.", "Praktisnya: Balik tiap minggu. Balik tumpukan."]);
  });

  it("introduces the first dalil, then its Arabic as a block of its own, then what it means", async () => {
    const [dalil] = (await articleOf("settled")).dalil;
    assert.deepEqual([dalil?.intro, dalil?.end, dalil?.arabic], ["Fatwa Uji 2 memuat teks ini", ":", ARABIC]);
    assert.equal(dalil?.meaning, null, "this dalil has no translation");
  });

  it("keeps every dalil, with the Arabic of each as the source's own text, and says which explanation was inferred", async () => {
    const dalil = (await articleOf("many-dalil")).dalil;
    assert.deepEqual(dalil.map((block) => block.intro), ["Fatwa Uji 2 memuat teks ini", "HR. Uji berbunyi", "QS. Uji: 7 berbunyi"]);
    assert.deepEqual(dalil.map((block) => block.inferred), [false, false, true]);
    assert.ok(dalil.every((block) => block.arabic !== null && block.margin.length === 1));
    assert.equal(dalil[1]?.meaning?.label, "Artinya");
    assert.equal(dalil[1]?.meaning?.text, "“Murid itu pergi ke sekolah pada pagi hari.”");
  });

  it("quotes the Arabic of a dalil in its margin note", async () => {
    const [note] = (await articleOf("many-dalil")).dalil[1]?.margin ?? [];
    assert.ok(note?.quote?.includes("ذَهَبَ"), "the margin quote is the dalil's Arabic");
  });

  it("holds a placeholder only while the answer may still grow", async () => {
    assert.equal((await articleOf("settled", "verifying")).pending, true);
    assert.equal((await articleOf("settled")).pending, false);
  });

  it("puts an unverified reference first, before there is any headline", async () => {
    const article = await articleOf("unverified-first", "reference");
    assert.equal(article.unverified[0]?.asStated, "HPT Jilid 9, Bab Kompos");
    assert.equal(article.lead.headline, null);
  });

  it("numbers the sources the answer cites, in the order of their marks", async () => {
    assert.equal((await articleOf("settled")).cited.length, 3);
  });
});

describe("the passages a prose cites", () => {
  it("lists them in the order of the marks and skips a mark that is still being checked", () => {
    const prose = [
      { kind: "text" as const, text: "a" },
      { kind: "cite" as const, passages: ["x#1", "y#2"] as never },
      { kind: "text" as const, text: "b" },
      { kind: "cite" as const, passages: null },
      { kind: "cite" as const, passages: ["z#3"] as never },
    ];
    assert.deepEqual(citedIn(prose), ["x#1", "y#2", "z#3"]);
    assert.deepEqual(citedIn(null), []);
  });
});

const note = (number: number): MarginNote => ({ id: `putusan/n${number}#1` as MarginNote["id"], number, title: `Sumber ${number}`, where: null, quote: null, status: "active" });

describe("the margin runs once, in reading order", () => {
  it("keeps a source at the first row that cites it and drops it from every later row", () => {
    const rows = firstCitations([[note(1), note(2)], [note(2), note(3)], [note(1), note(3), note(4)]]);
    assert.deepEqual(rows.map((row) => row.map((entry) => entry.number)), [[1, 2], [3], [4]]);
  });

  it("plans the whole article: each source once, the lead first, every dalil in reading order", async () => {
    const article = await articleOf("many-dalil");
    const shown = new Set(article.lead.margin.map((entry) => entry.id));
    const plan = marginPlan(article, shown);
    assert.deepEqual(plan.all.map((entry) => entry.number), [...new Set(plan.all.map((entry) => entry.number))]);
    assert.equal(plan.dalil.length, article.dalil.length, "no dalil is left out of the plan");
    assert.deepEqual(plan.all.map((entry) => entry.number), plan.all.map((entry) => entry.number).sort((a, b) => a - b), "numbers run upward down the page");
  });

  it("leaves out of the lead's notes a source whose mark the reveal has not reached", async () => {
    const article = await articleOf("settled");
    const [first] = article.lead.margin;
    const plan = marginPlan(article, new Set(first === undefined ? [] : [first.id]));
    assert.deepEqual(plan.lead.map((entry) => entry.number), [1]);
  });

  it("starts a note level with its line and pushes it down only when it would land on the note before", () => {
    assert.deepEqual(placeNotes([10, 200], [80, 60], 12), [10, 200]);
    assert.deepEqual(placeNotes([10, 40, 50], [80, 60, 30], 12), [10, 102, 174]);
    assert.deepEqual(placeNotes([300, 100], [50, 50], 12), [300, 362], "order is kept: the second note never moves above the first");
  });
});

describe("an inferred answer (D9.11)", () => {
  it("keeps the inference note in the opening paragraph and says in the view model that the answer is inferred", async () => {
    const inferred = await articleOf("inferred");
    assert.equal(inferred.lead.headline?.inferred, true);
    assert.equal(inferred.lead.headline?.text, "Berdasarkan HPT, kompos boleh dibuat dari sisa daun.");
    assert.ok(inferred.lead.inference !== null);
    const explicit = await articleOf("settled");
    assert.equal(explicit.lead.headline?.inferred, false);
    assert.equal(explicit.lead.inference, null);
  });

  it("reads the note after the verdict and before the summary when it is copied", async () => {
    const text = plainTextOf(await articleOf("inferred")).split("\n\n")[0] ?? "";
    assert.ok(text.indexOf("Berdasarkan HPT") < text.indexOf("Belum ada fatwa"));
    assert.ok(text.indexOf("Belum ada fatwa") < text.indexOf("Kompos boleh dibuat dari sisa daun."));
  });

  it("numbers the note's own source first, because the note is read first", async () => {
    const article = await articleOf("inferred");
    assert.equal(article.lead.margin[0]?.title, "Tanya Jawab Uji 3");
    assert.equal(article.lead.margin[0]?.number, 1);
  });
});
