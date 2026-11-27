import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createEngine, jsonlTraceSink, loadPromptTemplate, memoryTraceSink, openConversations, scrubConversation, type Trace } from "../src/features/answer/index.ts";
import { generateTitle, MAX_TITLE_CHARS, titleFrom, titleMessage, titleProfile } from "../src/features/answer/title.ts";
import { claudeModelOptions, createClient, createHost, type AskParams } from "../src/features/host/index.ts";
import { chunked, scriptedProvider, type ScriptedAttempt } from "../src/features/providers/index.ts";
import { answerConfig } from "../src/shared/config.ts";
import { GOOD_ANSWER, ONE, TWO, answerJson } from "../src/testing/answer-fixtures.ts";
import { fakeIndex } from "../src/testing/fake-index.ts";
import { memoryPipe } from "../src/testing/memory-pipe.ts";
import { tempDir } from "./helpers.ts";

const PROMPT = loadPromptTemplate(answerConfig.systemPromptDoc);
const SETTINGS = { model: "claude-haiku-test", effort: "low" as const, budgetMs: 300 };
const now = () => performance.now();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const answer = (): ScriptedAttempt => ({ chunks: chunked(answerJson(), 40) });
const OUT_OF_SCOPE = answerJson({ ...GOOD_ANSWER, type: "out_of_scope", basis: null, headline: null, headline_short: null, summary: null, notes: [], dalil: [], quotes: [], message: "Pertanyaan ini di luar bahasan Tarjih." });
const reply = (text: string, delayMs = 0): ScriptedAttempt => ({ chunks: [text], delayMs });
const failing: ScriptedAttempt = { chunks: [], fail: { code: "crashed", detail: "scripted", resetsAt: null } };

describe("what a title looks like", () => {
  it("is the first line, without a label, quotes or a closing period", () => {
    assert.equal(titleFrom("Shalat Jumat saat diare"), "Shalat Jumat saat diare");
    assert.equal(titleFrom('"Darah luka dan wudhu."'), "Darah luka dan wudhu");
    assert.equal(titleFrom("Judul: “Zakat fitrah dengan uang”\nPenjelasan lain"), "Zakat fitrah dengan uang");
    assert.equal(titleFrom("\n\n  **Puasa bagi ibu menyusui…**  \n"), "Puasa bagi ibu menyusui");
  });

  it("starts with a capital and puts a reply written in capitals back to lower case", () => {
    assert.equal(titleFrom("shalat jumat saat diare"), "Shalat jumat saat diare");
    assert.equal(titleFrom("SHALAT JUMAT SAAT DIARE"), "Shalat jumat saat diare");
    assert.equal(titleFrom("Shalat Jumat saat diare"), "Shalat Jumat saat diare");
  });

  it("is at most 48 characters, cut at a whole word", () => {
    const title = titleFrom("Hukum menggunakan pupuk kandang yang belum matang pada tanaman");
    assert.equal(title, "Hukum menggunakan pupuk kandang yang belum");
    assert.ok((title ?? "").length <= MAX_TITLE_CHARS);
    assert.equal(titleFrom("x".repeat(80))?.length, MAX_TITLE_CHARS);
  });

  it("is nothing when the reply is blank or a whole sentence", () => {
    assert.equal(titleFrom("   \n"), null);
    assert.equal(titleFrom('""'), null);
    assert.equal(titleFrom(`${"kata ".repeat(40)}akhir`), null);
  });
});

describe("the title request", () => {
  it("shows the question and the headline, never an answer's text, and escapes markup in them", () => {
    const message = titleMessage("Apakah <b>kompos</b> boleh?", "Menurut HPT, kompos boleh.");
    assert.equal(message, "<pertanyaan>Apakah &lt;b>kompos&lt;/b> boleh?</pertanyaan>\n<jawaban>Menurut HPT, kompos boleh.</jawaban>");
  });

  it("asks a Haiku process with no tools, on the rewrite's lane, and says what a title is in Indonesian", () => {
    const profile = titleProfile(SETTINGS);
    assert.deepEqual([profile.lane, profile.tools, profile.model, profile.effort], ["rewrite", [], "claude-haiku-test", "low"]);
    assert.match(profile.system, /3 sampai 6 kata/);
    assert.match(profile.system, /Shalat Jumat saat diare/);
  });
});

