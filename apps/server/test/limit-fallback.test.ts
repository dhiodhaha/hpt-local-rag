import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEngine, type AnswerEngine, type EngineSettings } from "../src/features/answer/engine.ts";
import { loadPromptTemplate } from "../src/features/answer/prompt.ts";
import { NO_LIMITS, UNKNOWN_RESET_MS, pickRoute, planOf, withLimit, type Route } from "../src/features/answer/routes.ts";
import { memoryTraceSink } from "../src/features/answer/trace.ts";
import { fallbackNotice, modelName } from "../src/features/answer/copy.ts";
import { nextStep } from "../src/features/answer/policy.ts";
import type { AnswerEvent } from "../src/features/answer/types.ts";
import { createPrinter, summaryLines } from "../src/commands/ask.ts";
import { chunked, scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { ONE, TWO, answerJson } from "../src/testing/answer-fixtures.ts";
import { fakeIndex } from "../src/testing/fake-index.ts";

const OPUS: Route = { model: "claude-opus-5-5", effort: "low" };
const SONNET: Route = { model: "claude-sonnet-5-5", effort: "low" };
const SETTINGS: EngineSettings = { ...OPUS, maxExtraToolCalls: 2, searchLimit: 10, evidenceTokens: 8000, fallbacks: { [OPUS.model]: SONNET } };
const PROMPT = loadPromptTemplate(answerConfig.systemPromptDoc);
const START = Date.parse("2026-11-26T10:00:00.000Z");
const RESET = "2026-11-26T15:00:00.000Z";
const LIMITED = (resetsAt: string | null = RESET): ScriptedAttempt => ({ chunks: [], fail: { code: "rate_limited", detail: "usage limit reached", resetsAt } });
const GOOD = answerJson();

function setup(script: ScriptedAttempt[], settings: Partial<EngineSettings> = {}) {
  const clock = { at: START };
  const provider = scriptedProvider(script);
  const traces = memoryTraceSink();
  const build = () => createEngine({ index: fakeIndex([ONE, TWO]), provider, prompt: PROMPT, canary: "CANARY-test", traces, settings: { ...SETTINGS, ...settings }, wall: () => clock.at });
  return { engine: build(), restarted: build, provider, traces, clock };
}

async function ask(engine: AnswerEngine) {
  const events: AnswerEvent[] = [];
  const finished = await engine.ask({ question: "Apakah kompos boleh?", history: [], scope: null }, { onEvent: (event) => events.push(event) });
  return { finished, events };
}

const routes = (provider: ReturnType<typeof scriptedProvider>) => provider.requests.map((request) => `${modelName(request.profile.model)} ${request.profile.effort}`);

describe("routes as data (D20)", () => {
  it("plans the route and its fallback, and leaves out a fallback on the same model", () => {
    assert.deepEqual(planOf(OPUS, { [OPUS.model]: SONNET }), [OPUS, SONNET]);
    assert.deepEqual(planOf(SONNET, { [OPUS.model]: SONNET }), [SONNET]);
    assert.deepEqual(planOf(OPUS, { [OPUS.model]: { model: OPUS.model, effort: "medium" } }), [OPUS]);
    assert.deepEqual(planOf(OPUS, {}), [OPUS]);
  });

  it("picks the first route that is not limited, and none when all are", () => {
    const plan = [OPUS, SONNET];
    const limited = withLimit(NO_LIMITS, OPUS.model, RESET, START);
    assert.equal(pickRoute(plan, NO_LIMITS, START), OPUS);
    assert.equal(pickRoute(plan, limited, START), SONNET);
    assert.equal(pickRoute(plan, limited, Date.parse(RESET)), OPUS, "the reset time itself ends the limit");
    assert.equal(pickRoute(plan, withLimit(limited, SONNET.model, RESET, START), START), null);
  });

  it("trusts a reset time in the future and falls back to a short wait for a missing or past one", () => {
    const until = (resetsAt: string | null) => withLimit(NO_LIMITS, OPUS.model, resetsAt, START).get(OPUS.model);
    assert.equal(until(RESET), Date.parse(RESET));
    assert.equal(until(null), START + UNKNOWN_RESET_MS);
    assert.equal(until("2026-11-26T09:00:00.000Z"), START + UNKNOWN_RESET_MS);
    assert.equal(until("not a date"), START + UNKNOWN_RESET_MS);
  });

  it("leaves the limits it was given untouched", () => {
    const before = withLimit(NO_LIMITS, OPUS.model, RESET, START);
    withLimit(before, SONNET.model, RESET, START);
    assert.deepEqual([...before.keys()], [OPUS.model]);
    assert.equal(NO_LIMITS.size, 0);
  });

  it("retries a spent limit only when a route is left, and on the shared attempt budget", () => {
    const limited = { kind: "provider_failed", code: "rate_limited" } as const;
    assert.deepEqual(nextStep(limited, 1, true), { kind: "retry", because: { kind: "provider", code: "rate_limited" } });
    assert.deepEqual(nextStep(limited, 1, false), { kind: "fail", code: "rate_limited" });
    assert.deepEqual(nextStep(limited, 1), { kind: "fail", code: "rate_limited" });
    assert.deepEqual(nextStep(limited, 2, true), { kind: "fail", code: "rate_limited" });
  });
});

describe("answering when the default model's limit is spent", () => {
  it("retries on Sonnet at low effort in a fresh attempt, and says in the events and the trace who answered and why", async () => {
    const { engine, provider } = setup([LIMITED(), { chunks: chunked(GOOD, 30) }]);
    const { finished, events } = await ask(engine);

    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low"]);
    assert.deepEqual(events.filter((event) => event.kind === "attempt").map((event) => (event.kind === "attempt" ? [event.attempt, event.because] : null)), [[1, null], [2, { kind: "provider", code: "rate_limited" }]]);
    const fallback = events.find((event) => event.kind === "fallback");
    assert.deepEqual(fallback, { kind: "fallback", route: SONNET, from: OPUS.model, until: RESET });
    assert.ok(events.indexOf(fallback as AnswerEvent) > events.findIndex((event) => event.kind === "attempt" && event.attempt === 2));
    assert.equal(events.some((event) => event.kind === "restart"), false, "nothing had been shown, so nothing is taken back");

    const [first, second] = finished.trace.attempts;
    assert.deepEqual([first?.route, first?.fallback, first?.failure?.code], [OPUS, null, "rate_limited"]);
    assert.deepEqual([second?.route, second?.fallback, second?.end], [SONNET, { from: OPUS.model, until: RESET }, "complete"]);
    assert.deepEqual([finished.trace.model, finished.trace.effort], [OPUS.model, OPUS.effort], "the trace keeps what was asked for");
  });

  it("answers the next questions on Sonnet straight away, with a full retry budget, while the limit lasts", async () => {
    const { engine, provider, clock } = setup([LIMITED(), { chunks: [GOOD] }, { chunks: [GOOD] }, { chunks: [GOOD] }]);
    await ask(engine);
    clock.at += 60 * 60_000;
    const second = await ask(engine);
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low", "Sonnet low"]);
    assert.equal(second.finished.trace.attempts.length, 1);
    assert.deepEqual(second.events.filter((event) => event.kind === "fallback"), [{ kind: "fallback", route: SONNET, from: OPUS.model, until: RESET }]);
    assert.equal(second.events.some((event) => event.kind === "attempt" && event.because !== null), false);
    assert.deepEqual(provider.warmed.at(-1)?.model, SONNET.model, "the spare process is prepared for the route that will answer");
  });

  it("returns to Opus once the reset time has passed", async () => {
    const { engine, provider, clock } = setup([LIMITED(), { chunks: [GOOD] }, { chunks: [GOOD] }]);
    await ask(engine);
    clock.at = Date.parse(RESET) + 1;
    const after = await ask(engine);
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low", "Opus low"]);
    assert.equal(after.events.some((event) => event.kind === "fallback"), false);
    assert.equal(after.finished.trace.attempts[0]?.fallback, null);
  });

  it("tries Opus again after a short wait when the provider named no reset time", async () => {
    const { engine, provider, clock } = setup([LIMITED(null), { chunks: [GOOD] }, { chunks: [GOOD] }, { chunks: [GOOD] }]);
    await ask(engine);
    clock.at += UNKNOWN_RESET_MS - 1;
    await ask(engine);
    clock.at += 2;
    await ask(engine);
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low", "Sonnet low", "Opus low"]);
  });

  it("forgets the limit when the process restarts", async () => {
    const { engine, restarted, provider } = setup([LIMITED(), { chunks: [GOOD] }, { chunks: [GOOD] }]);
    await ask(engine);
    await ask(restarted());
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low", "Opus low"]);
  });

  it("shows the Sonnet answer under a note when the limit hits after the headline was already on screen", async () => {
    const { engine, provider } = setup([{ chunks: chunked(GOOD, 40).slice(0, 4), fail: { code: "rate_limited", detail: "usage limit reached", resetsAt: RESET } }, { chunks: [GOOD] }]);
    const { finished, events } = await ask(engine);
    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low"]);
    assert.equal(finished.trace.attempts[0]?.visibleRestart, true);
    const kinds = events.map((event) => event.kind);
    assert.ok(kinds.indexOf("restart") < kinds.indexOf("fallback"));
  });

  it("fails with the limit copy when the fallback is limited too, and asks the default model once for the next question", async () => {
    const { engine, provider } = setup([LIMITED(), LIMITED("2026-11-26T12:00:00.000Z"), LIMITED()]);
    const first = await ask(engine);
    assert.deepEqual(first.finished.outcome.kind === "failed" && first.finished.outcome.code, "rate_limited");
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low"]);

    const next = await ask(engine);
    assert.deepEqual(next.finished.outcome.kind === "failed" && next.finished.outcome.code, "rate_limited");
    assert.deepEqual(routes(provider), ["Opus low", "Sonnet low", "Opus low"], "no route is left, so the default model is asked and fails fast");
    assert.equal(next.finished.trace.attempts.length, 1);
  });

  it("does not fall back when no fallback is configured, or when the model asked for has none", async () => {
    const plain = setup([LIMITED()], { fallbacks: {} });
    const refused = await ask(plain.engine);
    assert.equal(refused.finished.outcome.kind === "failed" && refused.finished.outcome.code, "rate_limited");
    assert.deepEqual(routes(plain.provider), ["Opus low"]);

    const other = setup([LIMITED()]);
    const haiku = await other.engine.ask({ question: "Apakah kompos boleh?", history: [], scope: null }, { overrides: { model: "claude-haiku-5-5" } });
    assert.equal(haiku.outcome.kind, "failed");
    assert.deepEqual(routes(other.provider), ["Haiku low"]);
  });

  it("does not treat other provider failures as a limit", async () => {
    const { engine, provider } = setup([{ chunks: [], fail: { code: "overloaded", detail: "busy", resetsAt: null } }, { chunks: [GOOD] }]);
    await ask(engine);
    assert.deepEqual(routes(provider), ["Opus low", "Opus low"]);
  });
});

describe("telling the reader", () => {
  it("names the model that answered and the one that is limited, in Indonesian", () => {
    assert.equal(fallbackNotice(SONNET, OPUS.model), "Dijawab oleh Sonnet karena batas Opus tercapai.");
    assert.equal(modelName("claude-haiku-5-5"), "Haiku");
    assert.equal(modelName("some-other-model"), "some-other-model");
  });

  it("prints the note in the terminal, and the route in the trace summary", async () => {
    const { engine } = setup([LIMITED(), { chunks: [GOOD] }]);
    let out = "";
    const finished = await engine.ask({ question: "Apakah kompos boleh?", history: [], scope: null }, { onEvent: createPrinter((text) => (out += text)) });
    assert.match(out, /\(percobaan 2, karena rate_limited\)\nDijawab oleh Sonnet karena batas Opus tercapai\.\n/);
    assert.match(summaryLines(finished)[1] ?? "", /claude-sonnet-5-5 low \(cadangan, batas Opus\)/);
  });
});
