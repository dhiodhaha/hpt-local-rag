import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crashed, failureOf, newMessageState, translate } from "../src/features/providers/claude/messages.ts";
import { successResult, textDelta, thinkingDelta, toolStart } from "./fake-claude-sdk.ts";

describe("translate", () => {
  it("streams text deltas and ignores thinking deltas and other stream events", () => {
    const state = newMessageState();
    assert.deepEqual(translate(textDelta('{"type"'), state), [{ kind: "text", delta: '{"type"' }]);
    assert.deepEqual(translate(thinkingDelta("hmm"), state), []);
    assert.deepEqual(translate({ type: "stream_event", event: { type: "message_start" } }, state), []);
    assert.deepEqual(translate({ type: "system", subtype: "init" }, state), []);
  });

  it("reports a tool call when its block starts", () => {
    assert.deepEqual(translate(toolStart("mcp__tarjih__search"), newMessageState()), [{ kind: "tool_use", name: "mcp__tarjih__search" }]);
  });

  it("ends with the usage of a clean result", () => {
    assert.deepEqual(translate(successResult(), newMessageState()), [
      { kind: "end", outcome: { ok: true, usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 100, cacheWriteTokens: 5 } } },
    ]);
  });
});

describe("failureOf", () => {
  it("names an invalid model even though the result says success, using the assistant error before it", () => {
    const state = newMessageState();
    translate({ type: "assistant", error: "model_not_found", api_error_status: 404 }, state);
    const result = { type: "result", subtype: "success", is_error: true, api_error_status: 404, terminal_reason: "api_error", result: "There is an issue with the selected model" };
    assert.equal(failureOf(result, state)?.code, "model_unavailable");
  });

  it("names the safeguard block from its marker", () => {
    const result = { type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", result: "Blocked [reasoning_extraction]" };
    assert.equal(failureOf(result, newMessageState())?.code, "blocked");
  });

  it("treats an auth label as not signed in and carries the reset time of a rate limit", () => {
    const auth = newMessageState();
    translate({ type: "assistant", error: "authentication_failed" }, auth);
    assert.equal(failureOf({ type: "result", subtype: "success", is_error: true, result: "Please log in" }, auth)?.code, "not_signed_in");

    const limited = newMessageState();
    translate({ type: "assistant", error: "rate_limit", api_error_params: { rate_limit_info: { resetsAt: 1_800_000_000 } } }, limited);
    const failure = failureOf({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "limit" }, limited);
    assert.equal(failure?.code, "rate_limited");
    assert.equal(failure?.resetsAt, new Date(1_800_000_000 * 1000).toISOString());
  });

  it("falls back to unknown for an error it cannot place, and to a clean result when nothing failed", () => {
    assert.equal(failureOf({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] }, newMessageState())?.code, "unknown");
    assert.equal(failureOf(successResult(), newMessageState()), null);
  });
});

describe("crashed", () => {
  it("reads a login problem out of the stderr tail and keeps the tail for the trace", () => {
    assert.equal(crashed(new Error("exit 1"), "Not logged in. Please run /login").code, "not_signed_in");
    const other = crashed(new Error("exit 1"), "segfault");
    assert.equal(other.code, "crashed");
    assert.match(other.detail, /segfault/);
  });
});
