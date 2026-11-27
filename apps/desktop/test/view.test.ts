import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordScenario } from "@hpt/server/testing";
import { emptyRun, reduceRun, runOf } from "../src/renderer/chat/run.ts";
import { plainTextOf } from "../src/renderer/chat/article.ts";
import { gistOf, quotedOf, whereOf } from "../src/renderer/chat/passage.ts";
import { DISCLAIMER_SHOWN, conversationShowsDisclaimer, panelOf, showsDisclaimer, viewOf } from "../src/renderer/chat/view.ts";

const cardOf = (run: ReturnType<typeof runOf>) => {
  const view = viewOf(run);
  assert.equal(view.kind, "answer");
  return view.kind === "answer" ? view.card : null;
};

describe("the Doop states, derived from real engine runs", () => {
  it("D7.1: the headline shows as verifying while the summary streams with a pending citation, and a placeholder waits under it", async () => {
    const card = cardOf(runOf(await recordScenario("settled", "verifying")));
    assert.equal(card?.lead.headline?.verifying, true);
    assert.equal(card?.lead.streaming, true);
    assert.equal(card?.lead.summary?.some((span) => span.kind === "cite" && span.passages === null), true);
    assert.equal(card?.pending, true);
    assert.equal(card?.finished, false);
  });

  it("D7.2: settled drops the verify state and the placeholder, and the blocks hold the items that passed", async () => {
    const run = runOf(await recordScenario("settled"));
    const card = cardOf(run);
    assert.equal(card?.lead.headline?.verifying, false);
    assert.equal(card?.finished, true);
    assert.equal(card?.pending, false);
    assert.deepEqual([card?.notes?.items.length, card?.dalil.length], [2, 1]);
    assert.equal(card?.cited.length, 3);
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

  it("D7.4: the unverified reference is in the answer before the headline exists", async () => {
    const card = cardOf(runOf(await recordScenario("unverified-first", "reference")));
    assert.equal(card?.unverified.length, 1);
    assert.equal(card?.lead.headline, null);
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
      assert.ok((view.card.notes?.items.length ?? 0) >= notes && view.card.dalil.length >= dalil, "a count went down");
      notes = view.card.notes?.items.length ?? 0;
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

describe("a Sumber row's quoted line", () => {
  it("shows the answer's own quote, with an ellipsis where the sentence goes on, and the start of the passage when nothing was quoted", async () => {
    const panel = panelOf(runOf(await recordScenario("settled")));
    const [first, second, third] = panel?.shown ?? [];
    assert.deepEqual([first?.line, first?.quoted, first?.copy], ["“…menumpuk sisa daun…”", true, "menumpuk sisa daun"]);
    assert.deepEqual([second?.line, second?.quoted], ["“Kompos yang belum matang tidak boleh dipakai.”", true]);
    assert.equal(third?.quoted, false);
    assert.equal(third?.line.startsWith("Daun kering juga"), true);
  });

  it("puts an ellipsis only on the side where the sentence goes on", () => {
    const text = "Kalimat pertama. Kutipan di tengah kalimat ini terus berlanjut.";
    const start = text.indexOf("Kutipan");
    const quote = { start, end: start + 21, text: "Kutipan di tengah kal" };
    assert.equal(quotedOf(text, quote, 90), "Kutipan di tengah kal…");
    assert.equal(quotedOf(text, { start: 4, end: 20, text: "pertama. Kutipan" }, 90), "…pertama. Kutipan…");
    assert.equal(quotedOf("Ini kalimat.", { start: 0, end: 12, text: "Ini kalimat." }, 90), "Ini kalimat.");
  });
});

describe("the copy button", () => {
  it("copies the whole answer as plain text, without citation marks: the lead, the dalil and the notes", async () => {
    const card = cardOf(runOf(await recordScenario("settled")));
    const text = card === null ? "" : plainTextOf(card);
    assert.ok(text.startsWith("Menurut HPT, kompos boleh dibuat dari sisa daun. Kompos boleh dibuat dari sisa daun. Namun kompos harus matang."));
    assert.ok(text.includes("Dalilnya. Fatwa Uji 2 memuat teks ini:"));
    assert.ok(text.includes("Yang perlu diperhatikan. Satu pengecualian: Kompos belum matang tidak boleh dipakai."));
    assert.equal(text.includes("[S"), false);
  });
});

describe("source card text", () => {
  it("cuts the gist at a word and keeps short text whole", () => {
    assert.equal(gistOf("Pendek   saja."), "Pendek saja.");
    const long = gistOf(`${"kata ".repeat(60)}akhir`);
    assert.ok(long.endsWith("…") && long.length <= 152);
    assert.ok(gistOf(`${"kata ".repeat(120)}akhir`, 360).length > long.length, "a preview is longer than a gist");
  });

  it("joins the locator parts the passage has", () => {
    assert.equal(whereOf({ kitab: "Kitab Thaharah", bab: "Bab Wudhu", page: 4 }), "Kitab Thaharah · Bab Wudhu");
    assert.equal(whereOf({}), null);
  });
});

describe("the disclaimer", () => {
  const shown = async (name: Parameters<typeof recordScenario>[0], cut?: string) => showsDisclaimer(viewOf(runOf(await recordScenario(name, cut))));

  it("belongs to an answer, while it streams and when it is done", async () => {
    assert.equal(await shown("settled"), true);
    assert.equal(await shown("settled", "verifying"), true);
  });

  it("is never under a reply that is not an answer: out of scope, declined, clarify, insufficient", async () => {
    for (const name of ["out-of-scope", "declined", "clarify", "insufficient"] as const) assert.equal(await shown(name), false, name);
  });

  it("is never under a failure or a withheld answer", async () => {
    for (const name of ["not-signed-in", "blocked", "limit-no-fallback", "withheld"] as const) assert.equal(await shown(name), false, name);
  });

  it("is never there while the type is still unknown: working, or rechecking after a restart", async () => {
    assert.equal(await shown("settled", "thinking"), false);
    assert.equal(showsDisclaimer(viewOf(emptyRun())), false);
    assert.equal(await shown("restart", "rechecking"), false);
  });

  it("shows under the question box once the conversation holds a real answer, and never before", async () => {
    const answered = runOf(await recordScenario("settled"));
    const refused = runOf(await recordScenario("clarify"));
    assert.equal(conversationShowsDisclaimer([]), false);
    assert.equal(conversationShowsDisclaimer([refused]), false);
    assert.equal(conversationShowsDisclaimer([answered]), true);
    assert.equal(conversationShowsDisclaimer([refused, answered]), true, "a real answer after a reply that is not one");
  });

  it("has one decision per answer type", () => {
    assert.deepEqual(DISCLAIMER_SHOWN, { answer: true, insufficient: false, clarify: false, out_of_scope: false, declined: false });
  });
});
