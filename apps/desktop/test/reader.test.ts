import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { citedOf, createClient, emptyAnswer, type Answer, type Passage, type PassageId } from "@hpt/server/client";
import { ARABIC, NEW_NOTE, OLD_NOTE, READER_CITED, READER_NOTE, READER_PASSAGES, REVISED_NEW, REVISED_OLD, SCENARIOS, makePassage, memoryPipe, scenarioHost, type ScenarioName } from "@hpt/server/testing";
import { COPY } from "../src/renderer/chat/copy.ts";
import { createChatStore, isBusy } from "../src/renderer/chat/store.ts";
import { annotationsOf, bagianOf, blocksOf, citedIn, documentOf, headingBefore, lastAtOrAbove, whereOf } from "../src/renderer/reader/model.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, label: string): Promise<void> {
  for (let waited = 0; waited < 5000; waited += 10) {
    if (check()) return;
    await wait(10);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function rig(name: ScenarioName) {
  const host = scenarioHost(name, { conversationsDir: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-reader-")), delayMs: 0 });
  const client = createClient(memoryPipe(host));
  let keys = 0;
  const store = createChatStore(client, { newKey: () => `t${(keys += 1)}`, schedule: (flush) => flush() });
  await until(() => client.state().kind === "ready", "the host");
  store.getState().send(SCENARIOS[name].question);
  await until(() => !isBusy(store.getState()), "the answer");
  const turn = store.getState().turns[0];
  assert.ok(turn);
  return { store, host, turn };
}

const passage = (section: string | null, ordinal = 1): Passage => makePassage(ordinal, `Teks ${ordinal}.`, { section });

describe("a note's bagian", () => {
  it("groups consecutive passages by their top-level heading, and starts a new bagian when it comes back later", () => {
    const passages = [passage(null, 1), passage("A", 2), passage("A › a1", 3), passage("A › a2", 4), passage("B", 5), passage("A", 6)];
    const bagian = bagianOf(passages);
    assert.deepEqual(bagian.map((entry) => [entry.n, entry.title, entry.passages.map((p) => p.ordinal)]), [
      [1, null, [1]],
      [2, "A", [2, 3, 4]],
      [3, "B", [5]],
      [4, "A", [6]],
    ]);
  });

  it("is one bagian for a note with no headings, so it has no table of contents", () => {
    assert.equal(bagianOf([passage(null, 1), passage(null, 2)]).length, 1);
  });

  it("draws the bagian's title where it starts and a smaller one where a sub-heading changes inside it", () => {
    const passages = [passage("A", 1), passage("A", 2), passage("A › a1", 3), passage("A › a1", 4), passage("B › b1", 5), passage(null, 6)];
    const headings = passages.map((entry, at) => headingBefore(entry, passages[at - 1] ?? null));
    assert.deepEqual(headings, [{ level: 2, text: "A" }, null, { level: 3, text: "a1" }, null, { level: 2, text: "B" }, null]);
  });

  it("reads a document's title, meta and status from the passages themselves", () => {
    const doc = documentOf(REVISED_OLD);
    assert.equal(doc.title, "Putusan Uji tentang Istihadah");
    assert.equal(doc.meta, "Nomor 7 · Munas Uji XXX · 2000");
    assert.equal(doc.kindLabel, "Putusan");
    assert.equal(doc.revised, true);
    const current = documentOf(READER_PASSAGES);
    assert.equal(current.revised, false);
    assert.deepEqual(current.bagian.map((entry) => entry.title), ["Pengertian kompos", "Bahan dan alat", "Cara membuat kompos", "Pematangan", "Pemakaian di kebun", "Hal yang dilarang", "Penutup"]);
    assert.throws(() => documentOf([]));
  });
});

describe("a passage as blocks", () => {
  const pieces = (text: string, excerpts: { start: number; end: number }[] = []) => blocksOf(text, excerpts);
  const flat = (blocks: ReturnType<typeof blocksOf>) => blocks.map((block) => block.pieces.map((piece) => piece.text).join("")).join("\n");

  it("makes one block per non-empty line and loses no character of them", () => {
    const text = "Baris satu.\n\n   \nBaris dua yang lebih panjang.\n";
    const blocks = pieces(text);
    assert.equal(blocks.length, 2);
    assert.equal(flat(blocks), "Baris satu.\nBaris dua yang lebih panjang.");
  });

  it("marks exactly the excerpt by position, also when the same words occur earlier", () => {
    const text = "kompos boleh. Lalu kompos boleh dipakai.";
    const start = text.lastIndexOf("kompos boleh");
    const [block] = pieces(text, [{ start, end: start + "kompos boleh".length }]);
    assert.deepEqual(
      block?.pieces.map((piece) => [piece.text, piece.quoted]),
      [
        ["kompos boleh. Lalu ", false],
        ["kompos boleh", true],
        [" dipakai.", false],
      ],
    );
  });

  it("cuts an excerpt that runs over a line break at the break", () => {
    const text = "Awal kalimat\nlanjutan kalimat.";
    const blocks = pieces(text, [{ start: 5, end: text.length - 1 }]);
    assert.deepEqual(blocks.map((block) => block.pieces.filter((piece) => piece.quoted).map((piece) => piece.text)), [["kalimat"], ["lanjutan kalimat"]]);
  });

  it("keeps Arabic inside a Latin line as a run, and draws a line that is mostly Arabic as a block of its own", () => {
    const text = `Ungkapan ditulis ${ARABIC} dalam contoh.\n${ARABIC}\n“Terjemahannya.”`;
    const [inline, own, last] = pieces(text);
    assert.equal(inline?.kind, "text");
    assert.deepEqual(inline?.pieces.map((piece) => [piece.text, piece.arabic]), [
      ["Ungkapan ditulis ", false],
      [ARABIC, true],
      [" dalam contoh.", false],
    ]);
    assert.equal(own?.kind, "arabic");
    assert.equal(last?.kind, "text");
    assert.equal(last?.pieces.some((piece) => piece.arabic), false);
  });

  it("marks an excerpt inside an Arabic block too", () => {
    const text = ARABIC;
    const [block] = pieces(text, [{ start: 0, end: 4 }]);
    assert.equal(block?.kind, "arabic");
    assert.equal(block?.pieces.some((piece) => piece.quoted), true);
    assert.equal(flat([block as never]), text);
  });
});

describe("what the answer says about a note", () => {
  it("numbers the cited passages the way the answer's own marks do, with the words it quotes", async () => {
    const { store, host, turn } = await rig("reader");
    const { answer } = store.getState().turns[0]?.run ?? turn.run;
    const annotations = annotationsOf(answer);
    const ids = citedOf(answer);
    assert.deepEqual(
      [...annotations].map(([id, note]) => [id, note.number]),
      ids.map((id, index) => [id, index + 1]),
    );
    const doc = documentOf(READER_PASSAGES);
    const cited = citedIn(doc, annotations);
    assert.deepEqual(cited.map((entry) => entry.passage.ordinal), [READER_CITED.S1, READER_CITED.S2, READER_CITED.S3]);
    const quoted = cited.flatMap((entry) => entry.note.excerpts.map(({ start, end }) => entry.passage.text.slice(start, end)));
    assert.ok(quoted.includes("menumpuk sisa daun"), "the quote of the first passage is an excerpt of it");
    await host.close();
  });
});

describe("the scroll position", () => {
  it("finds the last entry at or above a line, and none when the line is above them all", () => {
    const tops = [0, 100, 250, 400];
    assert.deepEqual([-1, 0, 99, 100, 300, 400, 9000].map((y) => lastAtOrAbove(tops, y)), [-1, 0, 0, 1, 2, 3, 3]);
    assert.equal(lastAtOrAbove([], 10), -1);
  });
});

describe("the reader in the chat store", () => {
  const id = (note: string, ordinal: number) => `${note}#${ordinal}` as PassageId;

  it("opens a note at the passage a citation names, loads all of it, and closes", async () => {
    const { store, host, turn } = await rig("reader");
    const target = id(READER_NOTE, READER_CITED.S2);
    store.getState().openReader(turn.key, target);
    assert.deepEqual([store.getState().reader?.load.state, store.getState().reader?.noteId, store.getState().reader?.passage], ["loading", READER_NOTE, target]);
    await until(() => store.getState().reader?.load.state === "ready", "the note");
    const { load } = store.getState().reader ?? { load: null };
    assert.equal(load?.state === "ready" ? load.passages.length : 0, READER_PASSAGES.length);
    store.getState().closeReader();
    assert.equal(store.getState().reader, null);
    await host.close();
  });

  it("moves to another passage of the same note at once, without loading it again", async () => {
    const { store, host, turn } = await rig("reader");
    store.getState().openReader(turn.key, id(READER_NOTE, READER_CITED.S1));
    await until(() => store.getState().reader?.load.state === "ready", "the note");
    const before = store.getState().reader?.load;
    store.getState().showPassage(id(READER_NOTE, READER_CITED.S3));
    assert.equal(store.getState().reader?.passage, id(READER_NOTE, READER_CITED.S3));
    assert.equal(store.getState().reader?.load, before, "the same loaded note");
    await host.close();
  });

  it("moves to a passage of another note, and shows only the answer to the question asked last", async () => {
    const { store, host, turn } = await rig("reader-revised");
    store.getState().openReader(turn.key, id(OLD_NOTE, 1));
    store.getState().showPassage(id(NEW_NOTE, 1));
    await until(() => store.getState().reader?.load.state === "ready", "the other note");
    const { reader } = store.getState();
    assert.equal(reader?.noteId, NEW_NOTE);
    assert.deepEqual(reader?.load.state === "ready" ? reader.load.passages.map((entry) => entry.noteId) : null, REVISED_NEW.map(() => NEW_NOTE));
    await wait(30);
    assert.equal(store.getState().reader?.noteId, NEW_NOTE, "the older note's late answer was dropped");
    await host.close();
  });

  it("fails for a note the index does not have, and loads again on retry", async () => {
    const { store, host, turn } = await rig("reader");
    store.getState().openReader(turn.key, id("putusan/tidak-ada", 1));
    await until(() => store.getState().reader?.load.state === "failed", "the failure");
    store.getState().retryReader();
    assert.equal(store.getState().reader?.load.state, "loading");
    await until(() => store.getState().reader?.load.state === "failed", "the second failure");
    await host.close();
  });

  it("closes when a conversation starts over or another question is asked", async () => {
    const { store, host, turn } = await rig("reader");
    store.getState().openReader(turn.key, id(READER_NOTE, READER_CITED.S1));
    store.getState().newConversation();
    assert.equal(store.getState().reader, null);
    store.getState().send(SCENARIOS.reader.question);
    await until(() => !isBusy(store.getState()), "the answer");
    store.getState().openReader(store.getState().turns[0]?.key ?? "", id(READER_NOTE, READER_CITED.S1));
    store.getState().send("lanjut?");
    assert.equal(store.getState().reader, null);
    await host.close();
  });
});

describe("the reader never imitates the source's numbering", () => {
  const doc = documentOf(READER_PASSAGES);
  const at = (ordinal: number) => READER_PASSAGES[ordinal - 1] as Passage;
  const WORDS = /\b(paragraf|pasal|ayat)\b/i;

  it("names a passage by its derived bagian and its heading, never by a number of its own", () => {
    assert.equal(whereOf(doc, at(READER_CITED.S1)), "Bagian 3 · Tahap awal");
    assert.equal(whereOf(doc, at(READER_CITED.S2)), "Bagian 4 · Pematangan");
    assert.equal(whereOf(doc, at(READER_CITED.S3)), "Bagian 6 · Hal yang dilarang");
  });

  it("shows only the heading for a note with one bagian, and the note's title when it has no heading", () => {
    const one = documentOf([passage("Satu judul", 1), passage("Satu judul", 2)]);
    assert.equal(whereOf(one, one.passages[1] as Passage), "Satu judul");
    const none = documentOf([passage(null, 1), passage(null, 2)]);
    assert.equal(whereOf(none, none.passages[0] as Passage), none.title);
    const untitled = documentOf([passage(null, 1), passage("B", 2)]);
    assert.equal(whereOf(untitled, untitled.passages[0] as Passage), "Bagian 1");
  });

  it("has no paragraph, pasal or ayat word in any copy the reader can show", () => {
    const samples = Object.values(COPY.reader).flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const text = entry as (...args: never[]) => unknown;
      return [(text as (...args: unknown[]) => unknown)(2, 7, "Judul"), (text as (...args: unknown[]) => unknown)("Judul")].map(String);
    });
    assert.ok(samples.length > 20);
    assert.deepEqual(samples.filter((sample) => WORDS.test(sample)), []);
    assert.equal(WORDS.test(COPY.reader.citedCount(3)), false);
    assert.equal(COPY.reader.citedCount(3), "3 dikutip");
  });

  it("builds every label of a fixture note from bagian and headings only", () => {
    const labels = [
      ...doc.bagian.map((entry) => `${COPY.reader.bagian(entry.n, doc.bagian.length)} ${entry.title ?? COPY.reader.untitled}`),
      ...doc.passages.map((entry) => whereOf(doc, entry)),
      COPY.reader.tocCount(doc.bagian.length, 3),
    ];
    assert.deepEqual(labels.filter((label) => WORDS.test(label) || /\(\d+\)/.test(label)), []);
  });

  it("has no ordinal marker in the article's source", () => {
    const root = path.resolve(import.meta.dirname, "../src/renderer");
    const files = ["reader/Article.tsx", "reader/AnswerPane.tsx", "reader/ReaderView.tsx", "styles/reader.css"].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
    assert.deepEqual(files.filter((text) => /rd-pn|ordinal/.test(text) || WORDS.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))), []);
  });
});

