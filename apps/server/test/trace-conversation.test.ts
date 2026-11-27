import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { historyOf, openConversations, type StoredTurn } from "../src/features/answer/conversation.ts";
import type { AnswerEngine, Finished } from "../src/features/answer/engine.ts";
import { createRecorder, jsonlTraceSink, memoryTraceSink, type Trace } from "../src/features/answer/trace.ts";
import { emptyAnswer } from "../src/features/answer/fold.ts";
import type { CompleteAnswer, Turn } from "../src/features/answer/types.ts";
import { ONE, TWO } from "../src/testing/answer-fixtures.ts";
import { tempDir } from "./helpers.ts";

describe("the trace recorder", () => {
  const header = { v: 1 as const, id: "t1", label: null, at: "2026-11-26T10:30:12.114Z", conversation: null, turn: null, model: "m", effort: "medium" as const, provider: "scripted", promptVersion: "abc", indexFingerprint: "fp", maxExtraToolCalls: 2 };

  it("times fields, items and the first text from the start of the ask, and numbers items per list", () => {
    let clock = 1000;
    const recorder = createRecorder({ ...header, now: () => clock });
    recorder.attemptStarted(1, { model: "m", effort: "medium" }, null);
    clock += 120;
    recorder.providerStarted(3.4, true);
    clock += 1800;
    recorder.firstText();
    clock += 50;
    recorder.firstText();
    clock += 400;
    recorder.event({ kind: "field", name: "headline", value: "h" });
    clock += 10;
    recorder.event({ kind: "item", name: "dalil", value: { id: "D1" } as never, edits: [] });
    recorder.event({ kind: "item", name: "dalil", value: { id: "D2" } as never, edits: [] });
    clock += 5;
    recorder.attemptEnded({ end: "complete", findings: [], edits: [], failure: null, visibleRestart: false, usage: null });
    const trace = recorder.finish({ outcome: { kind: "delivered" }, ledger: [ONE.id], tools: [], cited: [ONE.id] });
    const [attempt] = trace.attempts;
    assert.deepEqual([attempt?.route, attempt?.fallback], [{ model: "m", effort: "medium" }, null]);
    assert.equal(attempt?.firstTextMs, 1920);
    assert.equal(attempt?.providerWaitMs, 3);
    assert.equal(attempt?.warm, true);
    assert.deepEqual(attempt?.committedMs, [{ name: "headline", ms: 2370 }, { name: "dalil[0]", ms: 2380 }, { name: "dalil[1]", ms: 2380 }]);
    assert.equal(attempt?.endedMs, 2385);
    assert.equal(trace.totalMs, 2385);
    assert.equal(trace.id, "t1");
  });
});

describe("the trace sinks", () => {
  const trace = { v: 1, id: "t1", at: "2026-11-26T10:30:12.114Z" } as unknown as Trace;

  it("appends one JSON line per trace to a file named for the day", () => {
    const dir = path.join(tempDir(), "traces");
    const sink = jsonlTraceSink(dir);
    sink.write(trace);
    sink.write({ ...trace, id: "t2" });
    const lines = fs.readFileSync(path.join(dir, "2026-11-26.jsonl"), "utf8").trim().split("\n");
    assert.deepEqual(lines.map((line) => (JSON.parse(line) as Trace).id), ["t1", "t2"]);
  });

  it("never throws when it cannot write", () => {
    const blocker = path.join(tempDir(), "file");
    fs.writeFileSync(blocker, "x");
    const original = console.error;
    console.error = () => {};
    try {
      assert.doesNotThrow(() => jsonlTraceSink(path.join(blocker, "inside")).write(trace));
    } finally {
      console.error = original;
    }
  });

  it("keeps traces in memory for the eval to read back", () => {
    const sink = memoryTraceSink();
    sink.write(trace);
    assert.equal(sink.traces.length, 1);
  });
});

const delivered = (overrides: Partial<CompleteAnswer> = {}): CompleteAnswer => ({
  ...emptyAnswer(),
  type: "answer",
  basis: "explicit",
  headline: "Menurut HPT, ...",
  headlineShort: "boleh",
  summary: [{ kind: "text", text: "a " }, { kind: "cite", passages: [ONE.id] }],
  dalil: [{ id: "D1", kind: "tarjih", reference: "r", arabic: null, translation: null, explanation: "e", explanationBasis: "explicit", sources: [TWO.id] }],
  ...overrides,
});

