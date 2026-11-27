import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeProvider } from "../src/features/providers/claude/provider.ts";
import { createSpareSlot, stderrTail } from "../src/features/providers/claude/spare.ts";
import { assertProviderContract, profileKey, type ProviderEvent, type RunProfile, type ToolHost } from "../src/features/providers/index.ts";
import { fakeSdk, successResult, textDelta, toolStart, type FakeSdk } from "./fake-claude-sdk.ts";

const profile = (overrides: Partial<RunProfile> = {}): RunProfile => ({
  lane: "answer",
  model: "claude-test",
  effort: "medium",
  system: "system prompt",
  tools: [{ name: "search", description: "Search.", params: { query: { description: "What to look for." } } }],
  ...overrides,
});

const noTools: ToolHost = { invoke: async () => ({ text: "", isError: false }) };

const slotOn = (sdk: FakeSdk, options: { bootTimeoutMs?: number; idleMs?: number } = {}) =>
  createSpareSlot({
    sdk,
    build: (target) => ({ options: { model: target.model }, binding: { host: null }, stderr: stderrTail() }),
    bootTimeoutMs: options.bootTimeoutMs ?? 1000,
    idleMs: options.idleMs ?? 60_000,
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the warm slot", () => {
  it("hands a ready process to a claim with the same profile, once", async () => {
    const sdk = fakeSdk();
    const slot = slotOn(sdk);
    slot.warm(profile());
    await settle();
    assert.equal(slot.state.phase, "ready");
    const claimed = await slot.claim(profile(), 100);
    assert.ok(claimed);
    assert.equal(slot.state.phase, "empty");
    assert.equal(await slot.claim(profile(), 100), null);
  });

  it("leaves the parked process alone when the claim asks for another profile", async () => {
    const sdk = fakeSdk();
    const slot = slotOn(sdk);
    slot.warm(profile());
    await settle();
    assert.equal(await slot.claim(profile({ model: "other" }), 100), null);
    assert.equal(slot.state.phase, "ready");
    assert.equal(sdk.startups[0]?.warm?.closed, false);
  });

  it("does not boot a second process for a profile it already holds, and replaces one for a different profile", async () => {
    const sdk = fakeSdk();
    const slot = slotOn(sdk);
    slot.warm(profile());
    slot.warm(profile());
    await settle();
    assert.equal(sdk.startups.length, 1);
    slot.warm(profile({ model: "other" }));
    await settle();
    assert.equal(sdk.startups.length, 2);
    assert.equal(sdk.startups[0]?.warm?.closed, true);
    assert.deepEqual(slot.state, { phase: "ready", key: profileKey(profile({ model: "other" })) });
  });

  it("waits for a booting process up to the deadline, then gives up without losing the boot", async () => {
    const sdk = fakeSdk();
    sdk.startupDelayMs = 60;
    const slot = slotOn(sdk);
    slot.warm(profile());
    assert.equal(slot.state.phase, "starting");
    assert.equal(await slot.claim(profile(), 10), null);
    const claimed = await slot.claim(profile(), 500);
    assert.ok(claimed);
    assert.equal(sdk.startups.length, 1);
  });

  it("returns to empty when the boot fails", async () => {
    const sdk = fakeSdk();
    sdk.startupFails = true;
    const slot = slotOn(sdk);
    slot.warm(profile());
    await settle();
    assert.equal(slot.state.phase, "empty");
    assert.equal(await slot.claim(profile(), 50), null);
  });

  it("closes a parked process after the idle time", async () => {
    const sdk = fakeSdk();
    const slot = slotOn(sdk, { idleMs: 20 });
    slot.warm(profile());
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(slot.state.phase, "empty");
    assert.equal(sdk.startups[0]?.warm?.closed, true);
  });

  it("closes a process that finishes booting after close()", async () => {
    const sdk = fakeSdk();
    sdk.startupDelayMs = 30;
    const slot = slotOn(sdk);
    slot.warm(profile());
    slot.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(sdk.startups[0]?.warm?.closed, true);
    assert.equal(slot.state.phase, "empty");
  });
});

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  return assertProviderContract(events);
}

