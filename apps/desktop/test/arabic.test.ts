import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ARABIC } from "@hpt/server/testing";
import { arabicRuns } from "../src/renderer/arabic.ts";

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

  it("keeps a line with no Arabic as one plain run", () => {
    assert.deepEqual(arabicRuns("Pupuk organik dari kompos."), [{ text: "Pupuk organik dari kompos.", arabic: false }]);
  });

  it("is used wherever corpus text is drawn in the UI font", () => {
    for (const file of ["chat/SourcesPanel.tsx", "chat/AnswerCardView.tsx", "reader/AnswerPane.tsx"]) {
      assert.match(fs.readFileSync(path.join(renderer, file), "utf8"), /<ArabicText /, file);
    }
  });
});
