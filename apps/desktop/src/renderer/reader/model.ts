import { citedOf, type Answer, type NoteId, type Passage, type PassageId } from "@hpt/server/client";
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
  const spans = [...answer.quotes, ...answer.notes.flatMap((note) => ("withheld" in note || note.quote === null ? [] : [note.quote])), ...answer.dalil.flatMap((dalil) => (dalil.arabic === null ? [] : [dalil.arabic]))];
  return new Map(
    citedOf(answer).map((id, index) => [id, { number: index + 1, excerpts: spans.filter((span) => span.passage === id).map(({ start, end }) => ({ start, end })) }]),
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
export type Block = { readonly kind: "text" | "arabic"; readonly pieces: readonly Piece[] };

const ARABIC_CHARS = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const ARABIC_RUN = new RegExp(`[${ARABIC_CHARS}]+(?:[\\s\\u060C\\u061B\\u061F]+[${ARABIC_CHARS}]+)*`, "gu");
const ARABIC_CHAR = new RegExp(`[${ARABIC_CHARS}]`, "gu");
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/g;

/** A line that is mostly Arabic letters is drawn as a block of its own, right to left. Any other line keeps its Arabic as runs. */
const ARABIC_BLOCK_SHARE = 0.6;

const countOf = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

function arabicRuns(text: string): { text: string; arabic: boolean }[] {
  const parts: { text: string; arabic: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(ARABIC_RUN)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index), arabic: false });
    parts.push({ text: match[0], arabic: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), arabic: false });
  return parts;
}

/**
 * A passage's text as blocks, one per non-empty line, each cut at the edges of the excerpts that overlap it. The offsets are the
 * engine's, taken on the whole canonical string, so a line's excerpts are found by position and never by searching for the words.
 */
export function blocksOf(text: string, excerpts: readonly { readonly start: number; readonly end: number }[]): Block[] {
  const blocks: Block[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    if (line.trim() !== "") {
      const cuts = [...new Set([lineStart, lineEnd, ...excerpts.flatMap(({ start, end }) => [start, end]).filter((at) => at > lineStart && at < lineEnd)])].sort((a, b) => a - b);
      const pieces = cuts.slice(0, -1).flatMap((from, index) => {
        const to = cuts[index + 1] ?? lineEnd;
        const quoted = excerpts.some(({ start, end }) => start <= from && to <= end);
        return arabicRuns(text.slice(from, to)).map((part) => ({ ...part, quoted }));
      });
      const arabic = countOf(line, ARABIC_CHAR);
      const latin = countOf(line, LATIN_LETTER);
      blocks.push({ kind: arabic > 0 && arabic / (arabic + latin) >= ARABIC_BLOCK_SHARE ? "arabic" : "text", pieces });
    }
    lineStart = lineEnd + 1;
  }
  return blocks;
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
