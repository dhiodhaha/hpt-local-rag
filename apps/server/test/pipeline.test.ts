import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPipeline, type Pipeline } from "../src/features/answer/pipeline.ts";
import { actionOf, queuesForTestSet } from "../src/features/answer/policy.ts";
import { createTripwire } from "../src/features/answer/tripwire.ts";
import type { AnswerEvent } from "../src/features/answer/types.ts";
import { chunked } from "../src/features/providers/index.ts";
import { ARABIC, GOOD_ANSWER, NOTES, ONE, TWO, answerJson, ledgerOf, makePassage } from "./answer-fixtures.ts";

const CANARY = "CANARY-7f3a91";

type Run = { events: AnswerEvent[]; abort: ReturnType<Pipeline["push"]>["abort"]; pipeline: Pipeline };

function run(chunks: readonly string[], options: { passages?: Parameters<typeof ledgerOf> } = {}): Run {
  const pipeline = createPipeline({ ledger: ledgerOf(...(options.passages ?? [ONE, TWO])), tripwire: createTripwire(CANARY) });
  const events: AnswerEvent[] = [];
  for (const chunk of chunks) {
    const step = pipeline.push(chunk);
    events.push(...step.events);
    if (step.abort) return { events, abort: step.abort, pipeline };
  }
  const done = pipeline.finish();
  events.push(...done.events);
  return { events, abort: done.abort, pipeline };
}

const names = (events: readonly AnswerEvent[]) => events.filter((event) => event.kind !== "progress").map((event) => (event.kind === "field" || event.kind === "item" ? `${event.kind}:${event.name}` : event.kind));

const GOOD = answerJson();

