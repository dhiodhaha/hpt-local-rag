import { citedOf, type Answer, type PassageId, type Prose } from "@hpt/server/client";

const citesOf = (prose: Prose | null): PassageId[] => (prose ?? []).flatMap((span) => (span.kind === "cite" && span.passages !== null ? [...span.passages] : []));

/**
 * The passages the answer cites, numbered in the order a person reads them. The engine counts the summary before the inference
 * note, but the note is drawn right after the verdict and before the summary, so its marks come first here.
 */
export function citedInReadingOrder(answer: Answer): PassageId[] {
  return [...new Set([...citesOf(answer.inferenceNote), ...citedOf(answer)])];
}

/** Every span of a passage's canonical text the answer quotes: its quotes, the quote of a note and the Arabic of a dalil. */
export function spansOf(answer: Answer): Answer["quotes"][number][] {
  return [...answer.quotes, ...answer.notes.flatMap((note) => ("withheld" in note || note.quote === null ? [] : [note.quote])), ...answer.dalil.flatMap((dalil) => (dalil.arabic === null ? [] : [dalil.arabic]))];
}
