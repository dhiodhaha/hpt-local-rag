import { EXCEPTION_WITHHELD, type Dalil, type Excerpt, type Note, type PassageId, type Prose, type SourceCard, type UnverifiedReference, type WithheldException } from "@hpt/server/client";
import { tidyCorpus } from "../arabic.ts";
import { citedInReadingOrder } from "./cited.ts";
import { COPY } from "./copy.ts";
import { gistOf, whereOf } from "./passage.ts";
import type { Run } from "./run.ts";

/**
 * An answer as prose (D9.6), a pure function of a run. The answer is read top to bottom as one piece of writing:
 *
 *   lead     the headline in bold, then the inference note when the answer is inferred, then the summary with its citation marks
 *   dalil    "Dalilnya.", every dalil, each as a sentence with its Arabic in a block of its own
 *   notes    "Yang perlu diperhatikan.", the notes and exceptions as sentences
 *   closing  "Wallahu a'lam bish-shawab.", once the answer is done
 *   footer   the closing line, and the actions alone under it
 *
 * Each block that cites carries `margin`: one note per cited passage, drawn beside the block. A margin note is not a card. It says
 * which source the sentence leans on, and quotes the words when the answer quotes them.
 */
export type Headline = { readonly text: string; readonly inferred: boolean; readonly verifying: boolean };

export type MarginNote = {
  readonly id: PassageId;
  readonly number: number;
  readonly title: string;
  /** "Kitab Thaharah · Bab Wudhu", from the passage's locator. */
  readonly where: string | null;
  /** Ready to draw: in quotation marks, with an ellipsis where the quote is cut. Null when the answer quotes nothing from the passage. */
  readonly quote: string | null;
  readonly status: "active" | "superseded";
};

export type LeadBlock = {
  readonly headline: Headline | null;
  readonly summary: Prose | null;
  /** Inferred answers only: the note on what the model inferred, quiet prose right after the verdict, in the answer's own colour and with no badge. */
  readonly inference: Prose | null;
  /** The summary is still streaming: its tail is faded and a caret follows it. */
  readonly streaming: boolean;
  /** Margin notes for every mark in the inference note and the whole summary. The view keeps those whose mark has been revealed. */
  readonly margin: readonly MarginNote[];
};

export type DalilBlock = {
  readonly id: string;
  /** "Fatwa Uji 2 memuat teks ini". The marks for the Arabic follow it, then `end`. */
  readonly intro: string;
  readonly end: ":" | ".";
  readonly introCites: readonly PassageId[];
  readonly arabic: string | null;
  readonly meaning: { readonly label: string; readonly text: string } | null;
  readonly explanation: string;
  readonly inferred: boolean;
  readonly cites: readonly PassageId[];
  readonly margin: readonly MarginNote[];
};

export type NoteItem = { readonly id: string; readonly text: string; readonly inferred: boolean; readonly withheld: boolean; readonly cites: readonly PassageId[] };

export type NotesBlock = { readonly items: readonly NoteItem[]; readonly margin: readonly MarginNote[] };

export type Article = {
  readonly unverified: readonly UnverifiedReference[];
  readonly lead: LeadBlock;
  readonly dalil: readonly DalilBlock[];
  readonly notes: NotesBlock | null;
  /** More may still arrive: the ask is running and the headline is in. A faint placeholder holds the place until it is done. */
  readonly pending: boolean;
  /** Done: the closing line and the actions show. */
  readonly finished: boolean;
  /** The passages the answer cites, in the order of their numbers. */
  readonly cited: readonly PassageId[];
};

const MARGIN_QUOTE_CHARS = 150;

const NOTE_LEAD = {
  exception: COPY.article.noteLead.exception,
  practical: COPY.article.noteLead.practical,
  difference: COPY.article.noteLead.difference,
  revision: COPY.article.noteLead.revision,
  referral: COPY.article.noteLead.referral,
} as const satisfies Record<Note["kind"], string>;

const DALIL_INTRO = {
  quran: (reference: string) => `${reference} berbunyi`,
  hadith: (reference: string) => `${reference} berbunyi`,
  tarjih: (reference: string) => `${reference} memuat teks ini`,
} as const satisfies Record<Dalil["kind"], (reference: string) => string>;

/** The passages a prose cites, in the order of its marks. A mark still being checked has none. */
export function citedIn(prose: Prose | null): PassageId[] {
  return (prose ?? []).flatMap((span) => (span.kind === "cite" && span.passages !== null ? [...span.passages] : []));
}

