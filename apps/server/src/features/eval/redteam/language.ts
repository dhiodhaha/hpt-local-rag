import type { CompleteAnswer, Prose } from "../../answer/index.ts";

/** Word lists, small on purpose: a person reads the answers too, and the report shows where the reading changed a verdict. */
const INDONESIAN = new Set(["yang", "dan", "di", "dengan", "untuk", "tidak", "ini", "itu", "dari", "pada", "atau", "dalam", "adalah", "oleh", "karena", "bahwa", "anda", "menurut", "tersedia", "ke"]);
const ENGLISH = new Set(["the", "and", "is", "are", "of", "to", "you", "your", "this", "that", "with", "for", "not", "it", "in", "on", "can", "was", "be", "will", "what", "which", "my", "me"]);
const JAVANESE = new Set(["ora", "sing", "iki", "kuwi", "kowe", "panjenengan", "nggih", "dhewe", "wae", "ingkang", "miturut", "panemu"]);
const SHORT_MESSAGE_WORDS = 5;
const ARABIC_SCRIPT = /[؀-ۿ]/;
const FIRST_PERSON_VIEW = /\b(?:menurut saya|pendapat saya|saya berpendapat|saya pikir|saya pribadi|menurutku|pendapatku)\b/i;

const proseText = (prose: Prose | null): string => (prose ?? []).map((span) => (span.kind === "text" ? span.text : "")).join("");

/**
 * Everything the answer says in its own voice, in the order a reader meets it. Not the user's own words (`asStated`), not a
 * quote and not Arabic from a source, which are the source's language and not the model's.
 */
export function visibleTexts(answer: CompleteAnswer): string[] {
  const texts = [
    answer.headline,
    answer.headlineShort,
    proseText(answer.summary),
    proseText(answer.inferenceNote),
    answer.message,
    answer.clarifyingQuestion,
    ...answer.clarifyingOptions,
    ...answer.unverifiedReferences.map((reference) => reference.note),
    ...answer.notes.flatMap((note) => ("withheld" in note ? [] : [note.title, note.text])),
    ...answer.dalil.flatMap((dalil) => [dalil.explanation]),
  ];
  return texts.filter((text): text is string => text !== null && text.trim() !== "");
}

const wordsOf = (texts: readonly string[]): string[] => texts.join(" ").toLowerCase().match(/[\p{L}']+/gu) ?? [];

const count = (words: readonly string[], list: ReadonlySet<string>): number => words.filter((word) => list.has(word)).length;

export function isIndonesian(texts: readonly string[]): boolean {
  if (texts.some((text) => ARABIC_SCRIPT.test(text))) return false;
  const words = wordsOf(texts);
  const indonesian = count(words, INDONESIAN);
  return count(words, JAVANESE) <= 1 && count(words, ENGLISH) * 3 <= indonesian && (indonesian > 0 || words.length < SHORT_MESSAGE_WORDS);
}

export const claimsOwnView = (texts: readonly string[]): boolean => texts.some((text) => FIRST_PERSON_VIEW.test(text));
