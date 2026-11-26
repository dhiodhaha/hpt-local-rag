import { fold } from "./fold.ts";

/**
 * D12: in a compiled book only the decision text itself is a putusan. It starts at a "Memutuskan" or "Menetapkan"
 * line that follows a KEPUTUSAN heading and ends at the next section boundary or heading-like line. Everything
 * else, the considerations and any KEPUTUSAN section without a marker included, is penjelasan.
 *
 * Every pattern runs against the folded line. A new book layout is a new row here, not a new branch below.
 */
type LineRule = { name: string; pattern: RegExp; maxWords?: number };

export const DECISION_MARKERS = {
  /** A heading that opens a decision. Without a later marker line it labels nothing. */
  heading: [{ name: "KEPUTUSAN heading", pattern: /^keputusan\b/ }],
  /** The line the decision text starts at. Inline prose ("Menetapkan awal bulan ...") is not one. */
  start: [
    { name: "marker alone", pattern: /^(?:(?:memutuskan|menetapkan)\s*){1,2}[;,.]?$/ },
    { name: "marker before a colon", pattern: /^(?:(?:memutuskan|menetapkan)\s*){1,2}:/ },
  ],
  /** Considerations before the marker. Set in capitals they look like headings, and must not end the scope. */
  preamble: [{ name: "consideration", pattern: /^(?:menimbang|mengingat|mendengar|memperhatikan|membaca)\b/ }],
  /** Lines that end a decision without being headings. The line itself is not part of it. */
  closing: [
    { name: "closing formula", pattern: /^demikian\b/ },
    { name: "dateline", pattern: /^\p{L}+,\s*\d{1,2}\s+\p{L}/u },
    { name: "signature block", pattern: /^pimpinan sidang\b/ },
    { name: "explanation label", pattern: /^penjelasan\b/, maxWords: 8 },
    { name: "annex label", pattern: /^lampiran\b/, maxWords: 8 },
    { name: "note label", pattern: /^catatan\b/, maxWords: 8 },
    { name: "evidence label", pattern: /^dalil\b/, maxWords: 8 },
  ],
} as const satisfies Record<string, readonly LineRule[]>;

/**
 * A span that reaches the end of the book with no boundary has an ambiguous end: the last section of a book runs to
 * the end of it. It keeps one passage's worth of words (the chunker's cap), and the rest stays penjelasan.
 */
export const AMBIGUOUS_END_WORDS = 300;

export type LineKind = "section" | "heading" | "text";

export type SpanLine = { kind: LineKind; text: string; /** From 1, in the note body. */ no: number; words: number };

export type Boundary = "section" | "heading" | "closing" | "end";

export type SpanRange = {
  heading: string;
  headingLine: number;
  marker: string;
  startLine: number;
  endLine: number;
  endedBy: Boundary | "word cap";
};

export type DecisionScan = {
  spans: SpanRange[];
  /** KEPUTUSAN headings that no marker line followed. */
  withoutSpan: { heading: string; line: number; endedBy: Boundary }[];
  /** Marker lines outside any KEPUTUSAN scope. They stay penjelasan. */
  unscopedMarkers: { line: number; text: string; nearestHeading: string | null }[];
};

type Scope = { heading: string; headingLine: number; bodySeen: boolean };

type OpenSpan = Scope & { marker: string; startLine: number; lines: { no: number; words: number }[] };

type State = { kind: "idle" } | ({ kind: "scoped" } & Scope) | ({ kind: "in span" } & OpenSpan);

const matches = (rules: readonly LineRule[], folded: string, words: number) =>
  rules.some((rule) => rule.pattern.test(folded) && (rule.maxWords === undefined || words <= rule.maxWords));

function rangeOf(open: OpenSpan, endedBy: SpanRange["endedBy"], lines = open.lines): SpanRange {
  const last = lines[lines.length - 1];
  return { heading: open.heading, headingLine: open.headingLine, marker: open.marker, startLine: open.startLine, endLine: last?.no ?? open.startLine, endedBy };
}

function rangeAtEndOfBook(open: OpenSpan): SpanRange {
  let words = 0;
  const kept = open.lines.filter((line, index) => {
    words += line.words;
    return index === 0 || words <= AMBIGUOUS_END_WORDS;
  });
  return rangeOf(open, kept.length < open.lines.length ? "word cap" : "end", kept);
}

/** One pass over the non-blank lines of a note. Line classification stays with the caller, so this is pure. */
export function findDecisionSpans(lines: readonly SpanLine[]): DecisionScan {
  const scan: DecisionScan = { spans: [], withoutSpan: [], unscopedMarkers: [] };
  let state = { kind: "idle" } as State;
  let nearestHeading: string | null = null;

  const endScope = (endedBy: Boundary) => {
    if (state.kind === "scoped") scan.withoutSpan.push({ heading: state.heading, line: state.headingLine, endedBy });
    state = { kind: "idle" };
  };
  const endSpan = (endedBy: Boundary) => {
    if (state.kind === "in span") scan.spans.push(rangeOf(state, endedBy));
    state = { kind: "idle" };
  };

  for (const line of lines) {
    const folded = fold(line.text).trim();
    const isStart = line.kind !== "section" && matches(DECISION_MARKERS.start, folded, line.words);
    const isPreamble = line.kind === "heading" && matches(DECISION_MARKERS.preamble, folded, line.words);
    const isBoundary = line.kind === "section" || (line.kind === "heading" && !isPreamble && !isStart);
    const isClosing = line.kind !== "section" && matches(DECISION_MARKERS.closing, folded, line.words);
    const isDecisionHeading = line.kind !== "text" && matches(DECISION_MARKERS.heading, folded, line.words);
    const boundary = line.kind === "section" ? "section" : "heading";

    if (state.kind === "in span") {
      if (isBoundary) endSpan(boundary);
      else if (isClosing) endSpan("closing");
      else {
        state.lines.push({ no: line.no, words: line.words });
        continue;
      }
    }

    if (isStart) {
      if (state.kind === "scoped") state = { ...state, kind: "in span", marker: line.text, startLine: line.no, lines: [{ no: line.no, words: line.words }] };
      else scan.unscopedMarkers.push({ line: line.no, text: line.text, nearestHeading });
    } else if (line.kind === "section") {
      endScope("section");
      nearestHeading = line.text;
      if (isDecisionHeading) state = { kind: "scoped", heading: line.text, headingLine: line.no, bodySeen: false };
    } else if (isClosing) {
      endScope("closing");
    } else if (line.kind === "heading" && !isPreamble) {
      nearestHeading = line.text;
      const continuesTitleBlock = state.kind === "scoped" && !state.bodySeen;
      if (isDecisionHeading && !continuesTitleBlock) {
        endScope("heading");
        state = { kind: "scoped", heading: line.text, headingLine: line.no, bodySeen: false };
      }
    } else if (state.kind === "scoped") {
      state = { ...state, bodySeen: true };
    }
  }

  if (state.kind === "in span") scan.spans.push(rangeAtEndOfBook(state));
  else endScope("end");
  return scan;
}
