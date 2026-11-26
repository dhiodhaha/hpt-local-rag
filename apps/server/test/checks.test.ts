import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkComplete, checkDalil, checkMarkersSoFar, checkNote, checkQuote, checkSources, findSpan, markersOf, normalize, toProse, verifyExcerpt } from "../src/features/answer/checks.ts";
import { emptyAnswer } from "../src/features/answer/fold.ts";
import type { Answer } from "../src/features/answer/types.ts";
import { ARABIC, NOTES, ONE, TWO, ledgerOf, makePassage } from "./answer-fixtures.ts";

const wireDalil = (overrides: Record<string, unknown> = {}) =>
  ({ id: "D1", kind: "tarjih", reference: "r", arabic: ARABIC, translation: null, explanation: "e", explanation_basis: "explicit", sources: ["S2"], ...overrides }) as never;

describe("normalising for the checks (D10a)", () => {
  it("collapses whitespace, folds curly quotes and applies NFC, and nothing else", () => {
    assert.equal(normalize("  a \n\t b “c” ‘d’  ").text, " a b \"c\" 'd' ");
    assert.equal(normalize("cafe\u0301").text, "café");
    assert.equal(normalize("Wudlu BATAL").text, "Wudlu BATAL");
  });

  it("keeps Arabic harakat: text without them is a different text", () => {
    const withMarks = makePassage(7, `Teks ${ARABIC} selesai.`);
    const stripped = ARABIC.replace(/[ً-ْ]/g, "");
    assert.notEqual(stripped, ARABIC);
    assert.notEqual(verifyExcerpt(ARABIC, [withMarks]), null);
    assert.equal(verifyExcerpt(stripped, [withMarks]), null);
  });

  it("finds a span whose normalised form equals the needle's, in the source's own coordinates", () => {
    const cases: [string, string][] = [
      ["Kompos  yang\nbelum   matang tidak boleh.", "yang belum matang"],
      ["Ungkapan “kitab” ditulis begini.", 'Ungkapan "kitab" ditulis'],
      ["cafe\u0301 enak sekali", "café enak"],
      ["satu dua tiga empat", " dua tiga "],
    ];
    for (const [haystack, needle] of cases) {
      const span = findSpan(haystack, needle);
      assert.ok(span, needle);
      assert.equal(normalize(haystack.slice(span.start, span.end)).text.trim(), normalize(needle).text.trim(), needle);
    }
  });

  it("refuses a match that would have to cut inside a word that NFC rewrote, and an empty needle", () => {
    assert.equal(findSpan("cafe\u0301 enak", "caf"), null);
    assert.equal(findSpan("apa saja", "   "), null);
    assert.equal(findSpan("apa saja", "tidak ada"), null);
  });

  it("returns the SOURCE's text for a verified quote, so the reader highlights what the source says", () => {
    const excerpt = verifyExcerpt('Ungkapan "kitab" ditulis', [TWO]);
    assert.ok(excerpt);
    assert.equal(excerpt.passage, TWO.id);
    assert.equal(excerpt.text, TWO.text.slice(excerpt.start, excerpt.end));
    assert.match(excerpt.text, /“kitab”/);
  });
});

