import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createEngine, loadPromptTemplate, memoryTraceSink, openConversations, type AnswerEvent } from "../src/features/answer/index.ts";
import { claudeModelOptions, createClient, createHost, type AskParams, type FromHost, type HostDeps, type HostError, type Pipe } from "../src/features/host/index.ts";
import { chunked, scriptedProvider, type Connection, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { ONE, TWO, answerJson } from "../src/testing/answer-fixtures.ts";
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

const ask = (overrides: Partial<AskParams> = {}): AskParams => ({ conversation: null, question: "Apakah kompos boleh?", scope: null, choice: null, ...overrides });

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
