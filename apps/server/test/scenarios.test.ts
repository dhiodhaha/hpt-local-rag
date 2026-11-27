import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldAnswer, emptyAnswer, type AnswerEvent, type Outcome } from "../src/features/answer/index.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openConversations } from "../src/features/answer/index.ts";
import { SCENARIOS, SCENARIO_NAMES, recordScenario, seedConversations, type ScenarioName } from "../src/testing/index.ts";

const EXPECTED: Record<ScenarioName, Outcome["kind"]> = {
  riwayat: "delivered",
  reader: "delivered",
  "reader-tj": "delivered",
  "reader-revised": "delivered",
  settled: "delivered",
  inferred: "delivered",
  "margin-tall": "delivered",
  "follow-up": "delivered",
  "many-dalil": "delivered",
  "arabic-rows": "delivered",
  titled: "delivered",
  restart: "delivered",
  "unverified-first": "delivered",
  fallback: "delivered",
  "out-of-scope": "delivered",
  declined: "delivered",
  insufficient: "delivered",
  clarify: "delivered",
  "not-signed-in": "failed",
  blocked: "failed",
  "limit-no-fallback": "failed",
  withheld: "withheld",
};

const kinds = (events: readonly AnswerEvent[]) => events.map((event) => event.kind);

describe("the scenarios", () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} ends in ${EXPECTED[name]}`, async () => {
      const events = await recordScenario(name);
      const last = events.at(-1);
      assert.equal(last?.kind, "finished");
      assert.equal(last?.kind === "finished" ? last.outcome.kind : null, EXPECTED[name]);
      assert.equal(events.filter((event) => event.kind === "finished").length, 1);
    });
  }

  it("shows the states the design names", async () => {
    const restart = await recordScenario("restart");
    assert.ok(kinds(restart).includes("restart"));
    const fallback = await recordScenario("fallback");
    assert.ok(kinds(fallback).includes("fallback"));
    const unverified = await recordScenario("unverified-first");
    const reference = unverified.findIndex((event) => event.kind === "item" && event.name === "unverified_references");
    const headline = unverified.findIndex((event) => event.kind === "field" && event.name === "headline");
    assert.ok(reference !== -1 && reference < headline, "the unverified reference comes before the headline");
    const settled = await recordScenario("settled");
    assert.ok(settled.findIndex((event) => event.kind === "settled") > settled.findIndex((event) => event.kind === "field" && event.name === "headline"));
  });

  it("records to a cut point, and the fold at the cut is the state the cut names", async () => {
    const verifying = (await recordScenario("settled", "verifying")).reduce(foldAnswer, emptyAnswer());
    assert.equal(verifying.headlineState, "verifying");
    const rechecking = await recordScenario("restart", "rechecking");
    assert.equal(rechecking.at(-1)?.kind, "restart");
    await assert.rejects(recordScenario("settled", "nowhere"), /no cut "nowhere"/);
  });

  it("has a script for every name it lists", () => {
    assert.deepEqual(Object.keys(EXPECTED).sort(), Object.keys(SCENARIOS).sort());
  });
});

describe("the riwayat seed", () => {
  it("writes a fictional history over several days that the conversation store lists, searches and groups", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-seed-"));
    const now = new Date(2026, 10, 26, 13, 30);
    await seedConversations(dir, now);
    const conversations = openConversations(dir);
    const summaries = conversations.summaries();
    assert.equal(summaries.length, 7);
    assert.equal(summaries[0]?.turns === 2 || summaries[1]?.turns === 2, true, "one conversation has a follow-up");
    assert.ok(summaries.every((entry) => entry.sources > 0 && entry.gist !== null));
    assert.ok(conversations.search("kompos").hits.length >= 5);
    const inAnswers = conversations.search("dilarang").hits;
    assert.ok(inAnswers.length > 0 && inAnswers.every((hit) => hit.where === "answer"));
    assert.deepEqual(fs.readdirSync(dir).filter((name) => !name.endsWith(".jsonl")), []);
  });
});
