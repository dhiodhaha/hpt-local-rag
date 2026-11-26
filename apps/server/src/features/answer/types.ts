import type { NoteId } from "../corpus/index.ts";
import type { Evidence, Passage, PassageId } from "../search/index.ts";
import type { FailureCode } from "../providers/index.ts";
import type { FindingCode } from "./policy.ts";

/**
 * Domain types of the answer engine. The model's JSON (wire shape) and its S-ids never appear here: they are parsed at the
 * boundary (`wire.ts`, `ledger.ts`) into stable PassageIds and checked values. Everything here is JSON-serializable, so the
 * same events go to a terminal, an SSE stream or a trace unchanged.
 */

export type Scope =
  /** Asked from the putusan reader: answer from this document's passages first. */
  | { readonly kind: "document"; readonly noteId: NoteId }
  /** Asked from the compare view: about the difference between two versions, citing both. */
  | { readonly kind: "revision"; readonly active: PassageId; readonly superseded: PassageId };

export type AnswerType = "answer" | "clarify" | "insufficient" | "out_of_scope" | "declined";
export type Basis = "explicit" | "inferred";

/** One earlier turn, as the prompt's <history> block carries it. Earlier answer text is never included, so it can never be evidence. */
export type HistoryEntry = {
  readonly n: number;
  readonly question: string;
  readonly type: AnswerType;
  /** The headline, or for a non-answer the clarifying question or message. */
  readonly gist: string | null;
  readonly basis: Basis | null;
  /** Stable ids. The prompt builder shows the ones still in this turn's context as S-ids and leaves the rest out. */
  readonly cited: readonly PassageId[];
};

export type Turn = {
  readonly question: string;
  readonly history: readonly HistoryEntry[];
  readonly scope: Scope | null;
};

/** A span anchored in a passage's canonical text: what the reader highlights, and proof the text is verbatim. `text === passage.text.slice(start, end)`. */
export type Excerpt = { readonly passage: PassageId; readonly start: number; readonly end: number; readonly text: string };

/** Text with citations as spans, not "[S3]" markers. `passages: null` means "still being checked". Final prose never contains null. */
export type ProseSpan = { readonly kind: "text"; readonly text: string } | { readonly kind: "cite"; readonly passages: readonly PassageId[] | null };
export type Prose = readonly ProseSpan[];

export type NoteKind = "exception" | "practical" | "difference" | "revision" | "referral";
export type DalilKind = "quran" | "hadith" | "tarjih";

export type Note = {
  readonly id: string;
  readonly kind: NoteKind;
  readonly title: string;
  readonly text: string;
  readonly basis: Basis;
  readonly quote: Excerpt | null;
  readonly sources: readonly PassageId[];
};

/** D10f: a failing exception note is never dropped silently. Its place shows a fixed sentence and links to `passages`. */
export type WithheldException = { readonly withheld: "exception"; readonly id: string; readonly passages: readonly PassageId[] };

export type Dalil = {
  readonly id: string;
  readonly kind: DalilKind;
  readonly reference: string;
  /** Always the SOURCE's text (D10b), never the model's. Null when it did not match a cited passage. */
  readonly arabic: Excerpt | null;
  readonly translation: string | null;
  readonly explanation: string;
  readonly explanationBasis: Basis;
  readonly sources: readonly PassageId[];
};

export type UnverifiedReference = { readonly asStated: string; readonly note: string };

/**
 * Where a shown headline stands. It is `verifying` from the moment its own checks pass until the summary passes its checks, then
 * `settled`. Only a restart takes a verifying headline back, so a reader never sees a settled headline withdrawn.
 */
export type HeadlineState = "pending" | "verifying" | "settled";

export type Answer = {
  readonly type: AnswerType | null;
  readonly basis: Basis | null;
  readonly headline: string | null;
  readonly headlineState: HeadlineState;
  readonly headlineShort: string | null;
  readonly summary: Prose | null;
  readonly inferenceNote: Prose | null;
  readonly notes: readonly (Note | WithheldException)[];
  readonly dalil: readonly Dalil[];
  readonly quotes: readonly Excerpt[];
  readonly unverifiedReferences: readonly UnverifiedReference[];
  readonly clarifyingQuestion: string | null;
  readonly clarifyingOptions: readonly string[];
  readonly message: string | null;
};

export type CompleteAnswer = Answer & { readonly type: AnswerType };

/** D10c: every repair is logged. */
export type Edit =
  | { readonly kind: "arabic_from_source"; readonly id: string }
  | { readonly kind: "arabic_nulled"; readonly id: string }
  | { readonly kind: "quote_from_source"; readonly id: string }
  | { readonly kind: "quote_dropped"; readonly id: string }
  | { readonly kind: "fence_stripped" };

export type FieldValues = {
  type: AnswerType;
  basis: Basis | null;
  headline: string | null;
  headline_short: string | null;
  summary: Prose | null;
  inference_note: Prose | null;
  clarifying_question: string | null;
  message: string | null;
};

export type ItemValues = {
  notes: Note | WithheldException;
  dalil: Dalil;
  quotes: Excerpt;
  unverified_references: UnverifiedReference;
  clarifying_options: string;
};

export type SourceCard = {
  /** Per-answer ordinal, the number the model's "S3" had. A display label only: storage and links use `passage.id`. */
  readonly n: number;
  readonly passage: Passage;
  readonly origin: "retrieval" | "carry_over" | "scope" | "tool";
  readonly priorTurn: number | null;
};

export type Cause = { readonly kind: "check"; readonly code: FindingCode } | { readonly kind: "provider"; readonly code: FailureCode };

export type Outcome =
  | { readonly kind: "delivered" }
  /** D10d: checks failed twice. `copy` is the fixed Indonesian sentence. */
  | { readonly kind: "withheld"; readonly code: FindingCode; readonly copy: string }
  | { readonly kind: "failed"; readonly code: FailureCode; readonly copy: string }
  | { readonly kind: "cancelled" };

/**
 * Committed events only. Nothing is ever taken back except by a `restart`, which means "drop everything shown so far: the
 * quiet retry started". A retry that starts before anything was shown has no `restart`. `foldAnswer` is the one reducer.
 */
export type AnswerEvent =
  /** The Sumber panel fills from this before the model has written a word. Later events (origin "tool") add to it. */
  | { readonly kind: "sources"; readonly added: readonly SourceCard[]; readonly evidence: Evidence | null }
  | { readonly kind: "attempt"; readonly attempt: number; readonly because: Cause | null }
  | { readonly kind: "restart"; readonly copy: string }
  /** The summary passed its checks, so the headline shown earlier is now confirmed. */
  | { readonly kind: "settled"; readonly name: "headline" }
  | { readonly kind: "tool_call"; readonly n: number; readonly tool: string; readonly arg: string; readonly denied: boolean }
  /** The summary growing, citations pending. Only `summary` streams (D5a). */
  | { readonly kind: "progress"; readonly name: "summary"; readonly prose: Prose }
  | { readonly [K in keyof FieldValues]: { readonly kind: "field"; readonly name: K; readonly value: FieldValues[K] } }[keyof FieldValues]
  | { readonly [K in keyof ItemValues]: { readonly kind: "item"; readonly name: K; readonly value: ItemValues[K]; readonly edits: readonly Edit[] } }[keyof ItemValues]
  | { readonly kind: "finished"; readonly outcome: Outcome };
