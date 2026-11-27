/**
 * What a UI may import from the search feature: the passage types and the two pure rules about a passage. No `node:*`, no I/O.
 * `src/client.ts` re-exports this file, and `test/client-surface.test.ts` bundles that entry for a browser.
 */
export { noteIdOf, statusOf } from "./types.ts";
export type { Evidence, EvidenceLevel, Locator, Passage, PassageId, SourceType } from "./types.ts";
