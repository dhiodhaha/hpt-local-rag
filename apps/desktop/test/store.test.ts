import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createClient } from "@hpt/server/client";
import { memoryPipe, scenarioHost, seedConversations, type ScenarioName } from "@hpt/server/testing";
import { createChatStore, eventBuffer, isBusy } from "../src/renderer/chat/store.ts";

const PERSON = { via: "enter", trusted: true, focused: true } as const;
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
    store.getState().send("  Apakah kompos boleh dibuat dari sisa daun?  ", PERSON);
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
    store.getState().send("pertama", PERSON);
    store.getState().send("kedua", PERSON);
    assert.equal(store.getState().turns.length, 1);
    await until(() => !isBusy(store.getState()) && store.getState().conversation !== null, "the first answer");
    const conversation = store.getState().conversation;
    store.getState().send("lanjut?", PERSON);
    await until(() => store.getState().turns.length === 2, "the follow-up turn");
    assert.equal(store.getState().conversation, conversation);
    await host.close();
  });

  it("drops a cancelled turn and puts its question back in the composer", async () => {
    const { store, host } = await rig("settled", 30);
    store.getState().send("batalkan ini", PERSON);
    await wait(120);
    store.getState().cancel();
    await until(() => store.getState().turns.length === 0, "the turn to be dropped");
    assert.equal(store.getState().draft, "batalkan ini");
    await host.close();
  });

  it("keeps a failed turn with its notice, and asks the same question again on retry", async () => {
    const { store, host } = await rig("not-signed-in");
    store.getState().send("coba", PERSON);
    await until(() => !isBusy(store.getState()), "the failure");
    assert.equal(store.getState().turns[0]?.run.outcome?.kind, "failed");
    store.getState().retry(PERSON);
    assert.equal(store.getState().turns.length, 1);
    assert.equal(store.getState().turns[0]?.question, "coba");
    await until(() => !isBusy(store.getState()), "the second failure");
    await host.close();
  });

  it("starts over only when nothing is running", async () => {
    const { store, host } = await rig("settled");
    store.getState().send("x", PERSON);
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

async function riwayatRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-riwayat-"));
  await seedConversations(dir);
  const host = scenarioHost("riwayat", { conversationsDir: dir, delayMs: 0 });
  const client = createClient(memoryPipe(host));
  const store = createChatStore(client, { schedule: (flush) => flush(), searchDelayMs: 0 });
  await until(() => client.state().kind === "ready", "the host");
  await store.getState().refreshHistory();
  return { store, host };
}

describe("Riwayat in the store", () => {
  it("lists the stored conversations, newest first", async () => {
    const { store, host } = await riwayatRig();
    const { history } = store.getState();
    assert.equal(history.state, "ready");
    assert.equal(history.conversations.length, 7);
    const stamps = history.conversations.map((entry) => entry.updatedAt);
    assert.deepEqual(stamps, stamps.toSorted().reverse());
    await host.close();
  });

  it("reopens a conversation with its stored answers as they were, and a follow-up continues it", async () => {
    const { store, host } = await riwayatRig();
    const target = store.getState().history.conversations.find((entry) => entry.turns === 2);
    assert.ok(target);
    await store.getState().openConversation(target.id);
    const opened = store.getState();
    assert.equal(opened.conversation, target.id);
    assert.deepEqual(opened.turns.map((turn) => [turn.fresh, turn.run.outcome?.kind]), [[false, "delivered"], [false, "delivered"]]);
    assert.equal(opened.turns[0]?.run.answer.headline, "Menurut HPT, kompos boleh dibuat dari sisa daun.");
    assert.equal(opened.turns[0]?.run.answer.headlineState, "settled");
    assert.ok((opened.turns[0]?.run.sources.length ?? 0) > 0);
    opened.send("Lanjut?", PERSON);
    await until(() => !isBusy(store.getState()), "the follow-up");
    assert.equal(store.getState().conversation, target.id);
    await until(() => store.getState().history.conversations.find((entry) => entry.id === target.id)?.turns === 3, "the refreshed history");
    await host.close();
  });

  it("does not open another conversation while a question is running", async () => {
    const { store, host } = await riwayatRig();
    store.getState().send("sedang berjalan", PERSON);
    await store.getState().openConversation(store.getState().history.conversations[3]?.id ?? "");
    assert.equal(store.getState().turns.length, 1);
    assert.equal(store.getState().turns[0]?.fresh, true);
    await until(() => !isBusy(store.getState()), "the answer");
    await host.close();
  });

  it("searches, and shows only the answer to the latest query", async () => {
    const { store, host } = await riwayatRig();
    store.getState().openSearch();
    store.getState().setQuery("dilarang");
    store.getState().setQuery("kompos");
    await until(() => store.getState().search.settled === "kompos", "the search");
    assert.ok((store.getState().search.result?.hits.length ?? 0) >= 5);
    store.getState().setQuery("");
    assert.equal(store.getState().search.result, null);
    store.getState().closeSearch();
    assert.equal(store.getState().search.open, false);
    await host.close();
  });

  it("shows a generated title in the sidebar in place of the question, once it arrives", async () => {
    const { store, host } = await rig("titled");
    store.getState().send("Apakah kompos boleh dibuat dari sisa daun?", PERSON);
    await until(() => store.getState().history.conversations[0]?.title === "Kompos dari sisa daun", "the generated title");
    assert.deepEqual(store.getState().history.conversations.map((entry) => entry.renamed), [false]);
    await host.close();
  });

  it("renames in place, and deleting the open conversation clears the screen", async () => {
    const { store, host } = await riwayatRig();
    const [first] = store.getState().history.conversations;
    assert.ok(first);
    await store.getState().openConversation(first.id);
    store.getState().startRename(first.id);
    assert.equal(store.getState().renaming, first.id);
    await store.getState().commitRename(first.id, "  Catatan kebun  ");
    assert.equal(store.getState().renaming, null);
    assert.equal(store.getState().history.conversations.find((entry) => entry.id === first.id)?.title, "Catatan kebun");

    store.getState().askDelete(first.id);
    assert.equal(store.getState().confirming?.id, first.id);
    store.getState().cancelDelete();
    assert.equal(store.getState().history.conversations.length, 7);
    store.getState().askDelete(first.id);
    await store.getState().confirmDelete();
    assert.equal(store.getState().history.conversations.some((entry) => entry.id === first.id), false);
    assert.deepEqual([store.getState().conversation, store.getState().turns.length, store.getState().confirming], [null, 0, null]);
    await host.close();
  });
});
