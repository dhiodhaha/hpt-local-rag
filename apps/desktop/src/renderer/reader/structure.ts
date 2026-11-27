import { isArabicBlock, piecesBetween, type Piece, type Span } from "./model.ts";

/**
 * How a passage's plain text is laid out as a book page. The corpus has no markup, only conventions: a Tanya Jawab page writes
 * "5. Title Tanya: … (asker, place) Jawab: …" on one line, a hadith has its Arabic on a line of its own followed by "Artinya:".
 * This reads those conventions per passage and nothing else. It only ever cuts the text at an edge and labels the parts: no
 * character is dropped or moved, so whatever it does not recognise stays a plain paragraph in its own place.
 */
export type Kind =
  /** Anything unrecognised. */
  | "plain"
  /** "5. Shalat Qabliyyah Jumat", the number and title that come before "Tanya:" on the same line. */
  | "title"
  | "question"
  /** "(Nur Hidayah, Kab. Banyumas)", the asker, at the end of the question. */
  | "signature"
  | "answer"
  /** "1. …", a numbered point. */
  | "point"
  /** "a. …", a lettered item. */
  | "item"
  /** A line that is mostly Arabic. */
  | "matn"
  /** "Artinya: …". */
  | "translation"
  /** "(HR. …)" at the end of a translation. */
  | "narrator";

export type Segment = {
  readonly kind: Kind;
  /** Offsets into the passage text, with the whitespace around the part left out. */
  readonly start: number;
  readonly end: number;
  /** How many characters from `start` are the run-in head: "Tanya:", "Jawab:", "Artinya:", "3.", "a.". */
  readonly head: number;
  /** An item under a numbered point sits one step deeper: 2. Everything else is 1. */
  readonly depth: 1 | 2;
  /** The part ends with "Hadis riwayat …:" and the Arabic or the translation follows. */
  readonly leadIn: boolean;
};

const NUMBERED_QUESTION = /^(\d+)\.\s+(.{1,120}?)\s+(Tanya\s*:)/;
const QUESTION_HEAD = /^Tanya\s*:/;
const ANSWER_HEAD = /^Jawab\s*:/;
const ANSWER_HEAD_ANYWHERE = /(?<![\p{L}\p{N}])Jawab\s*:/u;
const TRANSLATION_HEAD = /^Artinya\s*:/;
const TRANSLATION_HEAD_ANYWHERE = /(?<![\p{L}\p{N}])Artinya\s*:/gu;
const POINT = /^(\d{1,2})\.\s/;
const ITEM = /^[a-z]\.\s/;
/** The last bracket of the question, when nothing but punctuation follows it. */
const SIGNATURE_TAIL = /\(([^()]*)\)[\s.,;:]*$/;
const SIGNATURE_CONTENT = /,|Kab\.|Kota|\d/;
const NARRATOR_TAIL = /[([]\s*(?:HR|H\.R)\b[^()[\]]*[)\]][\s.]*$/;
const LEAD_IN = /Hadi(?:s|ts)\s+riwayat\b[^]*:\s*$/i;

type Reading = { asking: boolean; underPoint: boolean };
type Cut = { readonly at: number; readonly kind: Kind; readonly head: number };

const segment = (kind: Kind, start: number, end: number, head = 0, depth: 1 | 2 = 1): Segment => ({ kind, start, end, head, depth, leadIn: false });

/** `[from, to)` with the whitespace at both ends left out, or null when nothing is left. */
function trimmed(text: string, from: number, to: number): { start: number; end: number } | null {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start] as string)) start += 1;
  while (end > start && /\s/.test(text[end - 1] as string)) end -= 1;
  return start < end ? { start, end } : null;
}