describe("markers and prose", () => {
  it("lists markers in order without duplicates and ignores look-alikes", () => {
    assert.deepEqual(markersOf("a [S1][S2] b [S1] [S03] [Sumber] [S]"), ["S1", "S2", "S03"]);
  });

  it("turns markers into cite spans, merging adjacent ones, and resolves them to passage ids", () => {
    const ledger = ledgerOf(ONE, TWO);
    const checked = toProse("Awal [S1][S2] tengah [S1] akhir.", ledger, true, "summary");
    assert.deepEqual(checked.findings, []);
    assert.deepEqual(checked.value, [
      { kind: "text", text: "Awal " },
      { kind: "cite", passages: [ONE.id, TWO.id] },
      { kind: "text", text: " tengah " },
      { kind: "cite", passages: [ONE.id] },
      { kind: "text", text: " akhir." },
    ]);
  });

  it("reports an unknown marker and a superseded one in final prose", () => {
    const old = makePassage(3, "lama", { supersededBy: ONE.id });
    const ledger = ledgerOf(ONE, old);
    const codes = toProse("a [S1] b [S2] c [S9] d [S01]", ledger, true, "summary").findings.map((found) => `${found.code}:${found.detail.split(" ")[0]}`);
    assert.deepEqual(codes, ["superseded_cited:S2", "unknown_source:S9", "unknown_source:S01"]);
  });

  it("holds back a half-written marker while streaming and shows every cite as pending", () => {
    const ledger = ledgerOf(ONE);
    for (const tail of ["[", "[S", "[S1", "[S1][", "[S1][S"]) {
      const streamed = toProse(`Awal ${tail}`, ledger, false, "summary").value;
      const joined = streamed.map((span) => (span.kind === "text" ? span.text : `<${span.passages}>`)).join("");
      assert.ok(!joined.includes("["), tail);
    }
    assert.deepEqual(toProse("Awal [S1] lagi [S", ledger, false, "summary").value, [
      { kind: "text", text: "Awal " },
      { kind: "cite", passages: null },
      { kind: "text", text: " lagi " },
    ]);
  });

  it("catches an unknown id as soon as its marker is closed, and ignores one still being written", () => {
    const ledger = ledgerOf(ONE);
    assert.equal(checkMarkersSoFar("summary", "Awal [S1] lalu [S7", ledger).length, 0);
    assert.deepEqual(checkMarkersSoFar("summary", "Awal [S1] lalu [S7]", ledger).map((found) => found.code), ["unknown_source"]);
  });
});

describe("items", () => {
  it("checks source ids: unknown, superseded unless a revision note, and an empty list", () => {
    const old = makePassage(3, "lama", { supersededBy: ONE.id });
    const ledger = ledgerOf(ONE, old);
    assert.deepEqual(checkSources("dalil", ["S1"], ledger, false), []);
    assert.deepEqual(checkSources("dalil", ["S9"], ledger, false).map((found) => found.code), ["unknown_source"]);
    assert.deepEqual(checkSources("dalil", ["S2"], ledger, false).map((found) => found.code), ["superseded_cited"]);
    assert.deepEqual(checkSources("note.revision", ["S1", "S2"], ledger, true), []);
    assert.deepEqual(checkSources("dalil", [], ledger, false).map((found) => found.code), ["bad_shape"]);
  });

  it("turns a verbatim note quote into a span in the source and logs the substitution when the text differed", () => {
    const ledger = ledgerOf(ONE, TWO);
    const exact = checkNote(NOTES.exception as never, ledger);
    assert.deepEqual(exact.findings, []);
    assert.equal(exact.value.quote?.text, "Kompos yang belum matang tidak boleh dipakai.");
    assert.deepEqual(exact.rewrites, []);
    const spaced = checkNote({ ...NOTES.exception, quote: { source: "S2", text: "Kompos  yang   belum matang" } } as never, ledger);
    assert.deepEqual(spaced.rewrites, [{ kind: "quote_from_source", id: "N1" }]);
    assert.equal(spaced.value.quote?.text, "Kompos yang belum matang");
  });

  it("drops a quote that is not in its source with a logged repair, and keeps the note", () => {
    const checked = checkNote({ ...NOTES.exception, quote: { source: "S2", text: "kalimat karangan" } } as never, ledgerOf(ONE, TWO));
    assert.equal(checked.value.quote, null);
    assert.deepEqual(checked.findings.map((found) => [found.code, found.site, found.repair]), [["quote_not_verbatim", "note.exception", { kind: "quote_dropped", id: "N1" }]]);
    assert.equal(checked.value.title, "Kompos belum matang tidak boleh dipakai");
  });

  it("only lets a revision note cite a superseded passage, active source first", () => {
    const newer = makePassage(5, "versi baru", { supersedes: makePassage(4, "x").id });
    const older = makePassage(4, "versi lama", { supersededBy: newer.id });
    const ledger = ledgerOf(newer, older);
    const revision = { id: "N3", kind: "revision", title: "t", text: "x", basis: "explicit", quote: null, sources: ["S1", "S2"] };
    assert.deepEqual(checkNote(revision as never, ledger).findings, []);
    assert.deepEqual(checkNote({ ...revision, kind: "difference" } as never, ledger).findings.map((found) => found.code), ["superseded_cited"]);
  });

  it("D10b: Arabic matching a cited passage becomes the source's text, and Arabic that does not match is nulled", () => {
    const ledger = ledgerOf(ONE, TWO);
    const fromSource = checkDalil(wireDalil({ arabic: `  ${ARABIC.replace(/ /g, "  ")} ` }), ledger);
    assert.deepEqual(fromSource.findings, []);
    assert.equal(fromSource.value.arabic?.text, ARABIC);
    assert.deepEqual(fromSource.rewrites, [{ kind: "arabic_from_source", id: "D1" }]);

    const notCited = checkDalil(wireDalil({ sources: ["S1"] }), ledger);
    assert.deepEqual(notCited.findings.map((found) => [found.code, found.repair]), [["arabic_not_in_source", { kind: "arabic_nulled", id: "D1" }]]);
    assert.equal(notCited.value.arabic, null);
    assert.equal(notCited.value.explanation, "e");
  });

  it("checks a source-panel quote against the passage it names", () => {
    const ledger = ledgerOf(ONE);
    assert.equal(checkQuote({ source: "S1", text: "menumpuk sisa daun" }, ledger).value?.text, "menumpuk sisa daun");
    const unknown = checkQuote({ source: "S4", text: "x" }, ledger);
    assert.equal(unknown.value, null);
    assert.deepEqual(unknown.findings.map((found) => found.code), ["unknown_source"]);
    assert.deepEqual(checkQuote({ source: "S1", text: "bukan isi" }, ledger).findings.map((found) => found.code), ["quote_not_verbatim"]);
  });
});

