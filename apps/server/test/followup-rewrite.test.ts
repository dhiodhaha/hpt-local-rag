import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEngine, type AnswerEngine, type EngineSettings } from "../src/features/answer/engine.ts";
import { loadPromptTemplate } from "../src/features/answer/prompt.ts";
import { carryIds, MAX_CARRY, retrieve, type Rewriter } from "../src/features/answer/retrieval.ts";
import { queryFrom, rewriteMessage, rewriteProfile, rewriteQuery } from "../src/features/answer/rewrite.ts";
import { memoryTraceSink } from "../src/features/answer/trace.ts";
import type { HistoryEntry, Turn } from "../src/features/answer/types.ts";
import { scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { answerJson, makePassage, ONE, TWO } from "../src/testing/answer-fixtures.ts";
import { fakeIndex } from "../src/testing/fake-index.ts";

const entry = (n: number, question: string, cited: HistoryEntry["cited"] = [], gist: string | null = "ringkasan"): HistoryEntry => ({ n, question, type: "answer", gist, basis: "explicit", cited });
const turn = (question: string, history: HistoryEntry[] = []): Turn => ({ question, history, scope: null });
const SEARCH = { searchLimit: 10, evidenceTokens: 8000 };
const REWRITE = { model: "claude-haiku-test", effort: "low" as const, budgetMs: 200 };
const now = () => performance.now();

describe("the rewrite request", () => {
  it("shows the last turns as questions and headlines, never an answer, and escapes markup in them", () => {
    const history = [entry(1, "pertama"), entry(2, "kedua"), entry(3, "ketiga <b>", [], "ringkas"), entry(4, "keempat", [], null)];
    const message = rewriteMessage(turn("lalu apa dalilnya", history));
    assert.equal(message.includes("pertama"), false);
    assert.match(message, /<turn n="3"><pertanyaan>ketiga &lt;b><\/pertanyaan><jawaban>ringkas<\/jawaban><\/turn>/);
    assert.match(message, /<turn n="4"><pertanyaan>keempat<\/pertanyaan><jawaban><\/jawaban><\/turn>/);
    assert.ok(message.endsWith("<pertanyaan>lalu apa dalilnya</pertanyaan>"));
  });

  it("asks a process with no tools, in its own lane", () => {
    const profile = rewriteProfile(REWRITE);
    assert.deepEqual([profile.lane, profile.tools, profile.model, profile.effort], ["rewrite", [], "claude-haiku-test", "low"]);
  });

  it("takes the first line of the reply as the query, without quotes", () => {
    assert.equal(queryFrom('"dalil qunut subuh"\npenjelasan'), "dalil qunut subuh");
    assert.equal(queryFrom("\n\n  dalil qunut  \n"), "dalil qunut");
    assert.equal(queryFrom("   \n"), null);
    assert.equal(queryFrom("x".repeat(400)), null);
  });
});

describe("rewriting a follow-up", () => {
  const run = (script: ScriptedAttempt[], signal?: AbortSignal) => {
    const provider = scriptedProvider(script);
    return { provider, result: rewriteQuery({ provider, settings: REWRITE, turn: turn("lalu dalilnya", [entry(1, "tentang kompos")]), signal, now }) };
  };

  it("returns the standalone query and the time it took", async () => {
    const { result, provider } = run([{ chunks: ["dalil kompos dari sisa daun"] }]);
    const rewritten = await result;
    assert.equal(rewritten.text, "dalil kompos dari sisa daun");
    assert.equal(rewritten.fallback, null);
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]?.profile.lane, "rewrite");
  });

  it("gives up at the budget and says so, however long the provider takes", async () => {
    const { result } = run([{ chunks: ["terlambat"], delayMs: 2000 }]);
    const started = performance.now();
    const rewritten = await result;
    assert.deepEqual([rewritten.text, rewritten.fallback], [null, "timeout"]);
    assert.ok(performance.now() - started < 1000);
    assert.ok(rewritten.ms >= REWRITE.budgetMs - 5);
  });

  it("falls back when the provider fails, and when the reply is blank", async () => {
    const failure = { code: "overloaded" as const, detail: "x", resetsAt: null };
    assert.equal((await run([{ chunks: [], fail: failure }]).result).fallback, "failed");
    assert.equal((await run([{ chunks: ["  \n"] }]).result).fallback, "unusable");
  });

  it("does not start when the question was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, provider } = run([{ chunks: ["x"] }], controller.signal);
    assert.equal((await result).fallback, "cancelled");
    assert.equal(provider.requests.length, 0);
  });
});

