import {
  citedOf,
  type AnswerType,
  type Basis,
  type Dalil,
  type Note,
  type Outcome,
  type PassageId,
  type Prose,
  type SourceCard,
  type SourceType,
  type UnverifiedReference,
  type WithheldException,
} from "@hpt/server/client";
import type { Run } from "./run.ts";

/**
 * Run to what to draw. Pure functions of a Run, no React. Each Doop state is defined here, once:
 *
 *   D7.1 verifying     card.headline.verifying      the headline passed its own checks and the summary has not yet
 *   D7.2 settled       card.headline.verifying false   the verify mark leaves and nothing replaces it
 *   D7.3 restart       view.kind "rechecking"       a restart arrived and no new `type` has yet. The Sumber panel stays
 *   D7.4 unverified    card.unverified              drawn above the headline. The engine releases it before `headline` (D17)
 *   skeletons (D10g)   section row "skeleton"       no item of that section has passed its checks and the ask is still running
 *   counts             row count                    only items that passed their checks are events, so a count never goes down
 *   fallback notice    run.fallback                 text from fallbackNotice(route, from)
 *   Sumber hidden      panelOf(run) === null        the type shows no Sumber, or no card may show before the type is known
 */
export type RowKind = "notes" | "dalil";

export type SectionRow =
  | { readonly kind: "items"; readonly section: RowKind; readonly count: number; readonly hint: string | null }
  | { readonly kind: "skeleton"; readonly section: RowKind };

export type AnswerCard = {
  readonly unverified: readonly UnverifiedReference[];
  /** null until the headline's own checks pass. */
  readonly headline: { readonly text: string; readonly inferred: boolean; readonly verifying: boolean } | null;
  readonly summary: Prose | null;
  /** The summary is still streaming: its tail is faded and a caret follows it. */
  readonly summaryStreaming: boolean;
  readonly inferenceNote: Prose | null;
  readonly notes: readonly (Note | WithheldException)[];
  readonly dalil: readonly Dalil[];
  readonly rows: readonly SectionRow[];
  /** Done: the disclaimer shows under every delivered answer. It is fixed text, never model text. */
  readonly finished: boolean;
};

export type ReplyType = Exclude<AnswerType, "answer">;

export type RunView =
  | { readonly kind: "working"; readonly step: "searching" | "thinking" }
  | { readonly kind: "rechecking"; readonly copy: string }
  | { readonly kind: "answer"; readonly card: AnswerCard }
  | { readonly kind: "reply"; readonly type: ReplyType; readonly message: string | null; readonly question: string | null; readonly options: readonly string[]; readonly basis: Basis | null }
  /** Withheld, failed or cancelled. Whatever streamed is not shown: the question stays and a notice takes the card's place. */
  | { readonly kind: "notice"; readonly outcome: Exclude<Outcome, { readonly kind: "delivered" }> };

const exceptionTitle = (notes: readonly (Note | WithheldException)[]): string | null => {
  const first = notes.find((note) => "kind" in note && note.kind === "exception");
  return first !== undefined && "title" in first ? first.title : null;
};

function rowsOf(notes: readonly (Note | WithheldException)[], dalil: readonly Dalil[], finished: boolean): SectionRow[] {
  const dalilHint = dalil.length === 0 ? null : [...new Set(dalil.map((entry) => entry.reference))].join(", ");
  const rows: SectionRow[] = [];
  if (notes.length > 0) rows.push({ kind: "items", section: "notes", count: notes.length, hint: exceptionTitle(notes) });
  else if (!finished) rows.push({ kind: "skeleton", section: "notes" });
  if (dalil.length > 0) rows.push({ kind: "items", section: "dalil", count: dalil.length, hint: dalilHint });
  else if (!finished) rows.push({ kind: "skeleton", section: "dalil" });
  return rows;
}

export function viewOf(run: Run): RunView {
  const { answer, outcome } = run;
  if (outcome !== null && outcome.kind !== "delivered") return { kind: "notice", outcome };
  const { type } = answer;
  if (type === null) {
    if (run.restart !== null) return { kind: "rechecking", copy: run.restart.copy };
    return { kind: "working", step: run.sources.length === 0 ? "searching" : "thinking" };
  }
  if (type !== "answer") return { kind: "reply", type, message: answer.message, question: answer.clarifyingQuestion, options: answer.clarifyingOptions, basis: answer.basis };
  const finished = outcome !== null;
  return {
    kind: "answer",
    card: {
      unverified: answer.unverifiedReferences,
      headline: answer.headline === null ? null : { text: answer.headline, inferred: answer.basis === "inferred", verifying: answer.headlineState === "verifying" },
      summary: answer.summary,
      summaryStreaming: answer.summary !== null && !run.summaryDone && !finished,
      inferenceNote: answer.inferenceNote,
      notes: answer.notes,
      dalil: answer.dalil,
      rows: rowsOf(answer.notes, answer.dalil, finished),
      finished,
    },
  };
}

/** Which answer types show the Sumber panel. A new type is a compile error here, so nobody can forget to decide. */
export const SOURCES_SHOWN = {
  answer: true,
  insufficient: true,
  clarify: false,
  out_of_scope: false,
  declined: false,
} as const satisfies Record<AnswerType, boolean>;

/**
 * Which answer types carry the disclaimer ("bukan fatwa resmi"). It belongs to an answer and to nothing else: not a reply that is
 * not an answer, not a failure or a withheld answer, and not a run whose type is not known yet (working, rechecking). A new type
 * is a compile error here, so nobody can forget to decide.
 */
