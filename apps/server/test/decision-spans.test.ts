import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chunkBody, type Chunk, type ChunkedBody } from "../src/features/search/chunk.ts";
import { AMBIGUOUS_END_WORDS } from "../src/features/search/decision-spans.ts";
import { sentences, wordBudget, wordTotal } from "./helpers.ts";

const roomy = wordBudget();

type TestSection = { title: string; lines: string[] };

/** A compiled book: its table of contents with dotted leaders, then each section under its title. */
function compiledBook(sections: readonly TestSection[]): string {
  const toc = sections.map(({ title }, index) => `${title} ........................ ${index + 1}  `);
  return [...toc, "", ...sections.flatMap(({ title, lines }) => [title, ...lines])].join("\n");
}

/** Each line opens with a word no marker pattern knows, so the filler cannot look like a closing line. */
const explanationLines = (count: number) => Array.from({ length: count }, (_unused, index) => `xuraian ${sentences(index, 7)}`);

const spans = (body: string): ChunkedBody => chunkBody(body, roomy, { decisionSpans: true });

const decisionText = (chunks: readonly Chunk[]) => chunks.filter((chunk) => chunk.span !== null).map((chunk) => chunk.text).join("\n");

const otherText = (chunks: readonly Chunk[]) => chunks.filter((chunk) => chunk.span === null).map((chunk) => chunk.text).join("\n");

const lineOf = (body: string, text: string) => body.split("\n").findLastIndex((line) => line.startsWith(text)) + 1;

describe("a decision between a KEPUTUSAN heading and the next heading", () => {
  const body = compiledBook([
    { title: "BAGIAN UJI PERTAMA", lines: [`xalpha ${sentences(1, 80)}`] },
    {
      title: "KEPUTUSAN TENTANG CONTOH UJI",
      lines: ["Menimbang :", `xmenimbang ${sentences(2, 40)}`, "Mengingat :", `xmengingat ${sentences(3, 30)}`, "Memutuskan :", `1. xputusan ${sentences(4, 30)}`, `2. ${sentences(5, 30)}`],
    },
    { title: "BAGIAN UJI KEDUA", lines: [`xomega ${sentences(6, 60)}`] },
  ]);

  test("only the text from the marker line on is a decision, and its line range says so", () => {
    const { chunks, decisions } = spans(body);
    assert.equal(decisions.spans.length, 1);
    const [span] = decisions.spans;
    assert.equal(span?.heading, "KEPUTUSAN TENTANG CONTOH UJI");
    assert.equal(span?.marker, "Memutuskan :");
    assert.equal(span?.startLine, lineOf(body, "Memutuskan :"));
    assert.equal(span?.endLine, lineOf(body, "2. "));
    assert.equal(span?.endedBy, "section");
    assert.ok(decisionText(chunks).startsWith("Memutuskan :"));
    assert.ok(decisionText(chunks).includes("xputusan"));
    for (const marker of ["xalpha", "xmenimbang", "xmengingat", "xomega"]) {
      assert.ok(!decisionText(chunks).includes(marker), marker);
      assert.ok(otherText(chunks).includes(marker), marker);
    }
  });

  test("the span reports its words, its first and last words and the chunks cut from it", () => {
    const { chunks, decisions } = spans(body);
    const [span] = decisions.spans;
    const words = decisionText(chunks).split(/\s+/).filter(Boolean);
    assert.equal(span?.words, words.length);
    assert.equal(span?.opening, words.slice(0, 25).join(" "));
    assert.equal(span?.closing, words.slice(-25).join(" "));
    assert.deepEqual(span?.chunkOrdinals, chunks.filter((chunk) => chunk.span === 0).map((chunk) => chunk.ordinal));
  });

  test("labelling moves no word and costs no passage boundary outside the book", () => {
    assert.equal(wordTotal(spans(body).chunks.map((chunk) => chunk.text)), wordTotal(chunkBody(body, roomy).chunks.map((chunk) => chunk.text)));
    const plain = chunkBody(body, roomy);
    assert.equal(plain.decisions.spans.length, 0);
    assert.ok(plain.chunks.every((chunk) => chunk.span === null));
  });

  test("considerations set in capitals do not end the scope", () => {
    const capitals = compiledBook([
      { title: "KEPUTUSAN TENTANG HURUF BESAR", lines: ["MENIMBANG :", sentences(1, 30), "MEMUTUSKAN :", `xputusan ${sentences(2, 30)}`] },
    ]);
    const { chunks, decisions } = spans(capitals);
    assert.equal(decisions.spans.length, 1);
    assert.ok(decisionText(chunks).includes("xputusan"));
  });
});

