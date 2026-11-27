import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { evalAnswersCommand } from "../src/commands/eval-answers.ts";
import { evalRedteamCommand } from "../src/commands/eval-redteam.ts";
import { gateEval, NEEDS_KEY, NEEDS_WORKSPACE, requireApi } from "../src/commands/eval-guard.ts";
import type { Trace } from "../src/features/answer/index.ts";
import {
  BATCH_DISCOUNT,
  chooseProfile,
  costOf,
  DEFAULT_PROFILES,
  decide,
  estimateCost,
  formatEstimate,
  MIN_TRACES,
  PRICES,
  profileFromTraces,
  recentTraces,
  UnpricedModelError,
} from "../src/features/eval/index.ts";
import { claudeProvider } from "../src/features/providers/index.ts";
import { isolatedEnv } from "../src/features/providers/claude/options.ts";
import { fakeSdk } from "./fake-claude-sdk.ts";
import { tempDir } from "./helpers.ts";

const OPUS = "claude-opus-5-5";
const profile = { lane: "answer" as const, model: OPUS, effort: "low" as const, system: "s", tools: [] };
const noTools = { invoke: async () => ({ text: "", isError: false }) };

async function withEnv<T>(key: string | undefined, run: () => Promise<T> | T): Promise<T> {
  const before = process.env.ANTHROPIC_API_KEY;
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
  }
}

describe("the API key guard", () => {
  it("refuses a missing or blank key with the reason, and returns a present one", () => {
    assert.throws(() => requireApi({}), /never run on the Claude plan login/);
    assert.throws(
      () => requireApi({ ANTHROPIC_API_KEY: "  " }),
      (error: Error) => error.message === NEEDS_KEY,
    );
    assert.deepEqual(requireApi({ ANTHROPIC_API_KEY: "sk-test" }), { key: "sk-test", workspace: null });
    assert.throws(() => requireApi({ ANTHROPIC_API_KEY: "sk-ant-usr01-x" }), (error: Error) => error.message === NEEDS_WORKSPACE);
    assert.deepEqual(requireApi({ ANTHROPIC_API_KEY: "sk-ant-usr01-x", ANTHROPIC_WORKSPACE_ID: "wrkspc_01Abc" }), { key: "sk-ant-usr01-x", workspace: "wrkspc_01Abc" });
    assert.throws(() => requireApi({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_WORKSPACE_ID: "default" }), /wrkspc_/);
  });

  it("stops every model-calling eval before it reads a file or starts a process", async () => {
    await withEnv(undefined, async () => {
      await assert.rejects(evalAnswersCommand("answers", []), /plan login/);
      await assert.rejects(evalAnswersCommand("followups", []), /plan login/);
      await assert.rejects(evalRedteamCommand("redteam", ["--level", "8"]), /plan login/);
    });
  });

  it("leaves the local evals alone", async () => {
    await withEnv(undefined, async () => {
      await assert.rejects(evalAnswersCommand("answers-report", []), /Name at least one run id/);
      await assert.rejects(evalAnswersCommand("followups-report", []), /Name at least one run id/);
      await assert.rejects(evalRedteamCommand("redteam-report", []), /Name a run id/);
    });
  });
});

async function collect(provider: ReturnType<typeof claudeProvider>): Promise<void> {
  for await (const event of provider.run({ profile, user: "q", tools: noTools }, new AbortController().signal)) void event;
}

function envOf(sdk: ReturnType<typeof fakeSdk>): Record<string, string | undefined> {
  const query = sdk.queries[0];
  assert.ok(query, "the provider made a query");
  return query.options.env as Record<string, string | undefined>;
}

