import type { PassageId, Prose, ProseSpan } from "@hpt/server/client";

export type Segment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "cite"; readonly word: string; readonly passages: readonly PassageId[] | null; readonly after: string };

const PUNCTUATION = /^[.,;:!?)”"]+/;

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

export const textLength = (spans: Prose): number => spans.reduce((sum, span) => sum + (span.kind === "text" ? span.text.length : 0), 0);

function snapToWord(text: string, cut: number): number {
  if (cut <= 0 || cut >= text.length) return Math.max(0, Math.min(cut, text.length));
  if (/\s/.test(text.charAt(cut - 1)) || /\s/.test(text.charAt(cut))) return cut;
  const space = Math.max(text.lastIndexOf(" ", cut - 1), text.lastIndexOf("\n", cut - 1));
  return space + 1;
}

/** A citation appears only when every word before it has, so a number never arrives ahead of the sentence it belongs to. */
export function revealProse(spans: Prose, chars: number): Prose {
  const out: ProseSpan[] = [];
  let left = chars;
  for (const span of spans) {
    if (span.kind === "cite") {
      out.push(span);
      continue;
    }
    if (left >= span.text.length) {
      out.push(span);
      left -= span.text.length;
      continue;
    }
    const cut = snapToWord(span.text, left);
    if (cut > 0) out.push({ kind: "text", text: span.text.slice(0, cut) });
    break;
  }
  return out;
}

export const MAX_STEP_MS = 100;

export function advanceReveal(shown: number, total: number, dtMs: number, cps: number): number {
  return Math.min(total, shown + (cps * Math.min(Math.max(dtMs, 0), MAX_STEP_MS)) / 1000);
}