describe("the Claude provider", () => {
  it("serves a run from the warm process, binds the tools to it, and boots the next spare", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    provider.warm(profile());
    await settle();
    const [warm] = sdk.startups;
    assert.ok(warm?.warm);
    sdk.nextScripts.push({ messages: [textDelta('{"type":'), toolStart("mcp__tarjih__search"), textDelta('"answer"}'), successResult()] });

    const events = await collect(provider.run({ profile: profile(), user: "question", tools: noTools }, new AbortController().signal));

    assert.deepEqual(
      events.map((event) => event.kind),
      ["started", "text", "tool_use", "text", "end"],
    );
    const started = events[0];
    assert.equal(started?.kind === "started" && started.warm, true);
    assert.equal(warm.warm.queried?.prompt, "question");
    assert.equal(sdk.queries.length, 0);
    await settle();
    assert.equal(sdk.startups.length, 2);
    await provider.close();
  });

  it("keeps one warm process per lane, so the rewrite's boot never replaces the answer's", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    const rewrite = profile({ lane: "rewrite", model: "claude-small", tools: [] });
    provider.warm(profile());
    provider.warm(rewrite);
    await settle();
    assert.equal(sdk.startups.length, 2);
    assert.deepEqual(sdk.startups.map((boot) => boot.warm?.closed), [false, false]);

    const events = await collect(provider.run({ profile: rewrite, user: "q", tools: noTools }, new AbortController().signal));
    const started = events[0];
    assert.equal(started?.kind === "started" && started.warm, true);
    assert.equal(sdk.startups[1]?.warm?.queried?.prompt, "q");
    assert.equal(sdk.startups[0]?.warm?.queried, null);
    await provider.close();
    assert.equal(sdk.startups[0]?.warm?.closed, true);
  });

  it("does not boot a replacement after serving the rewrite lane: the engine warms it when an ask ends", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    const rewrite = profile({ lane: "rewrite", model: "claude-small", tools: [] });
    provider.warm(rewrite);
    await settle();
    await collect(provider.run({ profile: rewrite, user: "q", tools: noTools }, new AbortController().signal));
    await settle();
    assert.equal(sdk.startups.length, 1);
    await provider.close();
  });

  it("closes a claimed process and ends aborted when the run was cancelled while it waited for the claim", async () => {
    const sdk = fakeSdk();
    sdk.startupDelayMs = 40;
    const provider = claudeProvider({ sdk });
    provider.warm(profile());
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const events = await collect(provider.run({ profile: profile(), user: "q", tools: noTools }, controller.signal));
    const end = events.at(-1);
    assert.ok(end?.kind === "end" && !end.outcome.ok && end.outcome.failure.code === "aborted");
    assert.equal(sdk.startups[0]?.warm?.closed, true);
    assert.equal(sdk.startups[0]?.warm?.queried, null);
    await provider.close();
  });

  it("lets the in-process tool reach the host of the run that claimed the process", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    provider.warm(profile());
    await settle();
    const host: ToolHost = { invoke: async (name) => ({ text: `ran ${name}`, isError: false }) };
    let reply = "";
    sdk.nextScripts.push({
      messages: [textDelta("x"), successResult()],
      after: {
        index: 0,
        run: async () => {
          reply = (await sdk.servers[0]?.binding.host?.invoke("search", { query: "q" }))?.text ?? "unbound";
        },
      },
    });
    await collect(provider.run({ profile: profile(), user: "q", tools: host }, new AbortController().signal));
    assert.equal(reply, "ran search");
    assert.equal(sdk.servers[0]?.binding.host, null);
    await provider.close();
  });

  it("falls back to a fresh query when no process matches, and does not boot a spare for it", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    sdk.nextScripts.push({ messages: [textDelta("{}"), successResult()] });
    const events = await collect(provider.run({ profile: profile(), user: "question", tools: noTools }, new AbortController().signal));
    const started = events[0];
    assert.equal(started?.kind === "started" && started.warm, false);
    assert.equal(sdk.queries.length, 1);
    assert.equal(sdk.startups.length, 0);
    assert.deepEqual(sdk.queries[0]?.options.mcpServers, { tarjih: { specs: profile().tools } });
    await provider.close();
  });

  it("advertises no tool server when the profile has no tools", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    await collect(provider.run({ profile: profile({ tools: [] }), user: "question", tools: noTools }, new AbortController().signal));
    assert.deepEqual(sdk.queries[0]?.options.mcpServers, {});
    assert.deepEqual(sdk.queries[0]?.options.allowedTools, []);
    assert.equal(sdk.servers.length, 0);
  });

  it("ends at the result without waiting for the process to tear down", async () => {
    const sdk = fakeSdk();
    sdk.nextScripts.push({ messages: [textDelta("{}"), successResult()], hangAfter: true });
    const provider = claudeProvider({ sdk });
    const finished = collect(provider.run({ profile: profile(), user: "q", tools: noTools }, new AbortController().signal));
    const outcome = await Promise.race([finished, new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500))]);
    assert.notEqual(outcome, "hung");
    assert.equal(sdk.queries[0]?.query.closed, true);
  });

  it("classifies a failed result and a crashed process as end events, never as a throw", async () => {
    const sdk = fakeSdk();
    sdk.nextScripts.push({ messages: [{ type: "assistant", error: "rate_limit" }, { type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "limit" }] });
    sdk.nextScripts.push({ messages: [textDelta("{")], throwAfterMessages: new Error("spawn failed") });
    const provider = claudeProvider({ sdk });
    const limited = await collect(provider.run({ profile: profile(), user: "q", tools: noTools }, new AbortController().signal));
    const crashedRun = await collect(provider.run({ profile: profile(), user: "q", tools: noTools }, new AbortController().signal));
    const endOf = (events: ProviderEvent[]) => {
      const end = events.at(-1);
      return end?.kind === "end" && !end.outcome.ok ? end.outcome.failure.code : null;
    };
    assert.equal(endOf(limited), "rate_limited");
    assert.equal(endOf(crashedRun), "crashed");
  });

  it("ends with aborted and closes the process when the signal fires mid-stream", async () => {
    const sdk = fakeSdk();
    sdk.nextScripts.push({ messages: [textDelta("{")], hangAfter: true });
    const provider = claudeProvider({ sdk });
    const controller = new AbortController();
    const events: ProviderEvent[] = [];
    const run = (async () => {
      for await (const event of provider.run({ profile: profile(), user: "q", tools: noTools }, controller.signal)) {
        events.push(event);
        if (event.kind === "text") controller.abort();
      }
    })();
    await run;
    const end = events.at(-1);
    assert.equal(end?.kind === "end" && !end.outcome.ok && end.outcome.failure.code, "aborted");
    assert.equal(sdk.queries[0]?.query.closed, true);
  });

  it("passes the isolation recipe to the SDK", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    await collect(provider.run({ profile: profile({ effort: "low" }), user: "q", tools: noTools }, new AbortController().signal));
    const options = sdk.queries[0]?.options;
    assert.deepEqual(options?.tools, []);
    assert.deepEqual(options?.settingSources, []);
    assert.equal(options?.strictMcpConfig, true);
    assert.equal(options?.persistSession, false);
    assert.equal(options?.permissionMode, "dontAsk");
    assert.equal(options?.effort, "low");
    const env = options?.env as Record<string, string | undefined>;
    assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
    assert.equal(Object.keys(env).some((key) => /^(ANTHROPIC|AI_AGENT)/i.test(key)), false);
  });
});

