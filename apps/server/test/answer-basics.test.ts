import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { citedOf, emptyAnswer, foldAnswer } from "../src/features/answer/fold.ts";
import { createTripwire, loadCanary } from "../src/features/answer/tripwire.ts";
import type { AnswerEvent } from "../src/features/answer/types.ts";
import { ONE, TWO, ledgerOf, makePassage } from "../src/testing/answer-fixtures.ts";
import { tempDir } from "./helpers.ts";

describe("the source ledger", () => {
  it("numbers passages densely from 1 in insertion order and resolves only canonical S-ids", () => {
    const ledger = ledgerOf(ONE, TWO);
    assert.equal(ledger.resolve("S1")?.passage.id, ONE.id);
    assert.equal(ledger.resolve("S2")?.passage.id, TWO.id);
    for (const bad of ["S0", "S3", "S01", "s1", "S1 ", "1", "S-1", "S1.5", ""]) assert.equal(ledger.resolve(bad), null, bad);
  });

  it("is idempotent: adding a passage again returns its existing entry and number", () => {
    const ledger = ledgerOf(ONE, TWO);
    const again = ledger.add(ONE, { origin: "tool" });
    assert.equal(again.sid, "S1");
    assert.equal(again.origin, "retrieval");
    assert.equal(ledger.entries.length, 2);
    assert.equal(ledger.add(makePassage(3, "baru"), { origin: "tool" }).sid, "S3");
    assert.deepEqual(ledger.passageIds, [ONE.id, TWO.id, makePassage(3, "baru").id]);
  });

  it("links a superseded pair only when both passages are in the ledger, whatever the insertion order", () => {
    const newer = makePassage(5, "versi baru", { supersedes: makePassage(4, "x").id });
    const older = makePassage(4, "versi lama", { supersededBy: newer.id });
    const both = ledgerOf(older, newer);
    assert.deepEqual(both.pair(both.resolve("S1")!), { supersedes: null, supersededBy: "S2" });
    assert.deepEqual(both.pair(both.resolve("S2")!), { supersedes: "S1", supersededBy: null });
    const alone = ledgerOf(older);
    assert.deepEqual(alone.pair(alone.resolve("S1")!), { supersedes: null, supersededBy: null });
  });
});

describe("the canary tripwire", () => {
  it("catches the canary split across any chunk seam, ignoring case", () => {
    const canary = "CANARY-7f3a91";
    const text = `jawaban biasa lalu ${canary.toLowerCase()} muncul`;
    for (let cut = 1; cut < text.length; cut += 1) {
      const wire = createTripwire(canary);
      const tripped = wire.feed(text.slice(0, cut)) || wire.feed(text.slice(cut));
      assert.equal(tripped, true, `cut at ${cut}`);
      assert.equal(wire.tripped, true);
    }
  });

  it("stays quiet for text that only starts like the canary, and stays tripped once tripped", () => {
    const wire = createTripwire("CANARY-7f3a91");
    assert.equal(wire.feed("CANARY-7f3a9"), false);
    assert.equal(wire.feed("0 dan seterusnya"), false);
    assert.equal(wire.contains("ada CANARY-7f3a91 di sini"), true);
    assert.equal(wire.feed("teks lain"), false);
    assert.equal(wire.tripped, true);
  });

  it("holds back one character fewer than the canary is long", () => {
    assert.equal(createTripwire("CANARY-7f3a91").holdBack, "CANARY-7f3a91".length - 1);
  });
});

describe("loading the canary from local settings", () => {
  it("prefers the environment, then the file, and creates a random one on first use", () => {
    const file = path.join(tempDir(), "nested", "canary.txt");
    assert.equal(loadCanary(file, { HPT_CANARY: "  CANARY-env  " }), "CANARY-env");
    const created = loadCanary(file, {});
    assert.match(created, /^CANARY-[0-9a-f]{16}$/);
    assert.equal(fs.readFileSync(file, "utf8").trim(), created);
    assert.equal(loadCanary(file, {}), created);
  });

  it("refuses an empty canary, because a missing one must never mean no check", () => {
    const file = path.join(tempDir(), "canary.txt");
    assert.throws(() => loadCanary(file, { HPT_CANARY: "   " }), /empty/);
    fs.writeFileSync(file, "\n");
    assert.throws(() => loadCanary(file, {}), /empty/);
  });
});

describe("folding events into an answer", () => {
  const field = (name: string, value: unknown) => ({ kind: "field", name, value }) as AnswerEvent;

  it("sets fields, appends items and lets the final summary replace its progress", () => {
    const events: AnswerEvent[] = [
      field("type", "answer"),
      field("headline_short", "boleh"),
      { kind: "progress", name: "summary", prose: [{ kind: "text", text: "Kompos" }, { kind: "cite", passages: null }] },
      field("summary", [{ kind: "text", text: "Kompos" }, { kind: "cite", passages: [ONE.id] }]),
      { kind: "item", name: "quotes", value: { passage: ONE.id, start: 0, end: 5, text: "Pupuk" }, edits: [] },
    ];
    const answer = events.reduce(foldAnswer, emptyAnswer());
    assert.equal(answer.type, "answer");
    assert.equal(answer.headlineShort, "boleh");
    assert.deepEqual(answer.summary, [{ kind: "text", text: "Kompos" }, { kind: "cite", passages: [ONE.id] }]);
    assert.equal(answer.quotes.length, 1);
  });

  it("returns to an empty answer on a restart and ignores events that carry no answer content", () => {
    const events: AnswerEvent[] = [field("type", "answer"), field("headline", "Menurut HPT, ...")];
    const shown = events.reduce(foldAnswer, emptyAnswer());
    assert.equal(foldAnswer(shown, { kind: "restart", copy: "Memeriksa ulang sumber…" }).headline, null);
    assert.deepEqual(foldAnswer(shown, { kind: "attempt", attempt: 2, because: null }), shown);
  });

  it("lists cited passages in first-cited order across summary, dalil, notes and quotes, once each, and not for a withheld exception", () => {
    const events: AnswerEvent[] = [
      field("summary", [{ kind: "cite", passages: [TWO.id] }]),
      { kind: "item", name: "notes", value: { withheld: "exception", id: "N1", passages: [ONE.id] }, edits: [] },
      { kind: "item", name: "quotes", value: { passage: TWO.id, start: 0, end: 1, text: "K" }, edits: [] },
    ];
    const answer = events.reduce(foldAnswer, emptyAnswer());
    assert.deepEqual(citedOf(answer), [TWO.id]);
  });
});
