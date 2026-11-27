const ARABIC_CHARS = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
/** The joiners sit between letters of one word, so they never end a run on their own. */
const JOINERS = "\\u200C\\u200D";
/** What the corpus puts between Arabic words: spaces, Arabic punctuation, and the plain brackets and colon of a hadith source, as in "]رواه مسلم : ٨٥٨[". */
const CONNECTORS = "\\s\\u060C\\u061B\\u061F:\\[\\]()";
/** An ellipsis touching the run belongs to it, so a cut Arabic excerpt shows "…" at its own end, on the left. A square bracket touching either end of a run is part of it too, because the corpus stores a source's brackets in visual order. */
const ARABIC_RUN = new RegExp(`…?[\\[\\]]?[${ARABIC_CHARS}](?:[${ARABIC_CHARS}${JOINERS}]|[${CONNECTORS}]+(?=[${ARABIC_CHARS}]))*[\\[\\]]?…?`, "gu");
const ARABIC_LETTER = new RegExp(`[${ARABIC_CHARS}]`, "u");
export const ARABIC_CHAR = new RegExp(`[${ARABIC_CHARS}]`, "gu");

const MARKS = "\\u064B-\\u065F\\u0670";
const SPACE_BEFORE_MARK = new RegExp(`[ \\t]+(?=[${MARKS}])`, "gu");
const ALLAH_LIGATURE = new RegExp(`\\u0627?\\u0426[${MARKS}]*`, "gu");
// The corpus really holds these characters, so the patterns name them on purpose.
// oxlint-disable-next-line no-control-regex
const HAMZA_CONTROL = /[\u0007\u0008]/gu;
// oxlint-disable-next-line no-control-regex
const UNDRAWABLE = /[\u0000-\u0006\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/gu;

/**
 * Corpus text as the reader should see it. The corpus comes from PDFs, and the extraction left three kinds of damage that draw
 * as stray glyphs: a hamza-alef stored as a control character (a box), the lafz Allah stored as a Cyrillic Ц (a "ц"), and a
 * space between a letter and its vowel mark (a mark floating by itself). Each is put back to the letters it stands for. The word
 * order inside some PDF lines is scrambled in the corpus itself, and no display rule can undo that.
 */
export function tidyCorpus(text: string): string {
  return text
    .replace(HAMZA_CONTROL, "\u0623")
    .replace(UNDRAWABLE, "")
    .replace(SPACE_BEFORE_MARK, "")
    .replace(ALLAH_LIGATURE, "\u0627\u0644\u0644\u0647");
}

export type Run = { readonly text: string; readonly arabic: boolean };

/** Text split into Arabic and other runs, so each Arabic run can be drawn right to left in the Arabic font, isolated from its line. */
export function arabicRuns(raw: string): Run[] {
  const text = tidyCorpus(raw);
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

/** A one-line row split for drawing. `arabic` is empty unless the row keeps `dir` "ltr" and holds Arabic after its Latin `lead`. */
export type RowLine = { readonly dir: "rtl" | "ltr"; readonly lead: string; readonly arabic: string };

/**
 * A one-line row of corpus text is cut at its end when it is too long, and the cut must leave the beginning of each Arabic run in
 * view. An Arabic run begins on its right. So a row that starts with Arabic (digits, quotes and an ellipsis before the first letter
 * do not count) reads right to left as a whole, and its cut and "…" fall on the left. A row that starts with Latin keeps its order,
 * and its Arabic, from the first Arabic run on, is a right-to-left part of its own that takes the room the Latin leaves and is cut
 * on its left. The browser's `dir="auto"` cannot decide this, because it skips the Arabic runs, which carry a direction of their own.
 */
export function rowLine(raw: string): RowLine {
  const runs = arabicRuns(raw);
  const join = (part: Run[]) => part.map((run) => run.text).join("");
  const startsArabic = runs.find((run) => run.arabic || /\p{L}/u.test(run.text))?.arabic === true;
  const split = runs.findIndex((run) => run.arabic);
  const whole = startsArabic || split === -1;
  return { dir: startsArabic ? "rtl" : "ltr", lead: join(whole ? runs : runs.slice(0, split)), arabic: whole ? "" : join(runs.slice(split)) };
}

/** Most of the letters are Arabic: the text is an Arabic quote, drawn as its own right-to-left block, not a line with Arabic inside. */
export function isMostlyArabic(text: string): boolean {
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  const arabic = letters.filter((char) => ARABIC_LETTER.test(char));
  return letters.length > 0 && arabic.length / letters.length > 0.5;
}
