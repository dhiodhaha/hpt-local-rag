import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationSummary } from "@hpt/server/client";
import { dayGroupOf, groupByDay, groupByMonth, metaOf, monthsOf, piecesOf, titlePieces, whenOf } from "../src/renderer/chat/riwayat.ts";

const NOW = new Date(2026, 10, 26, 13, 30);
const at = (month: number, day: number, hour = 9) => new Date(2026, month, day, hour).toISOString();
const conversation = (id: string, updatedAt: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: id,
  renamed: false,
  turns: 1,
  startedAt: updatedAt,
  updatedAt,
  gist: "tidak membatalkan",
  sources: 4,
  ...overrides,
});

describe("Riwayat grouping", () => {
  it("puts a conversation in today, yesterday, the last seven days or older, by local day", () => {
    assert.deepEqual([at(10, 26, 0), at(10, 25, 23), at(10, 19, 9), at(10, 18, 9), at(9, 1)].map((iso) => dayGroupOf(iso, NOW)), ["today", "yesterday", "week", "older", "older"]);
  });

  it("groups newest first and leaves out an empty group", () => {
    const groups = groupByDay([conversation("a", at(10, 20)), conversation("b", at(10, 26, 8)), conversation("c", at(10, 26, 12)), conversation("d", at(8, 2))], NOW);
    assert.deepEqual(groups.map((group) => [group.label, group.conversations.map((entry) => entry.id)]), [
      ["Hari ini", ["c", "b"]],
      ["7 hari terakhir", ["a"]],
      ["Lebih lama", ["d"]],
    ]);
  });

  it("groups by month for the full list and counts each month for the filter chips", () => {
    const all = [conversation("a", at(10, 20)), conversation("b", at(10, 2)), conversation("c", at(9, 29))];
    assert.deepEqual(groupByMonth(all).map((group) => [group.label, group.conversations.length]), [["NOVEMBER 2026", 2], ["OKTOBER 2026", 1]]);
    assert.deepEqual(monthsOf(all), [{ key: "2026-11", label: "November", count: 2 }, { key: "2026-10", label: "Oktober", count: 1 }]);
  });

  it("says when, in words a person uses", () => {
    assert.deepEqual([at(10, 26), at(10, 25), at(10, 22), at(8, 28)].map((iso) => whenOf(iso, NOW)), ["Hari ini", "Kemarin", "Min", "28 Sep"]);
    assert.equal(whenOf(new Date(2025, 11, 3).toISOString(), NOW), "3 Des 2025");
  });

  it("writes the second line from the verdict and the sources, and skips what is missing", () => {
    assert.equal(metaOf(conversation("a", at(10, 26))), "Tidak membatalkan · 4 sumber");
    assert.equal(metaOf(conversation("a", at(10, 26), { sources: 0 })), "Tidak membatalkan");
    assert.equal(metaOf(conversation("a", at(10, 26), { gist: null, sources: 0 })), "");
  });
});

describe("highlighting", () => {
  it("splits at the marked ranges and keeps every character", () => {
    const pieces = piecesOf("ber wudhu setiap", [[4, 9]]);
    assert.deepEqual(pieces, [{ text: "ber ", marked: false }, { text: "wudhu", marked: true }, { text: " setiap", marked: false }]);
    assert.equal(pieces.map((piece) => piece.text).join(""), "ber wudhu setiap");
  });

  it("marks every word of a search in a title, case-insensitively and without overlap", () => {
    assert.deepEqual(titlePieces("Mimisan dan Wudhu", ["wudhu", "mimi"]).filter((piece) => piece.marked).map((piece) => piece.text), ["Mimi", "Wudhu"]);
    assert.deepEqual(titlePieces("Tidak ada", ["xyz"]), [{ text: "Tidak ada", marked: false }]);
  });
});