describe("generating a title", () => {
  const run = (script: ScriptedAttempt[], signal?: AbortSignal) => {
    const provider = scriptedProvider(script);
    return { provider, result: generateTitle({ provider, settings: SETTINGS, question: "Apakah kompos boleh?", headline: "Menurut HPT, boleh.", signal, now }) };
  };

  it("returns the title and the time it took", async () => {
    const { result, provider } = run([reply("Kompos dari sisa daun")]);
    const made = await result;
    assert.equal(made.text, "Kompos dari sisa daun");
    assert.equal(made.fallback, null);
    assert.equal(provider.requests.length, 1);
  });

  it("gives up at the budget, however long the provider takes", async () => {
    const { result } = run([reply("Terlambat", 2000)]);
    const started = performance.now();
    const made = await result;
    assert.deepEqual([made.text, made.fallback], [null, "timeout"]);
    assert.ok(performance.now() - started < 1000);
  });

  it("falls back when the provider fails, when the reply is blank, and when the call was cancelled", async () => {
    assert.equal((await run([failing]).result).fallback, "failed");
    assert.equal((await run([reply("  ")]).result).fallback, "unusable");
    const controller = new AbortController();
    controller.abort();
    const { result, provider } = run([reply("Tidak dipanggil")], controller.signal);
    assert.equal((await result).fallback, "cancelled");
    assert.equal(provider.requests.length, 0);
  });
});

describe("a stored title", () => {
  const newest = () => {
    const dir = tempDir();
    const conversations = openConversations(path.join(dir, "conversations"));
    return { conversations, dir };
  };
  const seeded = async (script: ScriptedAttempt[] = [answer()]) => {
    const { conversations, dir } = newest();
    const engine = createEngine({ index: fakeIndex([ONE, TWO]), provider: scriptedProvider(script), prompt: PROMPT, canary: "CANARY-test", traces: memoryTraceSink(), settings: { ...answerConfig.answer, rewrite: undefined } });
    const conversation = conversations.open("new");
    await conversation.ask(engine, "Apakah kompos boleh dibuat dari sisa daun?");
    return { conversations, id: conversation.id, dir };
  };

  it("takes the place of the question, and is not a rename", async () => {
    const { conversations, id } = await seeded();
    const summary = conversations.autoTitle(id, "Kompos dari sisa daun");
    assert.deepEqual([summary?.title, summary?.renamed], ["Kompos dari sisa daun", false]);
    assert.deepEqual(conversations.summaries().map((entry) => [entry.title, entry.renamed]), [["Kompos dari sisa daun", false]]);
  });

  it("never replaces a title a person typed, and a rename replaces it", async () => {
    const { conversations, id } = await seeded();
    conversations.rename(id, "Judul saya");
    assert.equal(conversations.autoTitle(id, "Kompos dari sisa daun"), null);
    assert.equal(conversations.summaries()[0]?.title, "Judul saya");
    const other = await seeded();
    other.conversations.autoTitle(other.id, "Kompos dari sisa daun");
    assert.deepEqual([other.conversations.rename(other.id, "Judul saya")?.title, other.conversations.summaries()[0]?.renamed], ["Judul saya", true]);
  });

  it("stays out of the way of a rename made while it was being generated, also a rename back to the question", async () => {
    const { conversations, id } = await seeded();
    conversations.rename(id, "   ");
    assert.equal(conversations.autoTitle(id, "Kompos dari sisa daun"), null);
    assert.equal(conversations.summaries()[0]?.renamed, false);
    assert.equal(conversations.summaries()[0]?.title, "Apakah kompos boleh dibuat dari sisa daun?");
  });

  it("is not stored for a conversation with no turns, for an empty title, or twice", async () => {
    const { conversations, id } = await seeded();
    assert.equal(conversations.autoTitle("c-20261120-090000-aaaa", "Judul"), null);
    assert.equal(conversations.autoTitle(id, "   "), null);
    assert.notEqual(conversations.autoTitle(id, "Pertama"), null);
    assert.equal(conversations.autoTitle(id, "Kedua"), null);
    assert.equal(conversations.summaries()[0]?.title, "Pertama");
  });

  it("is found by the sidebar's search, and goes when the conversation is deleted", async () => {
    const { conversations, id } = await seeded();
    conversations.autoTitle(id, "Pupuk organik");
    assert.equal(conversations.search("organik").hits.length, 1);
    conversations.remove(id);
    assert.deepEqual(conversations.summaries(), []);
  });
});