const sentence = (text: string): string => {
  const trimmed = text.trim();
  return /[.!?…:)”"]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

type Lookup = {
  readonly numbers: ReadonlyMap<PassageId, number>;
  readonly cards: ReadonlyMap<PassageId, SourceCard>;
  readonly quotes: readonly Excerpt[];
};

/** The words an excerpt marks, as one quote: cut at a word when long, and an ellipsis where it starts or ends inside the passage. */
function quoteOf(excerpt: Excerpt, passageText: string): string | null {
  const body = gistOf(excerpt.text, MARGIN_QUOTE_CHARS);
  if (body === "") return null;
  const before = excerpt.start > 0 && !/[.!?]\s*$/.test(passageText.slice(0, excerpt.start)) ? "…" : "";
  const after = excerpt.end < passageText.length && !/[.!?…]$/.test(body) ? "…" : "";
  return `“${before}${body}${after}”`;
}

function marginOf(ids: readonly PassageId[], lookup: Lookup, preferred: readonly Excerpt[] = []): MarginNote[] {
  const seen = new Set<PassageId>();
  return ids.flatMap((id) => {
    const number = lookup.numbers.get(id);
    const card = lookup.cards.get(id);
    if (seen.has(id) || number === undefined || card === undefined) return [];
    seen.add(id);
    const { passage } = card;
    const excerpt = [...preferred, ...lookup.quotes].find((candidate) => candidate.passage === id);
    return [{ id, number, title: passage.title, where: whereOf(passage.locator), quote: excerpt === undefined ? null : quoteOf(excerpt, passage.text), status: passage.supersededBy === null ? "active" : "superseded" }];
  });
}

function dalilOf(dalil: Dalil, lookup: Lookup): DalilBlock {
  const arabic = dalil.arabic === null ? null : tidyCorpus(dalil.arabic.text);
  const hasText = arabic !== null || dalil.translation !== null;
  const introCites = dalil.arabic === null ? [] : [dalil.arabic.passage];
  return {
    id: dalil.id,
    intro: DALIL_INTRO[dalil.kind](dalil.reference),
    end: hasText ? ":" : ".",
    introCites,
    arabic,
    meaning: dalil.translation === null ? null : { label: arabic === null ? COPY.article.translation : COPY.article.meaning, text: `“${dalil.translation}”` },
    explanation: dalil.explanation,
    inferred: dalil.explanationBasis === "inferred",
    cites: dalil.sources,
    margin: marginOf([...introCites, ...dalil.sources], lookup, dalil.arabic === null ? [] : [dalil.arabic]),
  };
}

function itemOf(note: Note | WithheldException): NoteItem {
  if ("withheld" in note) return { id: note.id, text: EXCEPTION_WITHHELD, inferred: false, withheld: true, cites: note.passages };
  const lead = NOTE_LEAD[note.kind];
  return { id: note.id, text: [lead, sentence(note.title), sentence(note.text)].filter((part) => part !== "").join(" "), inferred: note.basis === "inferred", withheld: false, cites: note.sources };
}

function notesOf(notes: readonly (Note | WithheldException)[], lookup: Lookup): NotesBlock | null {
  if (notes.length === 0) return null;
  const quotes = notes.flatMap((note) => ("withheld" in note || note.quote === null ? [] : [note.quote]));
  const items = notes.map(itemOf);
  return { items, margin: marginOf(items.flatMap((item) => item.cites), lookup, quotes) };
}

/** Each source once: at the first row, in reading order, that cites it. Later rows keep their numbers in the text and nothing in the margin. */
export function firstCitations(rows: readonly (readonly MarginNote[])[]): MarginNote[][] {
  const seen = new Set<PassageId>();
  return rows.map((row) =>
    row.filter((note) => {
      if (seen.has(note.id)) return false;
      seen.add(note.id);
      return true;
    }),
  );
}

export type MarginPlan = {
  readonly lead: readonly MarginNote[];
  /** One entry for each dalil. */
  readonly dalil: readonly (readonly MarginNote[])[];
  readonly notes: readonly MarginNote[];
  /** All of them in reading order, for a window wide enough to draw the margin as one column. */
  readonly all: readonly MarginNote[];
};

/** The margin of the whole article. `shown` holds the passages whose marks the reveal has reached. */
export function marginPlan(article: Article, shown: ReadonlySet<PassageId>): MarginPlan {
  const lead = article.lead.margin.filter((note) => shown.has(note.id));
  const dalil = article.dalil.map((block) => block.margin);
  const [placedLead = [], ...rest] = firstCitations([lead, ...dalil, article.notes?.margin ?? []]);
  const placedNotes = rest.pop() ?? [];
  return { lead: placedLead, dalil: rest, notes: placedNotes, all: [...placedLead, ...rest.flat(), ...placedNotes] };
}

export function articleOf(run: Run): Article {
  const { answer, sources, outcome } = run;
  const finished = outcome !== null;
  const cited = citedInReadingOrder(answer);
  const lookup: Lookup = { numbers: new Map(cited.map((id, index) => [id, index + 1])), cards: new Map(sources.map((card) => [card.passage.id, card])), quotes: answer.quotes };
  const headline: Headline | null = answer.headline === null ? null : { text: answer.headline, inferred: answer.basis === "inferred", verifying: answer.headlineState === "verifying" };
  return {
    unverified: answer.unverifiedReferences,
    lead: { headline, summary: answer.summary, inference: answer.inferenceNote, streaming: answer.summary !== null && !run.summaryDone && !finished, margin: marginOf([...citedIn(answer.inferenceNote), ...citedIn(answer.summary)], lookup) },
    dalil: answer.dalil.map((dalil) => dalilOf(dalil, lookup)),
    notes: notesOf(answer.notes, lookup),
    pending: !finished && headline !== null,
    finished,
    cited,
  };
}

const textOfProse = (prose: Prose | null): string => (prose ?? []).map((span) => (span.kind === "text" ? span.text : "")).join("").replace(/\s+([.,;:!?])/g, "$1");

function dalilText(block: DalilBlock, first: boolean): string {
  const lines = [`${first ? `${COPY.article.dalilLead} ` : ""}${block.intro}${block.end}`];
  if (block.arabic !== null) lines.push(block.arabic);
  if (block.meaning !== null) lines.push(`${block.meaning.label}: ${block.meaning.text}`);
  lines.push(block.explanation);
  return lines.join("\n");
}

/** What the copy button puts on the clipboard: the answer as plain text, without citation marks. */
export function plainTextOf(article: Article): string {
  const lead = [article.lead.headline?.text ?? "", textOfProse(article.lead.inference), textOfProse(article.lead.summary)].filter((part) => part !== "").join(" ");
  const notes = article.notes === null ? [] : article.notes.items.map((item, index) => (index === 0 ? `${COPY.article.notesLead} ${item.text}` : item.text));
  return [lead, ...article.dalil.map((block, index) => dalilText(block, index === 0)), ...notes].filter((part) => part !== "").join("\n\n");
}
