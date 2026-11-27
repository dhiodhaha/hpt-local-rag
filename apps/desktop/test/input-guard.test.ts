import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createClient, type FromHost, type Pipe, type ToHost } from "@hpt/server/client";
import { memoryPipe, scenarioHost } from "@hpt/server/testing";
import { WINDOW_SECURITY, answeredLogLine, appendLog, askLogLine, askVerdict, classify, expectedRenderer, logFileFor, rejectedLogLine, senderVerdict, sha12, urlAllowed } from "../src/main/input-guard.ts";
import { createChatStore, isBusy } from "../src/renderer/chat/store.ts";

const QUESTION = "Apakah kompos boleh dibuat dari sisa daun?";
const DEV = expectedRenderer("http://localhost:5173/", "file:///app/out/renderer/index.html");
const BUILT = expectedRenderer(undefined, "file:///app/out/renderer/index.html");
const OK = { fromWindow: true, isMainFrame: true, frameUrl: "http://localhost:5173/" };

const askFrame = (origin: Record<string, unknown> | undefined = { via: "enter", trusted: true, focused: true, turn: 1 }, extra: Record<string, unknown> = {}) => ({
  kind: "call",
  id: "call-1",
  method: "ask",
  params: { conversation: null, question: QUESTION, scope: null, choice: null, origin, ...extra },
});

describe("which senders the main process accepts", () => {
  it("accepts the main frame of our window at the dev server's origin, or at the one built file", () => {
    assert.deepEqual(senderVerdict(OK, DEV), { ok: true });
    assert.deepEqual(senderVerdict({ ...OK, frameUrl: "file:///app/out/renderer/index.html#/x" }, BUILT), { ok: true });
  });

  it("refuses another sender, a child frame, and a page that is not ours", () => {
    assert.deepEqual(senderVerdict({ ...OK, fromWindow: false }, DEV), { ok: false, reason: "other_sender" });
    assert.deepEqual(senderVerdict({ ...OK, isMainFrame: false }, DEV), { ok: false, reason: "not_main_frame" });
    for (const frameUrl of ["https://example.test/", "http://localhost:5174/", "http://localhost.evil.test:5173/", "file:///app/out/renderer/other.html", "about:blank", "not a url", ""]) {
      assert.deepEqual(senderVerdict({ ...OK, frameUrl }, DEV), { ok: false, reason: "wrong_origin" }, frameUrl);
    }
    assert.equal(senderVerdict({ ...OK, frameUrl: "http://localhost:5173/" }, BUILT).ok, false, "the dev server is not our page in production");
    assert.equal(senderVerdict({ ...OK, frameUrl: "file:///elsewhere/index.html" }, BUILT).ok, false);
  });

  it("lets navigation stay on the renderer's origin and blocks the rest", () => {
    assert.equal(urlAllowed("http://localhost:5173/#reload", DEV), true);
    assert.equal(urlAllowed("https://example.test/", DEV), false);
    assert.equal(urlAllowed("file:///app/out/renderer/index.html", BUILT), true);
    assert.equal(urlAllowed("https://example.test/", BUILT), false);
  });

  it("keeps the window's security settings on", () => {
    assert.deepEqual(WINDOW_SECURITY, { contextIsolation: true, sandbox: true, nodeIntegration: false });
  });
});