describe("one process per question", () => {
  it("refuses a second prompt on a claimed handle", async () => {
    const sdk = fakeSdk();
    const slot = slotOn(sdk);
    slot.warm(profile());
    await settle();
    const claimed = await slot.claim(profile(), 100);
    assert.ok(claimed);
    claimed.warm.query("first");
    assert.throws(() => claimed.warm.query("second"), /one question only/);
    assert.equal(sdk.startups[0]?.warm?.queried?.prompt, "first");
  });

  it("serves two consecutive questions, and the retry of a question, from three different processes, each used once", async () => {
    const sdk = fakeSdk();
    const provider = claudeProvider({ sdk });
    provider.warm(profile());
    await settle();
    const prompts = ["one", "two", "retry of two"];
    for (const user of prompts) {
      const events = await collect(provider.run({ profile: profile(), user, tools: noTools }, new AbortController().signal));
      const started = events[0];
      assert.equal(started?.kind === "started" && started.warm, true, user);
      await settle();
    }
    const handles = sdk.startups.map((startup) => startup.warm);
    assert.ok(handles.length >= 3);
    assert.deepEqual(handles.slice(0, 3).map((warm) => warm?.queried?.prompt), prompts);
    assert.equal(new Set(handles.slice(0, 3)).size, 3);
    assert.equal(sdk.queries.length, 0);
    await provider.close();
  });

  it("waits for the next process to boot rather than reuse the last one", async () => {
    const sdk = fakeSdk();
    sdk.startupDelayMs = 40;
    const provider = claudeProvider({ sdk });
    provider.warm(profile());
    await new Promise((resolve) => setTimeout(resolve, 80));
    await collect(provider.run({ profile: profile(), user: "one", tools: noTools }, new AbortController().signal));
    await collect(provider.run({ profile: profile(), user: "two", tools: noTools }, new AbortController().signal));
    assert.deepEqual(sdk.startups.slice(0, 2).map((startup) => startup.warm?.queried?.prompt), ["one", "two"]);
    await provider.close();
  });
});
