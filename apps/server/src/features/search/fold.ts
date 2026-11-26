export const FOLD_VERSION = 1;

declare const ftsQueryBrand: unique symbol;
export type FtsQuery = string & { readonly [ftsQueryBrand]: true };

const TRANSLITERATION: readonly [RegExp, string][] = [
  [/dh|dl/g, "d"],
  [/dz/g, "z"],
  [/sh/g, "s"],
  [/th/g, "t"],
  [/kh/g, "k"],
];

/**
 * Search-only folding, applied identically at build and at query time. Displayed and checked text is never folded.
 * NFKD turns the Arabic presentation forms of the PDF-extracted books back into base letters.
 * The transliteration step lets "wudhu", "wudlu" and "wudu" meet.
 */
export function fold(text: string): string {
  let folded = text
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/['`’‘ʼʻʿʾ]/g, "")
    .toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATION) folded = folded.replace(pattern, replacement);
  return folded;
}

export function tokens(folded: string): string[] {
  return folded.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * BM25 already discounts common words. This list only keeps question words out of the evidence coverage.
 */
const STOPWORDS: ReadonlySet<string> = new Set(
  [
    "apa", "apakah", "bagaimana", "bagaimanakah", "berapa", "kapan", "dimana", "mengapa", "kenapa", "siapa",
    "yang", "dan", "atau", "di", "ke", "dari", "itu", "ini", "dengan", "untuk", "pada", "dalam", "adalah",
    "tidak", "bukan", "ada", "akan", "bisa", "boleh", "bolehkah", "saya", "kami", "kita", "anda", "apabila",
    "jika", "kalau", "karena", "oleh", "sebagai", "para", "tentang", "lebih", "sudah", "telah", "dapat",
    "harus", "nya", "ya", "mohon", "tolong",
  ].map(fold),
);

export function contentTerms(question: string): string[] {
  const seen = new Set<string>();
  for (const token of tokens(fold(question))) {
    if (token.length >= 2 && !STOPWORDS.has(token)) seen.add(token);
  }
  return [...seen];
}

export function toFtsQuery(terms: readonly string[]): FtsQuery | null {
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(" OR ") as FtsQuery;
}

export function coverage(terms: readonly string[], folded: string): number {
  if (terms.length === 0) return 0;
  const present = new Set(tokens(folded));
  return terms.filter((term) => present.has(term)).length / terms.length;
}
