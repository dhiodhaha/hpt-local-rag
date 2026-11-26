import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { advanceReveal, CATCH_UP_MS, catchUpCps, revealProse, segmentsOf, textLength } from "../src/renderer/chat/prose.ts";
import { MOTION, motionVars } from "../src/renderer/motion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/renderer");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

const sources = filesUnder(root).filter((file) => /\.(tsx?|css)$/.test(file));
const read = (file: string) => fs.readFileSync(file, "utf8");

describe("rules the renderer keeps", () => {
  it("never writes markup from text, since corpus text is only ever a text node", () => {
    assert.deepEqual(sources.filter((file) => read(file).includes("dangerouslySetInnerHTML")), []);
  });

  it("imports no Electron and no Node built-in", () => {
    const offenders = sources.filter((file) => /from "(electron|node:[^"]+)"/.test(read(file)));
    assert.deepEqual(offenders, []);
  });

  it("holds colours in tokens only: no hex literal outside tokens.css and the provider marks", () => {
    const allowed = new Set(["tokens.css", "providerLogos.ts"]);
    const offenders = sources.filter((file) => !allowed.has(path.basename(file)) && /#[0-9a-fA-F]{3,8}\b/.test(read(file)));
    assert.deepEqual(offenders.map((file) => path.relative(root, file)), []);
  });
});

describe("prose segments", () => {
  const cite = (passages: string[] | null) => ({ kind: "cite" as const, passages: passages as never });

  it("keeps a mark on the line with the word before it and the punctuation after it", () => {
    const segments = segmentsOf([{ kind: "text", text: "Kompos boleh dari daun" }, cite(["a#1"]), { kind: "text", text: ". Lalu matang" }]);
    assert.deepEqual(segments, [
      { kind: "text", text: "Kompos boleh dari " },
      { kind: "cite", word: "daun", passages: ["a#1"], after: "." },
      { kind: "text", text: " Lalu matang" },
    ]);
  });

  it("keeps a pending mark and a second mark in a row", () => {
    const segments = segmentsOf([{ kind: "text", text: "Dasar" }, cite(null), cite(["a#2"])]);
    assert.deepEqual(segments.map((segment) => segment.kind), ["cite", "cite"]);
    assert.equal(segments[0]?.kind === "cite" && segments[0].word, "Dasar");
  });


  it("shows words whole and a citation only after the words before it", () => {
    const prose = [{ kind: "text" as const, text: "Kompos boleh dari daun " }, cite(["a#1"]), { kind: "text" as const, text: "dan jerami." }];
    assert.deepEqual(revealProse(prose, 0), []);
    assert.deepEqual(revealProse(prose, 9), [{ kind: "text", text: "Kompos " }]);
    assert.deepEqual(revealProse(prose, 18), [{ kind: "text", text: "Kompos boleh dari " }]);
    assert.deepEqual(revealProse(prose, 23), [{ kind: "text", text: "Kompos boleh dari daun " }, cite(["a#1"])]);
    assert.deepEqual(revealProse(prose, 500), prose);
    assert.equal(textLength(prose), 34);
  });

  it("advances at the configured pace and never past what has arrived, even after a long pause", () => {
    assert.equal(advanceReveal(0, 100, 100, 90), 9);
    assert.equal(advanceReveal(95, 100, 100, 90), 100);
    assert.equal(advanceReveal(0, 100, 5000, 90), 9);
    assert.equal(catchUpCps(10, 90), 90, "a short remainder keeps the normal rate");
    assert.equal(catchUpCps(400, 90), 1000, "a long remainder finishes within CATCH_UP_MS");
    let shown = 0;
    const cps = catchUpCps(400, 90);
    for (let ms = 0; ms < CATCH_UP_MS; ms += 16) shown = advanceReveal(shown, 400, 16, cps);
    assert.ok(shown >= 399, `caught up to ${shown}`);
  });
});

describe("the motion config", () => {
  it("has exactly the keys the tuner exports, so its JSON can be pasted over it", () => {
    assert.deepEqual(Object.keys(MOTION).sort(), [
      "cardStaggerMs", "citeResolveMs", "easing", "fieldEnterMs", "fieldOffsetPx", "headlineEnterMs", "headlineOffsetPx", "headlineSettleMs", "headlineVerifyInk",
      "restartFadeInMs", "restartFadeOutMs", "skeletonShimmerMs", "skeletonSwapMs", "sourcesEnterMs", "sourcesOffsetPx", "sourcesStaggerMs", "textRevealCps",
      "thinkingPulseMs", "verifyPillFadeMs", "wordFadeMs",
    ]);
  });

  it("ships the approved values", () => {
    assert.deepEqual(MOTION, {
      easing: [0.2, 0.7, 0.2, 1], thinkingPulseMs: 1600, sourcesEnterMs: 200, sourcesStaggerMs: 40, sourcesOffsetPx: 8, citeResolveMs: 160, headlineEnterMs: 260, headlineOffsetPx: 4,
      headlineVerifyInk: 75, headlineSettleMs: 200, verifyPillFadeMs: 200, textRevealCps: 90, wordFadeMs: 120, fieldEnterMs: 220, fieldOffsetPx: 6, cardStaggerMs: 60,
      skeletonShimmerMs: 1400, skeletonSwapMs: 180, restartFadeOutMs: 200, restartFadeInMs: 240,
    });
  });

  it("turns every key but the reveal rate into a CSS variable, and a reduced setting drops movement but keeps the fades", () => {
    const full = motionVars(MOTION, false);
    assert.equal(full["--m-ease"], "cubic-bezier(0.2, 0.7, 0.2, 1)");
    assert.equal(full["--m-sources-offset"], "8px");
    assert.equal(full["--m-headline-settle"], "200ms");
    assert.equal(Object.keys(full).length, 19);
    const reduced = motionVars(MOTION, true);
    assert.deepEqual([reduced["--m-sources-offset"], reduced["--m-headline-offset"], reduced["--m-field-offset"]], ["0px", "0px", "0px"]);
    assert.deepEqual([reduced["--m-headline-settle"], reduced["--m-word-fade"], reduced["--m-verify-fade"]], ["200ms", "120ms", "200ms"]);
  });
});
