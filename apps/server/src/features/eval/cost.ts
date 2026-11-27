import fs from "node:fs";
import path from "node:path";
import type { Trace } from "../answer/index.ts";

/**
 * D34: what a model-calling eval will cost, worked out before it starts. Pure arithmetic over a token profile and a price table,
 * so a test needs no model. The profile is what one answer used, read from the most recent local traces when there are enough,
 * else a default measured on the plan login. It is a forecast and says so: a retry, an extra tool round or a long answer moves it.
 */
export type Price = { readonly input: number; readonly output: number; readonly cacheWrite: number; readonly cacheRead: number };

/** Dollars per million tokens. A cache write costs 1.25 times the input price. */
function priced(input: number, output: number, cacheRead: number): Price {
  return { input, output, cacheWrite: input * 1.25, cacheRead };
}

/** Current API prices as of 2026-11-27. Haiku cache reads are assumed at 0.1 times its input price. A model with no row here is refused, so a guess never passes as an estimate. */
export const PRICES: Readonly<Record<string, Price>> = {
  "claude-opus-5-5": priced(4, 20, 0.2),
  "claude-sonnet-5-5": priced(2, 10, 0.1),
  "claude-haiku-5-5": priced(0.1, 0.5, 0.01),
};

/** The Message Batches API takes this share off. */
export const BATCH_DISCOUNT = 0.5;

export type Profile = { readonly input: number; readonly cacheWrite: number; readonly cacheRead: number; readonly output: number };

/** Tokens per answer, summed over its attempts and tool rounds, for Opus 5.5 at low effort, from the answer eval of 2026-11-26. */
export const DEFAULT_PROFILES: Readonly<Record<string, Profile>> = {
  "claude-opus-5-5": { input: 0, cacheWrite: 9500, cacheRead: 14_100, output: 1700 },
};

/**
 * Small Haiku requests that ride along. Assumed, not measured: the session title the Claude process sends once per attempt,
 * and the follow-up rewrite (D33). Both are a few hundred to a couple of thousand tokens, so they move the total by cents.
 */
export const TITLE_PROFILE: Profile = { input: 500, cacheWrite: 0, cacheRead: 0, output: 30 };
export const REWRITE_PROFILE: Profile = { input: 2500, cacheWrite: 0, cacheRead: 0, output: 40 };
const HAIKU = "claude-haiku-5-5";
const STAND_IN = "claude-opus-5-5";

export const MIN_TRACES = 5;
const MAX_TRACES = 50;

export type ProfileChoice = {
  readonly profile: Profile;
  readonly source: "traces" | "default" | "stand-in";
  /** How many traces the profile averages. 0 for a default. */
  readonly traces: number;
};

function usageOf(trace: Trace): Profile | null {
  const used = trace.attempts.flatMap((attempt) => (attempt.usage === null ? [] : [attempt.usage]));
  if (used.length === 0) return null;
  const sum = (pick: (usage: (typeof used)[number]) => number) => used.reduce((total, usage) => total + pick(usage), 0);
  return { input: sum((u) => u.inputTokens), cacheWrite: sum((u) => u.cacheWriteTokens), cacheRead: sum((u) => u.cacheReadTokens), output: sum((u) => u.outputTokens) };
}

/** Newest first. */
export function recentTraces(dir: string): Trace[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort().reverse();
  const traces: Trace[] = [];
  for (const name of files) {
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n").reverse();
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        traces.push(JSON.parse(line) as Trace);
      } catch {
        // A truncated line.
      }
    }
    if (traces.length >= MAX_TRACES * 4) break;
  }
  return traces;
}

/** The mean of the latest traces of this model and effort, when there are at least `MIN_TRACES`. Traces are newest first. */
export function profileFromTraces(traces: readonly Trace[], model: string, effort: string): { readonly profile: Profile; readonly n: number } | null {
  const usages = traces
    .filter((trace) => trace.model === model && trace.effort === effort)
    .flatMap((trace) => usageOf(trace) ?? [])
    .slice(0, MAX_TRACES);
  if (usages.length < MIN_TRACES) return null;
  const mean = (pick: (profile: Profile) => number) => Math.round(usages.reduce((total, usage) => total + pick(usage), 0) / usages.length);
  return { profile: { input: mean((p) => p.input), cacheWrite: mean((p) => p.cacheWrite), cacheRead: mean((p) => p.cacheRead), output: mean((p) => p.output) }, n: usages.length };
}