describe("retrieving a follow-up with a rewrite", () => {
  const ok =
    (text: string): Rewriter =>
    async () => ({ text, ms: 40, fallback: null });
  const history = [entry(1, "apa itu kompos", [ONE.id])];

  it("searches the bare question and the rewrite, and takes the rewrite when the evidence ties", async () => {
    const index = fakeIndex([ONE, TWO]);
    const retrieved = await retrieve(index, turn("lalu dalilnya", history), SEARCH, ok("dalil kompos"));
    assert.deepEqual(retrieved.queries, ["lalu dalilnya", "dalil kompos"]);
    assert.deepEqual(retrieved.rewrite, { ms: 40, used: true, fallback: null, picked: "rewrite", text: "dalil kompos" });
  });

  it("keeps the bare question when it beats the rewrite, which is what a change of topic looks like", async () => {
    const index = fakeIndex([ONE, TWO]);
    index.evidence = (query) => (query === "dalil kompos" ? "weak" : "strong");
    const retrieved = await retrieve(index, turn("sekarang zakat", history), SEARCH, ok("dalil kompos"));
    assert.equal(retrieved.evidence.level, "strong");
    assert.equal(retrieved.rewrite?.picked, "bare");
    assert.equal(retrieved.rewrite?.used, true);
  });

  it("takes the rewrite when only it finds strong evidence", async () => {
    const index = fakeIndex([ONE, TWO]);
    index.evidence = (query) => (query === "dalil kompos" ? "strong" : "weak");
    const retrieved = await retrieve(index, turn("lalu dalilnya", history), SEARCH, ok("dalil kompos"));
    assert.equal(retrieved.evidence.level, "strong");
    assert.equal(retrieved.rewrite?.picked, "rewrite");
  });

  it("starts the rewrite before the bare search finishes", async () => {
    const index = fakeIndex([ONE]);
    const order: string[] = [];
    const rewriter: Rewriter = async () => {
      order.push("rewrite started");
      return { text: null, ms: 1, fallback: "failed" };
    };
    const search = index.search.bind(index);
    index.search = async (query, options) => {
      order.push(`search ${query}`);
      return search(query, options);
    };
    await retrieve(index, turn("lalu", history), SEARCH, rewriter);
    assert.deepEqual(order.slice(0, 2), ["rewrite started", "search lalu"]);
  });

  it("falls back to the old rule when the rewrite did not arrive: a weak bare question is searched with the previous one", async () => {
    const index = fakeIndex([ONE, TWO]);
    index.evidence = (query) => (query.startsWith("apa itu kompos") ? "strong" : "weak");
    const failed: Rewriter = async () => ({ text: null, ms: 1500, fallback: "timeout" });
    const retrieved = await retrieve(index, turn("yang tadi", history), SEARCH, failed);
    assert.deepEqual(retrieved.queries, ["yang tadi", "apa itu kompos yang tadi"]);
    assert.equal(retrieved.evidence.level, "strong");
    assert.deepEqual(retrieved.rewrite, { ms: 1500, used: false, fallback: "timeout", picked: null, text: null });
  });

  it("falls back to the bare question alone when it is strong and the rewrite did not arrive", async () => {
    const index = fakeIndex([ONE, TWO]);
    const failed: Rewriter = async () => ({ text: null, ms: 1500, fallback: "timeout" });
    const retrieved = await retrieve(index, turn("yang tadi", history), SEARCH, failed);
    assert.deepEqual(retrieved.queries, ["yang tadi"]);
  });

  it("never calls the rewrite for a first question", async () => {
    const index = fakeIndex([ONE]);
    let called = false;
    const retrieved = await retrieve(index, turn("apa itu kompos"), SEARCH, async () => {
      called = true;
      return { text: "x", ms: 1, fallback: null };
    });
    assert.equal(called, false);
    assert.equal(retrieved.rewrite, null);
    assert.deepEqual(retrieved.queries, ["apa itu kompos"]);
  });
});

const SETTINGS: EngineSettings = { model: "claude-test", effort: "medium", maxExtraToolCalls: 2, searchLimit: 10, evidenceTokens: 8000 };

function engineWith(script: ScriptedAttempt[], settings: Partial<EngineSettings> = { rewrite: REWRITE }) {
  const provider = scriptedProvider(script);
  const index = fakeIndex([ONE, TWO]);
  const traces = memoryTraceSink();
  const engine: AnswerEngine = createEngine({ index, provider, prompt: loadPromptTemplate(answerConfig.systemPromptDoc), canary: "CANARY-x", traces, settings: { ...SETTINGS, ...settings } });
  return { engine, provider, index, traces };
}

