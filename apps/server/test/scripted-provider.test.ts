import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderContract, chunked, scriptedProvider, type RunProfile, type ToolHost } from "../src/features/providers/index.ts";

const profile: RunProfile = { model: "m", effort: "low", system: "s", tools: [] };
const tools: ToolHost = { invoke: async () => ({ text: "", isError: false }) };

describe("the scripted provider", () => {
  it("replays each attempt in order and keeps the requests it received", async () => {
    const provider = scriptedProvider([{ chunks: ["a", "b"] }, { chunks: ["c"] }]);
    const first = await assertProviderContract(provider.run({ profile, user: "one", tools }, new AbortController().signal));
    const second = await assertProviderContract(provider.run({ profile, user: "two", tools }, new AbortController().signal));
    assert.deepEqual(
      first.map((event) => event.kind),
      ["started", "text", "text", "end"],
    );
    assert.deepEqual(
      second.map((event) => event.kind),
      ["started", "text", "end"],
    );
    assert.deepEqual(
      provider.requests.map((request) => request.user),
      ["one", "two"],
    );
  });

  it("runs a scripted tool call through the host between the chunks around it", async () => {
    const called: string[] = [];
    const host: ToolHost = {
      invoke: async (name, args) => {
        called.push(`${name}:${args.query}`);
        return { text: "ok", isError: false };
      },
    };
    const provider = scriptedProvider([{ chunks: ["x", "y"], toolCalls: [{ afterChunk: 0, name: "search", args: { query: "q" } }] }]);
    const events = await assertProviderContract(provider.run({ profile, user: "u", tools: host }, new AbortController().signal));
    assert.deepEqual(
      events.map((event) => event.kind),
      ["started", "text", "tool_use", "text", "end"],
    );
    assert.deepEqual(called, ["search:q"]);
  });

  it("ends with the scripted failure, and with crashed once the script runs out", async () => {
    const provider = scriptedProvider([{ chunks: ["a"], fail: { code: "overloaded", detail: "busy", resetsAt: null } }]);
    const failing = await assertProviderContract(provider.run({ profile, user: "u", tools }, new AbortController().signal));
    const exhausted = await assertProviderContract(provider.run({ profile, user: "u", tools }, new AbortController().signal));
    const codeOf = (events: Awaited<ReturnType<typeof assertProviderContract>>) => {
      const end = events.at(-1);
      return end?.kind === "end" && !end.outcome.ok ? end.outcome.failure.code : null;
    };
    assert.equal(codeOf(failing), "overloaded");
    assert.equal(codeOf(exhausted), "crashed");
  });

  it("ends with aborted when the signal fires", async () => {
    const provider = scriptedProvider([{ chunks: ["a", "b", "c"] }]);
    const controller = new AbortController();
    controller.abort();
    const events = await assertProviderContract(provider.run({ profile, user: "u", tools }, controller.signal));
    const end = events.at(-1);
    assert.equal(end?.kind === "end" && !end.outcome.ok && end.outcome.failure.code, "aborted");
  });

  it("chunks text without losing any of it", () => {
    assert.deepEqual(chunked("abcdefg", 3), ["abc", "def", "g"]);
    assert.equal(chunked("héllo wörld", 4).join(""), "héllo wörld");
  });
});
