/**
 * The answer feature's public surface. Callers (the CLI, the eval runner, later the HTTP server) import ONLY from here.
 * Not exported on purpose: the ledger and S-ids, the scanner, the wire schemas, the checks, the policy tables, the pipeline,
 * retrieval packing, prompt rendering and the tool session. Callers cannot reach a rule except through `ask`.
 */
export { createEngine } from "./engine.ts";
export type { AnswerEngine, AskOptions, EngineDeps, EngineSettings, Finished } from "./engine.ts";

export { openConversations, historyOf } from "./conversation.ts";
export type { Conversation, ConversationId, Conversations, StoredTurn } from "./conversation.ts";

export { emptyAnswer, foldAnswer, citedOf } from "./fold.ts";

export { loadPromptTemplate } from "./prompt.ts";
export type { PromptTemplate } from "./prompt.ts";

export { loadCanary } from "./tripwire.ts";

export { jsonlTraceSink, memoryTraceSink } from "./trace.ts";
export type { AttemptTrace, FindingTrace, Trace, TraceSink } from "./trace.ts";

export { FINDING_CODES } from "./policy.ts";
export type { FindingCode } from "./policy.ts";

export { EXCEPTION_WITHHELD, FAILURE_COPY } from "./copy.ts";

export type {
  Answer,
  AnswerEvent,
  AnswerType,
  Basis,
  CompleteAnswer,
  Dalil,
  Edit,
  Excerpt,
  HistoryEntry,
  Note,
  Outcome,
  Prose,
  Scope,
  SourceCard,
  Turn,
  WithheldException,
} from "./types.ts";
