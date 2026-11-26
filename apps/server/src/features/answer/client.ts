/**
 * What a UI may import from the answer feature: pure values and types, no `node:*`, no I/O. `index.ts` re-exports this file, so
 * the node surface and the UI surface share one definition. `test/client-surface.test.ts` bundles `src/client.ts` for the
 * browser and fails if a Node or native module is reachable.
 *
 * Not here on purpose: the engine, the pipeline, the ledger and its S-ids, the policy tables, trace writing. A UI folds events
 * with `foldAnswer` and never re-implements what an event means.
 */
export { emptyAnswer, foldAnswer, citedOf } from "./fold.ts";

export { EXCEPTION_WITHHELD, FAILURE_COPY, RESTART, WITHHELD, fallbackNotice, modelName } from "./copy.ts";

export { isConversationId } from "./conversation-id.ts";
export type { ConversationId } from "./conversation-id.ts";

export type { Route } from "./routes.ts";
export type {
  Answer,
  AnswerEvent,
  AnswerType,
  Basis,
  Cause,
  CompleteAnswer,
  Dalil,
  Edit,
  Excerpt,
  HeadlineState,
  HistoryEntry,
  Note,
  Outcome,
  Prose,
  ProseSpan,
  Scope,
  SourceCard,
  UnverifiedReference,
  WithheldException,
} from "./types.ts";
