const ARABIC_CHARS = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const ARABIC_RUN = new RegExp(`[${ARABIC_CHARS}]+(?:[\\s\\u060C\\u061B\\u061F]+[${ARABIC_CHARS}]+)*`, "gu");
export const ARABIC_CHAR = new RegExp(`[${ARABIC_CHARS}]`, "gu");

export type Run = { readonly text: string; readonly arabic: boolean };

/** Text split into Arabic and other runs, so each Arabic run can be drawn right to left in the Arabic font, isolated from its line. */
export function arabicRuns(text: string): Run[] {
  const parts: Run[] = [];
  let at = 0;
  for (const match of text.matchAll(ARABIC_RUN)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index), arabic: false });
    parts.push({ text: match[0], arabic: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), arabic: false });
  return parts;
}
