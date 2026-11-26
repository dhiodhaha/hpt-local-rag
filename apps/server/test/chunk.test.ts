import assert from "node:assert/strict";
import { test } from "node:test";
import { CHUNK_WORDS, chunkBody, sectionLabel } from "../src/features/search/chunk.ts";
import { costOf, hardWrapped, sentences, wordBudget, wordTotal } from "./helpers.ts";

const roomy = wordBudget();

test("a hard-wrapped page with no headings splits under the word cap and keeps every word once", () => {
  const body = hardWrapped(sentences(1, 900));
  const { chunks } = chunkBody(body, roomy);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) assert.ok(chunk.wordCount <= CHUNK_WORDS.max, `${chunk.wordCount} words`);
  assert.equal(wordTotal(chunks.map((chunk) => chunk.text)), 900);
  assert.deepEqual(chunks.map((chunk) => chunk.ordinal), chunks.map((_chunk, index) => index + 1));
});

test("chunks are deterministic", () => {
  const body = hardWrapped(sentences(2, 700));
  assert.deepEqual(chunkBody(body, roomy), chunkBody(body, roomy));
});

test("a short flat fatwa with a bold title stays one chunk labelled by that title", () => {
  const body = ["**HUKUM MENJUAL HASIL PANEN**", "", "Pertanyaan Dari:", "", "Seorang warga desa", "", "Tanya:", "", sentences(3, 80), "", "Jawab:", "", sentences(4, 120)].join("\n");
  const { chunks } = chunkBody(body, roomy);
  assert.equal(chunks.length, 1);
  assert.equal(sectionLabel(chunks[0] as (typeof chunks)[number]), "HUKUM MENJUAL HASIL PANEN");
  assert.ok(!chunks[0]?.text.includes("**"));
});

test("a heading never ends a chunk", () => {
  const body = [sentences(5, 290), "", "SUBJUDUL PERTAMA", "", sentences(6, 100)].join("\n");
  const { chunks } = chunkBody(body, roomy);
  assert.equal(chunks.length, 2);
  assert.ok(!(chunks[0]?.text.trimEnd().endsWith("SUBJUDUL PERTAMA") ?? true));
  assert.ok(chunks[1]?.text.startsWith("SUBJUDUL PERTAMA"));
});

const bookBody = [
  "CONTOH KITAB UJI  ",
  "CONTOH KITAB UJI ................................ 1  ",
  "BAGIAN PERTAMA UJI ............................ 2  ",
  "KEPUTUSAN TENTANG PERKARA UJI (HALAMAN 12).. 5  ",
  "BAGIAN KETIGA YANG PANJANG SEKALI UNTUK  ",
  "DIUJI ........................................ 9  ",
  "",
  "CONTOH KITAB UJI  ",
  "BAGIAN PERTAMA UJI  ",
  `xalpha ${hardWrapped(sentences(7, 250), 5)}`,
  "KEPUTUSAN TENTANG PERKARA UJI (HALAMAN 12)  ",
  "KEPUTUSAN TENTANG PERKARA UJI  ",
  `1. xbeta ${sentences(8, 120)}`,
  "2. " + sentences(9, 100),
  "BAGIAN KETIGA YANG PANJANG SEKALI UNTUK  ",
  "DIUJI  ",
  `xgamma ${hardWrapped(sentences(10, 200), 5)}`,
].join("\n");

test("a table of contents is removed from the text and its titles become sections", () => {
  const { chunks } = chunkBody(bookBody, roomy);
  assert.ok(chunks.every((chunk) => !chunk.text.includes("....")));
  assert.deepEqual(
    [...new Set(chunks.map((chunk) => chunk.top))],
    ["BAGIAN PERTAMA UJI", "KEPUTUSAN TENTANG PERKARA UJI", "BAGIAN KETIGA YANG PANJANG SEKALI UNTUK DIUJI"],
  );
});

test("the title line before the first section merges into it", () => {
  const { chunks } = chunkBody(bookBody, roomy);
  assert.ok(chunks[0]?.text.startsWith("CONTOH KITAB UJI"));
  assert.equal(chunks[0]?.top, "BAGIAN PERTAMA UJI");
});

test("a chunk never spans two sections, and a title with a page marker yields the page", () => {
  const { chunks } = chunkBody(bookBody, roomy);
  for (const marker of ["xalpha", "xbeta", "xgamma"]) {
    const holding = chunks.filter((chunk) => chunk.text.includes(marker));
    assert.equal(holding.length, 1);
    const others = ["xalpha", "xbeta", "xgamma"].filter((other) => other !== marker);
    assert.ok(others.every((other) => !holding[0]?.text.includes(other)));
  }
  const decision = chunks.find((chunk) => chunk.top === "KEPUTUSAN TENTANG PERKARA UJI");
  assert.equal(decision?.page, 12);
});

