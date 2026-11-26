import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { segmentsOf, splitTail } from "../src/renderer/chat/prose.ts";

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

  it("fades the last four words of a streaming tail", () => {
    assert.deepEqual(splitTail("satu dua tiga empat lima enam"), { lead: "satu dua", tail: " tiga empat lima enam" });
    assert.deepEqual(splitTail("dua kata"), { lead: "", tail: "dua kata" });
  });
});
