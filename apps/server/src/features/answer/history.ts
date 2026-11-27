import type { Passage, PassageId } from "../search/index.ts";
import type { ConversationId } from "./conversation-id.ts";
import type { StoredTurn } from "./conversation.ts";
import { citedOf } from "./fold.ts";
import type { Answer, CompleteAnswer, Prose, Scope, SourceCard } from "./types.ts";

/**
 * What a UI needs to list, search and reopen stored conversations. Pure: the files are read in conversation.ts and handed in as
 * StoredTurns, so every rule here is testable without a disk. Everything in this file is JSON and crosses the host wire.
 *
 * The first question is the default title, until a generated title (D36) or a rename replaces it. Both are stored beside the conversation
 * (never inside its append-only turn file, which `pnpm hpt ask` shares), and an empty rename clears it.
 */
export type ConversationSummary = {
  readonly id: ConversationId;
  readonly title: string;
  readonly renamed: boolean;
  readonly turns: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** The latest answer's short verdict, or its message or clarifying question. */
  readonly gist: string | null;
  /** How many naskah the latest answer cited. */
  readonly sources: number;
};

/** `text` with the character ranges `[from, to)` of every matched term. */
export type Snippet = { readonly text: string; readonly marks: readonly (readonly [number, number])[] };

export type ConversationHit = {
  readonly conversation: ConversationSummary;
  /** A question (or the title) holds every term, or only the stored answers do. */
  readonly where: "question" | "answer";
  /** The turn the snippet comes from. */
  readonly turn: number;
  /** null when the row's own title already shows the match. */
  readonly snippet: Snippet | null;
};

export type SearchResult = { readonly terms: readonly string[]; readonly hits: readonly ConversationHit[] };

export type OpenedTurn = {
  readonly id: string;
  readonly n: number;
  readonly at: string;
  readonly question: string;
  readonly scope: Scope | null;
  readonly answer: CompleteAnswer;
  /** The turn's ledger in order, so a chip keeps its number. Passages the index no longer has are left out. */
  readonly sources: readonly SourceCard[];
};

export type OpenedConversation = { readonly summary: ConversationSummary; readonly turns: readonly OpenedTurn[] };

const MAX_TITLE_CHARS = 120;
const MAX_TERMS = 5;
const SNIPPET_BEFORE = 36;
const SNIPPET_AFTER = 84;
const MAX_HITS = 50;

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** null clears the custom title. */
export function normalizeTitle(raw: string): string | null {
  const title = collapse(raw).slice(0, MAX_TITLE_CHARS).trim();
  return title === "" ? null : title;
}

const proseText = (prose: Prose | null): string =>
  (prose ?? [])
    .map((span) => (span.kind === "text" ? span.text : ""))
    .join("")
    .replace(/\s+([.,;:!?])/g, "$1");

/** Every piece of an answer a person could remember a word from. Arabic is left out: a Latin keyboard cannot find it. */
export function answerTexts(answer: Answer): string[] {
  const pieces: (string | null)[] = [
    answer.headline,
    answer.headlineShort,
    proseText(answer.summary),
    proseText(answer.inferenceNote),
    ...answer.notes.flatMap((note) => ("withheld" in note ? [] : [note.title, note.text, note.quote?.text ?? null])),
    ...answer.dalil.flatMap((dalil) => [dalil.reference, dalil.translation, dalil.explanation]),
    answer.message,
    answer.clarifyingQuestion,
    ...answer.clarifyingOptions,
  ];
  return pieces.flatMap((piece) => (piece === null || piece.trim() === "" ? [] : [collapse(piece)]));
}

/** `generated` marks a title the engine wrote (D36). It shows as the title, but it is not a rename. */
export function summaryOf(id: ConversationId, turns: readonly StoredTurn[], renamedTo: string | null, generated = false): ConversationSummary | null {
  const first = turns[0];
  const last = turns.at(-1);
  if (first === undefined || last === undefined) return null;
  const { answer } = last;
  return {
    id,
    title: renamedTo ?? collapse(first.question),
    renamed: renamedTo !== null && !generated,
    turns: turns.length,
    startedAt: first.at,
    updatedAt: last.at,
    gist: answer.headlineShort ?? answer.headline ?? answer.message ?? answer.clarifyingQuestion,
    sources: citedOf(answer).length,
  };
}

export function termsOf(query: string): string[] {
  const words = collapse(query).toLowerCase().split(" ").filter((word) => word !== "");
  return [...new Set(words)].slice(0, MAX_TERMS);
}

