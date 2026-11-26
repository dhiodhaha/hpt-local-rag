import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { openConversations, type StoredTurn } from "../src/features/answer/conversation.ts";
import { emptyAnswer } from "../src/features/answer/fold.ts";
import { normalizeTitle, openedOf, searchOf, snippetOf, summaryOf, termsOf } from "../src/features/answer/history.ts";
import type { CompleteAnswer } from "../src/features/answer/types.ts";
import { ONE, TWO } from "../src/testing/answer-fixtures.ts";
import { tempDir } from "./helpers.ts";

const answer = (overrides: Partial<CompleteAnswer> = {}): CompleteAnswer => ({
  ...emptyAnswer(),
  type: "answer",
  basis: "explicit",
  headline: "Menurut HPT, kompos boleh dibuat dari sisa daun.",
  headlineShort: "boleh",
  summary: [{ kind: "text", text: "Kompos dari sisa daun boleh dipakai " }, { kind: "cite", passages: [ONE.id] }, { kind: "text", text: "." }],
  ...overrides,
});

const turn = (n: number, question: string, at: string, overrides: Partial<CompleteAnswer> = {}): StoredTurn => ({
  id: `ask-${n}-${question.length}`,
  n,
  at,
  question,
  scope: null,
  answer: answer(overrides),
  context: [ONE.id, TWO.id],
});

const stored = (id: string, turns: StoredTurn[], title: string | null = null) => ({ summary: summaryOf(id, turns, title)!, turns });

describe("a conversation summary", () => {
  it("titles by the first question and describes the latest answer", () => {
    const summary = summaryOf("c-1", [turn(1, "  Apakah   kompos boleh? ", "2026-11-20T09:00:00Z"), turn(2, "Dan pupuk?", "2026-11-21T10:00:00Z", { headlineShort: "boleh juga" })], null)!;
    assert.equal(summary.title, "Apakah kompos boleh?");
    assert.deepEqual([summary.renamed, summary.turns, summary.startedAt, summary.updatedAt, summary.gist, summary.sources], [false, 2, "2026-11-20T09:00:00Z", "2026-11-21T10:00:00Z", "boleh juga", 1]);
  });

  it("is null before the first delivered turn, and a rename wins over the first question", () => {
    assert.equal(summaryOf("c-1", [], null), null);
    assert.equal(summaryOf("c-1", [turn(1, "q", "2026-11-20T09:00:00Z")], "Judul saya")?.title, "Judul saya");
  });

  it("cleans a title, and an empty one means no rename", () => {
    assert.equal(normalizeTitle("  Kompos \n  daun  "), "Kompos daun");
    assert.equal(normalizeTitle("   "), null);
    assert.equal(normalizeTitle("x".repeat(500))?.length, 120);
  });
});

describe("search over questions and stored answers", () => {
  const compost = stored("c-1", [turn(1, "Apakah kompos boleh dibuat dari sisa daun?", "2026-11-20T09:00:00Z")]);
  const laterQuestion = stored("c-2", [turn(1, "Bagaimana pupuk?", "2026-11-21T09:00:00Z"), turn(2, "Dan kompos matang?", "2026-11-21T09:05:00Z", { summary: [{ kind: "text", text: "Tunggu." }] })]);
  const answerOnly = stored("c-3", [turn(1, "Hukum pupuk kandang?", "2026-11-22T09:00:00Z", { headline: "Pupuk kandang boleh.", summary: [{ kind: "text", text: "Pupuk kandang yang sudah matang boleh dicampur ke dalam tumpukan." }] })]);

  it("matches the title and marks nothing in a snippet, since the row shows it", () => {
    const { hits } = searchOf([compost, laterQuestion, answerOnly], "kompos");
    const first = hits.find((hit) => hit.conversation.id === "c-1")!;
    assert.deepEqual([first.where, first.turn, first.snippet], ["question", 1, null]);
  });

  it("matches a later question, and says which turn it was", () => {
    const hit = searchOf([laterQuestion], "kompos").hits[0]!;
    assert.deepEqual([hit.where, hit.turn], ["question", 2]);
    assert.equal(hit.snippet?.text, "Dan kompos matang?");
    assert.deepEqual(hit.snippet?.marks, [[4, 10]]);
  });

  it("falls back to stored answer text and marks the match inside it", () => {
    const hit = searchOf([answerOnly], "matang").hits[0]!;
    assert.equal(hit.where, "answer");
    const { text, marks } = hit.snippet!;
    assert.deepEqual(marks.map(([from, to]) => text.slice(from, to)), ["matang"]);
  });

  it("needs every word, in any block of the conversation, and ignores case", () => {
    const all = [compost, laterQuestion, answerOnly];
    assert.deepEqual(searchOf(all, "KOMPOS daun").hits.map((hit) => hit.conversation.id), ["c-2", "c-1"]);
    assert.deepEqual(searchOf(all, "kompos kandang").hits, []);
    assert.deepEqual(searchOf(all, "pupuk matang").hits.map((hit) => hit.conversation.id), ["c-3", "c-2"]);
    assert.deepEqual(searchOf(all, "tidak ada").hits, []);
  });

  it("returns nothing for a blank query and lists newest first", () => {
    assert.deepEqual(searchOf([compost], "   "), { terms: [], hits: [] });
    assert.deepEqual(searchOf([compost, laterQuestion, answerOnly], "pupuk").hits.map((hit) => hit.conversation.id), ["c-3", "c-2"]);
  });

  it("does not search Arabic or withheld exceptions, and cuts a long block at word edges", () => {
    assert.deepEqual(termsOf(" Wudhu  wudhu  Shalat "), ["wudhu", "shalat"]);
    const long = `${"kata ".repeat(40)}wudhu${" kata".repeat(40)}`;
    const { text, marks } = snippetOf(long, ["wudhu"]);
    assert.ok(text.startsWith("…") && text.endsWith("…"));
    assert.deepEqual(marks.map(([from, to]) => text.slice(from, to)), ["wudhu"]);
    assert.ok(text.length < 140);
  });
});

