import { renderWikilinks, type NoteId } from "../corpus/index.ts";
import { fold, tokens } from "./fold.ts";

/** Bump on any change that can move passage boundaries. Ordinals, and so passage ids, shift with it. */
export const CHUNKER_VERSION = 1;

/** Passages stay under `max` so a 512-token embedder does not truncate them later. */
export const CHUNK_WORDS = { min: 120, max: 300 } as const;

export type Chunk = {
  /** From 1. */
  ordinal: number;
  /** Table-of-contents title of a compiled book's section. Null for notes without a table of contents. */
  top: string | null;
  sub: string | null;
  page: number | null;
  text: string;
  wordCount: number;
  links: NoteId[];
};

export type ChunkedBody = {
  chunks: Chunk[];
  /** Table-of-contents titles that no body heading matched. Their sections are merged into the one before. */
  unmatchedTocTitles: string[];
};

type Line = { text: string; links: NoteId[] };

type Paragraph = {
  text: string;
  links: NoteId[];
  words: number;
  isHeading: boolean;
  sub: string | null;
  page: number | null;
};

type Section = { top: string | null; paragraphs: Paragraph[] };

const PAGE_PARENTHESIS = /\(\s*(?:halaman|hal\.?|h\.?)\s*(\d+)\s*\)/i;
const TOC_LEADER = /\s*(\.{2,})\s*\d+\s*$/;
const LIST_ITEM = /^(?:[-*+•]|\d{1,3}[.)]|[A-Za-z][.)]|\([A-Za-z0-9]{1,3}\))\s+\S/;
const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/;
const KEYWORD_HEADING = /^(?:KITAB|BAB|PASAL)\s+\S/;
const MAX_HEADING_WORDS = 14;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function cleanHeading(text: string): string {
  return text.replace(PAGE_PARENTHESIS, "").replace(/\s+/g, " ").replace(/[\s.:]+$/, "").trim();
}

function normalizeTitle(text: string): string {
  return tokens(fold(text.replace(PAGE_PARENTHESIS, ""))).join(" ");
}

function cleanMarkdown(raw: string): string {
  return raw
    .replace(/^\s*>\s?/, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~=:])/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function toLines(body: string): Line[] {
  return body.split("\n").map((raw) => {
    const { text, targets } = renderWikilinks(cleanMarkdown(raw));
    return { text, links: targets };
  });
}

function upperShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  return letters.filter((letter) => /\p{Lu}/u.test(letter)).length / letters.length;
}

function isCapsHeading(text: string): boolean {
  const latinLetters = text.match(/[A-Za-z]/g) ?? [];
  const words = countWords(text);
  return latinLetters.length >= 4 && words <= MAX_HEADING_WORDS && text.length <= 140 && upperShare(text) >= 0.9;
}

function isPseudoHeading(text: string): boolean {
  if (countWords(text) > MAX_HEADING_WORDS) return false;
  return KEYWORD_HEADING.test(text) || isCapsHeading(text);
}

/**
 * Compiled books list their sections with dotted leaders and a page number ("AURAT LAKI-LAKI ....... 1"),
 * sometimes wrapping a long title onto the line before. The titles become the section boundaries and the
 * TOC lines leave the body, so a table of contents is never indexed.
 */
function extractToc(lines: Line[]): { titles: ReadonlySet<string>; rest: Line[] } {
  const isLeader = (index: number) => {
    const text = lines[index]?.text ?? "";
    const leader = TOC_LEADER.exec(text);
    if (!leader) return false;
    return (leader[1] as string).length >= 4 || upperShare(text.replace(TOC_LEADER, "")) >= 0.8;
  };
  const previousNonEmpty = (index: number) => {
    let cursor = index - 1;
    while (cursor >= 0 && lines[cursor]?.text === "") cursor -= 1;
    return cursor;
  };
  const titles = new Set<string>();
  const dropped = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    if (!isLeader(index)) continue;
    dropped.add(index);
    let title = (lines[index]?.text ?? "").replace(TOC_LEADER, "");
    const before = previousNonEmpty(index);
    const wrapsOntoThisLine =
      before >= 0 && !isLeader(before) && upperShare(lines[before]?.text ?? "") >= 0.8 && isLeader(previousNonEmpty(before));
    if (wrapsOntoThisLine) {
      title = `${lines[before]?.text ?? ""} ${title}`;
      dropped.add(before);
    }
    titles.add(normalizeTitle(title));
  }
  return { titles, rest: lines.filter((_line, index) => !dropped.has(index)) };
}

