import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEngine, type AnswerEngine, type EngineSettings } from "../src/features/answer/engine.ts";
import { foldAnswer, emptyAnswer } from "../src/features/answer/fold.ts";
import { loadPromptTemplate } from "../src/features/answer/prompt.ts";
import { memoryTraceSink } from "../src/features/answer/trace.ts";
import type { AnswerEvent, Turn } from "../src/features/answer/types.ts";
import { chunked, scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { GOOD_ANSWER, ONE, TWO, answerJson, makePassage } from "./answer-fixtures.ts";
import { fakeIndex } from "./fake-index.ts";

const CANARY = "CANARY-test-7f3a91";
const SETTINGS: EngineSettings = { model: "claude-test", effort: "medium", maxExtraToolCalls: 2, searchLimit: 10, evidenceTokens: 8000 };
const TURN: Turn = { question: "Apakah kompos boleh dibuat dari sisa daun?", history: [], scope: null };
const PROMPT = loadPromptTemplate(answerConfig.systemPromptDoc);

const GOOD = answerJson();
const BAD_SUMMARY = answerJson({ summary: "Kompos boleh dibuat [S9] dari sisa daun." });
const MALFORMED = '{"type" "answer"}';

function setup(script: ScriptedAttempt[], extra: { passages?: ReturnType<typeof makePassage>[]; settings?: Partial<EngineSettings> } = {}) {
  const provider = scriptedProvider(script);
  const index = fakeIndex(extra.passages ?? [ONE, TWO]);
  const traces = memoryTraceSink();
  const engine = createEngine({ index, provider, prompt: PROMPT, canary: CANARY, traces, settings: { ...SETTINGS, ...extra.settings } });
  return { engine, provider, index, traces };
}

async function ask(engine: AnswerEngine, turn: Turn = TURN, options: Parameters<AnswerEngine["ask"]>[1] = {}) {
  const events: AnswerEvent[] = [];
  const finished = await engine.ask(turn, { ...options, onEvent: (event) => events.push(event) });
  return { finished, events };
}

const kinds = (events: readonly AnswerEvent[]) => events.map((event) => event.kind);

describe("answering one turn", () => {
  it("retrieves first, shows the sources before any model text, streams checked fields, and writes one trace", async () => {
    const { engine, traces } = setup([{ chunks: chunked(GOOD, 20) }]);
    const { finished, events } = await ask(engine);

    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(kinds(events).slice(0, 3), ["sources", "attempt", "field"]);
    assert.equal(kinds(events).at(-1), "finished");
    const sources = events[0];
    assert.ok(sources?.kind === "sources");
    assert.deepEqual(sources.added.map((card) => [card.n, card.passage.id, card.origin]), [[1, ONE.id, "retrieval"], [2, TWO.id, "retrieval"]]);
    assert.equal(finished.answer?.headline, GOOD_ANSWER.headline);
    assert.deepEqual(finished.context, [ONE.id, TWO.id]);

    assert.equal(traces.traces.length, 1);
    const trace = traces.traces[0]!;
    assert.equal(trace, finished.trace);
    assert.equal(trace.id, finished.id);
    assert.deepEqual([trace.retrieval.queries, trace.retrieval.hits, trace.retrieval.evidence, trace.retrieval.packed], [1, 2, "strong", 2]);
    assert.deepEqual(trace.cited, [ONE.id, TWO.id]);
    assert.deepEqual(trace.attempts[0]?.committedMs.map((mark) => mark.name).slice(0, 5), ["type", "basis", "headline", "headline_short", "summary"]);
    assert.equal(trace.attempts[0]?.end, "complete");
    assert.equal(trace.promptVersion, PROMPT.version);
    assert.equal(trace.indexFingerprint, "fake-fingerprint");
  });

  it("gives the model its context with S-ids, the question, and the system prompt with the canary and the budget filled", async () => {
    const { engine, provider } = setup([{ chunks: [GOOD] }]);
    await ask(engine);
    const request = provider.requests[0]!;
    assert.match(request.user, /<context>\n<passage id="S1"/);
    assert.ok(request.user.endsWith("<question>Apakah kompos boleh dibuat dari sisa daun?</question>"));
    assert.ok(request.profile.system.includes(CANARY));
    assert.ok(request.profile.system.includes("**at most 2** extra calls"));
    assert.deepEqual(request.profile.tools.map((tool) => tool.name), ["search", "get_passage"]);
    assert.deepEqual(provider.warmed[0], request.profile);
  });

  it("advertises no tools and says so in the prompt when the budget is zero", async () => {
    const { engine, provider } = setup([{ chunks: [GOOD] }]);
    await ask(engine, TURN, { overrides: { maxExtraToolCalls: 0 } });
    assert.deepEqual(provider.requests[0]?.profile.tools, []);
    assert.ok(provider.requests[0]?.profile.system.includes("**at most 0** extra calls"));
    assert.equal(provider.requests[0]?.profile.model, "claude-test");
  });

  it("keeps the default for an override that is left undefined, as a command line without --model leaves it", async () => {
    const { engine } = setup([{ chunks: [GOOD] }]);
    const { finished } = await ask(engine, TURN, { overrides: { model: undefined, effort: undefined, maxExtraToolCalls: undefined } });
    assert.deepEqual([finished.trace.model, finished.trace.effort, finished.trace.maxExtraToolCalls], ["claude-test", "medium", 2]);
  });

  it("carries the case label, the conversation and the overrides into the trace", async () => {
    const { engine } = setup([{ chunks: [GOOD] }]);
    const { finished } = await ask(engine, TURN, { label: "case-7", conversation: { id: "c-1", turn: 3 }, overrides: { model: "claude-other", effort: "high" } });
    assert.deepEqual([finished.trace.label, finished.trace.conversation, finished.trace.turn, finished.trace.model, finished.trace.effort], ["case-7", "c-1", 3, "claude-other", "high"]);
  });
});

describe("the quiet retry (D10d)", () => {
  it("retries once when the summary cites an unknown source, tells the reader calmly, and delivers the second attempt", async () => {
    const { engine, provider } = setup([{ chunks: chunked(BAD_SUMMARY, 25) }, { chunks: chunked(GOOD, 25) }]);
    const { finished, events } = await ask(engine);

    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(events.filter((event) => event.kind === "attempt").map((event) => (event.kind === "attempt" ? [event.attempt, event.because] : null)), [[1, null], [2, { kind: "check", code: "unknown_source" }]]);
    const restart = events.find((event) => event.kind === "restart");
    assert.ok(restart && restart.kind === "restart" && restart.copy === "Memeriksa ulang sumber…");
    assert.ok(events.indexOf(restart) < events.findLastIndex((event) => event.kind === "attempt"));
    assert.equal(events.reduce(foldAnswer, emptyAnswer()).headline, GOOD_ANSWER.headline);
    assert.equal(provider.requests.length, 2);
    assert.ok(provider.requests[1]?.user.endsWith('<previous_attempt_failed reason="unknown_source"/>'));
    assert.equal(provider.requests[0]?.user.includes("previous_attempt_failed"), false);
    const [first, second] = finished.trace.attempts;
    assert.deepEqual([first?.end, first?.visibleRestart, second?.end], ["check_failed", true, "complete"]);
    assert.deepEqual(first?.findings.map((found) => [found.code, found.site, found.action]), [["unknown_source", "summary", "retry_attempt"]]);
  });

  it("is silent when nothing had been shown yet: no restart event and no visible restart in the trace", async () => {
    const { engine } = setup([{ chunks: [MALFORMED] }, { chunks: [GOOD] }]);
    const { finished, events } = await ask(engine);
    assert.equal(finished.outcome.kind, "delivered");
    assert.equal(kinds(events).includes("restart"), false);
    assert.equal(finished.trace.attempts[0]?.visibleRestart, false);
  });

  it("withholds the answer with the fixed sentence when the second attempt fails too, and never exposes it", async () => {
    const { engine, provider } = setup([{ chunks: [BAD_SUMMARY] }, { chunks: [BAD_SUMMARY] }]);
    const { finished, events } = await ask(engine);
    assert.deepEqual(finished.outcome, { kind: "withheld", code: "unknown_source", copy: "Jawaban ini belum lolos pemeriksaan sumber, jadi tidak kami tampilkan. Silakan coba lagi." });
    assert.equal(finished.answer, null);
    assert.equal(provider.requests.length, 2);
    assert.equal(finished.trace.attempts.length, 2);
    assert.equal(kinds(events).at(-1), "finished");
  });

  it("stops on the canary, retries once, and withholds when it leaks again", async () => {
    const leaking = answerJson({ headline: `Menurut ${CANARY} HPT` });
    const { engine, provider } = setup([{ chunks: chunked(leaking, 7) }, { chunks: chunked(leaking, 7) }]);
    const { finished, events } = await ask(engine);
    assert.equal(finished.outcome.kind, "withheld");
    assert.equal(finished.outcome.kind === "withheld" && finished.outcome.code, "canary");
    assert.equal(JSON.stringify(events).includes(CANARY), false);
    assert.equal(provider.requests.length, 2);
  });
});

describe("provider failures", () => {
  it("fails at once, with the Indonesian copy and without a retry, when the login is missing", async () => {
    const { engine, provider } = setup([{ chunks: [], fail: { code: "not_signed_in", detail: "x", resetsAt: null } }]);
    const { finished } = await ask(engine);
    assert.equal(finished.outcome.kind, "failed");
    assert.match(finished.outcome.kind === "failed" ? finished.outcome.copy : "", /claude auth login/);
    assert.equal(provider.requests.length, 1);
    assert.equal(finished.trace.attempts[0]?.failure?.code, "not_signed_in");
  });

  it("retries a failure a retry can help and delivers", async () => {
    const { engine, provider } = setup([{ chunks: [], fail: { code: "overloaded", detail: "busy", resetsAt: null } }, { chunks: [GOOD] }]);
    const { finished, events } = await ask(engine);
    assert.equal(finished.outcome.kind, "delivered");
    assert.equal(provider.requests.length, 2);
    assert.deepEqual(events.find((event) => event.kind === "attempt" && event.attempt === 2), { kind: "attempt", attempt: 2, because: { kind: "provider", code: "overloaded" } });
  });

  it("shares the one retry between check failures and provider failures", async () => {
    const { engine, provider } = setup([{ chunks: [BAD_SUMMARY] }, { chunks: [], fail: { code: "overloaded", detail: "busy", resetsAt: null } }]);
    const { finished } = await ask(engine);
    assert.deepEqual(finished.outcome.kind === "failed" && finished.outcome.code, "overloaded");
    assert.equal(provider.requests.length, 2);
  });
});

describe("extra tool calls (D2)", () => {
  const search = (afterChunk: number, query: string) => ({ afterChunk, name: "search", args: { query } });

  it("shares one budget across the attempts of an answer and logs every call with its query", async () => {
    const { engine, index } = setup(
      [
        { chunks: ["Mencari dulu. ", BAD_SUMMARY], toolCalls: [search(0, "satu")] },
        { chunks: ["Mencari lagi. ", GOOD], toolCalls: [search(0, "dua"), search(0, "tiga")] },
      ],
      { passages: [ONE, TWO, makePassage(3, "Teks ketiga.")] },
    );
    const { finished, events } = await ask(engine);
    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(finished.trace.tools.map((call) => [call.attempt, call.arg, call.denied]), [[1, "satu", false], [2, "dua", false], [2, "tiga", true]]);
    assert.deepEqual(events.filter((event) => event.kind === "tool_call").map((event) => (event.kind === "tool_call" ? event.denied : null)), [false, false, true]);
    assert.equal(index.queries.length, 1 + 2);
    assert.equal(finished.context.length, 3);
  });

  it("keeps the S-ids of the first attempt for the retry and appends what the tools found", async () => {
    const { engine, provider } = setup([{ chunks: ["Mencari. ", BAD_SUMMARY], toolCalls: [search(0, "satu")] }, { chunks: [GOOD] }], { passages: [ONE, TWO, makePassage(3, "Teks ketiga.")] });
    await ask(engine, TURN, { overrides: { maxExtraToolCalls: 2 } });
    const second = provider.requests[1]!.user;
    assert.ok(second.indexOf('id="S1"') < second.indexOf('id="S2"'));
    assert.equal(second.includes('id="S3"'), true);
  });

  it("stops the answer when a tool argument carries the canary", async () => {
    const { engine } = setup([{ chunks: ["Mencari. ", GOOD], toolCalls: [search(0, `rahasia ${CANARY}`)] }, { chunks: [GOOD] }]);
    const { finished } = await ask(engine);
    assert.equal(finished.trace.attempts[0]?.findings[0]?.code, "canary");
    assert.equal(finished.outcome.kind, "delivered");
  });
});

describe("cancelling and queueing", () => {
  it("cancels without calling the provider when the signal is already aborted", async () => {
    const { engine, provider } = setup([{ chunks: [GOOD] }]);
    const controller = new AbortController();
    controller.abort();
    const { finished } = await ask(engine, TURN, { signal: controller.signal });
    assert.deepEqual(finished.outcome, { kind: "cancelled" });
    assert.equal(finished.answer, null);
    assert.equal(provider.requests.length, 0);
  });

  it("cancels mid-stream and still writes the trace", async () => {
    const { engine, traces } = setup([{ chunks: chunked(GOOD, 10), delayMs: 5 }]);
    const controller = new AbortController();
    const finished = await engine.ask(TURN, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.kind === "field" && event.name === "type") controller.abort();
      },
    });
    assert.deepEqual(finished.outcome, { kind: "cancelled" });
    assert.equal(traces.traces.length, 1);
    assert.equal(finished.trace.attempts[0]?.end, "cancelled");
  });

  it("runs asks one at a time: a second ask waits for the first and the events never interleave", async () => {
    const { engine, provider } = setup([{ chunks: chunked(GOOD, 30), delayMs: 3 }, { chunks: chunked(GOOD, 30) }]);
    const seen: string[] = [];
    const first = engine.ask(TURN, { label: "first", onEvent: (event) => seen.push(`1:${event.kind}`) });
    const second = engine.ask(TURN, { label: "second", onEvent: (event) => seen.push(`2:${event.kind}`) });
    await Promise.all([first, second]);
    const firstDone = seen.indexOf("1:finished");
    assert.ok(seen.slice(0, firstDone + 1).every((entry) => entry.startsWith("1:")));
    assert.ok(seen.slice(firstDone + 1).every((entry) => entry.startsWith("2:")));
    assert.equal(provider.requests.length, 2);
  });

  it("warms the provider for its default profile on request", () => {
    const { engine, provider } = setup([]);
    engine.warm();
    assert.equal(provider.warmed.length, 1);
    assert.equal(provider.warmed[0]?.model, "claude-test");
  });
});

