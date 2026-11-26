import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPrinter, parseScope, summaryLines } from "../src/commands/ask.ts";
import { createEngine, type EngineSettings } from "../src/features/answer/engine.ts";
import { loadPromptTemplate } from "../src/features/answer/prompt.ts";
import { memoryTraceSink } from "../src/features/answer/trace.ts";
import { chunked, scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { ONE, TWO, answerJson, makePassage } from "./answer-fixtures.ts";
import { fakeIndex } from "./fake-index.ts";

const SETTINGS: EngineSettings = { model: "claude-test", effort: "medium", maxExtraToolCalls: 2, searchLimit: 10, evidenceTokens: 8000 };

async function printed(script: ScriptedAttempt[]) {
  let out = "";
  const engine = createEngine({
    index: fakeIndex([ONE, TWO, makePassage(3, "Teks ketiga.")]),
    provider: scriptedProvider(script),
    prompt: loadPromptTemplate(answerConfig.systemPromptDoc),
    canary: "CANARY-test",
    traces: memoryTraceSink(),
    settings: SETTINGS,
  });
  const finished = await engine.ask({ question: "Apakah kompos boleh?", history: [], scope: null }, { onEvent: createPrinter((text) => (out += text)) });
  return { out, finished };
}

describe("hpt ask", () => {
  it("pins a question to a putusan with --note, and refuses anything else", () => {
    assert.equal(parseScope(undefined), null);
    assert.deepEqual(parseScope("putusan/fatwa-01"), { kind: "document", noteId: "putusan/fatwa-01" });
    assert.throws(() => parseScope("sources/fatwa-01"), /putusan/);
  });

  it("prints the sources first, then each checked field as it commits, with citations as source numbers", async () => {
    const { out } = await printed([{ chunks: chunked(answerJson(), 25) }]);
    const at = (needle: string) => out.indexOf(needle);
    assert.ok(at("Sumber (3):") === 0);
    assert.match(out, /\(bukti: strong\)/);
    assert.ok(at("Sumber (3):") < at("Menurut HPT, kompos boleh dibuat dari sisa daun.") && at("Menurut HPT") < at("Ringkasan: Kompos boleh dibuat"));
    assert.match(out, /dasar: explicit/);
    assert.match(out, /dikutip: 1, 2/);
    assert.match(out, /catatan {2}\[exception\] Kompos belum matang tidak boleh dipakai {2}\[2\]/);
    assert.match(out, /dalil {4}tarjih Fatwa Uji 2 {2}arab: dari sumber {2}\[2\]/);
    assert.match(out, /kutipan {2}\[1\] "menumpuk sisa daun"/);
    assert.equal(out.includes("[S"), false);
  });

  it("says when a retry replaced what was on screen, and prints the fixed sentence for a withheld answer", async () => {
    const bad = answerJson({ summary: "Kompos [S9]." });
    const retried = await printed([{ chunks: chunked(bad, 25) }, { chunks: [answerJson()] }]);
    assert.match(retried.out, /Memeriksa ulang sumber…/);
    assert.match(retried.out, /\(percobaan 2, karena unknown_source\)/);
    const withheld = await printed([{ chunks: [bad] }, { chunks: [bad] }]);
    assert.match(withheld.out, /Jawaban ini belum lolos pemeriksaan sumber, jadi tidak kami tampilkan\. Silakan coba lagi\./);
  });

  it("prints the sources a tool call added, and a denied call", async () => {
    const call = (query: string) => ({ afterChunk: 0, name: "search", args: { query } });
    const { out } = await printed([{ chunks: ["Mencari. ", answerJson()], toolCalls: [call("a"), call("b"), call("c")] }]);
    assert.match(out, /panggilan tambahan 1: search "a"/);
    assert.match(out, /panggilan tambahan 3: search "c" \(ditolak, batas habis\)/);
  });

  it("summarises the trace numbers a person checks by hand", async () => {
    const { finished } = await printed([{ chunks: [answerJson()] }]);
    const [first, second] = summaryLines(finished);
    assert.match(first ?? "", /^trace {2}retrieval \d+ ms · provider wait \d+ ms \(fresh\) · first text [\d.]+ s · headline [\d.]+ s · summary [\d.]+ s · settled [\d.]+ s · done [\d.]+ s$/);
    assert.match(second ?? "", /attempts 1 · tools 0 · repairs 0 · findings 0 · claude-test medium/);
  });
});

describe("the headline marker in the terminal", () => {
  const headline = { kind: "field", name: "headline", value: "Menurut HPT, boleh." } as const;
  const settled = { kind: "settled", name: "headline" } as const;
  const ESC = String.fromCharCode(27);

  function printerFor(rows?: number) {
    let out = "";
    const print = createPrinter((text) => (out += text), rows === undefined ? {} : { rewrite: { rows } });
    return { print, text: () => out };
  }

  it("marks the headline as being verified, and says on a new line when it settles in a plain stream", () => {
    const { print, text } = printerFor();
    print(headline);
    assert.match(text(), /Menurut HPT, boleh\. \[memeriksa…\]\n$/);
    print({ kind: "field", name: "headline_short", value: "boleh" });
    print(settled);
    assert.match(text(), /ringkas: boleh\n {2}headline terverifikasi\n$/);
  });

  it("rewrites the headline line in place on a terminal, replacing the marker, and returns the cursor below the text", () => {
    const { print, text } = printerFor(40);
    print(headline);
    print({ kind: "field", name: "headline_short", value: "boleh" });
    print({ kind: "field", name: "summary", value: [{ kind: "text", text: "Ringkasan." }] });
    const before = text();
    print(settled);
    const rewrite = text().slice(before.length);
    assert.equal(rewrite, `${ESC}[4A\r${ESC}[KMenurut HPT, boleh.${ESC}[4B\r`);
  });

  it("falls back to a new line when the headline has scrolled out of reach, and prints nothing for a headline a restart withdrew", () => {
    const small = printerFor(3);
    small.print(headline);
    small.print({ kind: "field", name: "summary", value: [{ kind: "text", text: "a\nb\nc\n" }] });
    small.print(settled);
    assert.match(small.text(), /headline terverifikasi\n$/);

    const withdrawn = printerFor(40);
    withdrawn.print(headline);
    withdrawn.print({ kind: "restart", copy: "Memeriksa ulang sumber…" });
    const before = withdrawn.text();
    withdrawn.print(settled);
    assert.equal(withdrawn.text(), before);
  });
});
