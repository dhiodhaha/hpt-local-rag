import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectionOf, probeClaude } from "../src/features/providers/claude/probe.ts";
import { CLAUDE_MODELS } from "../src/features/providers/index.ts";
import { MODELS } from "../src/commands/ask.ts";
import { isConversationId, openConversations } from "../src/features/answer/index.ts";
import { newId } from "../src/features/answer/conversation.ts";
import { answerConfig } from "../src/shared/config.ts";
import { tempDir } from "./helpers.ts";

describe("the Claude login check", () => {
  it("reads a signed-in account and a logged-out one from what the process reports", () => {
    assert.deepEqual(connectionOf({ email: "a@example.test", subscriptionType: "Claude Max" }), { state: "connected", subscription: "Claude Max" });
    assert.deepEqual(connectionOf({ tokenSource: "oauth" }), { state: "connected", subscription: null });
    assert.deepEqual(connectionOf({ tokenSource: "none" }), { state: "not_signed_in" });
    assert.deepEqual(connectionOf({}), { state: "not_signed_in" });
  });

  it("is unknown when the process cannot be asked, and never throws", async () => {
    assert.deepEqual(await probeClaude(() => Promise.reject(new Error("no binary"))), { state: "unknown" });
    assert.deepEqual(await probeClaude(async () => ({ subscriptionType: "Claude Pro" })), { state: "connected", subscription: "Claude Pro" });
  });
});

describe("the model catalog", () => {
  it("has one default, and it is the engine's default route", () => {
    const defaults = CLAUDE_MODELS.filter((entry) => entry.isDefault);
    assert.equal(defaults.length, 1);
    assert.deepEqual([defaults[0]?.model, defaults[0]?.effort], [answerConfig.answer.model, answerConfig.answer.effort]);
    assert.equal(answerConfig.answer.fallbacks["claude-opus-5-5"].model, CLAUDE_MODELS.find((entry) => entry.alias === "sonnet")?.model);
  });

  it("feeds the CLI's --model aliases", () => {
    for (const entry of CLAUDE_MODELS) assert.equal(MODELS[entry.alias], entry.model);
  });
});

describe("conversation ids", () => {
  it("accepts the ids the app generates and nothing that could be a path", () => {
    assert.ok(isConversationId(newId()));
    for (const bad of ["../x", "c-20261126-101500-abcd/../x", "c-20261126-101500-abcd.jsonl", "", "latest", "c-1-2-3"]) assert.equal(isConversationId(bad), false, bad);
  });

  it("is checked where the file name is made", () => {
    const conversations = openConversations(tempDir());
    assert.throws(() => conversations.open("../../escape"), /not a conversation id/);
  });
});