describe("carry-over", () => {
  it("lists every earlier citation once, newest turn first, up to the cap", () => {
    const many = Array.from({ length: MAX_CARRY + 3 }, (_, index) => makePassage(index + 10, "x").id);
    const history = [entry(1, "a", [many[0]!, ONE.id]), entry(2, "b", [TWO.id, ONE.id]), entry(3, "c", many)];
    assert.deepEqual(carryIds(history), many.slice(0, MAX_CARRY));
    assert.deepEqual(carryIds(history.slice(0, 2)), [TWO.id, ONE.id, many[0]]);
  });

  it("is added even when the fresh evidence is strong, and reaches the ledger as prior-turn context", async () => {
    const { engine, provider, index } = engineWith([{ chunks: [answerJson()] }], {});
    index.find = () => [ONE];
    const finished = await engine.ask(turn("lalu bagaimana", [entry(1, "apa itu kompos", [TWO.id])]), {});
    assert.deepEqual(finished.context, [ONE.id, TWO.id]);
    assert.equal(finished.trace.retrieval.evidence, "strong");
    assert.equal(finished.trace.retrieval.carried, 1);
    assert.match(provider.requests[0]!.user, /<passage id="S2"[^>]* prior_turn="1"/);
  });
});

describe("a follow-up through the engine", () => {
  const followUp = turn("lalu dalilnya", [entry(1, "apa itu kompos", [ONE.id])]);

  it("rewrites first, searches with the rewrite, answers on the answer lane, and records the rewrite", async () => {
    const { engine, provider, index } = engineWith([{ chunks: ["dalil kompos sisa daun"] }, { chunks: [answerJson()] }]);
    const finished = await engine.ask(followUp, {});
    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(provider.requests.map((request) => request.profile.lane), ["rewrite", "answer"]);
    assert.deepEqual(index.queries.map((call) => call.query), ["lalu dalilnya", "dalil kompos sisa daun"]);
    const { rewrite } = finished.trace;
    assert.ok(rewrite);
    assert.deepEqual([rewrite.used, rewrite.fallback, rewrite.picked, rewrite.text], [true, null, "rewrite", "dalil kompos sisa daun"]);
    assert.equal(typeof rewrite.ms, "number");
    assert.equal(finished.trace.retrieval.queries, 2);
    assert.equal(provider.requests[1]?.user.includes("dalil kompos sisa daun"), false);
  });

  it("falls back to today's retrieval when the rewrite times out, and still answers", async () => {
    const { engine, provider, index } = engineWith([{ chunks: ["terlambat"], delayMs: 1000 }, { chunks: [answerJson()] }], { rewrite: { ...REWRITE, budgetMs: 20 } });
    const finished = await engine.ask(followUp, {});
    assert.equal(finished.outcome.kind, "delivered");
    assert.deepEqual(index.queries.map((call) => call.query), ["lalu dalilnya"]);
    assert.deepEqual([finished.trace.rewrite?.used, finished.trace.rewrite?.fallback, finished.trace.rewrite?.picked], [false, "timeout", null]);
    assert.deepEqual(provider.requests.map((request) => request.profile.lane), ["rewrite", "answer"]);
  });

  it("does not call the rewrite for a first question, and records none", async () => {
    const { engine, provider } = engineWith([{ chunks: [answerJson()] }]);
    const finished = await engine.ask(turn("apa itu kompos"), {});
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0]?.profile.lane, "answer");
    assert.equal(finished.trace.rewrite, null);
  });

  it("does not call the rewrite when the engine has none configured", async () => {
    const { engine, provider } = engineWith([{ chunks: [answerJson()] }], {});
    const finished = await engine.ask(followUp, {});
    assert.equal(provider.requests.length, 1);
    assert.equal(finished.trace.rewrite, null);
    assert.equal(provider.warmed.some((profile) => profile.lane === "rewrite"), false);
  });

  it("boots the rewrite process when a delivered answer ends, so the next question finds it warm", async () => {
    const { engine, provider } = engineWith([{ chunks: [answerJson()] }]);
    await engine.ask(turn("apa itu kompos"), {});
    assert.deepEqual(provider.warmed.map((profile) => profile.lane), ["answer", "rewrite"]);
    assert.deepEqual(provider.warmed[1], rewriteProfile(REWRITE));
  });

  it("does not boot it after a first question that failed", async () => {
    const crashed = { chunks: [], fail: { code: "crashed" as const, detail: "x", resetsAt: null } };
    const { engine, provider } = engineWith([crashed, crashed]);
    const finished = await engine.ask(turn("apa itu kompos"), {});
    assert.notEqual(finished.outcome.kind, "delivered");
    assert.equal(provider.warmed.some((profile) => profile.lane === "rewrite"), false);
  });

  it("boots it on request for a conversation that is reopened", () => {
    const { engine, provider } = engineWith([]);
    engine.warm();
    assert.deepEqual(provider.warmed.map((profile) => profile.lane), ["answer"]);
    engine.warm({ followUp: true });
    assert.deepEqual(provider.warmed.map((profile) => profile.lane), ["answer", "answer", "rewrite"]);
  });
});