describe("what is logged about an ask", () => {
  const classified = classify(askFrame({ via: "suggestion", trusted: true, focused: false, turn: 3 }, { conversation: "c-20261126-101500-abcd" }));

  it("reads an ask frame and ignores every other frame", () => {
    assert.equal(classified.kind, "ask");
    assert.equal(classify({ kind: "hello" }).kind, "other");
    assert.equal(classify({ kind: "call", id: "x", method: "list", params: null }).kind, "other");
    assert.equal(classify("text").kind, "other");
    for (const bad of [askFrame({ via: "enter" }), askFrame(null as never), { ...askFrame(), id: "" }, { ...askFrame(), params: null }]) assert.equal(classify(bad).kind, "bad_ask");
  });

  it("has the fields the review needs and no text field: the question is only a length and a short hash", () => {
    assert.ok(classified.kind === "ask");
    const line = askLogLine({ now: new Date("2026-11-27T01:02:03.456Z"), ask: classified.ask, windowFocused: true, windowVisible: false });
    assert.deepEqual(Object.keys(line).sort(), ["callId", "conversation", "focused", "kind", "questionChars", "questionSha12", "time", "trusted", "turn", "via", "windowFocused", "windowVisible"]);
    assert.deepEqual(line, {
      time: "2026-11-27T01:02:03.456Z",
      kind: "ask",
      callId: "call-1",
      conversation: "c-20261126-101500-abcd",
      turn: 3,
      via: "suggestion",
      trusted: true,
      focused: false,
      windowFocused: true,
      windowVisible: false,
      questionChars: QUESTION.length,
      questionSha12: sha12(QUESTION),
    });
    assert.match(line.questionSha12, /^[0-9a-f]{12}$/);
    const text = JSON.stringify(line);
    for (const word of QUESTION.split(" ")) assert.equal(text.includes(word), false, word);
  });

  it("tells two asks apart by hash and the same question by the same hash", () => {
    assert.equal(sha12(QUESTION), sha12(QUESTION));
    assert.notEqual(sha12(QUESTION), sha12(`${QUESTION}?`));
  });

  it("logs a rejected frame with its reason and sender, and a result with the conversation a new ask got", () => {
    const now = new Date("2026-11-27T00:00:00Z");
    assert.deepEqual(rejectedLogLine(now, "wrong_origin", "https://example.test/"), { time: now.toISOString(), kind: "rejected", reason: "wrong_origin", senderUrl: "https://example.test/" });
    assert.deepEqual(answeredLogLine(now, "call-1", { conversation: "c-1", turn: 1, askId: "a1" }), { time: now.toISOString(), kind: "answered", callId: "call-1", conversation: "c-1", turn: 1, askId: "a1" });
    assert.equal(answeredLogLine(now, "call-1", { nothing: true }), null);
  });

  it("appends one JSON line per entry to data/logs/input-YYYY-MM-DD.jsonl and never throws", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hpt-log-")), "data", "logs");
    const now = new Date(2026, 10, 27, 9, 30);
    assert.ok(classified.kind === "ask");
    appendLog(dir, now, askLogLine({ now, ask: classified.ask, windowFocused: true, windowVisible: true }));
    appendLog(dir, now, rejectedLogLine(now, "other_sender", "x"));
    const file = logFileFor(dir, now);
    assert.equal(path.basename(file), "input-2026-11-27.jsonl");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { kind: string });
    assert.deepEqual(lines.map((line) => line.kind), ["ask", "rejected"]);
    assert.equal(fs.readFileSync(file, "utf8").includes("kompos"), false);
    const errors: string[] = [];
    appendLog(path.join(file, "not-a-folder"), now, rejectedLogLine(now, "other_sender", "x"), (message) => errors.push(message));
    assert.equal(errors.length, 1);
  });

  it("drops an ask from an untrusted event, and one that does not say where it came from", () => {
    assert.deepEqual(askVerdict(classify(askFrame({ via: "button", trusted: false, focused: true, turn: 1 }))), { ok: false, reason: "untrusted_ask" });
    assert.deepEqual(askVerdict(classify(askFrame({ via: "enter" }))), { ok: false, reason: "malformed_ask" });
    assert.deepEqual(askVerdict(classify(askFrame())), { ok: true });
    assert.deepEqual(askVerdict(classify({ kind: "hello" })), { ok: true });
  });
});

describe("an ask in the chat store", () => {
  async function rig() {
    const host = scenarioHost("settled", { conversationsDir: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-input-")), delayMs: 0 });
    const inner = memoryPipe(host);
    const sent: ToHost[] = [];
    const pipe: Pipe = {
      send: (frame) => {
        sent.push(frame);
        inner.send(frame);
      },
      subscribe: (listener: (frame: FromHost) => void) => inner.subscribe(listener),
    };
    const client = createClient(pipe);
    let keys = 0;
    const store = createChatStore(client, { newKey: () => `t${(keys += 1)}`, schedule: (flush) => flush() });
    for (let waited = 0; client.state().kind !== "ready" && waited < 3000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    return { store, host, sent };
  }
  const asks = (sent: readonly ToHost[]) => sent.flatMap((frame) => (frame.kind === "call" && frame.method === "ask" ? [frame.params] : []));

  it("ignores an ask from an untrusted event: no turn, no frame, the draft stays", async () => {
    const { store, host, sent } = await rig();
    store.getState().setDraft(QUESTION);
    store.getState().send(QUESTION, { via: "button", trusted: false, focused: true });
    assert.equal(store.getState().turns.length, 0);
    assert.equal(store.getState().draft, QUESTION);
    assert.equal(asks(sent).length, 0);
    await host.close();
  });

  it("sends where a trusted ask came from, with the turn number it has in the window", async () => {
    const { store, host, sent } = await rig();
    store.getState().send(QUESTION, { via: "suggestion", trusted: true, focused: false });
    for (let waited = 0; isBusy(store.getState()) && waited < 3000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    store.getState().send("Lalu bagaimana?", { via: "enter", trusted: true, focused: true });
    for (let waited = 0; asks(sent).length < 2 && waited < 3000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(asks(sent).map((params) => params.origin), [
      { via: "suggestion", trusted: true, focused: false, turn: 1 },
      { via: "enter", trusted: true, focused: true, turn: 2 },
    ]);
    await host.close();
  });

  it("does not retry on an untrusted event", async () => {
    const { store, host, sent } = await rig();
    store.getState().retry({ via: "retry", trusted: false, focused: true });
    assert.equal(asks(sent).length, 0);
    await host.close();
  });
});
