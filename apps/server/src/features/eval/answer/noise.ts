import { percentile } from "../metrics.ts";
import { seeded } from "./seeded.ts";

/**
 * The noise floor of a 40-question run, as seeded bootstrap intervals. A report states a difference only when it clears the
 * interval of the paired differences, so "faster" is never a gap smaller than the sample can tell apart.
 */
export type Interval = { readonly lo: number; readonly hi: number };

const RESAMPLES = 2000;

export const p50 = (values: readonly number[]) => percentile(values, 0.5);
export const p90 = (values: readonly number[]) => percentile(values, 0.9);

function interval(draws: number[]): Interval {
  return { lo: percentile(draws, 0.025), hi: percentile(draws, 0.975) };
}

/** 95 percent bootstrap interval of a statistic of one sample. */
export function bootstrap(values: readonly number[], statistic: (sample: readonly number[]) => number, seed = 1): Interval {
  if (values.length === 0) return { lo: 0, hi: 0 };
  const next = seeded(seed);
  const draws: number[] = [];
  for (let round = 0; round < RESAMPLES; round += 1) {
    const sample = values.map(() => values[Math.floor(next() * values.length)] as number);
    draws.push(statistic(sample));
  }
  return interval(draws);
}

export type PairedChange = {
  readonly n: number;
  /** statistic(after) minus statistic(before), over the same questions. */
  readonly change: number;
  readonly interval: Interval;
  /** The interval excludes zero. */
  readonly clears: boolean;
};

/** `before[i]` and `after[i]` are the same question. Resamples the questions together, so a hard question is hard for both. */
export function pairedChange(before: readonly number[], after: readonly number[], statistic: (sample: readonly number[]) => number, seed = 1): PairedChange {
  const n = Math.min(before.length, after.length);
  if (n === 0) return { n, change: 0, interval: { lo: 0, hi: 0 }, clears: false };
  const next = seeded(seed);
  const draws: number[] = [];
  for (let round = 0; round < RESAMPLES; round += 1) {
    const picks = Array.from({ length: n }, () => Math.floor(next() * n));
    draws.push(statistic(picks.map((at) => after[at] as number)) - statistic(picks.map((at) => before[at] as number)));
  }
  const spread = interval(draws);
  return { n, change: statistic(after.slice(0, n)) - statistic(before.slice(0, n)), interval: spread, clears: spread.lo > 0 || spread.hi < 0 };
}
