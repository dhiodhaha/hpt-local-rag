import type { NoteId } from "../features/corpus/index.ts";
import type { Passage, PassageId } from "../features/search/index.ts";
import { SourceLedger } from "../features/answer/ledger.ts";
import { FIELD_ORDER } from "../features/answer/wire.ts";

export const ARABIC = "كَتَبَ الْكَاتِبُ الْكِتَابَ";

export const TEXT_ONE = "Pupuk organik dari kompos dibuat dengan menumpuk sisa daun dan jerami lalu membaliknya tiap minggu sampai matang.";
export const TEXT_TWO = `Kompos yang belum matang tidak boleh dipakai. Ungkapan “kitab” ditulis ${ARABIC} dalam contoh ini.   Sisanya biasa saja.`;

export function makePassage(ordinal: number, text: string, overrides: Partial<Passage> = {}): Passage {
  const noteId: NoteId = `putusan/uji-${ordinal}`;
  return {
    id: `${noteId}#${ordinal}` as PassageId,
    noteId,
    ordinal,
    title: `Fatwa Uji ${ordinal}`,
    section: null,
    sourceType: "fatwa",
    parent: null,
    number: String(ordinal),
    year: 2003,
    publishedIn: null,
    locator: {},
    supersedes: null,
    supersededBy: null,
    text,
    textHash: `hash-${ordinal}`,
    sourceUrl: `https://example.test/${ordinal}`,
    ...overrides,
  };
}

export const ONE = makePassage(1, TEXT_ONE);
export const TWO = makePassage(2, TEXT_TWO);

export function ledgerOf(...passages: Passage[]): SourceLedger {
  const ledger = new SourceLedger();
  for (const passage of passages) ledger.add(passage, { origin: "retrieval" });
  return ledger;
}

type AnyJson = Record<string, unknown>;

export const GOOD_ANSWER: AnyJson = {
  type: "answer",
  basis: "explicit",
  headline: "Menurut HPT, kompos boleh dibuat dari sisa daun.",
  headline_short: "boleh",
  summary: "Kompos boleh dibuat dari sisa daun [S1]. Namun kompos harus matang [S2].",
  inference_note: null,
  notes: [
    {
      id: "N1",
      kind: "exception",
      title: "Kompos belum matang tidak boleh dipakai",
      text: "Tunggu sampai matang.",
      basis: "explicit",
      quote: { source: "S2", text: "Kompos yang belum matang tidak boleh dipakai." },
      sources: ["S2"],
    },
    { id: "N2", kind: "practical", title: "Balik tiap minggu", text: "Balik tumpukan.", basis: "explicit", quote: null, sources: ["S1"] },
  ],
  dalil: [
    { id: "D1", kind: "tarjih", reference: "Fatwa Uji 2", arabic: ARABIC, translation: null, explanation: "Contoh.", explanation_basis: "explicit", sources: ["S2"] },
  ],
  quotes: [{ source: "S1", text: "menumpuk sisa daun" }],
  unverified_references: [],
  clarifying_question: null,
  clarifying_options: [],
  message: null,
};

export function answerJson(overrides: AnyJson = {}, order: readonly string[] = FIELD_ORDER): string {
  const merged = { ...GOOD_ANSWER, ...overrides };
  const entries = order.filter((key) => key in merged).map((key) => [key, merged[key]] as const);
  return JSON.stringify(Object.fromEntries(entries));
}

export const NOTES = { exception: (GOOD_ANSWER.notes as AnyJson[])[0] as AnyJson, practical: (GOOD_ANSWER.notes as AnyJson[])[1] as AnyJson };