describe("the headline while its summary is checked", () => {
  const states = (events: readonly AnswerEvent[]) => {
    let answer = emptyAnswer();
    return events.map((event) => {
      answer = foldAnswer(answer, event);
      return answer.headlineState;
    });
  };

  it("shows the headline as verifying as soon as its own checks pass, and settles it once the summary has passed", async () => {
    const { engine } = setup([{ chunks: chunked(GOOD, 20) }]);
    const { finished, events } = await ask(engine);
    const at = (predicate: (event: AnswerEvent) => boolean) => events.findIndex(predicate);
    const headline = at((event) => event.kind === "field" && event.name === "headline");
    const summary = at((event) => event.kind === "field" && event.name === "summary");
    const settled = at((event) => event.kind === "settled");
    assert.ok(headline < summary && summary < settled);
    assert.ok(settled < at((event) => event.kind === "item"));
    const seen = states(events);
    assert.deepEqual([seen[headline - 1], seen[headline], seen[summary], seen[settled]], ["pending", "verifying", "verifying", "settled"]);
    assert.equal(finished.answer?.headlineState, "settled");
    const marks = finished.trace.attempts[0]!.committedMs;
    const ms = (name: string) => marks.find((mark) => mark.name === name)?.ms ?? NaN;
    assert.ok(ms("headline") <= ms("headline_settled") && ms("summary") <= ms("headline_settled"));
  });

  it("withdraws a verifying headline with the calm restart when the summary fails, and settles the retry's own headline", async () => {
    const { engine } = setup([{ chunks: chunked(BAD_SUMMARY, 25) }, { chunks: chunked(GOOD, 25) }]);
    const { finished, events } = await ask(engine);
    const restart = events.findIndex((event) => event.kind === "restart");
    const seen = states(events);
    assert.equal(events.slice(0, restart).some((event) => event.kind === "settled"), false);
    assert.equal(seen[restart - 1], "verifying");
    assert.equal(seen[restart], "pending");
    assert.equal(seen.at(-1), "settled");
    assert.equal(events.filter((event) => event.kind === "settled").length, 1);
    assert.equal(finished.trace.attempts[0]?.committedMs.some((mark) => mark.name === "headline_settled"), false);
    assert.equal(finished.trace.attempts[1]?.committedMs.some((mark) => mark.name === "headline_settled"), true);
  });

  it("never settles a headline of an answer that was withheld", async () => {
    const { engine } = setup([{ chunks: [BAD_SUMMARY] }, { chunks: [BAD_SUMMARY] }]);
    const { events } = await ask(engine);
    assert.equal(events.some((event) => event.kind === "settled"), false);
  });
});
