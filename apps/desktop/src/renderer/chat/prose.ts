import type { PassageId, Prose } from "@hpt/server/client";

export type Segment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "cite"; readonly word: string; readonly passages: readonly PassageId[] | null; readonly after: string };

const PUNCTUATION = /^[.,;:!?)”"]+/;
const TAIL_WORDS = 4;

/**
 * Splits prose so a mark stays on the line with the word before it and the punctuation after it, as in the Doop frames. Text is
 * only ever a string here and a text node in the view, never markup.
 */
export function segmentsOf(spans: Prose): Segment[] {
  const out: Segment[] = [];
  spans.forEach((span, index) => {
    const previous = spans[index - 1];
    const next = spans[index + 1];
    if (span.kind === "cite") {
      if (previous?.kind === "text") return;
      out.push({ kind: "cite", word: "", passages: span.passages, after: "" });
      return;
    }
    const trailing = previous?.kind === "cite" ? (PUNCTUATION.exec(span.text)?.[0] ?? "") : "";
    const last = out.at(-1);
    if (trailing !== "" && last?.kind === "cite") out[out.length - 1] = { ...last, after: trailing };
    const body = span.text.slice(trailing.length);
    if (next?.kind !== "cite") {
      out.push({ kind: "text", text: body });
      return;
    }
    const word = /\S+$/.exec(body)?.[0] ?? "";
    out.push({ kind: "text", text: body.slice(0, body.length - word.length) });
    out.push({ kind: "cite", word, passages: next.passages, after: "" });
  });
  return out.filter((segment) => segment.kind === "cite" || segment.text !== "");
}

/** The last few words of a still-streaming summary, which the frame draws faded. */
export function splitTail(text: string): { readonly lead: string; readonly tail: string } {
  const parts = text.split(/(\s+)/);
  const keep = Math.max(0, parts.length - TAIL_WORDS * 2);
  const lead = parts.slice(0, keep).join("");
  return { lead, tail: text.slice(lead.length) };
}
