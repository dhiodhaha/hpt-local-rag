import type { FailureCode, ProviderEvent, ProviderFailure, Usage } from "../types.ts";
import type { ClaudeMessage } from "./sdk.ts";

export type MessageState = {
  /** The last assistant `error` seen. A `success` result can still be a limit or auth failure. */
  assistantError: string | null;
  resetsAt: string | null;
};

export function newMessageState(): MessageState {
  return { assistantError: null, resetsAt: null };
}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

function noteResetsAt(source: unknown, state: MessageState): void {
  const info = record(record(source).rate_limit_info);
  if (typeof info.resetsAt === "number") state.resetsAt = new Date(info.resetsAt * 1000).toISOString();
}

/**
 * SDK message to domain events. Timing is not taken from `result.ttft_ms`, which is wrong for long outputs: the
 * engine times the first `text` event itself. Fields it does not understand are ignored.
 */
export function translate(message: ClaudeMessage, state: MessageState): ProviderEvent[] {
  if (message.type === "stream_event") {
    const event = record(message.event);
    if (event.type === "content_block_delta") {
      const delta = record(event.delta);
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text !== "") return [{ kind: "text", delta: delta.text }];
    }
    if (event.type === "content_block_start") {
      const block = record(event.content_block);
      if (block.type === "tool_use") return [{ kind: "tool_use", name: typeof block.name === "string" ? block.name : "" }];
    }
    return [];
  }
  if (message.type === "assistant") {
    if (typeof message.error === "string") state.assistantError = message.error;
    noteResetsAt(message.api_error_params, state);
    return [];
  }
  if (message.type === "rate_limit_event") {
    noteResetsAt(message, state);
    return [];
  }
  if (message.type === "result") {
    const failure = failureOf(message, state);
    return [{ kind: "end", outcome: failure === null ? { ok: true, usage: usageOf(message) } : { ok: false, failure } }];
  }
  return [];
}

function usageOf(result: ClaudeMessage): Usage {
  const usage = record(result.usage);
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheWriteTokens: num(usage.cache_creation_input_tokens),
  };
}

const AUTH_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required", "cloud_credential_error"]);

const BY_ASSISTANT_ERROR: Readonly<Record<string, FailureCode>> = {
  rate_limit: "rate_limited",
  overloaded: "overloaded",
  model_not_found: "model_unavailable",
};

const BY_STATUS: Readonly<Record<number, FailureCode>> = { 401: "not_signed_in", 403: "not_signed_in", 404: "model_unavailable", 429: "rate_limited", 529: "overloaded" };

const FAILED_TERMINAL = new Set(["api_error", "blocking_limit", "refusal"]);

function classify(result: ClaudeMessage, state: MessageState, text: string): FailureCode {
  if (/reasoning_extraction/i.test(text) || result.terminal_reason === "refusal") return "blocked";
  if (state.assistantError !== null) {
    if (AUTH_ERRORS.has(state.assistantError)) return "not_signed_in";
    const named = BY_ASSISTANT_ERROR[state.assistantError];
    if (named !== undefined) return named;
  }
  if (result.terminal_reason === "blocking_limit") return "rate_limited";
  const byStatus = typeof result.api_error_status === "number" ? BY_STATUS[result.api_error_status] : undefined;
  return byStatus ?? "unknown";
}

/**
 * Looks at `is_error`, `api_error_status`, `terminal_reason`, the preceding assistant `error` and the safeguard marker.
 * `subtype: "success"` with `is_error: true` is a failure. Returns null for a clean result.
 */
export function failureOf(result: ClaudeMessage, state: MessageState): ProviderFailure | null {
  const failed =
    result.is_error === true || (typeof result.subtype === "string" && result.subtype !== "success") || (typeof result.terminal_reason === "string" && FAILED_TERMINAL.has(result.terminal_reason));
  if (!failed) return null;
  const text = [result.result, ...(Array.isArray(result.errors) ? result.errors : [])].filter((part) => typeof part === "string").join(" ");
  return { code: classify(result, state, text), detail: text.slice(0, 500), resetsAt: state.resetsAt };
}

/** The iterator threw or ended with no `result`: the process died. Text that reads like a login problem is named as one. */
export function crashed(cause: unknown, stderrTail: string): ProviderFailure {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const detail = `${reason}${stderrTail === "" ? "" : ` | ${stderrTail}`}`.slice(0, 500);
  const code: FailureCode = /not logged in|please run \/login|claude auth login|authentication/i.test(detail) ? "not_signed_in" : "crashed";
  return { code, detail, resetsAt: null };
}