describe("where the key goes", () => {
  it("is never in a process's environment unless an eval passes it", () => {
    const source = { ANTHROPIC_API_KEY: "sk-ambient", ANTHROPIC_BASE_URL: "https://x", PATH: "/bin" };
    const plain = isolatedEnv(source);
    assert.equal(plain.ANTHROPIC_API_KEY, undefined);
    assert.equal(plain.ANTHROPIC_BASE_URL, undefined);
    assert.equal(plain.PATH, "/bin");
    assert.equal(isolatedEnv(source, { key: "sk-eval", workspace: null }).ANTHROPIC_API_KEY, "sk-eval");
    assert.equal(isolatedEnv(source, { key: "sk-eval", workspace: null }).ANTHROPIC_CUSTOM_HEADERS, undefined);
    assert.equal(isolatedEnv(source, { key: "sk-eval", workspace: "wrkspc_01Abc" }).ANTHROPIC_CUSTOM_HEADERS, "anthropic-workspace-id: wrkspc_01Abc");
    assert.equal(isolatedEnv(source, { key: "", workspace: null }).ANTHROPIC_API_KEY, undefined);
    assert.equal(isolatedEnv({ ...source, ANTHROPIC_CUSTOM_HEADERS: "x: y" }).ANTHROPIC_CUSTOM_HEADERS, undefined);
  });

  it("is passed to the SDK only by a provider built with it, and the app's provider drops an ambient one", async () => {
    await withEnv("sk-ambient", async () => {
      const app = fakeSdk();
      await collect(claudeProvider({ sdk: app }));
      assert.equal(envOf(app).ANTHROPIC_API_KEY, undefined);

      const evalSdk = fakeSdk();
      await collect(claudeProvider({ sdk: evalSdk, api: { key: "sk-eval", workspace: "wrkspc_01Abc" } }));
      assert.equal(envOf(evalSdk).ANTHROPIC_API_KEY, "sk-eval");
      assert.equal(envOf(evalSdk).ANTHROPIC_CUSTOM_HEADERS, "anthropic-workspace-id: wrkspc_01Abc");
    });
  });

  it("is never handed over by hpt ask or the desktop host", () => {
    const commands = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/commands");
    for (const name of ["ask.ts", "host.ts"]) {
      const source = fs.readFileSync(path.join(commands, name), "utf8");
      assert.doesNotMatch(source, /apiKey|api:|ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID|eval-guard/, name);
    }
  });
});

function trace(fields: { model?: string; effort?: string; usage: (number | null)[][] }): Trace {
  const attempts = fields.usage.map((tokens) => ({ usage: tokens[0] === null ? null : { inputTokens: tokens[0], cacheWriteTokens: tokens[1], cacheReadTokens: tokens[2], outputTokens: tokens[3] } }));
  return { model: fields.model ?? OPUS, effort: fields.effort ?? "low", attempts } as unknown as Trace;
}

describe("the cost estimate", () => {
  const defaults = { profile: DEFAULT_PROFILES[OPUS]!, source: "default" as const, traces: 0 };

  it("prices an answer from the token profile and the price table", () => {
    const price = PRICES[OPUS]!;
    assert.deepEqual([price.input, price.output, price.cacheWrite, price.cacheRead], [4, 20, 5, 0.2]);
    const haiku = PRICES["claude-haiku-5-5"]!;
    assert.deepEqual([haiku.input, haiku.output, haiku.cacheWrite, haiku.cacheRead], [0.1, 0.5, 0.125, 0.01]);
    const answer = (9500 * 5 + 14_100 * 0.2 + 1700 * 20) / 1_000_000;
    assert.ok(Math.abs(costOf(DEFAULT_PROFILES[OPUS]!, price) - answer) < 1e-12);
  });

  it("multiplies by cases and attempts, adds the Haiku requests that ride along, and shows the batch price", () => {
    const one = estimateCost({ model: OPUS, choice: defaults, cases: 1, attempts: 1, rewrites: 0 });
    const forty = estimateCost({ model: OPUS, choice: defaults, cases: 40, attempts: 2, rewrites: 0 });
    assert.ok(Math.abs(forty.usd - one.usd * 80) < 1e-9);
    assert.ok(Math.abs(forty.batchUsd - forty.usd * (1 - BATCH_DISCOUNT)) < 1e-12);
    assert.deepEqual(
      one.lines.map((line) => line.label),
      [`${OPUS} answers`, "session titles (Haiku)"],
    );
    assert.ok(one.usd > costOf(DEFAULT_PROFILES[OPUS]!, PRICES[OPUS]!));
    const withRewrites = estimateCost({ model: OPUS, choice: defaults, cases: 24, attempts: 1, rewrites: 12 });
    assert.equal(withRewrites.lines.at(-1)?.label, "follow-up rewrites (Haiku)");
    assert.equal(withRewrites.lines.at(-1)?.count, 12);
  });

  it("refuses a model with no price", () => {
    assert.throws(() => estimateCost({ model: "claude-unlisted", choice: defaults, cases: 1, attempts: 1, rewrites: 0 }), UnpricedModelError);
  });

  it("states the per-answer profile, its source, the batch price and the limit", () => {
    const text = formatEstimate(estimateCost({ model: OPUS, choice: defaults, cases: 40, attempts: 1, rewrites: 0 }), 10);
    assert.match(text, /40 cases x 1 attempt on claude-opus-5-5/);
    assert.match(text, /9,500 cache-write, 14,100 cache-read and 1,700 output/);
    assert.match(text, /Batch API price, 50% off, would be \$\d/);
    assert.match(text, /Limit \$10\.00 \(--max-usd\)/);
  });
});

