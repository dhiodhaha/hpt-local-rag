/**
 * The package's one browser-safe entry, `@hpt/server/client` in the `exports` map, and the only path an app may import from
 * `@hpt/server`: the map has no other entry, so a deep import into the engine fails to resolve instead of working by accident.
 * It is the answer feature's pure half, the host's wire and client, and the search and provider types the events mention.
 * `@hpt/server/testing` is the second, Node-only entry, for tests and scripted runs.
 */
export * from "./features/answer/client.ts";
export * from "./features/host/client.ts";
export type { Evidence, EvidenceLevel, Locator, Passage, PassageId, SourceType } from "./features/search/index.ts";
export type { Connection, Effort, FailureCode } from "./features/providers/index.ts";