describe("the title in the trace", () => {
  async function traced() {
    const dir = tempDir();
    const tracesDir = path.join(dir, "traces");
    const provider = scriptedProvider([answer(), answer(), reply("Kompos dari sisa daun")]);
    const engine = createEngine({ index: fakeIndex([ONE, TWO]), provider, prompt: PROMPT, canary: "CANARY-test", traces: jsonlTraceSink(tracesDir), settings: { ...answerConfig.answer, rewrite: undefined, title: SETTINGS } });
    const first = await engine.ask({ question: "Apakah kompos boleh?", history: [], scope: null }, { conversation: { id: "c-20261120-090000-aaaa", turn: 1 } });
    const second = await engine.ask({ question: "Lalu pupuk?", history: [], scope: null }, { conversation: { id: "c-20261120-090000-aaaa", turn: 2 } });
    const lines = () => fs.readdirSync(tracesDir).flatMap((name) => fs.readFileSync(path.join(tracesDir, name), "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Trace));
    return { engine, first, second, tracesDir, lines };
  }

  it("is recorded on the line of the answer it follows, with its time, whether it was used and why not", async () => {
    const { engine, first, second, lines } = await traced();
    assert.deepEqual(lines().map((trace) => trace.title), [null, null]);
    const made = await engine.title(first, "Apakah kompos boleh?", () => true);
    assert.equal(made?.text, "Kompos dari sisa daun");
    const [updated, untouched] = lines();
    assert.deepEqual([updated?.id, updated?.title?.used, updated?.title?.fallback, updated?.title?.text], [first.id, true, null, "Kompos dari sisa daun"]);
    assert.equal(typeof updated?.title?.ms, "number");
    assert.deepEqual([untouched?.id, untouched?.title], [second.id, null]);
  });

  it("says a title was not used when a rename got there first", async () => {
    const { engine, first, lines } = await traced();
    const made = await engine.title(first, "Apakah kompos boleh?", () => false);
    assert.deepEqual([made?.text, made?.fallback], [null, "renamed"]);
    assert.deepEqual([lines()[0]?.title?.used, lines()[0]?.title?.fallback, lines()[0]?.title?.text], [false, "renamed", null]);
  });

  it("is scrubbed with the conversation, like the rewrite query, and the numbers stay", async () => {
    const { engine, first, tracesDir, lines } = await traced();
    await engine.title(first, "Apakah kompos boleh?", () => true);
    assert.equal(scrubConversation(tracesDir, "c-20261120-090000-aaaa"), 2);
    const [scrubbed] = lines();
    assert.deepEqual([scrubbed?.conversation, scrubbed?.title?.text, scrubbed?.title?.used], [null, null, true]);
    assert.equal(typeof scrubbed?.title?.ms, "number");
    assert.equal(JSON.stringify(lines()).includes("Kompos dari sisa daun"), false);
  });

  it("is left alone on a line written before titles existed", () => {
    const tracesDir = path.join(tempDir(), "traces");
    fs.mkdirSync(tracesDir);
    const old = { v: 1, id: "a", at: "2026-11-20T09:00:00Z", conversation: "c-1", tools: [], rewrite: null };
    fs.writeFileSync(path.join(tracesDir, "2026-11-20.jsonl"), `${JSON.stringify(old)}\n`);
    assert.equal(scrubConversation(tracesDir, "c-1"), 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tracesDir, "2026-11-20.jsonl"), "utf8").trim()).title, null);
  });
});

