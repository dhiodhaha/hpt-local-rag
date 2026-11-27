import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createEngine, loadPromptTemplate, memoryTraceSink, openConversations, type AnswerEvent } from "../src/features/answer/index.ts";
import type { PassageId } from "../src/features/search/index.ts";
import { claudeModelOptions, createClient, createHost, type AskParams, type FromHost, type HostDeps, type HostError, type Pipe } from "../src/features/host/index.ts";
import { chunked, scriptedProvider, type Connection, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { ONE, TWO, answerJson, makePassage } from "../src/testing/answer-fixtures.ts";
import { fakeIndex } from "../src/testing/fake-index.ts";
import { memoryPipe } from "../src/testing/memory-pipe.ts";
import { tempDir } from "./helpers.ts";

const PROMPT = loadPromptTemplate(answerConfig.systemPromptDoc);
const GOOD = answerJson();
const ok = (delayMs = 0): ScriptedAttempt => ({ chunks: chunked(GOOD, 40), delayMs });
const CONNECTED: Connection = { state: "connected", subscription: "Claude Max" };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rig(script: ScriptedAttempt[], options: { hasPutusan?: boolean; connection?: Promise<Connection> } = {}) {
  const provider = scriptedProvider(script);
  const index = fakeIndex([ONE, TWO]);
  index.hasPutusan = () => options.hasPutusan ?? true;
  const engine = createEngine({ index, provider, prompt: PROMPT, canary: "CANARY-test", traces: memoryTraceSink(), settings: answerConfig.answer });
  const conversations = openConversations(path.join(tempDir(), "conversations"));
  const closed = { count: 0 };
  const deps: HostDeps = {
    backend: { engine, conversations, index },
    models: claudeModelOptions(),
    probe: () => options.connection ?? Promise.resolve(CONNECTED),
    close: async () => {
      closed.count += 1;
      await engine.close();
    },
    log: () => {},
  };
  const host = createHost(deps);
  const client = createClient(memoryPipe(host));
  return { provider, conversations, host, client, closed };
}

const ask = (overrides: Partial<AskParams> = {}): AskParams => ({ conversation: null, question: "Apakah kompos boleh?", scope: null, choice: null, origin: { via: "enter", trusted: true, focused: true, turn: 1 }, ...overrides });

function collect(client: ReturnType<typeof createClient>, params: AskParams) {
  const events: AnswerEvent[] = [];
  const call = client.ask(params, (event) => events.push(event));
  return { call, events };
}

const finishedOf = (events: readonly AnswerEvent[]) => events.filter((event) => event.kind === "finished");
const connectionOf = (client: ReturnType<typeof createClient>) => {
  const state = client.state();
  return state.kind === "ready" ? state.connection : null;
};

describe("the host over an in-memory pipe", () => {
  it("streams an ask and ends with exactly one finished, then the result", async () => {
    const { client, conversations } = rig([ok()]);
    const { call, events } = collect(client, ask());
    const result = await call.done;
    assert.equal(finishedOf(events).length, 1);
    assert.deepEqual(events.at(-1), { kind: "finished", outcome: { kind: "delivered" } });
    assert.equal(result.turn, 1);
    assert.equal(conversations.open(result.conversation).turns.length, 1);
  });

  it("sends finished only after the turn is saved", async () => {
    const { client, conversations } = rig([ok()]);
    const savedAtFinished: number[] = [];
    const call = client.ask(ask(), (event) => {
      if (event.kind === "finished") savedAtFinished.push(...conversations.list().map((entry) => entry.turns));
    });
    await call.done;
    assert.deepEqual(savedAtFinished, [1]);
  });

  it("runs a follow-up with the first turn in its history, also when two are sent at once", async () => {
    const { client, provider, conversations } = rig([ok(), ok(), ok()]);
    const first = await collect(client, ask({ question: "Pertanyaan pertama?" })).call.done;
    const second = collect(client, ask({ conversation: first.conversation, question: "Pertanyaan kedua?" }));
    const third = collect(client, ask({ conversation: first.conversation, question: "Pertanyaan ketiga?" }));
    const results = await Promise.all([second.call.done, third.call.done]);
    assert.deepEqual(results.map((result) => result.turn), [2, 3]);
    assert.equal(conversations.open(first.conversation).turns.length, 3);
    assert.ok((provider.requests.at(-1)?.user ?? "").includes("Pertanyaan kedua?"), "the third ask saw the second in its history");
  });

  it("cancels a running ask: finished cancelled, nothing stored", async () => {
    const { client, conversations } = rig([ok(30)]);
    const { call, events } = collect(client, ask());
    await wait(100);
    call.cancel();
    call.cancel();
    const result = await call.done;
    assert.deepEqual(events.at(-1), { kind: "finished", outcome: { kind: "cancelled" } });
    assert.equal(finishedOf(events).length, 1);
    assert.equal(conversations.open(result.conversation).turns.length, 0);
  });

  it("cancels an ask that is still queued behind another one of its conversation", async () => {
    const { client } = rig([ok(), ok(40)]);
    const first = await collect(client, ask()).call.done;
    const running = collect(client, ask({ conversation: first.conversation }));
    const queued = collect(client, ask({ conversation: first.conversation, question: "Lanjut?" }));
    await wait(20);
    queued.call.cancel();
    await Promise.all([running.call.done, queued.call.done]);
    assert.deepEqual(queued.events, [{ kind: "finished", outcome: { kind: "cancelled" } }]);
    assert.deepEqual(running.events.at(-1), { kind: "finished", outcome: { kind: "delivered" } });
  });

  it("refuses untrusted input and still ends the stream with a finished", async () => {
    const { client } = rig([ok()]);
    const refusals: [string, Partial<AskParams>][] = [
      ["a conversation id that is a path", { conversation: "../../x" }],
      ["an empty question", { question: "   " }],
      ["a model that is not in the list", { choice: { provider: "claude", model: "claude-not-real" } }],
      ["a note that is not a putusan", { scope: { kind: "document", noteId: "hpt/bukan-putusan" } }],
      ["an ask that does not say where it came from", { origin: undefined as never }],
      ["an origin with a path that is not one of ours", { origin: { via: "script" as never, trusted: true, focused: true, turn: 1 } }],
    ];
    for (const [label, overrides] of refusals) {
      const { call, events } = collect(client, ask(overrides));
      await assert.rejects(call.done, { code: "bad_request" }, label);
      assert.equal(finishedOf(events).length, 1, label);
      assert.equal(events.at(-1)?.kind, "finished", label);
    }
  });

  it("refuses a putusan scope the index does not have", async () => {
    const { client } = rig([ok()], { hasPutusan: false });
    const { call } = collect(client, ask({ scope: { kind: "document", noteId: "putusan/tidak-ada" } }));
    await assert.rejects(call.done, { code: "bad_request" });
  });

  it("refuses a call id used twice", async () => {
    const { host } = rig([ok()]);
    const frames: FromHost[] = [];
    const call = { kind: "call", id: "same", method: "ask", params: ask() };
    host.handle(call, (frame) => frames.push(frame));
    host.handle(call, (frame) => frames.push(frame));
    assert.deepEqual(frames.at(0), { kind: "error", id: "same", error: { code: "bad_request", message: "call id already used" } });
    await host.close();
  });

  it("answers a malformed frame with an error when it has an id and drops it when it has none", () => {
    const { host } = rig([ok()]);
    const frames: FromHost[] = [];
    host.handle({ kind: "call", id: "x", method: "ask", params: {} }, (frame) => frames.push(frame));
    host.handle("nonsense", (frame) => frames.push(frame));
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.kind, "error");
  });

  it("runs a picked model at the catalog's effort, and the default route otherwise", async () => {
    const { client, provider } = rig([ok(), ok()]);
    await collect(client, ask({ choice: { provider: "claude", model: "claude-sonnet-5-5" } })).call.done;
    await collect(client, ask()).call.done;
    assert.deepEqual(provider.requests.map((request) => [request.profile.model, request.profile.effort]), [
      ["claude-sonnet-5-5", "low"],
      ["claude-opus-5-5", "low"],
    ]);
  });

  it("close() aborts an open ask, waits for it and closes the engine once", async () => {
    const { client, host, closed } = rig([ok(30)]);
    const { call, events } = collect(client, ask());
    await wait(100);
    await Promise.all([host.close(), host.close()]);
    await call.done;
    assert.deepEqual(events.at(-1), { kind: "finished", outcome: { kind: "cancelled" } });
    assert.equal(closed.count, 1);
  });

  it("reports the login check after ready, and checking until it is known", async () => {
    let finish: (connection: Connection) => void = () => {};
    const { client } = rig([ok()], { connection: new Promise((resolve) => (finish = resolve)) });
    await wait(10);
    assert.deepEqual(connectionOf(client), { state: "checking" });
    finish({ state: "not_signed_in" });
    await wait(10);
    assert.deepEqual(connectionOf(client), { state: "not_signed_in" });
  });

  it("says why when the index is missing, and refuses asks without crashing", async () => {
    const host = createHost({ backend: { unavailable: "no index" }, models: claudeModelOptions(), probe: () => Promise.resolve(CONNECTED), close: async () => {}, log: () => {} });
    const client = createClient(memoryPipe(host));
    const { call, events } = collect(client, ask());
    await assert.rejects(call.done, { code: "index_unavailable" });
    assert.equal(events.at(-1)?.kind, "finished");
    const state = client.state();
    assert.deepEqual(state.kind === "ready" ? state.status.index : null, { state: "unavailable", message: "no index" });
  });
});