export const DISCLAIMER_SHOWN = {
  answer: true,
  insufficient: false,
  clarify: false,
  out_of_scope: false,
  declined: false,
} as const satisfies Record<AnswerType, boolean>;

export function showsDisclaimer(view: RunView): boolean {
  if (view.kind === "answer") return DISCLAIMER_SHOWN.answer;
  if (view.kind === "reply") return DISCLAIMER_SHOWN[view.type];
  return false;
}

export const SOURCE_TYPE_LABEL = {
  putusan: "Putusan",
  fatwa: "Fatwa",
  hpt: "HPT",
  penjelasan: "Penjelasan",
  tanya_jawab: "Tanya Jawab",
  opinion: "Pendapat",
} as const satisfies Record<SourceType, string>;

export type PanelCard = {
  readonly id: PassageId;
  /** null until the answer has cited it. */
  readonly number: number | null;
  readonly title: string;
  readonly typeLabel: string;
  readonly status: "active" | "superseded";
  /** "Kitab Thaharah · Bab Wudhu", from the passage's locator. */
  readonly where: string | null;
  /** The "Ringkasan" line: the trimmed start of the passage text, because passages have no summary field. */
  readonly gist: string;
  /** "Juga dikutip di pertanyaan N". */
  readonly priorTurn: number | null;
};

export type SourcesPanel = {
  readonly heading: { readonly count: number; readonly label: "ditelusuri" | "dikutip" };
  /** Before the first citation: why the numbers are not there yet. */
  readonly hint: "numbers-follow" | "numbers-return" | null;
  readonly shown: readonly PanelCard[];
  readonly folded: { readonly count: number; readonly label: "other" | "uncited"; readonly cards: readonly PanelCard[] } | null;
  readonly unverified: readonly UnverifiedReference[];
};

export const FIRST_SHOWN = 3;
const GIST_CHARS = 150;

export function gistOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= GIST_CHARS) return flat;
  const cut = flat.slice(0, GIST_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > GIST_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

export function whereOf(locator: SourceCard["passage"]["locator"]): string | null {
  const parts = [locator.kitab, locator.bab, locator.pasal, locator.ayat].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

function cardOf(card: SourceCard, number: number | null): PanelCard {
  const { passage } = card;
  return {
    id: passage.id,
    number,
    title: passage.title,
    typeLabel: SOURCE_TYPE_LABEL[passage.sourceType],
    status: passage.supersededBy === null ? "active" : "superseded",
    where: whereOf(passage.locator),
    gist: gistOf(passage.text),
    priorTurn: card.priorTurn,
  };
}

/**
 * The Sumber panel. While the ask runs, cards stay where the retrieval put them: the first few show, the others fold, and a card
 * that gets cited gains its number in place. When the ask is over and something was cited, the cited cards come first in the
 * order they were cited and the rest fold as "tidak dikutip". An answer that cited nothing (insufficient) keeps the first layout
 * because those are the nearest passages.
 */
function hintOf(run: Run, citedCount: number): SourcesPanel["hint"] {
  if (citedCount > 0 || run.outcome !== null) return null;
  return run.restart === null ? "numbers-follow" : "numbers-return";
}

export function panelOf(run: Run): SourcesPanel | null {
  if (run.sources.length === 0) return null;
  if (run.outcome !== null && run.outcome.kind !== "delivered") return null;
  const { type } = run.answer;
  if (type === null && run.evidence?.level === "absent") return null;
  if (type !== null && !SOURCES_SHOWN[type]) return null;

  const finished = run.outcome !== null;
  const cited = citedOf(run.answer);
  const numbers = new Map(cited.map((id, index) => [id, index + 1]));
  const all = run.sources.map((card) => cardOf(card, numbers.get(card.passage.id) ?? null));
  const unverified = run.answer.unverifiedReferences;

  if (finished && cited.length > 0) {
    const citedCards = cited.flatMap((id) => all.find((card) => card.id === id) ?? []);
    const rest = all.filter((card) => card.number === null);
    return {
      heading: { count: citedCards.length, label: "dikutip" },
      hint: null,
      shown: citedCards,
      folded: rest.length === 0 ? null : { count: rest.length, label: "uncited", cards: rest },
      unverified,
    };
  }
  const shown = all.filter((card, index) => index < FIRST_SHOWN || card.number !== null);
  const rest = all.filter((card) => !shown.includes(card));
  const hint = hintOf(run, cited.length);
  return {
    heading: { count: all.length, label: "ditelusuri" },
    hint,
    shown,
    folded: rest.length === 0 ? null : { count: rest.length, label: "other", cards: rest },
    unverified,
  };
}

/** How many sources the answer cited out of how many were searched, for the line above a finished card. */
export function tallyOf(run: Run): { readonly searched: number; readonly cited: number } {
  return { searched: run.sources.length, cited: citedOf(run.answer).length };
}

const textOfProse = (prose: Prose | null): string => (prose ?? []).map((span) => (span.kind === "text" ? span.text : "")).join("").replace(/\s+([.,;:!?])/g, "$1");

/** What the copy button puts on the clipboard: the headline and the summary, as plain text. */
export function plainTextOf(card: AnswerCard): string {
  return [card.headline?.text ?? "", textOfProse(card.summary)].filter((part) => part !== "").join("\n\n");
}
