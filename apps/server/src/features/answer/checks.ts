import { statusOf, type Passage } from "../search/index.ts";
import { citedOf } from "./fold.ts";
import type { SourceLedger } from "./ledger.ts";
import type { Finding, Site } from "./policy.ts";
import type { Answer, Dalil, Edit, Excerpt, Note, Prose } from "./types.ts";
import type { WireDalil, WireNote, WireQuote } from "./wire.ts";

/**
 * The checks of system-prompt-v2 Part 4 as pure functions from a parsed wire value and the ledger to
 * { value, findings, rewrites }. They decide nothing about consequences (policy.ts does) and never throw.
 *
 * Every check returns a CANDIDATE value with its success-path rewrites already applied (Arabic and quotes replaced by the
 * source's own text and span, a failed Arabic nulled, a failed quote removed) plus the findings that say what was wrong and,
 * for repairable ones, the edit that was applied. If policy says "repair" the candidate is used, and if it says anything
 * worse the candidate is discarded. One computation, no second pass to keep in sync.
 */
export type Checked<T> = {
  readonly value: T;
  readonly findings: readonly Finding[];
  /** The source's text was substituted for the model's (arabic_from_source, quote_from_source). Logged, not counted as failures. */
  readonly rewrites: readonly Edit[];
};

const QUOTE_MARKS: Readonly<Record<string, string>> = { "‘": "'", "’": "'", "“": '"', "”": '"' };

export type Normalized = {
  readonly text: string;
  /** Offset in the ORIGINAL text where normalised character i starts, and where it ends (exclusive). */
  readonly start: readonly number[];
  readonly end: readonly number[];
};

/**
 * D10a: whitespace collapsed to one space, curly quotes folded to straight, Unicode NFC. Arabic harakat are kept, because
 * one harakah can change the meaning of a verse or hadith. NFC runs per whitespace-delimited word. When it changes a
 * word's length the word's characters all map to the whole word, so `findSpan` can never cut inside it.
 */
export function normalize(text: string): Normalized {
  let out = "";
  const start: number[] = [];
  const end: number[] = [];
  let index = 0;
  while (index < text.length) {
    let stop = index;
    const space = /\s/.test(text.charAt(index));
    while (stop < text.length && /\s/.test(text.charAt(stop)) === space) stop += 1;
    if (space) {
      out += " ";
      start.push(index);
      end.push(stop);
    } else {
      const word = text.slice(index, stop);
      const folded = word.replace(/[‘’“”]/g, (mark) => QUOTE_MARKS[mark] ?? mark).normalize("NFC");
      const sameLength = folded.length === word.length;
      for (let offset = 0; offset < folded.length; offset += 1) {
        start.push(sameLength ? index + offset : index);
        end.push(sameLength ? index + offset + 1 : stop);
      }
      out += folded;
    }
    index = stop;
  }
  return { text: out, start, end };
}

/** The span of `haystack` (original coordinates) whose normalised form equals the normalised `needle`, or null. */
export function findSpan(haystack: string, needle: string): { readonly start: number; readonly end: number } | null {
  const wanted = normalize(needle).text.trim();
  if (wanted === "") return null;
  const hay = normalize(haystack);
  for (let at = hay.text.indexOf(wanted); at !== -1; at = hay.text.indexOf(wanted, at + 1)) {
    const start = hay.start[at];
    const end = hay.end[at + wanted.length - 1];
    if (start === undefined || end === undefined) continue;
    if (normalize(haystack.slice(start, end)).text.trim() === wanted) return { start, end };
  }
  return null;
}

/** The first passage that contains `needle` verbatim (modulo normalisation), as an Excerpt carrying the SOURCE's text. */
export function verifyExcerpt(needle: string, passages: readonly Passage[]): Excerpt | null {
  for (const passage of passages) {
    const span = findSpan(passage.text, needle);
    if (span !== null) return { passage: passage.id, start: span.start, end: span.end, text: passage.text.slice(span.start, span.end) };
  }
  return null;
}

