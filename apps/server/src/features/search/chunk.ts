import { renderWikilinks, type NoteId } from "../corpus/index.ts";
import { findDecisionSpans, type DecisionScan, type LineKind, type SpanLine, type SpanRange } from "./decision-spans.ts";
import { fold, tokens } from "./fold.ts";

/** Bump on any change that can move passage boundaries. Ordinals, and so passage ids, shift with it. */
export const CHUNKER_VERSION = 3;

/** Words alone do not bound the embedder's input: Arabic costs several tokens a word. `TokenBudget` is the binding cap there. */
export const CHUNK_WORDS = { min: 120, max: 300 } as const;

/** The embedder's limit for one passage, so a chunk is never truncated when it is embedded. */
export type TokenBudget = {
  /** The most tokens the embedder reads from one input. */
  max: number;
  /** Tokens of an input's title and section label, before any text. */
  overhead(section: string | null): number;
  /** Tokens a piece of text adds to an input. Whitespace-separated pieces add up, so a chunk costs its overhead plus its pieces. */
  tokens(text: string): number;
};

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
  /** Index into `ChunkedBody.decisions.spans` when the chunk is decision text, else null. A chunk never mixes the two. */
  span: number | null;
};

/** A decision span as the passages cut it: the line range from the detector, plus what the spot-check log shows. */
export type DecisionSpan = SpanRange & {
  words: number;
  opening: string;
  closing: string;
  /** Ordinals of the chunks cut from the span. */
  chunkOrdinals: number[];
};

export type ChunkedBody = {
  chunks: Chunk[];
  /** Table-of-contents titles that no body heading matched. Their sections are merged into the one before. */
  unmatchedTocTitles: string[];
  decisions: Omit<DecisionScan, "spans"> & { spans: DecisionSpan[] };
};

export type ChunkOptions = {
  /** Compiled books only: find the decision spans (`decision-spans.ts`). Other notes have none. */
  decisionSpans?: boolean;
};

type Line = { text: string; links: NoteId[]; /** From 1, in the note body. */ no: number };