/** Case-insensitive positions of a term. Falls back to the text as written if lowercasing changed its length. */
function positions(text: string, term: string): number[] {
  const lower = text.toLowerCase();
  const haystack = lower.length === text.length ? lower : text;
  const found: number[] = [];
  for (let at = haystack.indexOf(term); at !== -1; at = haystack.indexOf(term, at + term.length)) found.push(at);
  return found;
}

const holds = (blocks: readonly string[], term: string): boolean => blocks.some((block) => positions(block, term).length > 0);
const holdsAll = (blocks: readonly string[], terms: readonly string[]): boolean => terms.every((term) => holds(blocks, term));

function marksIn(text: string, terms: readonly string[]): [number, number][] {
  const ranges = terms.flatMap((term) => positions(text, term).map((at): [number, number] => [at, at + term.length])).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** A window of `block` around its first match, trimmed to word edges and marked with an ellipsis where it was cut. */
export function snippetOf(block: string, terms: readonly string[]): Snippet {
  const first = marksIn(block, terms)[0]?.[0] ?? 0;
  let start = Math.max(0, first - SNIPPET_BEFORE);
  let end = Math.min(block.length, first + SNIPPET_AFTER);
  if (start > 0) {
    const space = block.indexOf(" ", start);
    if (space !== -1 && space < first) start = space + 1;
  }
  if (end < block.length) {
    const space = block.lastIndexOf(" ", end);
    if (space > first) end = space;
  }
  const body = block.slice(start, end);
  const lead = start > 0 ? "…" : "";
  const text = `${lead}${body}${end < block.length ? "…" : ""}`;
  return { text, marks: marksIn(body, terms).map(([from, to]) => [from + lead.length, to + lead.length] as const) };
}

type Stored = { readonly summary: ConversationSummary; readonly turns: readonly StoredTurn[] };

function hitOf({ summary, turns }: Stored, terms: readonly string[]): ConversationHit | null {
  const questions = [summary.title, ...turns.map((turn) => turn.question)];
  const answers = turns.flatMap((turn) => answerTexts(turn.answer).map((text) => ({ turn: turn.n, text })));
  if (!holdsAll([...questions, ...answers.map((piece) => piece.text)], terms)) return null;
  if (holdsAll(questions, terms)) {
    if (holdsAll([summary.title], terms)) return { conversation: summary, where: "question", turn: 1, snippet: null };
    const turn = turns.find((entry) => holds([entry.question], terms[0] ?? ""));
    return { conversation: summary, where: "question", turn: turn?.n ?? 1, snippet: turn === undefined ? null : snippetOf(collapse(turn.question), terms) };
  }
  const piece = answers.find((entry) => terms.some((term) => holds([entry.text], term)));
  return { conversation: summary, where: "answer", turn: piece?.turn ?? 1, snippet: piece === undefined ? null : snippetOf(piece.text, terms) };
}

/** Every term must appear somewhere in the conversation. Newest first. */
export function searchOf(stored: readonly Stored[], query: string): SearchResult {
  const terms = termsOf(query);
  if (terms.length === 0) return { terms, hits: [] };
  const hits = stored.flatMap((entry) => hitOf(entry, terms) ?? []);
  hits.sort((a, b) => b.conversation.updatedAt.localeCompare(a.conversation.updatedAt));
  return { terms, hits: hits.slice(0, MAX_HITS) };
}

/** The panel a stored turn had: its ledger in order, with "Juga dikutip di pertanyaan N" from the earlier turns' citations. */
export function openedOf(summary: ConversationSummary, turns: readonly StoredTurn[], passages: ReadonlyMap<PassageId, Passage>): OpenedConversation {
  const citedBefore = new Map<PassageId, number>();
  const opened = turns.map((turn): OpenedTurn => {
    const sources = turn.context.flatMap((id, index): SourceCard[] => {
      const passage = passages.get(id);
      return passage === undefined ? [] : [{ n: index + 1, passage, origin: "retrieval", priorTurn: citedBefore.get(id) ?? null }];
    });
    for (const id of citedOf(turn.answer)) if (!citedBefore.has(id)) citedBefore.set(id, turn.n);
    return { id: turn.id, n: turn.n, at: turn.at, question: turn.question, scope: turn.scope, answer: turn.answer, sources };
  });
  return { summary, turns: opened };
}
