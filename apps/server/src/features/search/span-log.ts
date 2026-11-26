import type { NoteId } from "../corpus/index.ts";
import type { DecisionSpan, ChunkedBody } from "./chunk.ts";
import type { Boundary } from "./decision-spans.ts";
import { passageId, type PassageId } from "./types.ts";

export type NoteDecisions = { noteId: NoteId; decisions: ChunkedBody["decisions"] };

export type SpanLog = {
  chunkerVersion: number;
  lines: string;
  spans: (DecisionSpan & { noteId: NoteId; passageIds: PassageId[] })[];
  withoutSpan: { noteId: NoteId; heading: string; line: number; reason: string }[];
  unscopedMarkers: { noteId: NoteId; line: number; text: string; nearestHeading: string | null }[];
};

const SPAN_END: Record<DecisionSpan["endedBy"], string> = {
  section: "the next section began",
  heading: "a heading-like line",
  closing: "a closing line",
  end: "the end of the book",
  "word cap": "the word cap: the book ended with no boundary, so the end is ambiguous",
};

const NO_MARKER: Record<Boundary, string> = {
  section: "no Memutuskan or Menetapkan line before the next section began",
  heading: "no Memutuskan or Menetapkan line before the next heading-like line",
  closing: "no Memutuskan or Menetapkan line before a closing line",
  end: "no Memutuskan or Menetapkan line before the end of the book",
};

export function spanLog(notes: readonly NoteDecisions[], chunkerVersion: number): SpanLog {
  return {
    chunkerVersion,
    lines: "counted in the note body, from 1 at its first non-blank line after the title heading",
    spans: notes.flatMap(({ noteId, decisions }) =>
      decisions.spans.map((span) => ({ noteId, ...span, passageIds: span.chunkOrdinals.map((ordinal) => passageId(noteId, ordinal)) })),
    ),
    withoutSpan: notes.flatMap(({ noteId, decisions }) =>
      decisions.withoutSpan.map((entry) => ({ noteId, heading: entry.heading, line: entry.line, reason: NO_MARKER[entry.endedBy] })),
    ),
    unscopedMarkers: notes.flatMap(({ noteId, decisions }) => decisions.unscopedMarkers.map((marker) => ({ noteId, ...marker }))),
  };
}

export function spanLogMarkdown(log: SpanLog): string {
  const out = [
    "# Fikih Muhammadiyah putusan spans",
    "",
    `Auto-labelled by chunker v${log.chunkerVersion}. Only the text from a Memutuskan or Menetapkan line after a KEPUTUSAN heading is putusan. Line numbers: ${log.lines}.`,
    "",
    `${log.spans.length} spans, ${log.withoutSpan.length} KEPUTUSAN headings without one, ${log.unscopedMarkers.length} marker lines outside a KEPUTUSAN heading.`,
    "",
    "## Spans",
  ];
  for (const span of log.spans) {
    out.push(
      "",
      `### ${span.noteId}`,
      "",
      `- Heading: ${span.heading} (line ${span.headingLine})`,
      `- Marker: ${span.marker} (line ${span.startLine})`,
      `- Lines ${span.startLine} to ${span.endLine}, ${span.words} words, ended by ${SPAN_END[span.endedBy]}`,
      `- Passages: ${span.passageIds.join(", ")}`,
      `- Starts: ${span.opening}`,
      `- Ends: ${span.closing}`,
    );
  }
  out.push("", "## KEPUTUSAN headings without a span", "");
  for (const entry of log.withoutSpan) out.push(`- ${entry.noteId}, line ${entry.line}: ${entry.heading}. ${entry.reason}.`);
  out.push("", "## Marker lines outside a KEPUTUSAN heading", "", "Not putusan. Listed so a missed decision is easy to spot.", "");
  for (const marker of log.unscopedMarkers) out.push(`- ${marker.noteId}, line ${marker.line}: ${marker.text}. After: ${marker.nearestHeading ?? "no heading"}.`);
  return `${out.join("\n")}\n`;
}