function engineReturning(results: (Partial<Finished> & { answer: CompleteAnswer | null })[]) {
  const turns: Turn[] = [];
  const traces: unknown[] = [];
  let call = 0;
  const engine: AnswerEngine = {
    warm: () => {},
    title: async () => null,
    close: async () => {},
    ask: async (turn, options) => {
      turns.push(turn);
      traces.push(options?.conversation);
      const next = results[call++]!;
      return { id: `ask-${call}`, outcome: next.answer === null ? { kind: "cancelled" } : { kind: "delivered" }, context: [ONE.id, TWO.id], trace: {} as Trace, ...next };
    },
  };
  return { engine, turns, traces };
}

describe("conversations", () => {
  it("builds each turn's history from stored headlines and cited ids, never the answer text", () => {
    const stored: StoredTurn[] = [{ id: "a", n: 1, at: "x", question: "pertama?", scope: null, answer: delivered(), context: [ONE.id] }];
    assert.deepEqual(historyOf(stored), [{ n: 1, question: "pertama?", type: "answer", gist: "Menurut HPT, ...", basis: "explicit", cited: [ONE.id, TWO.id] }]);
    const clarify = delivered({ type: "clarify", headline: null, clarifyingQuestion: "Yang mana?", summary: null, dalil: [], basis: null });
    assert.equal(historyOf([{ ...stored[0]!, answer: clarify }])[0]?.gist, "Yang mana?");
  });

  it("records a delivered turn, hands the next question that history, and numbers turns for the trace", async () => {
    const dir = path.join(tempDir(), "conversations");
    const { engine, turns, traces } = engineReturning([{ answer: delivered() }, { answer: delivered() }]);
    const conversation = openConversations(dir).open("new");
    await conversation.ask(engine, "pertama?");
    await conversation.ask(engine, "lalu?", { scope: { kind: "document", noteId: "putusan/uji-1" } });
    assert.deepEqual(turns[0]?.history, []);
    assert.equal(turns[1]?.history.length, 1);
    assert.equal(turns[1]?.history[0]?.question, "pertama?");
    assert.deepEqual(turns[1]?.scope, { kind: "document", noteId: "putusan/uji-1" });
    assert.deepEqual(traces, [{ id: conversation.id, turn: 1 }, { id: conversation.id, turn: 2 }]);
    const file = path.join(dir, `${conversation.id}.jsonl`);
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 2);
  });

  it("stores nothing for an ask that was not delivered, so the user asks again against an unchanged history", async () => {
    const dir = path.join(tempDir(), "conversations");
    const { engine } = engineReturning([{ answer: null }]);
    const conversation = openConversations(dir).open("new");
    await conversation.ask(engine, "gagal?");
    assert.equal(conversation.turns.length, 0);
    assert.equal(fs.existsSync(dir), false);
  });

  it("reopens a conversation by id or as the latest, skipping a truncated last line", async () => {
    const dir = path.join(tempDir(), "conversations");
    const { engine } = engineReturning([{ answer: delivered() }, { answer: delivered() }]);
    const conversations = openConversations(dir);
    const first = conversations.open("new");
    await first.ask(engine, "pertama?");
    await first.ask(engine, "kedua?");
    fs.appendFileSync(path.join(dir, `${first.id}.jsonl`), '{"id":"cut","n":3,"quest');
    const reopened = openConversations(dir).open("latest");
    assert.equal(reopened.id, first.id);
    assert.deepEqual(reopened.turns.map((turn) => turn.question), ["pertama?", "kedua?"]);
    assert.deepEqual(conversations.list(), [{ id: first.id, turns: 2 }]);
    assert.equal(openConversations(dir).open(first.id).turns.length, 2);
  });

  it("says so when there is no conversation to continue", () => {
    assert.throws(() => openConversations(path.join(tempDir(), "none")).open("latest"), /no earlier conversation/);
  });
});
