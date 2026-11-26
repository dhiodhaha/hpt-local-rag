import type { NoteId } from "../../corpus/index.ts";
import type { EvidenceLevel, HptIndex } from "../../search/index.ts";
import { loadCases } from "../retrieval.ts";
import { seeded } from "./seeded.ts";
import { CATEGORIES, TARGETS, type AnswerCase, type Category, type DraftedCase } from "./cases.ts";

/**
 * Drafts the subset from data/qa_pairs.jsonl and the written questions: deterministic (a fixed seed, no model call). The draft
 * is a proposal. A human may edit data/eval/answer-subset.draft.json, and `hpt eval answers-lock` then freezes it.
 *
 * What each category means, and the signal that stands in for it (HPT's own references and answer, and OUR retrieval):
 *   explicit      HPT cited a putusan, our search is `strong`, and a cited note is in our top 5
 *   inferred      HPT cited a putusan, our search is not `strong`, and a cited note is in our top 10: related, not direct
 *   differing     as explicit or inferred, and HPT's answer mentions a difference of views
 *   revision      written: the corpus names a revised ruling (no revisions.json exists yet, so no passage is marked superseded)
 *   insufficient  written: an in-scope question on a topic with no hit for its key term anywhere in the putusan notes
 *   fictional     written: an invented ruling number, or a quotation nobody can find
 * qa_pairs has no row that is both in scope and unsourced (the unsourced rows are red-team and chit-chat), so the last three come
 * from `written`. Only a first turn is drafted: a follow-up has no meaning without its history.
 */
export type Row = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly references?: readonly unknown[];
};

export type Candidate = {
  readonly id: string;
  readonly question: string;
  readonly expectedNotes: readonly NoteId[];
  readonly evidence: EvidenceLevel;
  /** The best 1-based rank of an expected note in our top 10, or null. */
  readonly bestRank: number | null;
  readonly differs: boolean;
};

export type Draft = {
  readonly cases: readonly DraftedCase[];
  /** How many cases a category is short of its target. A category absent from the map is full. */
  readonly shortfall: Readonly<Partial<Record<Category, number>>>;
};

const MIN_CHARS = 15;
const MAX_CHARS = 300;
const DIFFERS = /berbeda|perbedaan pendapat|ikhtilaf|khilaf/i;
/** Some conversations lost their first message in the crawl, so their first row opens with thanks to an answer we do not have. */
const CONTINUATION = /^(terima kasih|makasih|syukran|jazakallah)/i;

/** Stable, readable id: the conversation's first 8 characters and the turn within it. */
export function caseId(conversation: string, turn: number): string {
  return `q-${conversation.slice(0, 8)}-${turn}`;
}

/** Searches every first-turn row once. The only step that touches the index. */
export async function candidatesFrom(jsonl: string, index: HptIndex): Promise<Candidate[]> {
  const seen = new Map<string, number>();
  const out: Candidate[] = [];
  for (const line of jsonl.split("\n").filter((text) => text.trim() !== "")) {
    const row = JSON.parse(line) as Row;
    const turn = (seen.get(row.id) ?? 0) + 1;
    seen.set(row.id, turn);
    if (turn !== 1 || row.question.length < MIN_CHARS || row.question.length > MAX_CHARS || CONTINUATION.test(row.question.trim())) continue;
    const notes = loadCases(line, (noteId) => index.hasPutusan(noteId)).cases[0]?.expected;
    if (notes === undefined) continue;
    const result = await index.search(row.question, { limit: 10 });
    const ranks = notes.map((note) => result.hits.findIndex((hit) => hit.passage.noteId === note)).filter((at) => at >= 0);
    out.push({
      id: caseId(row.id, turn),
      question: row.question,
      expectedNotes: notes,
      evidence: result.evidence.level,
      bestRank: ranks.length === 0 ? null : Math.min(...ranks) + 1,
      differs: DIFFERS.test(row.answer),
    });
  }
  return out;
}

function shuffled<T extends { readonly id: string }>(items: readonly T[], seed: number): T[] {
  const next = seeded(seed);
  const out = [...items].sort((a, b) => Number(a.id > b.id) - Number(a.id < b.id));
  for (let at = out.length - 1; at > 0; at -= 1) {
    const other = Math.floor(next() * (at + 1));
    [out[at], out[other]] = [out[other] as T, out[at] as T];
  }
  return out;
}

type Rule = { readonly category: Category; readonly takes: (candidate: Candidate) => boolean; readonly why: (candidate: Candidate) => string };

const rank = (candidate: Candidate) => candidate.bestRank ?? 0;
const within = (candidate: Candidate, limit: number) => candidate.bestRank !== null && candidate.bestRank <= limit;

/** Order matters: `differing` picks first so its questions do not fill the other pools. */
const RULES: readonly Rule[] = [
  {
    category: "differing",
    takes: (candidate) => candidate.differs && within(candidate, 10),
    why: (candidate) => `HPT's answer mentions a difference of views; evidence ${candidate.evidence}; a cited note is at rank ${rank(candidate)}`,
  },
  {
    category: "explicit",
    takes: (candidate) => !candidate.differs && candidate.evidence === "strong" && within(candidate, 5),
    why: (candidate) => `HPT cited a putusan; our evidence is strong; a cited note is at rank ${rank(candidate)}`,
  },
  {
    category: "inferred",
    takes: (candidate) => !candidate.differs && candidate.evidence !== "strong" && within(candidate, 10),
    why: (candidate) => `HPT cited a putusan; our evidence is ${candidate.evidence}, not strong; a cited note is at rank ${rank(candidate)}`,
  },
];

export type DraftInput = {
  readonly candidates: readonly Candidate[];
  readonly written: readonly DraftedCase[];
  readonly seed: number;
};

export function pickCases(input: DraftInput): Draft {
  const taken = new Set<string>();
  const cases: DraftedCase[] = [];
  const shortfall: Partial<Record<Category, number>> = {};

  for (const rule of RULES) {
    const pool = shuffled(
      input.candidates.filter((candidate) => !taken.has(candidate.id) && rule.takes(candidate)),
      input.seed,
    );
    for (const candidate of pool.slice(0, TARGETS[rule.category])) {
      taken.add(candidate.id);
      cases.push({ id: candidate.id, category: rule.category, question: candidate.question, expectedNotes: candidate.expectedNotes, origin: "qa_pairs", why: rule.why(candidate) });
    }
  }
  for (const item of input.written) cases.push(item);

  for (const category of CATEGORIES) {
    const missing = TARGETS[category] - cases.filter((item) => item.category === category).length;
    if (missing > 0) shortfall[category] = missing;
  }
  return { cases, shortfall };
}

/** The lock takes AnswerCase, so `why` is dropped there on purpose. */
export function withoutWhy(cases: readonly DraftedCase[]): AnswerCase[] {
  return cases.map(({ why: _why, ...rest }) => rest);
}