function paragraphOf(lines: readonly Line[], context: Pick<Paragraph, "sub" | "page">): Paragraph {
  const text = lines.map((line) => line.text).join(" ");
  return { text, links: lines.flatMap((line) => line.links), words: countWords(text), isHeading: false, ...context };
}

function matchTocTitle(titles: ReadonlySet<string>, line: Line, next: Line | undefined): { text: string; lines: number } | null {
  if (titles.has(normalizeTitle(line.text))) return { text: line.text, lines: 1 };
  if (!next || next.text === "") return null;
  const wrapped = `${line.text} ${next.text}`;
  return titles.has(normalizeTitle(wrapped)) ? { text: wrapped, lines: 2 } : null;
}

function toSections(lines: Line[]): { sections: Section[]; unmatchedTocTitles: string[] } {
  const { titles, rest } = extractToc(lines);
  const matchedTitles = new Set<string>();
  const sections: Section[] = [{ top: null, paragraphs: [] }];
  let buffer: Line[] = [];
  let sub: string | null = null;
  let page: number | null = null;
  let currentTop: string | null = null;
  let wrapsHeading = false;

  const current = () => sections[sections.length - 1] as Section;
  const flush = () => {
    if (buffer.length > 0) current().paragraphs.push(paragraphOf(buffer, { sub, page }));
    buffer = [];
  };
  const pushHeading = (text: string, links: NoteId[]) => {
    const heading = cleanHeading(text);
    current().paragraphs.push({ text: heading, links, words: countWords(heading), isHeading: true, sub, page });
  };
  const headingPage = (text: string) => {
    const match = PAGE_PARENTHESIS.exec(text);
    return match ? Number(match[1]) : null;
  };

  for (let index = 0; index < rest.length; index += 1) {
    const line = rest[index] as Line;
    if (line.text === "") {
      flush();
      continue;
    }
    const toc = matchTocTitle(titles, line, rest[index + 1]);
    if (toc) {
      flush();
      wrapsHeading = false;
      matchedTitles.add(normalizeTitle(toc.text));
      const title = cleanHeading(toc.text);
      if (normalizeTitle(title) !== normalizeTitle(currentTop ?? "")) {
        currentTop = title;
        sub = null;
        page = headingPage(toc.text);
        sections.push({ top: title, paragraphs: [] });
        pushHeading(title, line.links);
      }
      index += toc.lines - 1;
      continue;
    }
    const markdownHeading = MARKDOWN_HEADING.exec(line.text);
    if (markdownHeading || isPseudoHeading(line.text)) {
      flush();
      const text = markdownHeading ? (markdownHeading[1] as string) : line.text;
      if (!markdownHeading && wrapsHeading) {
        const heading = current().paragraphs.pop() as Paragraph;
        sub = cleanHeading(`${heading.text} ${text}`);
        pushHeading(sub, [...heading.links, ...line.links]);
      } else if (normalizeTitle(text) !== normalizeTitle(sub ?? "")) {
        sub = cleanHeading(text);
        page = headingPage(text);
        pushHeading(text, line.links);
        wrapsHeading = !markdownHeading;
      }
      continue;
    }
    wrapsHeading = false;
    if (LIST_ITEM.test(line.text)) flush();
    buffer.push(line);
  }
  flush();
  return { sections: mergeHeadingOnlySections(sections), unmatchedTocTitles: [...titles].filter((title) => !matchedTitles.has(title)) };
}

