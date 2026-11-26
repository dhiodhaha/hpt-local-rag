import { createHash } from "node:crypto";
import fs from "node:fs";
import type { NoteId } from "../../corpus/index.ts";

/**
 * D13: a locked 40-question subset, chosen on purpose and fixed before any result. The subset file under data/eval/ holds the
 * question text and stays local. What is committed is the LOCK: ids, categories, origins and a hash. Never text.
 */
export const CATEGORIES = ["explicit", "inferred", "differing", "revision", "insufficient", "fictional"] as const;
export type Category = (typeof CATEGORIES)[number];

/** D13's composition. The draft aims at it, the lock check reports against it, the report prints it. */
export const TARGETS: Readonly<Record<Category, number>> = { explicit: 15, inferred: 8, differing: 5, revision: 4, insufficient: 4, fictional: 4 };

/** A reference the question invents. A cited passage with this number and year means the answer treated it as real. */
export type FictionalRef = { readonly number: string; readonly year: number };

export type AnswerCase = {
  /** `q-<conversation id, 8 chars>-<turn>` for a drafted item, `w-NN` for a written one. */
  readonly id: string;
  readonly category: Category;
  readonly question: string;
  /** HPT's cited notes, when the item comes from qa_pairs. Silver labels, used only for the retrieval-overlap number. */
  readonly expectedNotes: readonly NoteId[];
  readonly origin: "qa_pairs" | "written";
  readonly fictionalRef?: FictionalRef;
};

/** A drafted case plus how it was categorized, so the owner can spot-check it later. `why` never leaves data/. */
export type DraftedCase = AnswerCase & { readonly why: string };

export type Subset = { readonly cases: readonly AnswerCase[]; readonly hash: string };

/** Committed as docs/eval/answer-subset.lock.json. */
export type SubsetLock = {
  readonly hash: string;
  readonly lockedAt: string;
  readonly items: readonly { readonly id: string; readonly category: Category; readonly origin: AnswerCase["origin"] }[];
};

export type Composition = Readonly<Record<Category, { readonly target: number; readonly actual: number }>>;

export function compositionOf(cases: readonly Pick<AnswerCase, "category">[]): Composition {
  return Object.fromEntries(CATEGORIES.map((category) => [category, { target: TARGETS[category], actual: cases.filter((item) => item.category === category).length }])) as Composition;
}

const byId = (a: { readonly id: string }, b: { readonly id: string }) => Number(a.id > b.id) - Number(a.id < b.id);

/** Canonical: sorted by id, only the fields that decide what a run asks and how it is scored. The `why` note is not part of the lock. */
export function hashCases(cases: readonly AnswerCase[]): string {
  const canonical = [...cases].sort(byId).map((item) => [item.id, item.category, item.question, item.origin, item.fictionalRef ?? null, [...item.expectedNotes].sort()]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function lockOf(cases: readonly AnswerCase[], lockedAt: string): SubsetLock {
  const items = [...cases].sort(byId).map(({ id, category, origin }) => ({ id, category, origin }));
  return { hash: hashCases(cases), lockedAt, items };
}

/** Throws unless the cases are exactly what the lock froze. "Locked before any result" is enforced here, not promised. */
export function assertLocked(cases: readonly AnswerCase[], lock: SubsetLock): void {
  const hash = hashCases(cases);
  if (hash !== lock.hash) throw new Error(`The subset file does not match the lock (hash ${hash.slice(0, 12)}, locked ${lock.hash.slice(0, 12)}). Re-draft and lock it again, or restore the file.`);
  const ids = new Set(lock.items.map((item) => item.id));
  const extra = cases.filter((item) => !ids.has(item.id));
  if (extra.length > 0 || cases.length !== lock.items.length) throw new Error("The subset file and the lock list different ids.");
}

export function loadSubset(file: string, lockFile: string): Subset {
  const cases = (JSON.parse(fs.readFileSync(file, "utf8")) as { cases: AnswerCase[] }).cases;
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8")) as SubsetLock;
  assertLocked(cases, lock);
  return { cases, hash: lock.hash };
}
