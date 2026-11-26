/**
 * The answer feature's public surface. Callers (the CLI, the eval runner, the desktop host) import ONLY from here.
 * Not exported on purpose: the ledger and S-ids, the scanner, the wire schemas, the checks, the policy tables, the pipeline,
 * retrieval packing, prompt rendering and the tool session. Callers cannot reach a rule except through `ask`.
 * The pure half a UI may use lives in `client.ts` and is re-exported here, so the two surfaces cannot drift.
 */
export { createEngine } from "./engine.ts";
export type { AnswerEngine, AskOptions, EngineDeps, EngineSettings, Finished } from "./engine.ts";

export { openConversations, historyOf } from "./conversation.ts";
export type { Conversation, Conversations, StoredTurn } from "./conversation.ts";

export { openedOf } from "./history.ts";

export * from "./client.ts";

export { loadPromptTemplate } from "./prompt.ts";
export type { PromptTemplate } from "./prompt.ts";

export { loadCanary } from "./tripwire.ts";

export { jsonlTraceSink, memoryTraceSink } from "./trace.ts";
export type { AttemptTrace, FindingTrace, Trace, TraceSink } from "./trace.ts";

export { FINDING_CODES } from "./policy.ts";
export type { FindingCode } from "./policy.ts";

export { NO_LIMITS, UNKNOWN_RESET_MS, pickRoute, planOf, withLimit } from "./routes.ts";
export type { Fallbacks, Limits } from "./routes.ts";

export type { Turn } from "./types.ts";
