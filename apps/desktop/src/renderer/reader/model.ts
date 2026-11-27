import { type Answer, type NoteId, type Passage, type PassageId } from "@hpt/server/client";
import { ARABIC_CHAR, arabicRuns } from "../arabic.ts";
import { citedInReadingOrder, spansOf } from "../chat/cited.ts";
import { COPY } from "../chat/copy.ts";
import { SOURCE_TYPE_LABEL } from "../chat/view.ts";

/**
 * The reader's data shapes and every rule about them, as pure functions with no React. A note is a flat list of passages in reading
 * order. The index has no pasal or ayat, so the table of contents is derived: consecutive passages that share a top-level heading
 * (the first part of `section`, "Bab › Sub") are one bagian. A note with one bagian has no table of contents.
 */
export type Bagian = {
  /** 1-based, in reading order. */
  readonly n: number;
  /** The top-level heading, or null for passages before the first heading. */
  readonly title: string | null;
  readonly passages: readonly Passage[];
};

export type ReaderDocument = {
  readonly noteId: NoteId;
  readonly title: string;
  readonly kindLabel: string;
  /** "Nomor 04 · 2003", from the first passage's own metadata. Empty when the note has none. */
  readonly meta: string;
  readonly passages: readonly Passage[];
  readonly bagian: readonly Bagian[];
  /** Some passage of this note has been superseded: the note is shown as an archive. */
  readonly revised: boolean;
};

const HEADING_SEPARATOR = " › ";

export const topHeadingOf = (passage: Passage): string | null => passage.section?.split(HEADING_SEPARATOR)[0] ?? null;

export function bagianOf(passages: readonly Passage[]): Bagian[] {
  const groups: { title: string | null; passages: Passage[] }[] = [];
  for (const passage of passages) {
    const title = topHeadingOf(passage);
    const last = groups.at(-1);
    if (last !== undefined && last.title === title) last.passages.push(passage);
    else groups.push({ title, passages: [passage] });
  }
  return groups.map((group, index) => ({ n: index + 1, ...group }));
}

function metaOf(first: Passage): string {
  const number = first.number === null ? null : `Nomor ${first.number}`;
  return [number, first.publishedIn, first.year === null ? null : String(first.year)].filter((part): part is string => part !== null && part !== "").join(" · ");
}

export function documentOf(passages: readonly Passage[]): ReaderDocument {
  const [first] = passages;
  if (first === undefined) throw new Error("a document needs at least one passage");
  return {
    noteId: first.noteId,
    title: first.title,
    kindLabel: SOURCE_TYPE_LABEL[first.sourceType],
    meta: metaOf(first),
    passages,
    bagian: bagianOf(passages),
    revised: passages.some((passage) => passage.supersededBy !== null),
  };
}

/** A heading to draw before a passage: the bagian's title where it starts, a smaller one where the sub-heading changes inside it. */
export type Heading = { readonly level: 2 | 3; readonly text: string };

export function headingBefore(passage: Passage, previous: Passage | null): Heading | null {
  if (passage.section === null || passage.section === previous?.section) return null;
  const [top, ...rest] = passage.section.split(HEADING_SEPARATOR);
  if (previous === null || topHeadingOf(previous) !== top) return { level: 2, text: top ?? "" };
  return rest.length === 0 ? null : { level: 3, text: rest.join(HEADING_SEPARATOR) };
}

/** What the answer says about one passage: its number, as the answer's own marks number it, and the words it quotes. */
export type Annotation = { readonly number: number; readonly excerpts: readonly { readonly start: number; readonly end: number }[] };

/** Every passage the answer cites. Quotes, the quote of a note and the Arabic of a dalil are spans of a passage's canonical text. */
export function annotationsOf(answer: Answer): Map<PassageId, Annotation> {
  const spans = spansOf(answer);
  return new Map(
    citedInReadingOrder(answer).map((id, index) => [id, { number: index + 1, excerpts: spans.filter((span) => span.passage === id).map(({ start, end }) => ({ start, end })) }]),
  );
}

export type Cited = { readonly passage: Passage; readonly note: Annotation };

/** The cited passages of this document, in reading order. */
export const citedIn = (doc: ReaderDocument, annotations: ReadonlyMap<PassageId, Annotation>): Cited[] =>
  doc.passages.flatMap((passage) => {
    const note = annotations.get(passage.id);
    return note === undefined ? [] : [{ passage, note }];
  });

export type Piece = { readonly text: string; readonly quoted: boolean; readonly arabic: boolean };
export type Span = { readonly start: number; readonly end: number };

const LATIN_LETTER = /[A-Za-zÀ-ɏ]/g;

/** A line that is mostly Arabic letters is drawn as a block of its own, right to left. Any other line keeps its Arabic as runs. */
const ARABIC_BLOCK_SHARE = 0.6;

const countOf = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

export function isArabicBlock(line: string): boolean {
  const arabic = countOf(line, ARABIC_CHAR);
  const latin = countOf(line, LATIN_LETTER);
  return arabic > 0 && arabic / (arabic + latin) >= ARABIC_BLOCK_SHARE;
}

/**
 * The text between two offsets as pieces, cut at the edges of the excerpts that overlap it. The offsets are the engine's, taken on
 * the whole canonical string, so an excerpt is found by position and never by searching for the words.
 */
export function piecesBetween(text: string, from: number, to: number, excerpts: readonly Span[]): Piece[] {
  const cuts = [...new Set([from, to, ...excerpts.flatMap(({ start, end }) => [start, end]).filter((at) => at > from && at < to)])].sort((a, b) => a - b);
  return cuts.slice(0, -1).flatMap((start, index) => {
    const end = cuts[index + 1] ?? to;
    const quoted = excerpts.some((excerpt) => excerpt.start <= start && end <= excerpt.end);
    return arabicRuns(text.slice(start, end)).map((part) => ({ ...part, quoted }));
  });
}

/** Index of the last entry that is at or above `y`, or -1 when `y` is above them all. `tops` is ascending. */
export function lastAtOrAbove(tops: readonly number[], y: number): number {
  let low = 0;
  let high = tops.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((tops[middle] ?? Infinity) <= y) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/**
 * Where a passage is, in the words of the headings and the derived bagian number. A passage is a token-capped chunk, so it never
 * gets a number of its own: the source's pasal, ayat and paragraph numbers are not ours to show or to imitate. A note with one
 * bagian has nothing to number, so it shows the heading, or the note's title when it has none.
 */
export function whereOf(doc: ReaderDocument, passage: Passage): string {
  const heading = passage.section?.split(HEADING_SEPARATOR).at(-1) ?? null;
  if (doc.bagian.length === 1) return heading ?? doc.title;
  const n = doc.bagian.find((entry) => entry.passages.some((candidate) => candidate.id === passage.id))?.n ?? 1;
  return heading === null ? COPY.reader.bagianLabel(n) : `${COPY.reader.bagianLabel(n)} · ${heading}`;
}

export const bagianIndexOf = (doc: ReaderDocument, passage: PassageId): number => doc.bagian.findIndex((entry) => entry.passages.some((candidate) => candidate.id === passage));