describe("the client over a transport that misbehaves", () => {
  function scripted() {
    const listeners = new Set<(frame: FromHost) => void>();
    const sent: { kind: string }[] = [];
    const pipe: Pipe = {
      send: (frame) => sent.push(frame),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const emit = (frame: FromHost) => listeners.forEach((listener) => listener(frame));
    return { pipe, sent, emit };
  }
  const status = { protocol: 1 as const, index: { state: "ready" as const, passages: 1 }, models: claudeModelOptions() };
  const kinds = (sent: { kind: string }[]) => sent.map((frame) => frame.kind);

  it("waits for ready before it sends a call, then sends it once", () => {
    const { pipe, sent, emit } = scripted();
    const client = createClient(pipe, () => "id-1");
    client.ask(ask(), () => {});
    assert.deepEqual(kinds(sent), ["hello"]);
    emit({ kind: "ready", status });
    emit({ kind: "ready", status });
    assert.deepEqual(kinds(sent), ["hello", "call"]);
  });

  it("makes the finished itself when the host goes down mid-stream, and fails calls made while it is down", async () => {
    const { pipe, emit } = scripted();
    const client = createClient(pipe, () => "id-1");
    emit({ kind: "ready", status });
    const { call, events } = collect(client, ask());
    emit({ kind: "down", reason: "exited" });
    await assert.rejects(call.done, (error: HostError) => error.code === "host_down");
    assert.deepEqual(events.map((event) => event.kind), ["finished"]);
    const later = collect(client, ask());
    await assert.rejects(later.call.done, { code: "host_down" });
    assert.equal(finishedOf(later.events).length, 1);
    assert.equal(client.state().kind, "down");
  });

  it("recovers when the host comes back", () => {
    const { pipe, emit } = scripted();
    const client = createClient(pipe);
    emit({ kind: "ready", status });
    emit({ kind: "down", reason: "exited" });
    emit({ kind: "ready", status });
    assert.equal(client.state().kind, "ready");
  });

  it("makes the finished when a result arrives without one", async () => {
    const { pipe, emit } = scripted();
    const client = createClient(pipe, () => "id-1");
    emit({ kind: "ready", status });
    const { call, events } = collect(client, ask());
    emit({ kind: "result", id: "id-1", result: { conversation: "c-20261126-101500-abcd", turn: 1, askId: "a" } });
    await call.done;
    assert.equal(finishedOf(events).length, 1);
  });

  it("never sends a cancel for a call that was not sent, and ends it as cancelled", async () => {
    const { pipe, sent, emit } = scripted();
    const client = createClient(pipe, () => "id-1");
    const { call, events } = collect(client, ask());
    call.cancel();
    await assert.rejects(call.done, { code: "cancelled" });
    assert.deepEqual(events, [{ kind: "finished", outcome: { kind: "cancelled" } }]);
    emit({ kind: "ready", status });
    assert.deepEqual(kinds(sent), ["hello"]);
  });
});

describe("hpt host as a forked process", () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");

  it("streams a scripted ask over fork IPC and exits when its parent disconnects", async () => {
    const child = fork(cli, ["host", "--scenario", "settled"], { stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "json" });
    const events: AnswerEvent[] = [];
    const exited = new Promise<number | string | null>((resolve) => {
      const guard = setTimeout(() => resolve("still running"), 10_000);
      child.on("exit", (code) => {
        clearTimeout(guard);
        resolve(code);
      });
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no result from the host")), 20_000);
      child.on("message", (frame: FromHost) => {
        if (frame.kind === "ready") child.send({ kind: "call", id: "c1", method: "ask", params: ask() });
        if (frame.kind === "event") events.push(frame.event);
        if (frame.kind === "result") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.deepEqual(events.at(-1), { kind: "finished", outcome: { kind: "delivered" } });
    assert.equal(finishedOf(events).length, 1);
    child.disconnect();
    assert.equal(await exited, 0);
  });

  it("prints its usage and exits 2 when it has no parent", () => {
    const run = spawnSync(process.execPath, [cli, "host"], { encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Started by the desktop app/);
  });
});

describe("Riwayat over the host", () => {
  it("lists, reopens with the ledger's passages, renames and deletes what an ask stored", async () => {
    const { client, conversations } = rig([ok(), ok()]);
    const first = await collect(client, ask({ question: "Apakah kompos boleh?" })).call.done;
    await collect(client, ask({ question: "Lalu pupuk?" })).call.done;
    const { conversations: listed } = await client.request("list", null);
    assert.deepEqual(listed.map((entry) => entry.title), ["Lalu pupuk?", "Apakah kompos boleh?"]);

    const opened = await client.request("open", { conversation: first.conversation });
    assert.equal(opened.turns.length, 1);
    assert.deepEqual(opened.turns[0]?.answer, conversations.open(first.conversation).turns[0]?.answer);
    assert.deepEqual(opened.turns[0]?.sources.map((card) => card.passage.id), [ONE.id, TWO.id]);

    const renamed = await client.request("rename", { conversation: first.conversation, title: "  Kompos  daun " });
    assert.equal(renamed.conversation.title, "Kompos daun");
    assert.equal((await client.request("list", null)).conversations.at(-1)?.title, "Kompos daun");

    await client.request("remove", { conversation: first.conversation });
    assert.deepEqual((await client.request("list", null)).conversations.map((entry) => entry.title), ["Lalu pupuk?"]);
    await assert.rejects(client.request("open", { conversation: first.conversation }), { code: "not_found" });
    await client.request("remove", { conversation: first.conversation });
  });

  it("searches questions and stored answers", async () => {
    const { client } = rig([ok()]);
    await collect(client, ask({ question: "Apakah kompos boleh?" })).call.done;
    assert.equal((await client.request("search", { query: "kompos" })).hits.length, 1);
    assert.deepEqual((await client.request("search", { query: "tidak-ada-kata-ini" })).hits, []);
    assert.deepEqual((await client.request("search", { query: "" })).hits, []);
  });

  it("refuses an id that is a path and a title or query that is far too long", async () => {
    const { client } = rig([]);
    await assert.rejects(client.request("open", { conversation: "../../x" }), { code: "bad_request" });
    await assert.rejects(client.request("remove", { conversation: "..\\..\\x" }), { code: "bad_request" });
    await assert.rejects(client.request("search", { query: "x".repeat(500) }), { code: "bad_request" });
    await assert.rejects(client.request("rename", { conversation: "c-20261126-101500-abcd", title: "x".repeat(500) }), { code: "bad_request" });
  });

  it("will not delete a conversation while it is answering", async () => {
    const { client } = rig([ok(), ok(60)]);
    const first = await collect(client, ask()).call.done;
    const running = collect(client, ask({ conversation: first.conversation, question: "Lanjut?" }));
    await wait(20);
    await assert.rejects(client.request("remove", { conversation: first.conversation }), { code: "bad_request" });
    await running.call.done;
    await wait(5);
    await client.request("remove", { conversation: first.conversation });
    assert.deepEqual((await client.request("list", null)).conversations, []);
  });

  it("says the index is unavailable instead of listing nothing, and fails fast when the host is down", async () => {
    const host = createHost({ backend: { unavailable: "no index" }, models: claudeModelOptions(), probe: () => Promise.resolve(CONNECTED), close: async () => {}, log: () => {} });
    const client = createClient(memoryPipe(host));
    await assert.rejects(client.request("list", null), { code: "index_unavailable" });
    const down = createClient({ send: () => {}, subscribe: (listener) => (listener({ kind: "down", reason: "exited" }), () => {}) });
    await assert.rejects(down.request("list", null), { code: "host_down" });
  });
});

describe("the reader over the host", () => {
  const noteIn = (ordinal: number, text: string) => makePassage(ordinal, text, { id: `putusan/uji-baca#${ordinal}` as PassageId, noteId: "putusan/uji-baca" });
  const NOTE = [noteIn(3, "Bagian ketiga."), noteIn(1, "Bagian pertama."), noteIn(2, "Bagian kedua.")];

  function readerRig() {
    const index = fakeIndex([ONE, ...NOTE]);
    const engine = createEngine({ index, provider: scriptedProvider([]), prompt: PROMPT, canary: "CANARY-test", traces: memoryTraceSink(), settings: answerConfig.answer });
    const host = createHost({
      backend: { engine, conversations: openConversations(path.join(tempDir(), "conversations")), index },
      models: claudeModelOptions(),
      probe: () => Promise.resolve(CONNECTED),
      close: () => engine.close(),
      log: () => {},
    });
    return createClient(memoryPipe(host));
  }

  it("returns one note's passages in reading order and none of another note's", async () => {
    const client = readerRig();
    const { passages } = await client.request("passages", { noteId: "putusan/uji-baca" });
    assert.deepEqual(passages.map((passage) => passage.ordinal), [1, 2, 3]);
    assert.ok(passages.every((passage) => passage.noteId === "putusan/uji-baca"));
    assert.deepEqual((await client.request("passages", { noteId: ONE.noteId })).passages.map((passage) => passage.id), [ONE.id]);
  });

  it("says not_found for a well-formed id the index does not hold", async () => {
    const client = readerRig();
    await assert.rejects(client.request("passages", { noteId: "putusan/tidak-ada" }), { code: "not_found" });
  });

  it("refuses an id that is not a putusan slug before it reaches the index", async () => {
    const client = readerRig();
    for (const noteId of ["../../etc/passwd", "putusan/../x", "putusan/a/b", "putusan/Huruf-Besar", "putusan/", "hpt/uji-baca", `putusan/${"a".repeat(200)}`, "putusan/uji baca", ""]) {
      await assert.rejects(client.request("passages", { noteId }), { code: "bad_request" }, noteId);
    }
    await assert.rejects(client.request("passages", { noteId: 7 as unknown as string }), { code: "bad_request" });
  });

  it("says why when the index is missing", async () => {
    const host = createHost({ backend: { unavailable: "no index" }, models: claudeModelOptions(), probe: () => Promise.resolve(CONNECTED), close: async () => {}, log: () => {} });
    await assert.rejects(createClient(memoryPipe(host)).request("passages", { noteId: "putusan/uji-baca" }), { code: "index_unavailable" });
  });
});
