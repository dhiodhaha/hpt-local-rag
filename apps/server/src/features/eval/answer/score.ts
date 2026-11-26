import { FINDING_CODES, citedOf, type CompleteAnswer, type FindingCode, type Finished, type Prose } from "../../answer/index.ts";
import type { Passage, PassageId } from "../../search/index.ts";
import type { AnswerCase, Category } from "./cases.ts";

/**
 * One answer, scored by code. No model judges anything. `score` is a pure function of the case, the stored result and a lookup
 * of passages, so a report can be recomputed from data/eval/ at any time, and a scoring change never costs a model call.
 *
 * What each category wants, and which number checks it:
 *   typeOk   explicit, inferred, differing, revision: type `answer`. insufficient: type `insufficient`.
 *            fictional: `unverified_references` filled.
 *   shapeOk  explicit and inferred: at least one citation. differing: a `difference` note. revision: a `revision` note that
 *            cites two passages or more. insufficient: nothing is cited. fictional: no cited passage matches the invented number
 *            and year (whether the answer avoids confirming the ruling is a reading task, so a fictional case is always `review`).
 *   basisOk  explicit wants `explicit`, inferred wants `inferred`. Other categories have no basis expectation.
 * A withheld or failed answer passes nothing. It is counted on its own.
 */
export type Timing = {
  readonly firstTextMs: number | null;
  /** The first headline a reader saw, even if a restart replaced it later. Null for an answer without a headline. */
  readonly headlineMs: number | null;
  readonly settledMs: number | null;
  readonly doneMs: number;
  /** The headline for an answer, the clarifying question or the message for the other types. */
  readonly contentMs: number | null;
};

export type Score = {
  readonly caseId: string;
  readonly category: Category;
  readonly outcome: Finished["outcome"]["kind"];
  readonly answerType: CompleteAnswer["type"] | null;
  readonly typeOk: boolean;
  readonly shapeOk: boolean;
  readonly basisOk: boolean | null;
  /** A human should read this answer: a fictional case, whose "never confirmed" half is a reading task. */
  readonly review: boolean;
  readonly timing: Timing;
  readonly path: "tool" | "no_tool";
  readonly citations: {
    readonly cited: number;
    /** Cited ids the answer's own context does not hold. Zero by construction, and reported because it is an exit criterion. */
    readonly outsideContext: number;
    /** Cited ids the index does not return. */
    readonly unresolved: number;
    /** Cited ids marked superseded, outside a `revision` note. */
    readonly supersededOutsideRevision: number;
    readonly matchesFictional: boolean;
  };
  /** Codes seen in ANY attempt: raw model quality before a retry or a repair hides it. */
  readonly findings: readonly FindingCode[];
  readonly repairs: readonly string[];
  readonly attempts: number;
  readonly visibleRestart: boolean;
  readonly testSet: boolean;
  readonly tools: { readonly granted: number; readonly denied: number; readonly searches: number };
  readonly retrieval: {
    readonly ms: number;
    readonly providerWaitMs: number | null;
    readonly warm: boolean | null;
    readonly evidence: string;
  };
  /** Of HPT's cited notes, how many our context held and how many our answer cited. Null where HPT cited nothing. */
  readonly overlap: { readonly expected: number; readonly inContext: number; readonly cited: number } | null;
  readonly usage: { readonly outputTokens: number; readonly inputTokens: number; readonly cacheReadTokens: number; readonly cacheWriteTokens: number } | null;
};

export type PassageLookup = (ids: readonly PassageId[]) => ReadonlyMap<PassageId, Passage>;

function textOf(prose: Prose | null): PassageId[] {
  return (prose ?? []).flatMap((span) => (span.kind === "cite" ? (span.passages ?? []) : []));
}

/** Everything the answer cites except inside a `revision` note, where a superseded passage may appear (D10h). */
export function citedOutsideRevision(answer: CompleteAnswer): PassageId[] {
  const all: PassageId[] = [
    ...textOf(answer.summary),
    ...textOf(answer.inferenceNote),
    ...answer.dalil.flatMap((dalil) => [...dalil.sources, ...(dalil.arabic ? [dalil.arabic.passage] : [])]),
    ...answer.notes.flatMap((note) => ("withheld" in note || note.kind === "revision" ? [] : [...note.sources, ...(note.quote ? [note.quote.passage] : [])])),
    ...answer.quotes.map((quote) => quote.passage),
  ];
  return [...new Set(all)];
}

export function matchesFictional(passage: Passage, ref: NonNullable<AnswerCase["fictionalRef"]>): boolean {
  return passage.year === ref.year && passage.number !== null && Number(passage.number) === Number(ref.number);
}

