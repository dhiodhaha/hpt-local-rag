import type { NoteId } from "../corpus/index.ts";
import type { Embedder } from "./embed.ts";

declare const passageIdBrand: unique symbol;
export type PassageId = string & { readonly [passageIdBrand]: true };

export function passageId(noteId: NoteId, ordinal: number): PassageId {
  return `${noteId}#${ordinal}` as PassageId;
}

export function noteIdOf(id: PassageId): NoteId {
  return id.slice(0, id.lastIndexOf("#"));
}

export const SOURCE_TYPES = ["putusan", "fatwa", "hpt", "penjelasan", "tanya_jawab", "opinion"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type Channel = "keyword" | "vector";

export type MapCollection = "sources" | "concepts" | "entities" | "quran";

export type Locator = {
  volume?: string;
  kitab?: string;
  bab?: string;
  pasal?: string;
  ayat?: string;
  footnote?: string;
  page?: number;
};

/**
 * A citable passage: always a piece of a putusan note. There is no `status` field.
 * `supersededBy` is the single source of truth and `statusOf` derives the label.
 * `text` is the canonical string the model sees and quotes are checked against. It is never folded.
 */
export type Passage = {
  id: PassageId;
  noteId: NoteId;
  ordinal: number;
  title: string;
  section: string | null;
  sourceType: SourceType;
  parent: string | null;
  number: string | null;
  year: number | null;
  publishedIn: string | null;
  locator: Locator;
  supersedes: PassageId | null;
  supersededBy: PassageId | null;
  text: string;
  textHash: string;
  sourceUrl: string;
};

export function statusOf(passage: Passage): "active" | "superseded" {
  return passage.supersededBy === null ? "active" : "superseded";
}

export type NoteRef = { noteId: NoteId; title: string; collection: MapCollection };

export type HitReason =
  | { kind: "direct"; channel: Channel; rank: number }
  | { kind: "via_link"; channel: Channel; rank: number; from: NoteRef };

export type SearchHit = {
  passage: Passage;
  score: number;
  reasons: [HitReason, ...HitReason[]];
  /** Passages with identical text that were collapsed into this hit. */
  duplicates: PassageId[];
};

export type EvidenceLevel = "strong" | "weak" | "absent";

export type Evidence = {
  level: EvidenceLevel;
  signals: {
    /** Share of the question's content terms found in the top hit's title and text, 0..1. */
    topCoverage: number;
    topIsDirect: boolean;
  };
};

export type SearchFilter = {
  noteIds?: readonly NoteId[];
  sourceTypes?: readonly SourceType[];
  years?: { from?: number; to?: number };
};

export type SearchOptions = {
  limit?: number;
  channels?: readonly Channel[];
  /** A filter turns link expansion off: only passages that match the filter directly are returned. */
  filter?: SearchFilter;
};

export type SearchResult = {
  hits: SearchHit[];
  /** Non-citable notes that matched. Never evidence. */
  leads: NoteRef[];
  evidence: Evidence;
  channels: readonly Channel[];
  ms: { keyword: number; total: number };
};

export type IndexInfo = {
  path: string;
  schemaVersion: number;
  chunkerVersion: number;
  foldVersion: number;
  channels: readonly Channel[];
  /** Null for a keyword-only index. */
  embedding: { model: string; dims: number } | null;
  fingerprint: string;
  counts: { notes: number; passages: number; mapPassages: number };
};

export type HptIndex = {
  readonly info: IndexInfo;
  search(question: string, options?: SearchOptions): Promise<SearchResult>;
  getPassages(ids: readonly string[]): Map<PassageId, Passage>;
  hasPutusan(noteId: NoteId): boolean;
  close(): void;
};

export type BuildOptions = {
  vaultDir: string;
  outFile: string;
  channels: readonly Channel[];
  /** Required when `channels` includes "vector". Without an `embedder` the build loads the model and may download it. */
  embedding?: { cacheFile: string; modelDir: string; embedder?: Embedder };
  revisionsFile?: string;
  onProgress?: (message: string) => void;
};

export type TokenSummary = { passages: number; overLimit: number; p50: number; p90: number; max: number };

export type EmbeddingReport = {
  model: string;
  dims: number;
  /** Vectors read from the cache and vectors computed by this build. */
  cached: number;
  embedded: number;
  ms: number;
  /** Tokens per embedder input, before the model truncates it. */
  tokens: { citable: TokenSummary; map: TokenSummary };
  cacheBytes: number;
};

export type BuildReport = {
  fingerprint: string;
  channels: readonly Channel[];
  ms: number;
  bytes: number;
  embedding: EmbeddingReport | null;
  counts: { notes: number; passages: number; mapPassages: number; mapLinks: number };
  passagesBySourceType: Record<SourceType, number>;
  wordCount: { p10: number; p50: number; p90: number; max: number };
  bookSections: { noteId: NoteId; section: string | null; sourceType: SourceType; page: number | null; words: number }[];
  /** Compiled books whose table-of-contents titles were not all found as headings in the body. */
  unmatchedTocTitles: { noteId: NoteId; count: number }[];
  /** Against the index that was replaced. Null on a first build or after a version change. */
  drift: { added: number; removed: number; changed: PassageId[] } | null;
};
