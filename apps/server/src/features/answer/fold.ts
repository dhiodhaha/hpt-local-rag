import type { PassageId } from "../search/index.ts";
import type { Answer, AnswerEvent, FieldValues, ItemValues, Prose } from "./types.ts";

/**
 * Events are the truth and an Answer is their fold. The engine folds to get the stored answer, the terminal folds to redraw,
 * a web client folds to render, a test folds to assert. One reducer, so no consumer can disagree about what an event means.
 *
 *   field      sets the scalar. A headline starts verifying, and `settled` settles it
 *   item       appends to its list
 *   progress   replaces `summary` with the pending prose; the `summary` field event later replaces it with the final one
 *   restart    back to an empty answer: the quiet retry replaces what was shown
 *   sources, attempt, tool_call, finished: no effect on the Answer
 */
export function emptyAnswer(): Answer {
  return {
    type: null,
    basis: null,
    headline: null,
    headlineState: "pending",
    headlineShort: null,
    summary: null,
    inferenceNote: null,
    notes: [],
    dalil: [],
    quotes: [],
    unverifiedReferences: [],
    clarifyingQuestion: null,
    clarifyingOptions: [],
    message: null,
  };
}

const FIELD_KEY = {
  type: "type",
  basis: "basis",
  headline: "headline",
  headline_short: "headlineShort",
  summary: "summary",
  inference_note: "inferenceNote",
  clarifying_question: "clarifyingQuestion",
  message: "message",
} as const satisfies Record<keyof FieldValues, keyof Answer>;

const ITEM_KEY = {
  notes: "notes",
  dalil: "dalil",
  quotes: "quotes",
  unverified_references: "unverifiedReferences",
  clarifying_options: "clarifyingOptions",
} as const satisfies Record<keyof ItemValues, keyof Answer>;

export function foldAnswer(answer: Answer, event: AnswerEvent): Answer {
  switch (event.kind) {
    case "field": {
      const next = { ...answer, [FIELD_KEY[event.name]]: event.value };
      if (event.name !== "headline") return next;
      return { ...next, headlineState: event.value === null ? "settled" : "verifying" };
    }
    case "settled":
      return { ...answer, headlineState: "settled" };
    case "item": {
      const key = ITEM_KEY[event.name];
      return { ...answer, [key]: [...(answer[key] as readonly unknown[]), event.value] };
    }
    case "progress":
      return { ...answer, summary: event.prose };
    case "restart":
      return emptyAnswer();
    default:
      return answer;
  }
}

function citesOf(prose: Prose | null): PassageId[] {
  return (prose ?? []).flatMap((span) => (span.kind === "cite" ? (span.passages ?? []) : []));
}

/** Passages the answer cites, in first-cited order across summary, inference note, dalil, notes and quotes. A withheld exception cites nothing. */
export function citedOf(answer: Answer): PassageId[] {
  const all: PassageId[] = [
    ...citesOf(answer.summary),
    ...citesOf(answer.inferenceNote),
    ...answer.dalil.flatMap((dalil) => [...dalil.sources, ...(dalil.arabic ? [dalil.arabic.passage] : [])]),
    ...answer.notes.flatMap((note) => ("withheld" in note ? [] : [...note.sources, ...(note.quote ? [note.quote.passage] : [])])),
    ...answer.quotes.map((quote) => quote.passage),
  ];
  return [...new Set(all)];
}