type Paragraph = {
  text: string;
  links: NoteId[];
  words: number;
  isHeading: boolean;
  sub: string | null;
  page: number | null;
  span: number | null;
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
  return body.split("\n").map((raw, index) => {
    const { text, targets } = renderWikilinks(cleanMarkdown(raw));
    return { text, links: targets, no: index + 1 };
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

function paragraphOf(lines: readonly Line[], context: Pick<Paragraph, "sub" | "page" | "span">): Paragraph {
  const text = lines.map((line) => line.text).join(" ");
  return { text, links: lines.flatMap((line) => line.links), words: countWords(text), isHeading: false, ...context };
}

function matchTocTitle(titles: ReadonlySet<string>, line: Line, next: Line | undefined): { text: string; lines: number } | null {
  if (titles.has(normalizeTitle(line.text))) return { text: line.text, lines: 1 };
  if (!next || next.text === "") return null;
  const wrapped = `${line.text} ${next.text}`;
  return titles.has(normalizeTitle(wrapped)) ? { text: wrapped, lines: 2 } : null;
}

type Item = { line: Line; kind: LineKind | "blank"; /** The table-of-contents title, the heading without its markdown marker, or the line. */ text: string; markdown: boolean };

function classify(rest: readonly Line[], titles: ReadonlySet<string>): { items: Item[]; matchedTitles: Set<string> } {
  const items: Item[] = [];
  const matchedTitles = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const line = rest[index] as Line;
    if (line.text === "") {
      items.push({ line, kind: "blank", text: "", markdown: false });
      continue;
    }
    const toc = matchTocTitle(titles, line, rest[index + 1]);
    if (toc) {
      matchedTitles.add(normalizeTitle(toc.text));
      items.push({ line, kind: "section", text: toc.text, markdown: false });
      index += toc.lines - 1;
      continue;
    }
    const markdownHeading = MARKDOWN_HEADING.exec(line.text);
    if (markdownHeading || isPseudoHeading(line.text)) items.push({ line, kind: "heading", text: markdownHeading ? (markdownHeading[1] as string) : line.text, markdown: markdownHeading !== null });
    else items.push({ line, kind: "text", text: line.text, markdown: false });
  }
  return { items, matchedTitles };
}

function spanLine(line: Line, kind: LineKind, text: string): SpanLine {
  const shown = kind === "text" ? text : cleanHeading(text);
  return { kind, text: shown, no: line.no, words: countWords(shown) };
}

function toSections(lines: Line[], decisionSpans: boolean): { sections: Section[]; unmatchedTocTitles: string[]; scan: DecisionScan } {
  const { titles, rest } = extractToc(lines);
  const { items, matchedTitles } = classify(rest, titles);
  const scan = decisionSpans
    ? findDecisionSpans(items.flatMap(({ line, kind, text }) => (kind === "blank" ? [] : [spanLine(line, kind, text)])))
    : { spans: [], withoutSpan: [], unscopedMarkers: [] };
  const spanOfLine = new Map<number, number>();
  scan.spans.forEach((span, index) => {
    for (let no = span.startLine; no <= span.endLine; no += 1) spanOfLine.set(no, index);
  });

  const sections: Section[] = [{ top: null, paragraphs: [] }];
  let buffer: Line[] = [];
  let sub: string | null = null;
  let page: number | null = null;
  let currentTop: string | null = null;
  let currentSpan: number | null = null;
  let wrapsHeading = false;

  const current = () => sections[sections.length - 1] as Section;
  const flush = () => {
    if (buffer.length > 0) current().paragraphs.push(paragraphOf(buffer, { sub, page, span: currentSpan }));
    buffer = [];
  };
  const pushHeading = (text: string, links: NoteId[]) => {
    const heading = cleanHeading(text);
    current().paragraphs.push({ text: heading, links, words: countWords(heading), isHeading: true, sub, page, span: currentSpan });
  };
  const headingPage = (text: string) => {
    const match = PAGE_PARENTHESIS.exec(text);
    return match ? Number(match[1]) : null;
  };

  for (const item of items) {
    const { line } = item;
    if (item.kind === "blank") {
      flush();
      continue;
    }
    const span = spanOfLine.get(line.no) ?? null;
    if (span !== currentSpan) {
      flush();
      wrapsHeading = false;
      currentSpan = span;
    }
    if (item.kind === "section") {
      flush();
      wrapsHeading = false;
      const title = cleanHeading(item.text);
      if (normalizeTitle(title) !== normalizeTitle(currentTop ?? "")) {
        currentTop = title;
        sub = null;
        page = headingPage(item.text);
        sections.push({ top: title, paragraphs: [] });
        pushHeading(title, line.links);
      }
      continue;
    }
    if (item.kind === "heading") {
      flush();
      if (!item.markdown && wrapsHeading) {
        const heading = current().paragraphs.pop() as Paragraph;
        sub = cleanHeading(`${heading.text} ${item.text}`);
        pushHeading(sub, [...heading.links, ...line.links]);
      } else if (normalizeTitle(item.text) !== normalizeTitle(sub ?? "")) {
        sub = cleanHeading(item.text);
        page = headingPage(item.text);
        pushHeading(item.text, line.links);
        wrapsHeading = !item.markdown;
      }
      continue;
    }
    wrapsHeading = false;
    if (LIST_ITEM.test(line.text)) flush();
    buffer.push(line);
  }
  flush();
  return { sections: mergeHeadingOnlySections(sections), unmatchedTocTitles: [...titles].filter((title) => !matchedTitles.has(title)), scan };
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

/** What one unit may cost: a unit is at most half a chunk, so packing fills a chunk to within half a unit of its cap. */
type Cap = { words: number; tokens: number };

type Unit = Paragraph & { tokens: number };

const SENTENCE_BREAK = /(?<=[.!?؟])\s+/;
const SPLIT_LEVELS: readonly ((text: string) => string[])[] = [
  (text) => text.split(SENTENCE_BREAK),
  (text) => text.split(/\s+/).filter(Boolean),
];

/** Consecutive parts into pieces under the cap. A part over the cap on its own goes to `splitPart`. */
function packParts(parts: readonly string[], cap: Cap, budget: TokenBudget, splitPart: (part: string) => string[]): string[] {
  const pieces: string[] = [];
  let piece: string[] = [];
  let words = 0;
  let tokens = 0;
  const emit = () => {
    if (piece.length > 0) pieces.push(piece.join(" "));
    piece = [];
    words = 0;
    tokens = 0;
  };
  for (const part of parts) {
    const partWords = countWords(part);
    const partTokens = budget.tokens(part);
    if (partWords > cap.words || partTokens > cap.tokens) {
      emit();
      pieces.push(...splitPart(part));
      continue;
    }
    if (words + partWords > cap.words || tokens + partTokens > cap.tokens) emit();
    piece.push(part);
    words += partWords;
    tokens += partTokens;
  }
  emit();
  return pieces;
}

/** Only for a single word that is over the cap alone. Counts do not add up inside a word, so this measures each prefix. */
function splitCharacters(word: string, cap: Cap, budget: TokenBudget): string[] {
  const characters = Array.from(word);
  const pieces: string[] = [];
  for (let start = 0; start < characters.length; ) {
    let good = 0;
    let bad = characters.length - start + 1;
    while (bad - good > 1) {
      const middle = Math.floor((good + bad) / 2);
      if (budget.tokens(characters.slice(start, start + middle).join("")) <= cap.tokens) good = middle;
      else bad = middle;
    }
    if (good === 0) throw new Error("a single character does not fit the token budget");
    pieces.push(characters.slice(start, start + good).join(""));
    start += good;
  }
  return pieces;
}

/** Sentences first, then words, then characters, so text is cut at the coarsest boundary that fits. */
function splitToFit(text: string, cap: Cap, budget: TokenBudget, level = 0): string[] {
  if (countWords(text) <= cap.words && budget.tokens(text) <= cap.tokens) return [text];
  const split = SPLIT_LEVELS[level];
  if (!split) return splitCharacters(text, cap, budget);
  const parts = split(text);
  if (parts.length === 1) return splitToFit(text, cap, budget, level + 1);
  return packParts(parts, cap, budget, (part) => splitToFit(part, cap, budget, level + 1));
}

function toUnits(paragraph: Paragraph, label: string | null, budget: TokenBudget, overheadOf: (label: string | null) => number): Unit[] {
  const cap = { words: CHUNK_WORDS.max / 2, tokens: Math.floor((budget.max - overheadOf(label)) / 2) };
  return splitToFit(paragraph.text, cap, budget).map((text) => {
    const unit = text === paragraph.text ? paragraph : { ...paragraph, text, words: countWords(text) };
    return { ...unit, tokens: budget.tokens(text) };
  });
}

const sumWords = (paragraphs: readonly Paragraph[]) => paragraphs.reduce((total, paragraph) => total + paragraph.words, 0);

const textOf = (paragraphs: readonly Paragraph[]) => paragraphs.map((paragraph) => paragraph.text).join("\n");

/** Greedy packing. A heading never ends a chunk: it moves to the start of the next one. */
function pack(units: readonly Unit[], fits: (units: readonly Unit[]) => boolean): Unit[][] {
  const chunks: Unit[][] = [];
  let current: Unit[] = [];
  for (const unit of units) {
    while (current.length > 0 && !fits([...current, unit])) {
      let keep = current.length;
      while (keep > 1 && (current[keep - 1] as Unit).isHeading) keep -= 1;
      chunks.push(current.slice(0, keep));
      current = current.slice(keep);
    }
    current.push(unit);
  }
  if (current.length > 0) chunks.push(current);

  const last = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  if (last && previous && sumWords(last) < CHUNK_WORDS.min / 2 && fits([...previous, ...last])) {
    chunks.splice(chunks.length - 2, 2, [...previous, ...last]);
  }
  return chunks;
}

/** Consecutive paragraphs of one kind, so a chunk never spans decision text and the explanation around it. */
function runsBySpan(paragraphs: readonly Paragraph[]): { span: number | null; paragraphs: Paragraph[] }[] {
  const runs: { span: number | null; paragraphs: Paragraph[] }[] = [];
  for (const paragraph of paragraphs) {
    const last = runs[runs.length - 1];
    if (last && last.span === paragraph.span) last.paragraphs.push(paragraph);
    else runs.push({ span: paragraph.span, paragraphs: [paragraph] });
  }
  return runs;
}

const SPOT_CHECK_WORDS = 25;

function withPassages(range: SpanRange, index: number, chunks: readonly Chunk[]): DecisionSpan {
  const own = chunks.filter((chunk) => chunk.span === index);
  const words = own.flatMap((chunk) => chunk.text.split(/\s+/).filter(Boolean));
  return {
    ...range,
    words: words.length,
    opening: words.slice(0, SPOT_CHECK_WORDS).join(" "),
    closing: words.slice(-SPOT_CHECK_WORDS).join(" "),
    chunkOrdinals: own.map((chunk) => chunk.ordinal),
  };
}

/**
 * Body to passages. Line-based, because most putusan are PDF text with hard line breaks and almost no markdown
 * headings. Headings come from the table of contents, markdown, KITAB/BAB/PASAL lines and short all-caps lines.
 * Only table-of-contents titles start a new section, so a chunk never spans two sections of a compiled book.
 * A chunk holds at most `CHUNK_WORDS.max` words and fills at most `budget.max` tokens of the embedder's input.
 */
export function chunkBody(body: string, budget: TokenBudget, options: ChunkOptions = {}): ChunkedBody {
  const chunks: Chunk[] = [];
  const { sections, unmatchedTocTitles, scan } = toSections(toLines(body), options.decisionSpans ?? false);
  const overheads = new Map<string | null, number>();
  const overheadOf = (label: string | null) => {
    if (!overheads.has(label)) overheads.set(label, budget.overhead(label));
    return overheads.get(label) as number;
  };
  for (const section of sections) {
    const labelOf = (paragraph: Paragraph) => sectionLabel({ top: section.top, sub: paragraph.sub });
    for (const run of runsBySpan(section.paragraphs)) {
      const units = run.paragraphs.flatMap((paragraph) => toUnits(paragraph, labelOf(paragraph), budget, overheadOf));
      const fits = (candidate: readonly Unit[]) =>
        sumWords(candidate) <= CHUNK_WORDS.max &&
        overheadOf(labelOf(candidate[0] as Unit)) + candidate.reduce((total, unit) => total + unit.tokens, 0) <= budget.max;
      for (const paragraphs of pack(units, fits)) {
        const first = paragraphs[0] as Paragraph;
        const text = textOf(paragraphs);
        chunks.push({
          ordinal: chunks.length + 1,
          top: section.top,
          sub: first.sub,
          page: first.page,
          text,
          wordCount: countWords(text),
          links: [...new Set(paragraphs.flatMap((paragraph) => paragraph.links))],
          span: run.span,
        });
      }
    }
  }
  return { chunks, unmatchedTocTitles, decisions: { ...scan, spans: scan.spans.map((range, index) => withPassages(range, index, chunks)) } };
}

export function sectionLabel(chunk: Pick<Chunk, "top" | "sub">): string | null {
  const sub = chunk.sub !== null && normalizeTitle(chunk.sub) !== normalizeTitle(chunk.top ?? "") ? chunk.sub : null;
  const parts = [chunk.top, sub].filter((part): part is string => part !== null && part !== "");
  return parts.length > 0 ? parts.join(" › ") : null;
}