test("every table-of-contents title that no heading matched is reported", () => {
  const withoutHeading = bookBody.replace("BAGIAN PERTAMA UJI  \n", "");
  assert.deepEqual(chunkBody(withoutHeading, roomy).unmatchedTocTitles, ["bagian pertama uji"]);
  assert.deepEqual(chunkBody(bookBody, roomy).unmatchedTocTitles, []);
});

test("wikilinks render as their alias and the targets ride along in order", () => {
  const body = "Lihat [[sources/kartu-a|Kartu A]] dan [[putusan/naskah-b|Naskah B]] lalu [[sources/kartu-a|Kartu A]] lagi.";
  const { chunks } = chunkBody(body, roomy);
  assert.equal(chunks[0]?.text, "Lihat Kartu A dan Naskah B lalu Kartu A lagi.");
  assert.deepEqual(chunks[0]?.links, ["sources/kartu-a", "putusan/naskah-b"]);
});

test("an empty body yields no chunks", () => {
  assert.deepEqual(chunkBody("", roomy).chunks, []);
});

const heavy = wordBudget({ max: 512, perWord: 3, overhead: 20 });

test("a passage is capped by tokens when its words alone would fit, and every word survives once", () => {
  const body = hardWrapped(sentences(11, 600));
  const { chunks } = chunkBody(body, heavy);
  assert.ok(chunks.length > chunkBody(body, roomy).chunks.length);
  for (const chunk of chunks) {
    assert.ok(costOf(heavy, sectionLabel(chunk), chunk.text) <= heavy.max, `${chunk.wordCount} words`);
    assert.ok(chunk.wordCount <= CHUNK_WORDS.max);
  }
  assert.equal(wordTotal(chunks.map((chunk) => chunk.text)), 600);
});

test("a long section label leaves less room for text, and the chunk still fits", () => {
  const label = Array.from({ length: 28 }, (_value, index) => `JUDUL${index}`).join(" ").toUpperCase();
  const body = [label, "", sentences(12, 500)].join("\n");
  const { chunks } = chunkBody(body, heavy);
  assert.ok(chunks.length > 2);
  for (const chunk of chunks) assert.ok(costOf(heavy, sectionLabel(chunk), chunk.text) <= heavy.max);
});

test("a section boundary of a compiled book holds under a tight token cap", () => {
  const tight = wordBudget({ max: 200, perWord: 2 });
  const { chunks } = chunkBody(bookBody, tight);
  assert.deepEqual(
    [...new Set(chunks.map((chunk) => chunk.top))],
    ["BAGIAN PERTAMA UJI", "KEPUTUSAN TENTANG PERKARA UJI", "BAGIAN KETIGA YANG PANJANG SEKALI UNTUK DIUJI"],
  );
  for (const marker of ["xalpha", "xbeta", "xgamma"]) assert.equal(chunks.filter((chunk) => chunk.text.includes(marker)).length, 1);
  for (const chunk of chunks) assert.ok(costOf(tight, sectionLabel(chunk), chunk.text) <= tight.max);
});

test("a heading never ends a chunk under a token cap either", () => {
  const body = [sentences(13, 120), "", "SUBJUDUL PERTAMA", "", sentences(14, 100)].join("\n");
  const { chunks } = chunkBody(body, wordBudget({ max: 300, perWord: 2 }));
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks.slice(0, -1)) assert.ok(!chunk.text.trimEnd().endsWith("SUBJUDUL PERTAMA"));
});

test("a run of letters longer than the cap is cut by characters, losing none", () => {
  const perCharacters = { max: 80, overhead: () => 0, tokens: (text: string) => Math.ceil(text.replace(/\s/g, "").length / 4) };
  const word = "abcdefghij".repeat(60);
  const { chunks } = chunkBody(`awal ${word} akhir`, perCharacters);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(perCharacters.tokens(chunk.text) <= perCharacters.max);
  assert.equal(chunks.map((chunk) => chunk.text).join("").replace(/[\s]/g, ""), `awal${word}akhir`);
});

test("a title and section that fill the whole budget are an error, not a silent truncation", () => {
  const impossible = { max: 10, overhead: () => 10, tokens: (text: string) => text.length };
  assert.throws(() => chunkBody("kata", impossible), /does not fit/);
});
