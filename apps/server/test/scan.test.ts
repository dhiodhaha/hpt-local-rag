import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createScanner, decodePartialString, type ScanEvent } from "../src/features/answer/scan.ts";
import { PROGRESS_FIELDS } from "../src/features/answer/wire.ts";
import { answerJson } from "../src/testing/answer-fixtures.ts";

const scanAll = (chunks: readonly string[]): ScanEvent[] => {
  const scanner = createScanner({ progressFields: PROGRESS_FIELDS });
  return chunks.flatMap((chunk) => scanner.push(chunk));
};

const withoutProgress = (events: readonly ScanEvent[]) => events.filter((event) => event.kind !== "progress");

const FIXTURE = answerJson({ summary: 'Dia berkata "ya" \\ dan {tanda} [S1] é selesai.' }).replace("é", "\\u00e9");

describe("the streamed JSON scanner", () => {
  it("reports each top-level value and each array item with its raw text, in order", () => {
    const events = withoutProgress(scanAll([FIXTURE]));
    const values = events.flatMap((event) => (event.kind === "value" ? [event.field] : []));
    assert.deepEqual(values, ["type", "basis", "unverified_references", "headline", "headline_short", "summary", "inference_note", "notes", "dalil", "quotes", "clarifying_question", "clarifying_options", "message"]);
    const items = events.flatMap((event) => (event.kind === "item" ? [`${event.field}#${event.index}`] : []));
    assert.deepEqual(items, ["notes#0", "notes#1", "dalil#0", "quotes#0"]);
    const summary = events.find((event) => event.kind === "value" && event.field === "summary");
    assert.equal(summary?.kind === "value" && JSON.parse(summary.raw), 'Dia berkata "ya" \\ dan {tanda} [S1] é selesai.');
    assert.equal(events.at(-1)?.kind, "end");
  });

  it("gives the same events for every way of splitting the text in two, and for 1- and 7-character chunks", () => {
    const whole = withoutProgress(scanAll([FIXTURE]));
    for (let cut = 1; cut < FIXTURE.length; cut += 1) {
      assert.deepEqual(withoutProgress(scanAll([FIXTURE.slice(0, cut), FIXTURE.slice(cut)])), whole, `split at ${cut}`);
    }
    for (const size of [1, 7]) {
      const chunks = Array.from({ length: Math.ceil(FIXTURE.length / size) }, (_, index) => FIXTURE.slice(index * size, (index + 1) * size));
      assert.deepEqual(withoutProgress(scanAll(chunks)), whole, `chunks of ${size}`);
    }
  });

  it("tolerates a code fence around the object and reports it", () => {
    const events = scanAll(["```json\n", FIXTURE, "\n```\n"]);
    assert.equal(events.filter((event) => event.kind === "fence").length, 1);
    assert.equal(events.some((event) => event.kind === "error"), false);
    assert.equal(events.some((event) => event.kind === "end"), true);
  });

  it("stops at the first byte that is not JSON, and stays dead", () => {
    const scanner = createScanner({ progressFields: PROGRESS_FIELDS });
    assert.deepEqual(
      scanner.push("Saya akan mencari dulu."),
      [{ kind: "error", reason: "not_json", at: 0 }],
    );
    assert.equal(scanner.dead, true);
    assert.deepEqual(scanner.push('{"type":"answer"}'), []);
  });

  it("rejects malformed structure and a repeated top-level key", () => {
    const malformed = scanAll(['{"type" "answer"}']);
    assert.equal(malformed.at(-1)?.kind === "error" && malformed.at(-1)?.kind === "error" && (malformed.at(-1) as { reason: string }).reason, "malformed");
    const duplicate = scanAll(['{"type":"answer","type":"clarify"}']);
    assert.deepEqual(
      duplicate.map((event) => event.kind),
      ["value", "error"],
    );
    assert.equal((duplicate[1] as { reason: string }).reason, "duplicate_key");
  });

  it("reports text after the closing brace as trailing, after the end event", () => {
    const events = scanAll(['{"type":"answer"} Semoga membantu.']);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["value", "end", "error"],
    );
    assert.equal((events[2] as { reason: string }).reason, "trailing");
  });

  it("streams only progress fields, with the decoded string so far and any half-received escape held back", () => {
    const scanner = createScanner({ progressFields: PROGRESS_FIELDS });
    const first = scanner.push('{"type":"answer","summary":"Dia \\"ya\\" \\u00');
    assert.deepEqual(
      first.filter((event) => event.kind === "progress"),
      [{ kind: "progress", field: "summary", text: 'Dia "ya" ' }],
    );
    const second = scanner.push('e9 lagi');
    assert.deepEqual(
      second.filter((event) => event.kind === "progress"),
      [{ kind: "progress", field: "summary", text: 'Dia "ya" é lagi' }],
    );
    const third = scanner.push('."');
    assert.deepEqual(third.map((event) => event.kind), ["value"]);
    assert.equal(createScanner({ progressFields: PROGRESS_FIELDS }).push('{"headline":"abc').length, 0);
  });

  it("holds a lone high surrogate escape until its pair arrives", () => {
    assert.equal(decodePartialString("a\\ud83d"), "a");
    assert.equal(decodePartialString("a\\ud83d\\ude00"), "a\u{1f600}");
    assert.equal(decodePartialString("tab\\there\\"), "tab\there");
  });
});
