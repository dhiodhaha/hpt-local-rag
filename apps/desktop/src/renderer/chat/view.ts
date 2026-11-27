import { isMostlyArabic } from "../arabic.ts";
import { type Answer, type AnswerType, type Basis, type Outcome, type PassageId, type SourceCard, type SourceType, type UnverifiedReference } from "@hpt/server/client";
import { articleOf, type Article } from "./article.ts";
import { citedInReadingOrder, spansOf } from "./cited.ts";
import { gistOf, quotedOf, whereOf } from "./passage.ts";
import type { Run } from "./run.ts";

/**
 * Run to what to draw. Pure functions of a Run, no React. Each Doop state is defined here, once:
 *
 *   D7.1 verifying     card.lead.headline.verifying   the headline passed its own checks and the summary has not yet
 *   D7.2 settled       card.lead.headline.verifying false   the verify mark leaves and nothing replaces it
 *   D7.3 restart       view.kind "rechecking"       a restart arrived and no new `type` has yet. The Sumber panel stays
 *   D7.4 unverified    card.unverified              drawn above the headline. The engine releases it before `headline` (D17)
 *   pending (D10g)     card.pending                 a faint placeholder under the last block while the ask is running
 *   counts             card.dalil, card.notes       only items that passed their checks are events, so a block never loses an item
 *   fallback notice    run.fallback                 text from fallbackNotice(route, from)
 *   Sumber hidden      panelOf(run) === null        the type shows no Sumber, or no card may show before the type is known
 */
export type ReplyType = Exclude<AnswerType, "answer">;

export type RunView =
  | { readonly kind: "working"; readonly step: "searching" | "thinking" }
  | { readonly kind: "rechecking"; readonly copy: string }
  | { readonly kind: "answer"; readonly card: Article }
  | { readonly kind: "reply"; readonly type: ReplyType; readonly message: string | null; readonly question: string | null; readonly options: readonly string[]; readonly basis: Basis | null }
  /** Withheld, failed or cancelled. Whatever streamed is not shown: the question stays and a notice takes the card's place. */
  | { readonly kind: "notice"; readonly outcome: Exclude<Outcome, { readonly kind: "delivered" }> };

export function viewOf(run: Run): RunView {
  const { answer, outcome } = run;
  if (outcome !== null && outcome.kind !== "delivered") return { kind: "notice", outcome };
  const { type } = answer;
  if (type === null) {
    if (run.restart !== null) return { kind: "rechecking", copy: run.restart.copy };
    return { kind: "working", step: run.sources.length === 0 ? "searching" : "thinking" };
  }
  if (type !== "answer") return { kind: "reply", type, message: answer.message, question: answer.clarifyingQuestion, options: answer.clarifyingOptions, basis: answer.basis };
  return { kind: "answer", card: articleOf(run) };
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
  /** The one line a closed row shows: what the answer quoted from this passage, else the trimmed start of the passage, because passages have no summary field. */
  readonly line: string;
  /** What an open row shows: the whole quote, else a longer start of the passage. */
  readonly preview: string;
  /** True when `line` and `preview` are the answer's own quote, so they are set in quotation marks. */
  readonly quoted: boolean;
  /** What "Salin kutipan" copies: the quote's words as they are, else the start of the passage. */
  readonly copy: string;
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
const PREVIEW_CHARS = 360;
const LINE_CHARS = 90;

const inQuotes = (text: string): string => (isMostlyArabic(text) ? text : `“${text}”`);

function cardOf(card: SourceCard, number: number | null, answer: Answer): PanelCard {
  const { passage } = card;
  const span = spansOf(answer).find((candidate) => candidate.passage === passage.id);
  return {
    id: passage.id,
    number,
    title: passage.title,
    typeLabel: SOURCE_TYPE_LABEL[passage.sourceType],
    status: passage.supersededBy === null ? "active" : "superseded",
    where: whereOf(passage.locator),
    line: span === undefined ? gistOf(passage.text) : inQuotes(quotedOf(passage.text, span, LINE_CHARS)),
    preview: span === undefined ? gistOf(passage.text, PREVIEW_CHARS) : inQuotes(quotedOf(passage.text, span, PREVIEW_CHARS)),
    quoted: span !== undefined,
    copy: span === undefined ? gistOf(passage.text, PREVIEW_CHARS) : gistOf(span.text, span.text.length),
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
  const cited = citedInReadingOrder(run.answer);
  const numbers = new Map(cited.map((id, index) => [id, index + 1]));
  const all = run.sources.map((card) => cardOf(card, numbers.get(card.passage.id) ?? null, run.answer));
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

/** The caution under the question box shows once the conversation holds at least one real answer. */
export const conversationShowsDisclaimer = (runs: readonly Run[]): boolean => runs.some((run) => showsDisclaimer(viewOf(run)));