/** What one line is made of, cut where a new part begins: "Tanya:" after a title, "Jawab:" in the middle of a line, "Artinya:". */
function readLine(text: string, from: number, to: number, reading: Reading, previous: Kind | null): Segment[] {
  const line = text.slice(from, to);
  if (isArabicBlock(line)) return [segment("matn", from, to)];

  let kind: Kind = "plain";
  let head = 0;
  let depth: 1 | 2 = 1;
  const cuts: Cut[] = [];
  const askingAtStart = reading.asking;
  let match: RegExpExecArray | null;
  if ((match = NUMBERED_QUESTION.exec(line)) !== null) {
    kind = "title";
    head = (match[1] as string).length + 1;
    const tanya = match[3] as string;
    cuts.push({ at: from + match[0].length - tanya.length, kind: "question", head: tanya.length });
    reading.asking = true;
    reading.underPoint = false;
  } else if ((match = QUESTION_HEAD.exec(line)) !== null) {
    kind = "question";
    head = match[0].length;
    reading.asking = true;
    reading.underPoint = false;
  } else if ((match = ANSWER_HEAD.exec(line)) !== null) {
    kind = "answer";
    head = match[0].length;
    reading.asking = false;
    reading.underPoint = false;
  } else if ((match = POINT.exec(line)) !== null) {
    kind = "point";
    head = (match[1] as string).length + 1;
    reading.underPoint = true;
  } else if (ITEM.test(line)) {
    kind = "item";
    head = 2;
    depth = reading.underPoint ? 2 : 1;
  } else if ((match = TRANSLATION_HEAD.exec(line)) !== null) {
    kind = "translation";
    head = match[0].length;
  } else if (previous === "matn" && /^[“"]/.test(line)) {
    kind = "translation";
  }

  if (reading.asking && kind !== "answer") {
    const first = cuts[0];
    const after = first === undefined ? head : first.at - from + first.head;
    const jawab = ANSWER_HEAD_ANYWHERE.exec(line.slice(after));
    if (jawab !== null) {
      cuts.push({ at: from + after + jawab.index, kind: "answer", head: jawab[0].length });
      reading.asking = false;
      reading.underPoint = false;
    }
  }
  for (const found of line.matchAll(TRANSLATION_HEAD_ANYWHERE)) {
    if (found.index > 0 && found.index >= head) cuts.push({ at: from + found.index, kind: "translation", head: found[0].length });
  }
  cuts.sort((a, b) => a.at - b.at);

  const edges = [from, ...cuts.map((cut) => cut.at), to];
  const kinds: Kind[] = [kind, ...cuts.map((cut) => cut.kind)];
  const heads = [head, ...cuts.map((cut) => cut.head)];
  const parts: Segment[] = [];
  kinds.forEach((partKind, index) => {
    const range = trimmed(text, edges[index] as number, edges[index + 1] as number);
    if (range !== null) parts.push(segment(partKind, range.start, range.end, heads[index], partKind === "item" ? depth : 1));
  });

  return parts.flatMap((part, index) => {
    const inQuestion = part.kind === "question" || (index === 0 && askingAtStart);
    return signatureOf(text, part, inQuestion) ?? narratorOf(text, part) ?? [withLeadIn(text, part)];
  });
}

/** A question's last bracket with a comma, "Kab.", "Kota" or a digit in it is who asked. It is cut off as a line of its own. */
function signatureOf(text: string, part: Segment, inQuestion: boolean): Segment[] | null {
  if (!inQuestion || part.kind === "title" || part.kind === "answer" || part.kind === "translation" || part.kind === "narrator") return null;
  const found = SIGNATURE_TAIL.exec(text.slice(part.start + part.head, part.end));
  if (found === null || !SIGNATURE_CONTENT.test(found[1] as string)) return null;
  const at = part.start + part.head + found.index;
  const before = trimmed(text, part.start, at);
  const signature = segment("signature", at, part.end);
  if (before === null) return [signature];
  return [{ ...part, start: before.start, end: before.end }, signature];
}

/** "(HR. …)" at the end of a translation is the narrator, on a line of its own. */
function narratorOf(text: string, part: Segment): Segment[] | null {
  if (part.kind !== "translation") return null;
  const found = NARRATOR_TAIL.exec(text.slice(part.start + part.head, part.end));
  if (found === null) return null;
  const at = part.start + part.head + found.index;
  const before = trimmed(text, part.start, at);
  const narrator = segment("narrator", at, part.end);
  if (before === null) return [narrator];
  return [segment("translation", before.start, before.end, part.head), narrator];
}

function withLeadIn(text: string, part: Segment): Segment {
  const flagged = part.kind !== "matn" && part.kind !== "translation" && LEAD_IN.test(text.slice(part.start + part.head, part.end));
  return flagged ? { ...part, leadIn: true } : part;
}

/** A passage's text as parts in reading order. Each non-blank line gives one part or more, and the parts cover every character that is not whitespace. */
export function segmentsOf(text: string): Segment[] {
  const reading: Reading = { asking: false, underPoint: false };
  const out: Segment[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    const range = trimmed(text, lineStart, lineEnd);
    if (range !== null) {
      const parts = readLine(text, range.start, range.end, reading, out.at(-1)?.kind ?? null);
      out.push(...parts);
    }
    lineStart = lineEnd + 1;
  }
  return out;
}

/** A part of a passage ready to draw: its head and its words, each cut at the edges of the excerpts the answer quoted. */
export type Para = {
  readonly kind: Kind;
  readonly depth: 1 | 2;
  readonly leadIn: boolean;
  readonly head: readonly Piece[];
  readonly pieces: readonly Piece[];
};

export function structureOf(text: string, excerpts: readonly Span[]): Para[] {
  return segmentsOf(text).map((part) => ({
    kind: part.kind,
    depth: part.depth,
    leadIn: part.leadIn,
    head: part.head === 0 ? [] : piecesBetween(text, part.start, part.start + part.head, excerpts),
    pieces: piecesBetween(text, part.start + part.head, part.end, excerpts),
  }));
}