/** A section that is only a heading (a book's title line before its first real section) has nothing to cite. */
function mergeHeadingOnlySections(sections: Section[]): Section[] {
  const merged: Section[] = [];
  let carried: Paragraph[] = [];
  for (const section of sections) {
    const paragraphs = [...carried, ...section.paragraphs];
    if (paragraphs.length === 0) continue;
    if (paragraphs.every((paragraph) => paragraph.isHeading)) {
      carried = paragraphs;
    } else {
      merged.push({ top: section.top, paragraphs });
      carried = [];
    }
  }
  if (carried.length > 0) merged.push({ top: null, paragraphs: carried });
  return merged;
}

function splitLongParagraph(paragraph: Paragraph, maxWords: number): Paragraph[] {
  if (paragraph.words <= maxWords) return [paragraph];
  const pieces: string[] = [];
  let piece: string[] = [];
  let pieceWords = 0;
  const emit = () => {
    if (piece.length > 0) pieces.push(piece.join(" "));
    piece = [];
    pieceWords = 0;
  };
  for (const sentence of paragraph.text.split(/(?<=[.!?؟])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (pieceWords + words.length > maxWords) emit();
    if (words.length > maxWords) {
      for (let start = 0; start < words.length; start += maxWords) pieces.push(words.slice(start, start + maxWords).join(" "));
    } else {
      piece.push(sentence);
      pieceWords += words.length;
    }
  }
  emit();
  return pieces.map((text) => ({ ...paragraph, text, words: countWords(text) }));
}

function sumWords(paragraphs: readonly Paragraph[]): number {
  return paragraphs.reduce((total, paragraph) => total + paragraph.words, 0);
}

/** Greedy packing. A heading never ends a chunk: it moves to the start of the next one. */
function pack(units: readonly Paragraph[]): Paragraph[][] {
  const chunks: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let words = 0;
  for (const unit of units) {
    if (current.length > 0 && words + unit.words > CHUNK_WORDS.max) {
      let keep = current.length;
      while (keep > 1 && (current[keep - 1] as Paragraph).isHeading) keep -= 1;
      chunks.push(current.slice(0, keep));
      current = current.slice(keep);
      words = sumWords(current);
    }
    current.push(unit);
    words += unit.words;
  }
  if (current.length > 0) chunks.push(current);

  const last = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  if (last && previous && sumWords(last) < CHUNK_WORDS.min / 2 && sumWords(previous) + sumWords(last) <= CHUNK_WORDS.max) {
    chunks.splice(chunks.length - 2, 2, [...previous, ...last]);
  }
  return chunks;
}

/**
 * Body to passages. Line-based, because most putusan are PDF text with hard line breaks and almost no markdown
 * headings. Headings come from the table of contents, markdown, KITAB/BAB/PASAL lines and short all-caps lines.
 * Only table-of-contents titles start a new section, so a chunk never spans two sections of a compiled book.
 */
export function chunkBody(body: string): ChunkedBody {
  const chunks: Chunk[] = [];
  const { sections, unmatchedTocTitles } = toSections(toLines(body));
  for (const section of sections) {
    const units = section.paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, CHUNK_WORDS.max / 2));
    for (const paragraphs of pack(units)) {
      const first = paragraphs[0] as Paragraph;
      const text = paragraphs.map((paragraph) => paragraph.text).join("\n");
      chunks.push({
        ordinal: chunks.length + 1,
        top: section.top,
        sub: first.sub,
        page: first.page,
        text,
        wordCount: countWords(text),
        links: [...new Set(paragraphs.flatMap((paragraph) => paragraph.links))],
      });
    }
  }
  return { chunks, unmatchedTocTitles };
}

export function sectionLabel(chunk: Pick<Chunk, "top" | "sub">): string | null {
  const sub = chunk.sub !== null && normalizeTitle(chunk.sub) !== normalizeTitle(chunk.top ?? "") ? chunk.sub : null;
  const parts = [chunk.top, sub].filter((part): part is string => part !== null && part !== "");
  return parts.length > 0 ? parts.join(" › ") : null;
}