/** Traces first, then the model's default. A model with neither borrows the Opus default and is labelled as a stand-in. */
export function chooseProfile(traces: readonly Trace[], model: string, effort: string): ProfileChoice {
  const found = profileFromTraces(traces, model, effort);
  if (found !== null) return { profile: found.profile, source: "traces", traces: found.n };
  const own = DEFAULT_PROFILES[model];
  if (own !== undefined) return { profile: own, source: "default", traces: 0 };
  return { profile: DEFAULT_PROFILES[STAND_IN] as Profile, source: "stand-in", traces: 0 };
}

export function costOf(profile: Profile, price: Price): number {
  return (profile.input * price.input + profile.cacheWrite * price.cacheWrite + profile.cacheRead * price.cacheRead + profile.output * price.output) / 1_000_000;
}

export type Line = { readonly label: string; readonly count: number; readonly usd: number };

export type Estimate = {
  readonly model: string;
  readonly cases: number;
  readonly attempts: number;
  readonly choice: ProfileChoice;
  readonly lines: readonly Line[];
  readonly usd: number;
  readonly batchUsd: number;
};

export type EstimateInput = {
  readonly model: string;
  readonly choice: ProfileChoice;
  /** Answers still to run. */
  readonly cases: number;
  /** Attempts per case. 1 means no retry. The profile already holds the tool rounds. */
  readonly attempts: number;
  /** Follow-up turns among the cases, each of which calls the rewrite. */
  readonly rewrites: number;
};

export class UnpricedModelError extends Error {}

export function estimateCost(input: EstimateInput): Estimate {
  const { model, choice, cases, attempts, rewrites } = input;
  const price = PRICES[model];
  if (price === undefined) throw new UnpricedModelError(`There is no price for ${model}. Add it to PRICES in features/eval/cost.ts before an eval may run on it.`);
  const haiku = PRICES[HAIKU] as Price;
  const answers = cases * attempts;
  const lines: Line[] = [
    { label: `${model} answers`, count: answers, usd: answers * costOf(choice.profile, price) },
    { label: "session titles (Haiku)", count: answers, usd: answers * costOf(TITLE_PROFILE, haiku) },
  ];
  if (rewrites > 0) lines.push({ label: "follow-up rewrites (Haiku)", count: rewrites, usd: rewrites * costOf(REWRITE_PROFILE, haiku) });
  const usd = lines.reduce((total, line) => total + line.usd, 0);
  return { model, cases, attempts, choice, lines, usd, batchUsd: usd * (1 - BATCH_DISCOUNT) };
}

const dollars = (usd: number) => `$${usd < 0.01 && usd > 0 ? "<0.01" : usd.toFixed(2)}`;
const tokens = (value: number) => value.toLocaleString("en-US");

const SOURCE_TEXT: Readonly<Record<ProfileChoice["source"], (choice: ProfileChoice) => string>> = {
  traces: (choice) => `the mean of the latest ${choice.traces} local traces of this model and effort`,
  default: () => "the default measured on the plan login on 2026-11-26",
  "stand-in": () => "the Opus 5.5 default as a stand-in, because there is no profile for this model yet",
};

export function formatEstimate(estimate: Estimate, maxUsd: number): string {
  const { choice, lines } = estimate;
  const { profile } = choice;
  return [
    `Cost estimate: ${estimate.cases} cases x ${estimate.attempts} attempt${estimate.attempts === 1 ? "" : "s"} on ${estimate.model}.`,
    `Per answer: ${tokens(profile.input)} input, ${tokens(profile.cacheWrite)} cache-write, ${tokens(profile.cacheRead)} cache-read and ${tokens(profile.output)} output tokens (${SOURCE_TEXT[choice.source](choice)}).`,
    ...lines.map((line) => `  ${line.label.padEnd(30)} ${String(line.count).padStart(4)}  ${dollars(line.usd).padStart(8)}`),
    `Estimated total ${dollars(estimate.usd)} at API prices. The Batch API price, 50% off, would be ${dollars(estimate.batchUsd)}.`,
    `Limit ${dollars(maxUsd)} (--max-usd). A forecast: a retry, a tool round or a long answer moves it.`,
  ].join("\n");
}

export type GateFlags = { readonly confirm: boolean; readonly maxUsd: number };

export type Gate = { readonly go: boolean; readonly message: string };

/** The estimate is shown first. Over the limit it refuses even with --confirm, and without --confirm it only reports. */
export function decide(estimate: Estimate, flags: GateFlags): Gate {
  const text = formatEstimate(estimate, flags.maxUsd);
  if (estimate.usd > flags.maxUsd) return { go: false, message: `${text}\nRefused: the estimate is over --max-usd. Run fewer cases (--first), or raise --max-usd on purpose.` };
  if (!flags.confirm) return { go: false, message: `${text}\nNothing was run. Add --confirm to run it.` };
  return { go: true, message: text };
}