describe("titling through the host", () => {
  function rig(script: ScriptedAttempt[], options: { title?: typeof SETTINGS | undefined } = { title: SETTINGS }) {
    const provider = scriptedProvider(script);
    const traces = memoryTraceSink();
    const engine = createEngine({ index: fakeIndex([ONE, TWO]), provider, prompt: PROMPT, canary: "CANARY-test", traces, settings: { ...answerConfig.answer, rewrite: undefined, title: options.title } });
    const conversations = openConversations(path.join(tempDir(), "conversations"));
    const host = createHost({ backend: { engine, conversations, index: fakeIndex([ONE, TWO]) }, models: claudeModelOptions(), probe: () => Promise.resolve({ state: "unknown" }), close: () => engine.close(), log: () => {} });
    const client = createClient(memoryPipe(host));
    const order: string[] = [];
    const titles: string[] = [];
    client.onTitle((conversation) => {
      order.push("title");
      titles.push(conversation.title);
    });
    return { provider, traces, conversations, client, order, titles, host };
  }
  const ask = (overrides: Partial<AskParams> = {}): AskParams => ({ conversation: null, question: "Apakah kompos boleh?", scope: null, choice: null, origin: { via: "enter", trusted: true, focused: true, turn: 1 }, ...overrides });
  const asked = async (client: ReturnType<typeof rig>["client"], order: string[], overrides: Partial<AskParams> = {}) => {
    const result = await client.ask(ask(overrides), () => {}).done;
    order.push("result");
    return result;
  };

  it("titles the conversation after its first answer, and the answer does not wait for it", async () => {
    const { client, order, titles, conversations, traces } = rig([answer(), reply("Kompos dari sisa daun", 40)]);
    const result = await asked(client, order);
    assert.deepEqual(order, ["result"]);
    assert.equal(conversations.summaries()[0]?.title, "Apakah kompos boleh?");
    await wait(150);
    assert.deepEqual(order, ["result", "title"]);
    assert.deepEqual(titles, ["Kompos dari sisa daun"]);
    assert.deepEqual(conversations.summaries().map((entry) => [entry.id, entry.title, entry.renamed]), [[result.conversation, "Kompos dari sisa daun", false]]);
    assert.deepEqual([traces.traces[0]?.title?.used, traces.traces[0]?.title?.fallback], [true, null]);
  });

  it("asks once per conversation: a follow-up does not title it again", async () => {
    const { client, order, titles, provider } = rig([answer(), reply("Kompos dari sisa daun"), answer(), reply("Judul lain")]);
    const first = await asked(client, order);
    await wait(100);
    await asked(client, order, { conversation: first.conversation, question: "Lalu pupuk?" });
    await wait(100);
    assert.equal(provider.requests.length, 3);
    assert.deepEqual(titles, ["Kompos dari sisa daun"]);
  });

  it("keeps the question for a first reply that is not an answer, and makes no call", async () => {
    const { client, order, titles, provider, conversations } = rig([{ chunks: chunked(OUT_OF_SCOPE, 40) }, reply("Tidak dipakai")]);
    await asked(client, order);
    await wait(100);
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(titles, []);
    assert.equal(conversations.summaries()[0]?.title, "Apakah kompos boleh?");
  });

  it("makes no call when the engine has no title settings", async () => {
    const { client, order, provider } = rig([answer(), reply("Tidak dipakai")], { title: undefined });
    await asked(client, order);
    await wait(100);
    assert.equal(provider.requests.length, 1);
  });

  it("keeps the question when the call fails or runs past its budget, and says so in the trace", async () => {
    const failed = rig([answer(), failing]);
    await asked(failed.client, failed.order);
    await wait(100);
    assert.deepEqual([failed.titles, failed.traces.traces[0]?.title?.fallback, failed.traces.traces[0]?.title?.used], [[], "failed", false]);

    const slow = rig([answer(), reply("Terlambat", 2000)], { title: { ...SETTINGS, budgetMs: 50 } });
    await asked(slow.client, slow.order);
    await wait(200);
    assert.deepEqual([slow.titles, slow.traces.traces[0]?.title?.fallback], [[], "timeout"]);
    assert.equal(slow.conversations.summaries()[0]?.title, "Apakah kompos boleh?");
  });

  it("lets a rename made before the title arrives win, and records that the title was not used", async () => {
    const { client, order, titles, conversations, traces } = rig([answer(), reply("Kompos dari sisa daun", 80)]);
    const result = await asked(client, order);
    await client.request("rename", { conversation: result.conversation, title: "Judul saya" });
    await wait(250);
    assert.deepEqual(titles, []);
    assert.deepEqual(conversations.summaries().map((entry) => [entry.title, entry.renamed]), [["Judul saya", true]]);
    assert.deepEqual([traces.traces[0]?.title?.used, traces.traces[0]?.title?.fallback, traces.traces[0]?.title?.text], [false, "renamed", null]);
  });

  it("sends nothing once the host is closing", async () => {
    const { client, order, titles, host } = rig([answer(), reply("Kompos dari sisa daun", 500)]);
    await asked(client, order);
    await host.close();
    await wait(50);
    assert.deepEqual(titles, []);
  });
});
