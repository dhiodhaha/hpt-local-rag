export { buildIndex, BuildError } from "./build.ts";
export { loadEmbedder, ModelUnavailableError } from "./embed.ts";
export type { Embedder, EmbedderSource } from "./embed.ts";
export { openIndex, IndexUnavailableError } from "./searcher.ts";
export { noteIdOf, statusOf } from "./types.ts";
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
