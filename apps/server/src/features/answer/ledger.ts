import type { Passage, PassageId } from "../search/index.ts";

/**
 * The S-id to passage-id mapping, one per answer (not per attempt). It is the single source of truth for what the model was
 * shown, what a marker like [S3] means, what a check may resolve and what the trace records.
 *
 *   - append-only: an S-id, once handed out, names the same passage for the rest of the answer;
 *   - idempotent: adding a passage already present returns the existing entry, so a search tool that re-finds S2 hands back S2;
 *   - dense from 1 in insertion order: pre-retrieved passages first, then tool results as they arrive, so a retry re-sends the
 *     same numbers and a trace is readable;
 *   - only the model-facing form is "S<n>". Everything that leaves the engine uses PassageId.
 */
export type SourceId = `S${number}`;

export type LedgerOrigin = "retrieval" | "carry_over" | "scope" | "tool";

export type LedgerEntry = {
  readonly sid: SourceId;
  readonly n: number;
  readonly passage: Passage;
  readonly origin: LedgerOrigin;
  /** The earliest earlier turn that cited this passage; becomes `prior_turn` in the prompt. */
  readonly priorTurn: number | null;
  /** True when the model was shown only an excerpt. The full `passage.text` is still what quotes are checked against. */
  readonly excerpted: boolean;
};

export type AddOptions = {
  readonly origin: LedgerOrigin;
  readonly priorTurn?: number | null;
  readonly excerpted?: boolean;
};

const CANONICAL = /^S([1-9]\d*)$/;

export class SourceLedger {
  #entries: LedgerEntry[] = [];
  #byPassage = new Map<PassageId, LedgerEntry>();

  add(passage: Passage, options: AddOptions): LedgerEntry {
    const existing = this.#byPassage.get(passage.id);
    if (existing) return existing;
    const n = this.#entries.length + 1;
    const entry: LedgerEntry = { sid: `S${n}`, n, passage, origin: options.origin, priorTurn: options.priorTurn ?? null, excerpted: options.excerpted ?? false };
    this.#entries.push(entry);
    this.#byPassage.set(passage.id, entry);
    return entry;
  }

  /** Accepts exactly "S" and a positive integer without leading zeros. Anything else is unknown. */
  resolve(sid: string): LedgerEntry | null {
    const match = CANONICAL.exec(sid);
    return match === null ? null : (this.#entries[Number(match[1]) - 1] ?? null);
  }

  entryOf(id: PassageId): LedgerEntry | null {
    return this.#byPassage.get(id) ?? null;
  }

  get entries(): readonly LedgerEntry[] {
    return this.#entries;
  }

  get passageIds(): PassageId[] {
    return this.#entries.map((entry) => entry.passage.id);
  }

  /** `supersedes` and `superseded_by` as S-ids, only when both passages are in the ledger. Derived on read, so insertion order does not matter. */
  pair(entry: LedgerEntry): { readonly supersedes: SourceId | null; readonly supersededBy: SourceId | null } {
    const { supersedes, supersededBy } = entry.passage;
    return {
      supersedes: supersedes === null ? null : (this.#byPassage.get(supersedes)?.sid ?? null),
      supersededBy: supersededBy === null ? null : (this.#byPassage.get(supersededBy)?.sid ?? null),
    };
  }
}
