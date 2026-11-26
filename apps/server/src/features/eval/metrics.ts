import type { NoteId } from "../corpus/index.ts";

export const CUTOFFS = [5, 10] as const;

/** Rank (1-based position in the hit list) of the first hit that covers each expected note, or null. */
export type ExpectedRanks = Record<NoteId, number | null>;

/**
 * `hitNotes[i]` lists every note that hit i stands for: its own note plus the notes of passages with identical
 * text that were collapsed into it. A duplicate published twice therefore still counts as found.
 */
export function rankExpected(expected: readonly NoteId[], hitNotes: readonly (readonly NoteId[])[]): ExpectedRanks {
  const ranks: ExpectedRanks = {};
  for (const note of expected) {
    const index = hitNotes.findIndex((covered) => covered.includes(note));
    ranks[note] = index === -1 ? null : index + 1;
  }
  return ranks;
}

function foundWithin(ranks: ExpectedRanks, k: number): number {
  return Object.values(ranks).filter((rank) => rank !== null && rank <= k).length;
}

export function recallAt(ranks: ExpectedRanks, k: number): number {
  return foundWithin(ranks, k) / Object.keys(ranks).length;
}

export function hitAt(ranks: ExpectedRanks, k: number): boolean {
  return foundWithin(ranks, k) > 0;
}

export function reciprocalRank(ranks: ExpectedRanks): number {
  const found = Object.values(ranks).filter((rank): rank is number => rank !== null);
  return found.length === 0 ? 0 : 1 / Math.min(...found);
}

export function ceilingAt(expectedCount: number, k: number): number {
  return Math.min(k, expectedCount) / expectedCount;
}

const mean = (values: readonly number[]) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);

export type ScoredCase = { ranks: ExpectedRanks };

export type CutoffSummary = { recall: number; ceiling: number; hit: number };

export function summarizeCases(cases: readonly ScoredCase[]): { byCutoff: Record<number, CutoffSummary>; mrr: number } {
  const byCutoff: Record<number, CutoffSummary> = {};
  for (const k of CUTOFFS) {
    byCutoff[k] = {
      recall: mean(cases.map(({ ranks }) => recallAt(ranks, k))),
      ceiling: mean(cases.map(({ ranks }) => ceilingAt(Object.keys(ranks).length, k))),
      hit: mean(cases.map(({ ranks }) => (hitAt(ranks, k) ? 1 : 0))),
    };
  }
  return { byCutoff, mrr: mean(cases.map(({ ranks }) => reciprocalRank(ranks))) };
}

export function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}