describe("a KEPUTUSAN with no marker", () => {
  const body = compiledBook([
    {
      title: "KEPUTUSAN TENTANG PERKARA TANPA AMAR",
      lines: ["Menimbang :", sentences(1, 40), "Menetapkan awal bulan berdasarkan hisab yang disepakati bersama dalam sidang.", sentences(2, 80)],
    },
    { title: "BAGIAN UJI BERIKUTNYA", lines: [sentences(3, 60)] },
  ]);

  test("is all penjelasan, and the log says why it produced no span", () => {
    const { chunks, decisions } = spans(body);
    assert.equal(decisions.spans.length, 0);
    assert.ok(chunks.every((chunk) => chunk.span === null));
    assert.deepEqual(decisions.withoutSpan, [{ heading: "KEPUTUSAN TENTANG PERKARA TANPA AMAR", line: lineOf(body, "KEPUTUSAN TENTANG PERKARA TANPA AMAR"), endedBy: "section" }]);
  });

  test("a title repeated under its own table-of-contents entry is one scope, not two", () => {
    const repeated = compiledBook([
      { title: "KEPUTUSAN TENTANG ULANG UJI (HALAMAN 12)", lines: ["KEPUTUSAN TENTANG ULANG UJI", "Menimbang :", sentences(1, 30), "Dalil-dalil untuk uji :", sentences(2, 30)] },
    ]);
    assert.equal(spans(repeated).decisions.withoutSpan.length, 1);
    const withMarker = compiledBook([
      { title: "KEPUTUSAN TENTANG ULANG UJI (HALAMAN 12)", lines: ["KEPUTUSAN TENTANG ULANG UJI", "Memutuskan :", `xputusan ${sentences(1, 30)}`] },
    ]);
    assert.equal(spans(withMarker).decisions.spans[0]?.heading, "KEPUTUSAN TENTANG ULANG UJI");
    assert.equal(spans(withMarker).decisions.withoutSpan.length, 0);
  });

  test("a prose sentence that starts with Menetapkan is not a marker", () => {
    assert.equal(spans(body).decisions.unscopedMarkers.length, 0);
  });
});

test("a marker outside any KEPUTUSAN section stays penjelasan and is listed", () => {
  const body = compiledBook([
    { title: "MASALAH UJI", lines: ["Memutuskan :", `xamar ${sentences(1, 30)}`] },
  ]);
  const { chunks, decisions } = spans(body);
  assert.equal(decisions.spans.length, 0);
  assert.ok(chunks.every((chunk) => chunk.span === null));
  assert.deepEqual(decisions.unscopedMarkers, [{ line: lineOf(body, "Memutuskan :"), text: "Memutuskan :", nearestHeading: "MASALAH UJI" }]);
});

describe("the last table-of-contents entry of a book", () => {
  test("keeps one passage's worth of a decision that runs to the end of the book", () => {
    const body = compiledBook([
      { title: "BAGIAN UJI PERTAMA", lines: [sentences(1, 60)] },
      { title: "KEPUTUSAN TENTANG BAGIAN AKHIR", lines: ["Memutuskan :", `1. xputusan ${sentences(2, 30)}`, ...explanationLines(120)] },
    ]);
    const { chunks, decisions } = spans(body);
    const [span] = decisions.spans;
    assert.equal(span?.endedBy, "word cap");
    assert.ok((span?.words ?? Infinity) <= AMBIGUOUS_END_WORDS);
    assert.ok(decisionText(chunks).includes("xputusan"));
    assert.ok(chunks.at(-1)?.span === null);
    assert.ok(wordTotal(chunks.filter((chunk) => chunk.span === null).map((chunk) => chunk.text)) > 600);
  });

  test("ends at a heading-like line when the book has one", () => {
    const body = compiledBook([
      { title: "KEPUTUSAN TENTANG BAGIAN AKHIR", lines: ["Memutuskan :", `1. xputusan ${sentences(2, 30)}`, "PENJELASAN DARI MAJELIS UJI", `xpenjelasan ${sentences(3, 400)}`] },
    ]);
    const { chunks, decisions } = spans(body);
    assert.equal(decisions.spans[0]?.endedBy, "heading");
    assert.ok(!decisionText(chunks).includes("xpenjelasan"));
    assert.ok(otherText(chunks).includes("xpenjelasan"));
  });
});

describe("a book without a table of contents", () => {
  test("a KEPUTUSAN heading in capitals opens the scope, and the next heading-like line closes the span", () => {
    const body = [
      sentences(1, 90),
      "",
      "KEPUTUSAN SIDANG UJI TENTANG LUMBUNG",
      "KEPUTUSAN SIDANG UJI",
      `Muktamar uji setelah mendengar prasaran. ${sentences(2, 40)}`,
      "MEMUTUSKAN",
      `1. xputusan ${sentences(3, 40)}`,
      "PENJELASAN DARI MAJELIS UJI",
      `xpenjelasan ${sentences(4, 60)}`,
    ].join("\n");
    const { chunks, decisions } = spans(body);
    assert.equal(decisions.spans.length, 1);
    assert.equal(decisions.spans[0]?.heading, "KEPUTUSAN SIDANG UJI TENTANG LUMBUNG");
    assert.equal(decisions.spans[0]?.endedBy, "heading");
    assert.ok(decisionText(chunks).startsWith("MEMUTUSKAN"));
    assert.ok(decisionText(chunks).includes("xputusan"));
    assert.ok(!decisionText(chunks).includes("xpenjelasan"));
  });

  test("a closing formula, a dateline and a signature are not decision text", () => {
    const body = [
      "KEPUTUSAN SIDANG UJI",
      "Memutuskan :",
      `1. xputusan ${sentences(3, 30)}`,
      "Demikian keputusan ini dibuat.",
      "Garut, 22 April 1976",
      "Pimpinan Sidang",
    ].join("\n");
    const { chunks, decisions } = spans(body);
    assert.equal(decisions.spans[0]?.endedBy, "closing");
    assert.ok(!decisionText(chunks).includes("Demikian"));
    assert.ok(otherText(chunks).includes("Pimpinan Sidang"));
  });

  test("a chunk never holds both kinds, even when both are short", () => {
    const body = ["KEPUTUSAN SIDANG UJI", "Menimbang : singkat.", "Memutuskan :", "1. singkat.", "Demikian."].join("\n");
    const { chunks } = spans(body);
    for (const chunk of chunks) assert.ok(chunk.span === null || !chunk.text.includes("Menimbang"));
    assert.ok(chunks.some((chunk) => chunk.span !== null));
    assert.ok(chunks.some((chunk) => chunk.span === null));
  });
});