const MARKER = /\[(S\d+)\]/g;
const MARKER_RUN = /(?:\[S\d+\])+/g;
const PARTIAL_MARKER = /^\[S?\d*$/;

export function markersOf(text: string): string[] {
  return [...new Set([...text.matchAll(MARKER)].map((match) => match[1] as string))];
}

function findingsForMarkers(site: Site, ids: readonly string[], ledger: SourceLedger, allowSuperseded: boolean): Finding[] {
  const findings: Finding[] = [];
  for (const sid of ids) {
    const entry = ledger.resolve(sid);
    if (entry === null) findings.push({ code: "unknown_source", site, detail: `${sid} is not in the context`, repair: null });
    else if (!allowSuperseded && statusOf(entry.passage) === "superseded") findings.push({ code: "superseded_cited", site, detail: `${sid} is superseded`, repair: null });
  }
  return findings;
}

function partialMarkerStart(text: string): number {
  const at = text.lastIndexOf("[");
  return at !== -1 && PARTIAL_MARKER.test(text.slice(at)) ? at : -1;
}

/**
 * Text with [S1][S2] markers to spans. Adjacent markers become one cite span.
 * final=false: a trailing half-written marker is held back and every cite is pending (`passages: null`).
 * final=true: every marker must resolve. Unresolved ones are findings, and the prose is only meaningful without any.
 */
export function toProse(text: string, ledger: SourceLedger, final: boolean, site: Site): Checked<Prose> {
  const partial = final ? -1 : partialMarkerStart(text);
  const visible = partial === -1 ? text : text.slice(0, partial);
  const spans: Prose[number][] = [];
  const findings: Finding[] = [];
  let cursor = 0;
  for (const run of visible.matchAll(MARKER_RUN)) {
    if (run.index > cursor) spans.push({ kind: "text", text: visible.slice(cursor, run.index) });
    if (final) {
      const ids = markersOf(run[0]);
      findings.push(...findingsForMarkers(site, ids, ledger, false));
      const passages = ids.flatMap((sid) => ledger.resolve(sid)?.passage.id ?? []);
      spans.push({ kind: "cite", passages: [...new Set(passages)] });
    } else spans.push({ kind: "cite", passages: null });
    cursor = run.index + run[0].length;
  }
  if (cursor < visible.length) spans.push({ kind: "text", text: visible.slice(cursor) });
  return { value: spans, findings, rewrites: [] };
}

/** The marker check on a still-growing string: only markers already closed are examined, so an unknown id is caught as soon as it is written. */
export function checkMarkersSoFar(site: Site, text: string, ledger: SourceLedger): readonly Finding[] {
  return findingsForMarkers(site, markersOf(text), ledger, false);
}

export function checkSources(site: Site, ids: readonly string[], ledger: SourceLedger, allowSuperseded: boolean): readonly Finding[] {
  const findings = findingsForMarkers(site, ids, ledger, allowSuperseded);
  if (ids.length === 0) findings.push({ code: "bad_shape", site, detail: "cites no source", repair: null });
  return findings;
}

const passagesOf = (ids: readonly string[], ledger: SourceLedger): Passage[] => ids.flatMap((sid) => ledger.resolve(sid)?.passage ?? []);

export function checkNote(wire: WireNote, ledger: SourceLedger): Checked<Note> {
  const site: Site = `note.${wire.kind}`;
  const allowSuperseded = wire.kind === "revision";
  const findings: Finding[] = [...checkSources(site, wire.sources, ledger, allowSuperseded)];
  const rewrites: Edit[] = [];
  let quote: Excerpt | null = null;
  if (wire.quote) {
    const entry = ledger.resolve(wire.quote.source);
    findings.push(...findingsForMarkers(site, [wire.quote.source], ledger, allowSuperseded));
    if (entry !== null) {
      quote = verifyExcerpt(wire.quote.text, [entry.passage]);
      if (quote === null) findings.push({ code: "quote_not_verbatim", site, detail: `${wire.id}: quote is not in ${wire.quote.source}`, repair: { kind: "quote_dropped", id: wire.id } });
      else if (quote.text !== wire.quote.text) rewrites.push({ kind: "quote_from_source", id: wire.id });
    }
  }
  const sources = [...new Set(passagesOf(wire.sources, ledger).map((passage) => passage.id))];
  return { value: { id: wire.id, kind: wire.kind, title: wire.title, text: wire.text, basis: wire.basis, quote, sources }, findings, rewrites };
}

/**
 * Dalil: sources, then `arabic` against the item's cited passages. A match becomes the SOURCE's text (D10b: not a failure),
 * and no match nulls it (arabic_not_in_source, repair arabic_nulled). `translation` is not checked: v2 Part 4 has no such check.
 */
export function checkDalil(wire: WireDalil, ledger: SourceLedger): Checked<Dalil> {
  const findings: Finding[] = [...checkSources("dalil", wire.sources, ledger, false)];
  const rewrites: Edit[] = [];
  let arabic: Excerpt | null = null;
  if (wire.arabic !== null && wire.arabic.trim() !== "") {
    arabic = verifyExcerpt(wire.arabic, passagesOf(wire.sources, ledger));
    if (arabic === null) findings.push({ code: "arabic_not_in_source", site: "dalil", detail: `${wire.id}: Arabic is not in a cited passage`, repair: { kind: "arabic_nulled", id: wire.id } });
    else if (arabic.text !== wire.arabic) rewrites.push({ kind: "arabic_from_source", id: wire.id });
  }
  const sources = [...new Set(passagesOf(wire.sources, ledger).map((passage) => passage.id))];
  const value: Dalil = {
    id: wire.id,
    kind: wire.kind,
    reference: wire.reference,
    arabic,
    translation: wire.translation,
    explanation: wire.explanation,
    explanationBasis: wire.explanation_basis,
    sources,
  };
  return { value, findings, rewrites };
}

export function checkQuote(wire: WireQuote, ledger: SourceLedger): Checked<Excerpt | null> {
  const findings: Finding[] = [...findingsForMarkers("quotes", [wire.source], ledger, false)];
  const entry = ledger.resolve(wire.source);
  const excerpt = entry === null ? null : verifyExcerpt(wire.text, [entry.passage]);
  if (entry !== null && excerpt === null) findings.push({ code: "quote_not_verbatim", site: "quotes", detail: `quote is not in ${wire.source}`, repair: null });
  return { value: excerpt, findings, rewrites: [] };
}

const filled = (value: string | null): boolean => value !== null && value.trim() !== "";

export function checkComplete(answer: Answer): readonly Finding[] {
  const missing = (site: Site, detail: string): Finding => ({ code: "incomplete", site, detail, repair: null });
  if (answer.type === null) return [missing("type", "no type")];
  if (answer.type === "clarify") {
    const findings: Finding[] = [];
    if (!filled(answer.clarifyingQuestion)) findings.push(missing("clarifying_question", "no clarifying question"));
    if (answer.clarifyingOptions.length < 2 || answer.clarifyingOptions.length > 4) findings.push(missing("clarifying_options", "needs 2 to 4 options"));
    return findings;
  }
  if (answer.type !== "answer") return filled(answer.message) ? [] : [missing("message", "no message")];
  const findings: Finding[] = [];
  if (answer.basis === null) findings.push(missing("basis", "no basis"));
  if (!filled(answer.headline)) findings.push(missing("headline", "no headline"));
  if (!filled(answer.headlineShort)) findings.push(missing("headline_short", "no short headline"));
  if (answer.summary === null) findings.push(missing("summary", "no summary"));
  if (answer.basis === "inferred" && answer.inferenceNote === null) findings.push(missing("inference_note", "inferred answer without an inference note"));
  if (citedOf(answer).length === 0) findings.push(missing("summary", "cites no passage"));
  return findings;
}