describe("the token profile", () => {
  const six = Array.from({ length: MIN_TRACES + 1 }, () => trace({ usage: [[10, 3500, 2000, 300]] }));

  it("is the mean of the newest traces of this model and effort, summing a retried answer's attempts", () => {
    assert.deepEqual(profileFromTraces(six, OPUS, "low")?.profile, { input: 10, cacheWrite: 3500, cacheRead: 2000, output: 300 });
    const retried = trace({ usage: [[10, 3500, 2000, 300], [10, 3500, 2000, 300]] });
    const found = profileFromTraces([retried, ...six.slice(1)], OPUS, "low");
    assert.equal(found?.n, MIN_TRACES + 1);
    assert.ok(found && found.profile.output > 300 && found.profile.cacheRead > 2000);
  });

  it("ignores other models, other efforts and attempts with no usage, and needs enough traces", () => {
    const noise = [trace({ model: "claude-sonnet-5-5", usage: [[1, 1, 1, 1]] }), trace({ effort: "high", usage: [[1, 1, 1, 1]] }), trace({ usage: [[null]] })];
    assert.equal(profileFromTraces([...noise, ...six.slice(0, MIN_TRACES - 1)], OPUS, "low"), null);
    assert.equal(profileFromTraces([...noise, ...six], OPUS, "low")?.n, MIN_TRACES + 1);
  });

  it("falls back to the default, then to a labelled stand-in", () => {
    assert.equal(chooseProfile([], OPUS, "low").source, "default");
    assert.equal(chooseProfile(six, OPUS, "low").source, "traces");
    const standIn = chooseProfile([], "claude-haiku-5-5", "low");
    assert.deepEqual([standIn.source, standIn.profile], ["stand-in", DEFAULT_PROFILES[OPUS]]);
  });

  it("is read from the most recent trace files, newest first, skipping a cut line", () => {
    const dir = tempDir();
    const line = (output: number) => JSON.stringify(trace({ usage: [[0, 0, 0, output]] }));
    fs.writeFileSync(path.join(dir, "2026-11-25.jsonl"), `${line(1)}\n`);
    fs.writeFileSync(path.join(dir, "2026-11-26.jsonl"), `${line(2)}\n{"cut\n${line(3)}\n`);
    assert.deepEqual(
      recentTraces(dir).map((one) => one.attempts.map((attempt) => attempt.usage?.outputTokens)).flat(),
      [3, 2, 1],
    );
    assert.deepEqual(recentTraces(path.join(dir, "none")), []);
  });
});

describe("the cost gate", () => {
  const estimate = (cases: number) => estimateCost({ model: OPUS, choice: { profile: DEFAULT_PROFILES[OPUS]!, source: "default", traces: 0 }, cases, attempts: 1, rewrites: 0 });

  it("only reports without --confirm, runs with it, and refuses over the limit even with it", () => {
    const small = estimate(40);
    assert.ok(small.usd < 10);
    assert.deepEqual([decide(small, { confirm: false, maxUsd: 10 }).go, decide(small, { confirm: true, maxUsd: 10 }).go], [false, true]);
    assert.match(decide(small, { confirm: false, maxUsd: 10 }).message, /Add --confirm/);
    const large = estimate(400);
    assert.ok(large.usd > 10);
    const refused = decide(large, { confirm: true, maxUsd: 10 });
    assert.equal(refused.go, false);
    assert.match(refused.message, /over --max-usd/);
    assert.equal(decide(large, { confirm: true, maxUsd: 100 }).go, true);
  });

  it("is applied to the cases still to run, from the flags, and prints the estimate either way", () => {
    const printed: string[] = [];
    const dir = tempDir();
    const plan = { model: OPUS, effort: "low", pending: 40 };
    assert.equal(gateEval(plan, {}, (text) => printed.push(text), dir), false);
    assert.equal(gateEval(plan, { confirm: true }, (text) => printed.push(text), dir), true);
    assert.equal(gateEval(plan, { confirm: true, "max-usd": "0.5" }, (text) => printed.push(text), dir), false);
    assert.equal(gateEval({ ...plan, pending: 0 }, {}, (text) => printed.push(text), dir), false);
    assert.equal(printed.length, 4);
    assert.match(printed[0] ?? "", /40 cases/);
    assert.throws(() => gateEval(plan, { "max-usd": "-1" }, () => {}, dir), /--max-usd is a number above 0/);
    assert.throws(() => gateEval({ ...plan, model: "claude-unlisted" }, { confirm: true }, () => {}, dir), /no price/);
  });
});
