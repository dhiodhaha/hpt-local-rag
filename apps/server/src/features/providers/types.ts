import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export type Effort = "low" | "medium" | "high";

/** Both tools take string arguments only, so a parameter is its description. */
export type ToolParam = { readonly description: string };
export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly params: Readonly<Record<string, ToolParam>>;
};

/**
 * Which spare process a run uses. Each lane parks its own, so the small rewrite call (D33) and the answer never replace each
 * other's warm process.
 */
export type Lane = "answer" | "rewrite";

/** Everything a warm process can be prepared with. Two equal keys within a lane mean one process can serve either. */
export type RunProfile = {
  readonly lane: Lane;
  /** Provider-specific model id, opaque to the engine. */
  readonly model: string;
  readonly effort: Effort;
  readonly system: string;
  /** The tools the model may call. Empty means none are advertised. */
  readonly tools: readonly ToolSpec[];
};

export function profileKey(profile: RunProfile): string {
  const canonical = JSON.stringify([profile.model, profile.effort, profile.system, profile.tools]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export type ToolReply = { readonly text: string; readonly isError: boolean };

/**
 * What the model may call during one ask, owned by the engine (budget, logging and ledger writes live there).
 * A provider only adapts it. `invoke` never throws: unknown names and spent budgets come back as an error reply.
 */
export type ToolHost = {
  invoke(name: string, args: Readonly<Record<string, string>>): Promise<ToolReply>;
};

export type ProviderRequest = {
  readonly profile: RunProfile;
  /** The whole user message. The app builds it; providers keep no session. */
  readonly user: string;
  readonly tools: ToolHost;
};

export type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

/** What went wrong, in terms the engine's policy can act on. User-facing copy and retry rules live in the answer feature. */
export type FailureCode =
  | "not_signed_in"
  | "rate_limited"
  | "overloaded"
  | "blocked"
  | "model_unavailable"
  | "boot_timeout"
  | "crashed"
  | "aborted"
  | "unknown";

export type ProviderFailure = {
  readonly code: FailureCode;
  /** Raw provider text for the trace. Never shown to the user. */
  readonly detail: string;
  readonly resetsAt: string | null;
};

export type ProviderEvent =
  /** `waitMs` is what the caller waited for the provider, from run() to this event. */
  | { readonly kind: "started"; readonly waitMs: number; readonly warm: boolean }
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "tool_use"; readonly name: string }
  | { readonly kind: "end"; readonly outcome: { readonly ok: true; readonly usage: Usage } | { readonly ok: false; readonly failure: ProviderFailure } };

export type Provider = {
  readonly id: "claude" | "codex" | "scripted";
  /**
   * Stream contract, checked by `assertProviderContract`:
   *   1. at most one `started`, and it comes first;
   *   2. then any number of `text` and `tool_use`;
   *   3. then exactly one `end`, then the stream finishes;
   *   4. the stream never throws: every failure is an `end` with ok:false;
   *   5. `end` is yielded when the answer is final, not when the process has torn down;
   *   6. aborting `signal` ends the stream with failure `aborted` promptly.
   */
  run(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  /** Hint: be ready for this profile. Fire and forget, idempotent, never throws. */
  warm(profile: RunProfile): void;
  close(): Promise<void>;
};

export async function assertProviderContract(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const seen: ProviderEvent[] = [];
  for await (const event of events) {
    assert.ok(seen.at(-1)?.kind !== "end", "no event may follow end");
    if (event.kind === "started") assert.equal(seen.length, 0, "started must come first");
    seen.push(event);
  }
  assert.equal(seen.filter((event) => event.kind === "end").length, 1, "exactly one end");
  assert.equal(seen.at(-1)?.kind, "end", "end must be last");
  return seen;
}

/** What a provider can say about its login without spending a question. */
export type Connection =
  | { readonly state: "checking" }
  | { readonly state: "connected"; readonly subscription: string | null }
  | { readonly state: "not_signed_in" }
  | { readonly state: "unknown" };
