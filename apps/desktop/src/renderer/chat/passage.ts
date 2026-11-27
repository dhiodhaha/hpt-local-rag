import type { SourceCard } from "@hpt/server/client";
import { tidyCorpus } from "../arabic.ts";

const GIST_CHARS = 150;

/** The start of a passage's text as one line, cut at a word. A cut shows an ellipsis at the end of the text, which is the left edge of Arabic. */
export function gistOf(text: string, chars: number = GIST_CHARS): string {
  const flat = tidyCorpus(text).replace(/\s+/g, " ").trim();
  if (flat.length <= chars) return flat;
  const cut = flat.slice(0, chars);
  const space = cut.lastIndexOf(" ");
  return `${(space > chars / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

export function whereOf(locator: SourceCard["passage"]["locator"]): string | null {
  const parts = [locator.kitab, locator.bab, locator.pasal, locator.ayat].filter((part): part is string => part !== undefined && part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

const SENTENCE_END = /[.!?…”"]$/;
const SENTENCE_START = /(^|[.!?:;”"\n])\s*$/;

type QuotedSpan = { readonly start: number; readonly end: number; readonly text: string };

/**
 * What a quoted span looks like on a card: its words as one line, cut at a word when long, with "…" on the side where the sentence
 * goes on, so a quote that stops mid-sentence is not taken for a whole one. `start` is the span's offset in the passage text.
 */
export function quotedOf(passage: string, span: QuotedSpan, chars: number): string {
  const line = gistOf(span.text, chars);
  const opens = SENTENCE_START.test(passage.slice(0, span.start));
  return `${opens ? "" : "…"}${line}${SENTENCE_END.test(line) ? "" : "…"}`;
}
