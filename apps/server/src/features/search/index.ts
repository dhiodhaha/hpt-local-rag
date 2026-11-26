export { buildIndex, BuildError } from "./build.ts";
export { loadEmbedder, ModelUnavailableError } from "./embed.ts";
export type { Embedder, EmbedderSource } from "./embed.ts";
export { levelOf, RANK_POLICY } from "./rank.ts";
export type { EvidenceFloors } from "./rank.ts";
export { openIndex, IndexUnavailableError } from "./searcher.ts";
export { noteIdOf, statusOf } from "./client.ts";
export type {
  BuildOptions,
  BuildReport,
  Channel,
  EmbeddingReport,
  Evidence,
  EvidenceLevel,
  HitReason,
  HptIndex,
  IndexInfo,
  Locator,
  NoteRef,
  Passage,
  PassageId,
  SearchFilter,
  SearchHit,
  SearchOptions,
  SearchResult,
  SourceType,
} from "./types.ts";
