import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordScenario } from "@hpt/server/testing";
import { emptyRun, reduceRun, runOf } from "../src/renderer/chat/run.ts";
import { gistOf, panelOf, plainTextOf, tallyOf, viewOf, whereOf } from "../src/renderer/chat/view.ts";

const cardOf = (run: ReturnType<typeof runOf>) => {
  const view = viewOf(run);
  assert.equal(view.kind, "answer");
  return view.kind === "answer" ? view.card : null;
};

describe("the Doop states, derived from real engine runs", () => {
  it("D7.1: the headline shows as verifying while the summary streams with a pending citation, and skeleton rows wait under it", async () => {
    const card = cardOf(runOf(await recordScenario("settled", "verifying")));
    assert.equal(card?.headline?.verifying, true);
    assert.equal(card?.summaryStreaming, true);
    assert.equal(card?.summary?.some((span) => span.kind === "cite" && span.passages === null), true);
    assert.deepEqual(card?.rows, [
      { kind: "skeleton", section: "notes" },
      { kind: "skeleton", section: "dalil" },
    ]);
    assert.equal(card?.finished, false);
  });

  it("D7.2: settled drops the verify state, and the rows become counts of the items that passed", async () => {
    const run = runOf(await recordScenario("settled"));
    const card = cardOf(run);
    assert.equal(card?.headline?.verifying, false);
    assert.equal(card?.finished, true);
    assert.deepEqual(card?.rows.map((row) => (row.kind === "items" ? [row.section, row.count] : null)), [["notes", 2], ["dalil", 1]]);
    assert.deepEqual(tallyOf(run), { searched: 5, cited: 3 });
  });

  it("D7.3: a restart shows the rechecking view and keeps the Sumber panel, with its numbers gone", async () => {
    const run = runOf(await recordScenario("restart", "rechecking"));
    const view = viewOf(run);
    assert.equal(view.kind, "rechecking");
    assert.equal(view.kind === "rechecking" ? view.copy : "", "Memeriksa ulang sumber…");
    const panel = panelOf(run);
    assert.equal(panel?.hint, "numbers-return");
    assert.equal(panel?.shown.every((card) => card.number === null), true);
  });

  it("D7.3: the retry settles into a normal answer", async () => {
    const run = runOf(await recordScenario("restart"));
    assert.equal(viewOf(run).kind, "answer");
    assert.equal(run.restart?.count, 1);
  });

  it("D7.4: the unverified reference is on the card before the headline exists", async () => {
    const card = cardOf(runOf(await recordScenario("unverified-first", "reference")));
    assert.equal(card?.unverified.length, 1);
    assert.equal(card?.headline, null);
    assert.equal(panelOf(runOf(await recordScenario("unverified-first")))?.unverified.length, 1);
  });

  it("shows the fallback notice from the engine's own route", async () => {
    const run = runOf(await recordScenario("fallback"));
    assert.equal(run.fallback?.route.model, "claude-sonnet-5-5");
    assert.equal(run.fallback?.from, "claude-opus-5-5");
    assert.equal(viewOf(run).kind, "answer");
  });

  it("hides Sumber for out of scope and declined, and never shows it before the type when the evidence is absent", async () => {
    for (const name of ["out-of-scope", "declined"] as const) {
      let run = emptyRun();
      for (const event of await recordScenario(name)) {
        run = reduceRun(run, event);
        if (name === "out-of-scope") assert.equal(panelOf(run), null, `${name} after ${event.kind}`);
      }
      assert.equal(panelOf(run), null, name);
      assert.equal(viewOf(run).kind, "reply");
    }
  });

  it("shows the nearest passages for an insufficient answer, unnumbered", async () => {
    const panel = panelOf(runOf(await recordScenario("insufficient")));
    assert.equal(panel?.heading.label, "ditelusuri");
    assert.equal(panel?.shown.every((card) => card.number === null), true);
  });

  it("hides Sumber and shows a notice for a failure or a withheld answer", async () => {
    for (const name of ["not-signed-in", "blocked", "limit-no-fallback", "withheld"] as const) {
      const run = runOf(await recordScenario(name));
      assert.equal(viewOf(run).kind, "notice", name);
      assert.equal(panelOf(run), null, name);
    }
  });

  it("never takes anything back while streaming: counts and numbers only grow", async () => {
    let run = emptyRun();
    let notes = 0;
    let dalil = 0;
    let numbers = new Map<string, number>();
    for (const event of await recordScenario("settled")) {
      run = reduceRun(run, event);
      const view = viewOf(run);
      if (view.kind !== "answer") continue;
      assert.ok(view.card.notes.length >= notes && view.card.dalil.length >= dalil, "a count went down");
      notes = view.card.notes.length;
      dalil = view.card.dalil.length;
      const shown = panelOf(run)?.shown ?? [];
      const current = new Map<string, number>(shown.flatMap((card) => (card.number === null ? [] : [[card.id, card.number] as const])));
      if (run.outcome === null) for (const [id, number] of numbers) assert.equal(current.get(id), number, `${id} changed number`);
      numbers = current;
    }
  });

  it("numbers the cited cards in the order they were cited and folds the rest", async () => {
    const panel = panelOf(runOf(await recordScenario("settled")));
    assert.deepEqual(panel?.shown.map((card) => card.number), [1, 2, 3]);
    assert.deepEqual([panel?.heading.label, panel?.folded?.label, panel?.folded?.count], ["dikutip", "uncited", 2]);
  });
});

describe("the copy button", () => {
  it("copies the headline and the summary as plain text, without citation marks", async () => {
    const card = cardOf(runOf(await recordScenario("settled")));
    const text = card === null ? "" : plainTextOf(card);
    assert.ok(text.startsWith("Menurut HPT, kompos boleh dibuat dari sisa daun."));
    assert.ok(text.includes("Kompos boleh dibuat dari sisa daun. Namun kompos harus matang."));
    assert.equal(text.includes("[S"), false);
  });
});

describe("source card text", () => {
  it("cuts the gist at a word and keeps short text whole", () => {
    assert.equal(gistOf("Pendek   saja."), "Pendek saja.");
    const long = gistOf(`${"kata ".repeat(60)}akhir`);
    assert.ok(long.endsWith("…") && long.length <= 152);
  });

  it("joins the locator parts the passage has", () => {
    assert.equal(whereOf({ kitab: "Kitab Thaharah", bab: "Bab Wudhu", page: 4 }), "Kitab Thaharah · Bab Wudhu");
    assert.equal(whereOf({}), null);
  });
});