describe("reopening a stored conversation", () => {
  it("rebuilds each turn's panel from its ledger and numbers the earlier citation", () => {
    const first = turn(1, "pertama?", "2026-11-20T09:00:00Z");
    const second = turn(2, "kedua?", "2026-11-20T09:05:00Z");
    const summary = summaryOf("c-1", [first, second], null)!;
    const opened = openedOf(summary, [first, second], new Map([[ONE.id, ONE]]));
    assert.deepEqual(opened.turns[0]?.sources.map((card) => [card.n, card.passage.id, card.priorTurn]), [[1, ONE.id, null]]);
    assert.deepEqual(opened.turns[1]?.sources.map((card) => [card.n, card.priorTurn]), [[1, 1]]);
    assert.deepEqual(opened.turns[1]?.answer, second.answer);
  });
});

describe("the conversation files", () => {
  const seed = (dir: string, id: string, ...turns: StoredTurn[]) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${turns.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  };

  it("lists newest first and keeps a rename beside the turns, never inside them", () => {
    const dir = path.join(tempDir(), "conversations");
    seed(dir, "c-20261120-090000-aaaa", turn(1, "lama?", "2026-11-20T09:00:00Z"));
    seed(dir, "c-20261121-090000-bbbb", turn(1, "baru?", "2026-11-21T09:00:00Z"));
    const conversations = openConversations(dir);
    assert.deepEqual(conversations.summaries().map((entry) => entry.title), ["baru?", "lama?"]);
    const before = fs.readFileSync(path.join(dir, "c-20261120-090000-aaaa.jsonl"), "utf8");
    assert.equal(conversations.rename("c-20261120-090000-aaaa", "Judul baru")?.title, "Judul baru");
    assert.equal(fs.readFileSync(path.join(dir, "c-20261120-090000-aaaa.jsonl"), "utf8"), before);
    assert.deepEqual(openConversations(dir).summaries().map((entry) => entry.title), ["baru?", "Judul baru"]);
    assert.equal(conversations.rename("c-20261120-090000-aaaa", "  ")?.title, "lama?");
    assert.equal(conversations.list().length, 2);
  });

  it("renames nothing that does not exist, and refuses an id that is not one", () => {
    const conversations = openConversations(path.join(tempDir(), "conversations"));
    assert.equal(conversations.rename("c-20261120-090000-aaaa", "x"), null);
    assert.throws(() => conversations.rename("../../etc/passwd", "x"), /not a conversation id/);
    assert.throws(() => conversations.remove("..\\..\\x"), /not a conversation id/);
  });

  it("deletes the turns and the rename, and deleting twice is fine", () => {
    const dir = path.join(tempDir(), "conversations");
    seed(dir, "c-20261120-090000-aaaa", turn(1, "lama?", "2026-11-20T09:00:00Z"));
    const conversations = openConversations(dir);
    conversations.rename("c-20261120-090000-aaaa", "Judul");
    conversations.remove("c-20261120-090000-aaaa");
    conversations.remove("c-20261120-090000-aaaa");
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.deepEqual(conversations.summaries(), []);
  });

  it("skips a file with no readable turn and a truncated last line", () => {
    const dir = path.join(tempDir(), "conversations");
    seed(dir, "c-20261120-090000-aaaa", turn(1, "lama?", "2026-11-20T09:00:00Z"));
    fs.appendFileSync(path.join(dir, "c-20261120-090000-aaaa.jsonl"), '{"id":"cut","n":2,"quest');
    fs.writeFileSync(path.join(dir, "c-20261121-090000-bbbb.jsonl"), "");
    assert.deepEqual(openConversations(dir).summaries().map((entry) => entry.turns), [1]);
  });
});