describe("the field pipeline", () => {
  it("commits fields in the prompt's order and folds to the answer, with the source's own text for Arabic and quotes", () => {
    const { events, abort, pipeline } = run([GOOD]);
    assert.equal(abort, null);
    assert.deepEqual(names(events), [
      "field:type",
      "field:basis",
      "field:headline",
      "field:headline_short",
      "field:summary",
      "settled",
      "field:inference_note",
      "item:notes",
      "item:notes",
      "item:dalil",
      "item:quotes",
      "field:clarifying_question",
      "field:message",
    ]);
    const { answer } = pipeline;
    assert.equal(answer.headline, GOOD_ANSWER.headline);
    assert.deepEqual(answer.summary?.filter((span) => span.kind === "cite").map((span) => (span.kind === "cite" ? span.passages : null)), [[ONE.id], [TWO.id]]);
    assert.equal(answer.dalil[0]?.arabic?.text, ARABIC);
    assert.equal(TWO.text.slice(answer.dalil[0]?.arabic?.start, answer.dalil[0]?.arabic?.end), ARABIC);
    assert.equal(answer.quotes[0]?.text, "menumpuk sisa daun");
    assert.equal(pipeline.committed, true);
    assert.deepEqual(pipeline.findings, []);
  });

  it("gives the same committed events for any chunking of the same text", () => {
    const whole = names(run([GOOD]).events);
    const wholeAnswer = run([GOOD]).pipeline.answer;
    for (const size of [1, 7, 64]) {
      const chunkedRun = run(chunked(GOOD, size));
      assert.deepEqual(names(chunkedRun.events), whole, `chunks of ${size}`);
      assert.deepEqual(chunkedRun.pipeline.answer, wholeAnswer, `chunks of ${size}`);
    }
  });

  it("streams the summary with pending cites, then replaces it with the checked one", () => {
    const { events } = run(chunked(GOOD, 5));
    const progress = events.filter((event) => event.kind === "progress");
    assert.ok(progress.length > 3);
    const last = progress.at(-1);
    assert.equal(last?.kind === "progress" && last.prose.some((span) => span.kind === "cite" && span.passages !== null), false);
    const summaryAt = events.findIndex((event) => event.kind === "field" && event.name === "summary");
    assert.ok(events.slice(0, summaryAt).filter((event) => event.kind === "progress").length === progress.length);
  });

  it("shows basis before headline even when the model writes them the other way round, and only warns", () => {
    const order = ["type", "headline", "basis", "headline_short", "summary", "inference_note", "notes", "dalil", "quotes", "unverified_references", "clarifying_question", "clarifying_options", "message"];
    const { events, abort, pipeline } = run([answerJson({}, order)]);
    assert.equal(abort, null);
    assert.deepEqual(names(events).slice(0, 4), ["field:type", "field:basis", "field:headline", "field:headline_short"]);
    assert.deepEqual(pipeline.findings.map((found) => [found.code, actionOf(found)]), [["out_of_order", "warn"]]);
  });

  it("holds later fields while an earlier one has not arrived, and releases them when the object closes", () => {
    const withoutNote = answerJson({}, ["type", "basis", "headline", "headline_short", "summary", "notes", "dalil", "quotes", "unverified_references", "clarifying_question", "clarifying_options", "message"]);
    const closing = withoutNote.length - 1;
    const pipeline = createPipeline({ ledger: ledgerOf(ONE, TWO), tripwire: createTripwire(CANARY) });
    const before = pipeline.push(withoutNote.slice(0, closing));
    assert.ok(names(before.events).includes("field:summary"));
    assert.equal(names(before.events).includes("item:notes"), false);
    const after = pipeline.push(withoutNote.slice(closing));
    assert.ok(names(after.events).includes("item:notes"));
    assert.equal(pipeline.finish().abort, null);
  });

  it("D10e: an unknown source in a dalil drops only that item and the answer is still delivered", () => {
    const dalil = [{ ...(GOOD_ANSWER.dalil as object[])[0], sources: ["S9"] }];
    const { events, abort, pipeline } = run([answerJson({ dalil })]);
    assert.equal(abort, null);
    assert.equal(names(events).includes("item:dalil"), false);
    assert.equal(pipeline.answer.dalil.length, 0);
    const [found] = pipeline.findings;
    assert.equal(found?.code, "unknown_source");
    assert.equal(actionOf(found!), "drop_item");
  });

  it("D10f: a failing exception note is withheld in its place, with its passages, and queued for the test set", () => {
    const notes = [{ ...NOTES.exception, sources: ["S9"] }, NOTES.practical];
    const { pipeline, abort } = run([answerJson({ notes })]);
    assert.equal(abort, null);
    assert.equal(pipeline.answer.notes.length, 2);
    const first = pipeline.answer.notes[0];
    assert.ok(first && "withheld" in first);
    assert.equal(first.id, "N1");
    assert.equal(queuesForTestSet(pipeline.findings[0]!), true);
  });

  it("D10h: a superseded passage cited in a dalil is dropped and queued, and in the summary it retries the attempt", () => {
    const old = makePassage(3, "versi lama", { supersededBy: ONE.id });
    const dalil = [{ ...(GOOD_ANSWER.dalil as object[])[0], sources: ["S3"], arabic: null }];
    const dropped = run([answerJson({ dalil })], { passages: [ONE, TWO, old] });
    assert.equal(dropped.abort, null);
    assert.equal(dropped.pipeline.answer.dalil.length, 0);
    assert.equal(queuesForTestSet(dropped.pipeline.findings[0]!), true);
    const retried = run([answerJson({ summary: "Menurut yang lama [S3]." })], { passages: [ONE, TWO, old] });
    assert.equal(retried.abort?.finding.code, "superseded_cited");
  });

  it("D10c: a Latin quote that fails is removed from its note, the note stays, and the repair is logged", () => {
    const notes = [NOTES.exception, { ...NOTES.practical, quote: { source: "S1", text: "kalimat karangan" } }];
    const { pipeline, abort } = run([answerJson({ notes })]);
    assert.equal(abort, null);
    const practical = pipeline.answer.notes[1];
    assert.ok(practical && !("withheld" in practical));
    assert.equal(practical.quote, null);
    assert.deepEqual(pipeline.edits, [{ kind: "quote_dropped", id: "N2" }]);
  });

  it("D10b: Arabic that is not in a cited passage is nulled, and the card keeps its reference", () => {
    const dalil = [{ ...(GOOD_ANSWER.dalil as object[])[0], arabic: "نص غير موجود" }];
    const { pipeline } = run([answerJson({ dalil })]);
    assert.equal(pipeline.answer.dalil[0]?.arabic, null);
    assert.equal(pipeline.answer.dalil[0]?.reference, "Fatwa Uji 2");
    assert.deepEqual(pipeline.edits, [{ kind: "arabic_nulled", id: "D1" }]);
  });

  it("D10e: a failing difference note retries the whole attempt instead of being dropped", () => {
    const notes = [{ ...NOTES.practical, kind: "difference", sources: ["S9"] }];
    assert.equal(run([answerJson({ notes })]).abort?.finding.code, "unknown_source");
  });

  it("aborts as soon as an unknown marker closes in the summary, before the rest of the text arrives", () => {
    const text = answerJson({ summary: "Kompos boleh [S9] dan seterusnya sampai akhir." });
    const cutAfterMarker = text.indexOf("[S9]") + 4;
    const pipeline = createPipeline({ ledger: ledgerOf(ONE, TWO), tripwire: createTripwire(CANARY) });
    const step = pipeline.push(text.slice(0, cutAfterMarker));
    assert.equal(step.abort?.finding.code, "unknown_source");
    assert.equal(step.abort?.finding.site, "summary");
    assert.equal(pipeline.committed, true);
    assert.deepEqual(pipeline.push(text.slice(cutAfterMarker)), { events: [], abort: null });
  });

  it("stops on the canary split across chunks, and never shows any part of it", () => {
    const text = answerJson({ summary: `Kompos boleh. ${CANARY} dibuka [S1].` });
    for (const size of [1, 3, 13]) {
      const { events, abort } = run(chunked(text, size));
      assert.equal(abort?.finding.code, "canary", `chunks of ${size}`);
      assert.equal(JSON.stringify(events).includes("CANARY"), false, `chunks of ${size}`);
    }
  });

  it("stops on a canary the model wrote behind JSON escapes", () => {
    const escaped = answerJson({ headline: "Menurut HPT, ok." }).replace("Menurut HPT, ok.", `Menurut \\u0043ANARY-7f3a91 HPT`);
    assert.equal(run([escaped]).abort?.finding.code, "canary");
  });

  it("stops when a tool argument tripped the canary", () => {
    const tripwire = createTripwire(CANARY);
    const pipeline = createPipeline({ ledger: ledgerOf(ONE), tripwire });
    tripwire.feed(`cari ${CANARY}`);
    assert.equal(pipeline.toolUse().abort?.finding.code, "canary");
  });

  it("clears its state for a tool call made before anything was shown, after the model thought aloud", () => {
    const pipeline = createPipeline({ ledger: ledgerOf(ONE, TWO), tripwire: createTripwire(CANARY) });
    assert.deepEqual(pipeline.push("Saya akan mencari dulu. "), { events: [], abort: null });
    assert.deepEqual(pipeline.toolUse(), { events: [], abort: null });
    const events = chunked(GOOD, 40).flatMap((chunk) => [...pipeline.push(chunk).events]);
    assert.ok(names(events).includes("field:headline"));
    assert.equal(pipeline.finish().abort, null);
  });

  it("D10: a tool call after the answer started cannot be undone, so it retries the attempt", () => {
    const pipeline = createPipeline({ ledger: ledgerOf(ONE, TWO), tripwire: createTripwire(CANARY) });
    pipeline.push(GOOD.slice(0, 60));
    assert.equal(pipeline.committed, true);
    assert.equal(pipeline.toolUse().abort?.finding.code, "tool_after_output");
  });

  it("treats a malformed or duplicate field as broken JSON and an unparsable value as a bad shape", () => {
    assert.equal(run(['{"type":"answer","type":"clarify"}']).abort?.finding.code, "bad_json");
    assert.equal(run(['{"type" "answer"}']).abort?.finding.code, "bad_json");
    const bad = run([answerJson({ type: "essay" })]);
    assert.equal(bad.abort?.finding.code, "bad_shape");
    assert.equal(bad.abort?.finding.site, "type");
  });

  it("fails an answer that ends without what its type requires, and one that is cut off", () => {
    const noHeadline = run([answerJson({ headline: null })]);
    assert.equal(noHeadline.abort?.finding.code, "incomplete");
    assert.equal(noHeadline.abort?.finding.site, "headline");
    assert.equal(run([GOOD.slice(0, 200)]).abort?.finding.code, "bad_json");
    assert.equal(run(["Saya tidak bisa menjawab."]).abort?.finding.code, "bad_json");
  });

  it("accepts a fenced object and logs the fence, and only warns about text after the object", () => {
    const fenced = run(["```json\n", GOOD, "\n```"]);
    assert.equal(fenced.abort, null);
    assert.deepEqual(fenced.pipeline.edits, [{ kind: "fence_stripped" }]);
    const trailing = run([GOOD, " Semoga membantu."]);
    assert.equal(trailing.abort, null);
    assert.deepEqual(trailing.pipeline.findings.map((found) => found.code), ["trailing_text"]);
  });

  it("delivers a clarify with its options and no sources", () => {
    const clarify = answerJson({ type: "clarify", basis: null, headline: null, headline_short: null, summary: null, notes: [], dalil: [], quotes: [], clarifying_question: "Darah dari mana?", clarifying_options: ["Hidung", "Luka"] });
    const { abort, pipeline } = run([clarify]);
    assert.equal(abort, null);
    assert.equal(pipeline.answer.type, "clarify");
    assert.deepEqual(pipeline.answer.clarifyingOptions, ["Hidung", "Luka"]);
  });
});