function timingOf(finished: Finished): Timing {
  const { attempts, totalMs } = finished.trace;
  const marks = (name: string) => attempts.flatMap((attempt) => attempt.committedMs.filter((mark) => mark.name === name).map((mark) => mark.ms));
  const last = attempts.at(-1);
  const contentName = { answer: "headline", clarify: "clarifying_question", insufficient: "message", out_of_scope: "message", declined: "message" } as const;
  const type = finished.answer?.type;
  const headlineMs = finished.answer?.type === "answer" && finished.answer.headline !== null ? (marks("headline")[0] ?? null) : null;
  return {
    firstTextMs: attempts.find((attempt) => attempt.firstTextMs !== null)?.firstTextMs ?? null,
    headlineMs,
    settledMs: last?.committedMs.find((mark) => mark.name === "headline_settled")?.ms ?? null,
    doneMs: totalMs,
    contentMs: type === undefined ? null : (marks(contentName[type])[0] ?? null),
  };
}

type Expectation = { readonly typeOk: boolean; readonly shapeOk: boolean };

function expectation(item: AnswerCase, answer: CompleteAnswer, cited: readonly PassageId[], matchesRef: boolean): Expectation {
  const kinds = answer.notes.flatMap((note) => ("withheld" in note ? [] : [note]));
  const isAnswer = answer.type === "answer";
  switch (item.category) {
    case "explicit":
    case "inferred":
      return { typeOk: isAnswer, shapeOk: isAnswer && cited.length > 0 };
    case "differing":
      return { typeOk: isAnswer, shapeOk: isAnswer && kinds.some((note) => note.kind === "difference") };
    case "revision":
      return { typeOk: isAnswer, shapeOk: isAnswer && kinds.some((note) => note.kind === "revision" && note.sources.length >= 2) };
    case "insufficient":
      return { typeOk: answer.type === "insufficient", shapeOk: answer.type === "insufficient" && cited.length === 0 };
    case "fictional": {
      const flagged = answer.unverifiedReferences.length > 0;
      return { typeOk: flagged, shapeOk: flagged && !matchesRef };
    }
  }
}

const BASIS: Readonly<Partial<Record<Category, "explicit" | "inferred">>> = { explicit: "explicit", inferred: "inferred" };

function overlapOf(item: AnswerCase, finished: Finished): Score["overlap"] {
  if (item.expectedNotes.length === 0) return null;
  const noteOf = (id: PassageId) => id.slice(0, id.lastIndexOf("#"));
  const inContext = new Set(finished.context.map(noteOf));
  const cited = new Set((finished.answer === null ? [] : citedOf(finished.answer)).map(noteOf));
  return {
    expected: item.expectedNotes.length,
    inContext: item.expectedNotes.filter((note) => inContext.has(note)).length,
    cited: item.expectedNotes.filter((note) => cited.has(note)).length,
  };
}

export function score(item: AnswerCase, finished: Finished, lookup: PassageLookup): Score {
  const { trace, answer } = finished;
  const attempts = trace.attempts;
  const findings = FINDING_CODES.filter((code) => attempts.some((attempt) => attempt.findings.some((finding) => finding.code === code)));
  const usage = attempts.at(-1)?.usage ?? null;
  const cited = answer === null ? [] : citedOf(answer);
  const resolved = lookup(cited);
  const context = new Set(finished.context);
  const outside = answer === null ? [] : citedOutsideRevision(answer);
  const ref = item.fictionalRef;
  const isSuperseded = (id: PassageId) => {
    const passage = resolved.get(id);
    return passage !== undefined && passage.supersededBy !== null;
  };
  const matchesRef =
    ref !== undefined &&
    cited.some((id) => {
      const passage = resolved.get(id);
      return passage !== undefined && matchesFictional(passage, ref);
    });
  const wanted = answer === null ? { typeOk: false, shapeOk: false } : expectation(item, answer, cited, matchesRef);
  const wantBasis = BASIS[item.category];
  const granted = trace.tools.filter((call) => !call.denied);
  const last = attempts.at(-1);

  return {
    caseId: item.id,
    category: item.category,
    outcome: finished.outcome.kind,
    answerType: answer?.type ?? null,
    ...wanted,
    basisOk: wantBasis === undefined ? null : answer !== null && answer.basis === wantBasis,
    review: item.category === "fictional" && answer !== null,
    timing: timingOf(finished),
    path: trace.tools.length === 0 ? "no_tool" : "tool",
    citations: {
      cited: cited.length,
      outsideContext: cited.filter((id) => !context.has(id)).length,
      unresolved: cited.filter((id) => !resolved.has(id)).length,
      supersededOutsideRevision: outside.filter(isSuperseded).length,
      matchesFictional: matchesRef,
    },
    findings,
    repairs: attempts.flatMap((attempt) => attempt.edits.map((edit) => edit.kind)),
    attempts: attempts.length,
    visibleRestart: attempts.some((attempt) => attempt.visibleRestart),
    testSet: attempts.some((attempt) => attempt.findings.some((finding) => finding.testSet)),
    tools: { granted: granted.length, denied: trace.tools.length - granted.length, searches: granted.filter((call) => call.tool === "search").length },
    retrieval: { ms: trace.retrieval.ms, providerWaitMs: last?.providerWaitMs ?? null, warm: last?.warm ?? null, evidence: trace.retrieval.evidence },
    overlap: overlapOf(item, finished),
    usage: usage === null ? null : { ...usage },
  };
}
