import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ARABIC } from "@hpt/server/testing";
import { arabicRuns, isMostlyArabic, tidyCorpus } from "../src/renderer/arabic.ts";
import { gistOf } from "../src/renderer/chat/passage.ts";

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/renderer");

describe("Arabic in a UI-font line", () => {
  it("splits a mixed line into runs that join back to the same text", () => {
    const text = `1. Hadits pertama: ${ARABIC}، ${ARABIC} lalu penjelasan.`;
    const runs = arabicRuns(text);
    assert.equal(runs.map((run) => run.text).join(""), text);
    assert.deepEqual(runs.map((run) => run.arabic), [false, true, false]);
    assert.equal(runs[1]?.text, `${ARABIC}، ${ARABIC}`);
  });

  it("keeps the ellipsis of a cut Arabic excerpt inside the run, so it shows on the left", () => {
    assert.deepEqual(arabicRuns(`Ringkasan ${ARABIC}…`), [{ text: "Ringkasan ", arabic: false }, { text: `${ARABIC}…`, arabic: true }]);
    assert.deepEqual(arabicRuns(`“…${ARABIC}”`), [{ text: "“", arabic: false }, { text: `…${ARABIC}`, arabic: true }, { text: "”", arabic: false }]);
    assert.deepEqual(arabicRuns("Hadits pertama…"), [{ text: "Hadits pertama…", arabic: false }]);
  });

  it("tells an Arabic quote from a line that only has Arabic in it", () => {
    assert.equal(isMostlyArabic(`“…${ARABIC}…”`), true);
    assert.equal(isMostlyArabic(`Ungkapan “kitab” ditulis ${ARABIC} dalam contoh ini.`), false);
    assert.equal(isMostlyArabic("“…”"), false);
  });

  it("keeps a line with no Arabic as one plain run", () => {
    assert.deepEqual(arabicRuns("Pupuk organik dari kompos."), [{ text: "Pupuk organik dari kompos.", arabic: false }]);
  });

  it("is used wherever corpus text is drawn in the UI font", () => {
    for (const file of ["chat/SourcesPanel.tsx", "chat/ArticleRow.tsx", "reader/AnswerPane.tsx"]) {
      assert.match(fs.readFileSync(path.join(renderer, file), "utf8"), /<ArabicText /, file);
    }
  });
});

describe("Arabic the corpus extraction damaged", () => {
  const ALEF = "\u0627";
  const HAMZA_ALEF = "\u0623";
  const BA = "\u0628";
  const NOON = "\u0646";
  const FATHA = "\u064E";
  const SUKUN = "\u0652";
  const ALLAH = "\u0627\u0644\u0644\u0647";

  it("puts a hamza-alef stored as a control character back, so no box is drawn", () => {
    assert.equal(tidyCorpus(`\u0007${FATHA}${BA}`), `${HAMZA_ALEF}${FATHA}${BA}`);
    assert.equal(tidyCorpus(`${BA}\u0008${FATHA}${BA}`), `${BA}${HAMZA_ALEF}${FATHA}${BA}`);
  });

  it("drops characters no font draws: other controls, private use and the replacement character", () => {
    assert.equal(tidyCorpus("a\u0001b\u000Bc\uE001d\uFFFDe"), "abcde");
    assert.equal(tidyCorpus("satu\tdua\ntiga"), "satu\tdua\ntiga");
  });

  it("puts the lafz Allah back where the extraction left a Cyrillic letter, with or without its marks", () => {
    assert.equal(tidyCorpus(`${ALEF}\u0426 \u064E\u064F\u0651`), ALLAH);
    assert.equal(tidyCorpus("\u0426"), ALLAH);
    assert.doesNotMatch(tidyCorpus(`${BA}${ALEF}\u0426${FATHA} ${BA}`), /[\u0400-\u04FF]/);
  });

  it("joins a vowel mark to its letter when the extraction put a space between them", () => {
    assert.equal(tidyCorpus(`${BA} ${SUKUN}${NOON} ${FATHA}`), `${BA}${SUKUN}${NOON}${FATHA}`);
    assert.equal(tidyCorpus(`${BA} ${NOON}`), `${BA} ${NOON}`);
  });

  it("keeps brackets, the colon of a hadith source, Arabic-Indic digits and the ornate brackets inside one run", () => {
    const hadith = `]${ARABIC} : \u0668\u0665\u0660[`;
    assert.deepEqual(arabicRuns(`Hadits: ${hadith} lanjut.`), [
      { text: "Hadits: ", arabic: false },
      { text: hadith, arabic: true },
      { text: " lanjut.", arabic: false },
    ]);
    const verse = `\uFD3E${ARABIC}\uFD3F \u0662\u0663`;
    assert.deepEqual(arabicRuns(verse), [{ text: verse, arabic: true }]);
  });

  it("keeps tatweel, zero-width joiners and honorific ligatures inside the run", () => {
    const text = `${ARABIC}\u0640\u0640${ARABIC} ${ARABIC}\u200D${ARABIC}\u200C${ARABIC} \uFDFA ${ARABIC}`;
    assert.deepEqual(arabicRuns(text), [{ text, arabic: true }]);
  });

  it("does not let a bracket or a joiner start a run of its own, or pull Indonesian words in", () => {
    assert.deepEqual(arabicRuns("lihat [1] dan (2) lalu \u200D selesai"), [{ text: "lihat [1] dan (2) lalu \u200D selesai", arabic: false }]);
    assert.deepEqual(arabicRuns(`kata ${ARABIC} (artinya) ini`).map((run) => run.arabic), [false, true, false]);
  });

  it("reads a damaged gist as one flowing line with one Arabic run per stretch of Arabic", () => {
    const damaged = `Ringkasan: \u0007${FATHA}${BA} ${ARABIC} ${ALEF}\u0426 \u064E\u064F\u0651 ]${ARABIC} : \u0661\u0662\u0663[ selesai`;
    const runs = arabicRuns(gistOf(damaged, 400));
    assert.deepEqual(runs.map((run) => run.arabic), [false, true, false]);
    assert.equal(runs[0]?.text, "Ringkasan: ");
    assert.equal(runs[2]?.text, " selesai");
    assert.ok(runs[1]?.text.includes(ALLAH));
    // oxlint-disable-next-line no-control-regex
    assert.doesNotMatch(runs.map((run) => run.text).join(""), /[\u0000-\u0008\u0426\uFFFD]/);
  });
});