describe("what each type requires at the end", () => {
  const complete: Answer = {
    ...emptyAnswer(),
    type: "answer",
    basis: "explicit",
    headline: "Menurut HPT, ...",
    headlineShort: "boleh",
    summary: [{ kind: "text", text: "a " }, { kind: "cite", passages: [ONE.id] }],
  };
  const sites = (answer: Answer) => checkComplete(answer).map((found) => found.site);

  it("accepts a complete answer and reports each missing part by site", () => {
    assert.deepEqual(sites(complete), []);
    assert.deepEqual(sites({ ...complete, headline: null, headlineShort: " " }), ["headline", "headline_short"]);
    assert.deepEqual(sites({ ...emptyAnswer() }), ["type"]);
  });

  it("requires an inference note for an inferred answer and at least one cited passage for any answer", () => {
    assert.deepEqual(sites({ ...complete, basis: "inferred" }), ["inference_note"]);
    assert.deepEqual(sites({ ...complete, summary: [{ kind: "text", text: "tanpa sumber" }] }), ["summary"]);
  });

  it("requires a question and 2 to 4 options for a clarify, and a message for the other types", () => {
    const clarify: Answer = { ...emptyAnswer(), type: "clarify", clarifyingQuestion: "Yang mana?", clarifyingOptions: ["a", "b"] };
    assert.deepEqual(sites(clarify), []);
    assert.deepEqual(sites({ ...clarify, clarifyingOptions: ["a"] }), ["clarifying_options"]);
    assert.deepEqual(sites({ ...clarify, clarifyingOptions: ["a", "b", "c", "d", "e"] }), ["clarifying_options"]);
    for (const type of ["insufficient", "out_of_scope", "declined"] as const) {
      assert.deepEqual(sites({ ...emptyAnswer(), type }), ["message"]);
      assert.deepEqual(sites({ ...emptyAnswer(), type, message: "Maaf." }), []);
    }
  });
});
