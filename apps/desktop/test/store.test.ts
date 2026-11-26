import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createClient } from "@hpt/server/client";
import { memoryPipe, scenarioHost, type ScenarioName } from "@hpt/server/testing";
import { createChatStore, eventBuffer, isBusy } from "../src/renderer/chat/store.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, label: string): Promise<void> {
  for (let waited = 0; waited < 5000; waited += 10) {
    if (check()) return;
    await wait(10);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function rig(name: ScenarioName, delayMs = 0) {
  const host = scenarioHost(name, { conversationsDir: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-store-")), delayMs });
  const client = createClient(memoryPipe(host));
  let keys = 0;
  const store = createChatStore(client, { newKey: () => `t${(keys += 1)}`, schedule: (flush) => flush() });
  await until(() => client.state().kind === "ready", "the host");
  return { store, host };
}

describe("the chat store", () => {
  it("folds a streamed answer into the turn and holds the host's conversation id", async () => {
    const { store, host } = await rig("settled");
    store.getState().send("  Apakah kompos boleh dibuat dari sisa daun?  ");
    assert.equal(isBusy(store.getState()), true);
    await until(() => !isBusy(store.getState()), "the answer");
    const state = store.getState();
    assert.equal(state.turns.length, 1);
    assert.equal(state.turns[0]?.question, "Apakah kompos boleh dibuat dari sisa daun?");
    assert.equal(state.turns[0]?.run.outcome?.kind, "delivered");
    await until(() => store.getState().conversation !== null, "the conversation id");
    await host.close();
  });

  it("ignores a second question while one is running, and sends a follow-up in the same conversation", async () => {
    const { store, host } = await rig("settled", 5);
    store.getState().send("pertama");
    store.getState().send("kedua");
    assert.equal(store.getState().turns.length, 1);
    await until(() => !isBusy(store.getState()) && store.getState().conversation !== null, "the first answer");
    const conversation = store.getState().conversation;
    store.getState().send("lanjut?");
    await until(() => store.getState().turns.length === 2, "the follow-up turn");
    assert.equal(store.getState().conversation, conversation);
    await host.close();
  });

  it("drops a cancelled turn and puts its question back in the composer", async () => {
    const { store, host } = await rig("settled", 30);
    store.getState().send("batalkan ini");
    await wait(120);
    store.getState().cancel();
    await until(() => store.getState().turns.length === 0, "the turn to be dropped");
    assert.equal(store.getState().draft, "batalkan ini");
    await host.close();
  });

  it("keeps a failed turn with its notice, and asks the same question again on retry", async () => {
    const { store, host } = await rig("not-signed-in");
    store.getState().send("coba");
    await until(() => !isBusy(store.getState()), "the failure");
    assert.equal(store.getState().turns[0]?.run.outcome?.kind, "failed");
    store.getState().retry();
    assert.equal(store.getState().turns.length, 1);
    assert.equal(store.getState().turns[0]?.question, "coba");
    await until(() => !isBusy(store.getState()), "the second failure");
    await host.close();
  });

  it("starts over only when nothing is running", async () => {
    const { store, host } = await rig("settled");
    store.getState().send("x");
    store.getState().newConversation();
    assert.equal(store.getState().turns.length, 1);
    await until(() => !isBusy(store.getState()), "the answer");
    store.getState().newConversation();
    assert.deepEqual([store.getState().turns.length, store.getState().conversation], [0, null]);
    await host.close();
  });
});

describe("the event buffer", () => {
  it("folds a frame's events in order in one apply and flushes at finished", () => {
    const applied: [string, string[]][] = [];
    let scheduled = 0;
    let flush: () => void = () => {};
    const buffer = eventBuffer(
      (key, events) => applied.push([key, events.map((event) => event.kind)]),
      (run) => {
        scheduled += 1;
        flush = run;
      },
    );
    buffer.push("a", { kind: "attempt", attempt: 1, because: null });
    buffer.push("a", { kind: "settled", name: "headline" });
    assert.equal(scheduled, 1);
    assert.deepEqual(applied, []);
    flush();
    buffer.push("a", { kind: "finished", outcome: { kind: "delivered" } });
    assert.deepEqual(applied, [["a", ["attempt", "settled"]], ["a", ["finished"]]]);
  });
});