describe("a cited passage with no verified excerpt", () => {
  it("is cited and numbered, and has no marked words, when the checks dropped the quote", () => {
    const passage = READER_PASSAGES[READER_CITED.S3 - 1] as Passage;
    const answer: Answer = { ...emptyAnswer(), type: "answer", summary: [{ kind: "text", text: "Dasar" }, { kind: "cite", passages: [passage.id] }], quotes: [], notes: [], dalil: [] };
    const annotations = annotationsOf(answer);
    assert.deepEqual(annotations.get(passage.id), { number: 1, excerpts: [] });
    const blocks = blocksOf(passage.text, annotations.get(passage.id)?.excerpts ?? []);
    assert.ok(blocks.length > 0);
    assert.equal(blocks.flatMap((block) => block.pieces).some((piece) => piece.quoted), false);
  });

  it("keeps the other passages' marks when only one of them lost its quote", () => {
    const [first, third] = [READER_PASSAGES[READER_CITED.S1 - 1], READER_PASSAGES[READER_CITED.S3 - 1]] as [Passage, Passage];
    const answer: Answer = {
      ...emptyAnswer(),
      type: "answer",
      summary: [{ kind: "cite", passages: [first.id, third.id] }],
      quotes: [{ passage: first.id, start: 0, end: 5, text: first.text.slice(0, 5) }],
      notes: [],
      dalil: [],
    };
    const annotations = annotationsOf(answer);
    assert.equal(annotations.get(first.id)?.excerpts.length, 1);
    assert.deepEqual(annotations.get(third.id)?.excerpts, []);
  });
});
