import type { Evidence, EvidenceLevel, HptIndex, Passage, PassageId, SearchHit, SearchOptions, SearchResult } from "../search/index.ts";
import type { LedgerOrigin, SourceLedger } from "./ledger.ts";
import type { HistoryEntry, Turn } from "./types.ts";

/**
 * Turns a Turn into the passages the model is shown. The app owns this (D1): retrieval, the context budget, carry-over.
 * `HptIndex.search` is consumed as is. The pure parts (queriesFor, packContext) are separate from the one impure call
 * (retrieve) so the budget and carry-over rules are tested with fabricated hits.
 *
 * Follow-up policy, until D9's rewrite exists behind the same `retrieve`:
 *   1. search the bare question. A first turn stops here.
 *   2. a follow-up whose evidence is not "strong" is searched again with the previous question prepended, and the better
 *      result by evidence level wins. A tie keeps the bare question, which has less topic bleed.
 *   3. carry-over: when the bare question was not strong, the passages the PREVIOUS turn cited are appended after the hits.
 */
export type RetrievalSettings = {
  readonly searchLimit: number;
  readonly evidenceTokens: number;
};

export type Retrieved = {
  readonly queries: readonly string[];
  readonly hits: readonly SearchHit[];
  readonly evidence: Evidence;
  readonly scoped: readonly Passage[];
  readonly carry: readonly Passage[];
  readonly ms: number;
};

const LEVEL: Readonly<Record<EvidenceLevel, number>> = { absent: 0, weak: 1, strong: 2 };

export function queriesFor(turn: Turn): { readonly bare: string; readonly withHistory: string | null } {
  const previous = turn.history.at(-1);
  return { bare: turn.question, withHistory: previous === undefined ? null : `${previous.question} ${turn.question}` };
}

export async function retrieve(index: HptIndex, turn: Turn, settings: RetrievalSettings): Promise<Retrieved> {
  const started = performance.now();
  const queries: string[] = [];
  const search = (query: string, options: SearchOptions = {}): Promise<SearchResult> => {
    queries.push(query);
    return index.search(query, { limit: settings.searchLimit, ...options });
  };
  const { bare, withHistory } = queriesFor(turn);
  const { scope } = turn;

  if (scope?.kind === "revision") {
    const found = index.getPassages([scope.active, scope.superseded]);
    const scoped = [scope.active, scope.superseded].flatMap((id) => found.get(id) ?? []);
    const result = await search(bare);
    return { queries, hits: result.hits, evidence: result.evidence, scoped, carry: [], ms: performance.now() - started };
  }
  if (scope?.kind === "document") {
    const inDocument = await search(bare, { filter: { noteIds: [scope.noteId] } });
    const overall = await search(bare);
    const evidence = inDocument.hits.length > 0 ? inDocument.evidence : overall.evidence;
    return { queries, hits: overall.hits, evidence, scoped: inDocument.hits.map((hit) => hit.passage), carry: [], ms: performance.now() - started };
  }

  let result = await search(bare);
  const previous = turn.history.at(-1);
  let carry: Passage[] = [];
  if (previous !== undefined && result.evidence.level !== "strong") {
    if (withHistory !== null) {
      const again = await search(withHistory);
      if (LEVEL[again.evidence.level] > LEVEL[result.evidence.level]) result = again;
    }
    carry = [...index.getPassages(previous.cited).values()];
  }
  return { queries, hits: result.hits, evidence: result.evidence, scoped: [], carry, ms: performance.now() - started };
}

/** Characters divided by 3.2, rounded up. Claude's tokenizer is not available: the trace records this estimate next to the provider's real input count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

export const FULL_PASSAGES = 6;
export const EXCERPT_WORDS = 120;
const TAG_TOKENS = 60;

export function excerptOf(text: string): string {
  let words = 0;
  for (const match of text.matchAll(/\S+/g)) {
    words += 1;
    if (words === EXCERPT_WORDS) return text.slice(0, match.index + match[0].length);
  }
  return text;
}

export type PackedEntry = {
  readonly passage: Passage;
  readonly origin: Exclude<LedgerOrigin, "tool">;
  readonly priorTurn: number | null;
  /** Ranks past `FULL_PASSAGES` are shown as an excerpt. Quotes are still checked against the full text. */
  readonly excerpted: boolean;
};

export type Packed = {
  readonly entries: readonly PackedEntry[];
  /** Candidates that did not fit the budget, or were left out with their pair, for the trace. */
  readonly dropped: readonly PassageId[];
  readonly estimatedTokens: number;
};

function earliestCitingTurn(history: readonly HistoryEntry[]): Map<PassageId, number> {
  const turns = new Map<PassageId, number>();
  for (const entry of history) for (const id of entry.cited) if (!turns.has(id)) turns.set(id, entry.n);
  return turns;
}

/**
 * Order: scoped, hits in rank order, carry-over. Whole passages only: a passage is shown in full, as an excerpt, or not at
 * all, never cut mid-sentence by the budget. Duplicates collapse and the first wins, keeping a prior-turn mark if any turn
 * cited it. A superseded passage and its replacement are kept together or dropped together.
 */
export function packContext(input: { readonly retrieved: Retrieved; readonly history: readonly HistoryEntry[]; readonly budgetTokens: number }): Packed {
  const { retrieved, history, budgetTokens } = input;
  const cited = earliestCitingTurn(history);
  const candidates: { passage: Passage; origin: PackedEntry["origin"] }[] = [
    ...retrieved.scoped.map((passage) => ({ passage, origin: "scope" as const })),
    ...retrieved.hits.map((hit) => ({ passage: hit.passage, origin: "retrieval" as const })),
    ...retrieved.carry.map((passage) => ({ passage, origin: "carry_over" as const })),
  ];
  const seen = new Set<PassageId>();
  const unique = candidates.filter(({ passage }) => !seen.has(passage.id) && seen.add(passage.id));
  const entries: PackedEntry[] = [];
  const dropped: PassageId[] = [];
  let remaining = budgetTokens;
  for (const [rank, { passage, origin }] of unique.entries()) {
    const full = estimateTokens(passage.text) + TAG_TOKENS;
    const short = estimateTokens(excerptOf(passage.text)) + TAG_TOKENS;
    const priorTurn = cited.get(passage.id) ?? null;
    if (rank < FULL_PASSAGES && full <= remaining) {
      remaining -= full;
      entries.push({ passage, origin, priorTurn, excerpted: false });
    } else if (short <= remaining) {
      remaining -= short;
      entries.push({ passage, origin, priorTurn, excerpted: short < full });
    } else dropped.push(passage.id);
  }

  const candidateIds = new Set(unique.map(({ passage }) => passage.id));
  for (let changed = true; changed; ) {
    changed = false;
    const packedIds = new Set(entries.map((entry) => entry.passage.id));
    const orphan = entries.findIndex(({ passage }) => [passage.supersedes, passage.supersededBy].some((partner) => partner !== null && candidateIds.has(partner) && !packedIds.has(partner)));
    if (orphan !== -1) {
      dropped.push((entries.splice(orphan, 1)[0] as PackedEntry).passage.id);
      changed = true;
    }
  }
  const spent = entries.reduce((sum, entry) => sum + estimateTokens(entry.excerpted ? excerptOf(entry.passage.text) : entry.passage.text) + TAG_TOKENS, 0);
  return { entries, dropped, estimatedTokens: spent };
}

export function fillLedger(ledger: SourceLedger, packed: Packed): void {
  for (const entry of packed.entries) ledger.add(entry.passage, { origin: entry.origin, priorTurn: entry.priorTurn, excerpted: entry.excerpted });
}
