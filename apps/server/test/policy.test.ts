import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDalil, checkNote, checkQuote } from "../src/features/answer/checks.ts";
import { actionOf, dispose, MAX_ATTEMPTS, nextStep, queuesForTestSet, SITES, type Finding, type FindingCode, type Site } from "../src/features/answer/policy.ts";
import type { Edit } from "../src/features/answer/types.ts";
import { NOTES, ONE, TWO, ledgerOf } from "../src/testing/answer-fixtures.ts";

const finding = (code: FindingCode, site: Site, repair: Edit | null = null): Finding => ({ code, site, detail: "", repair });
const REPAIR: Edit = { kind: "quote_dropped", id: "N1" };

describe("what a failed check means (D10 to D10h)", () => {
  it("D10b: Arabic that is not in the source is repaired by nulling it, never retried", () => {
    assert.equal(actionOf(finding("arabic_not_in_source", "dalil", { kind: "arabic_nulled", id: "D1" })), "repair");
  });

  it("D10c: a Latin quote that fails is dropped from a note and from the source panel", () => {
    assert.equal(actionOf(finding("quote_not_verbatim", "note.practical", REPAIR)), "repair");
    assert.equal(actionOf(finding("quote_not_verbatim", "note.difference", REPAIR)), "repair");
    assert.equal(actionOf(finding("quote_not_verbatim", "quotes")), "drop_item");
  });

  it("D10d and D10e: a serious failure in type, basis, headline or summary retries the whole attempt", () => {
    for (const site of ["type", "basis", "headline", "headline_short", "summary", "inference_note"] as const) {
      for (const code of ["unknown_source", "superseded_cited", "bad_shape"] as const) assert.equal(actionOf(finding(code, site)), "retry_attempt", `${code} at ${site}`);
    }
  });

  it("D10e: the same failure in a later dalil, a practical note or a referral drops only that item", () => {
    for (const site of ["dalil", "note.practical", "note.referral"] as const) {
      for (const code of ["unknown_source", "superseded_cited", "bad_shape"] as const) assert.equal(actionOf(finding(code, site)), "drop_item", `${code} at ${site}`);
    }
  });

  it("D10e: the canary and broken JSON stop the attempt wherever they are found", () => {
    for (const site of SITES) {
      assert.equal(actionOf(finding("canary", site)), "retry_attempt", `canary at ${site}`);
      assert.equal(actionOf(finding("bad_json", site)), "retry_attempt", `bad_json at ${site}`);
    }
  });

  it("D10f: a failing exception note is withheld in place, never dropped, and goes to the test set", () => {
    const failing = finding("unknown_source", "note.exception");
    assert.equal(actionOf(failing), "withhold_item");
    assert.equal(queuesForTestSet(failing), true);
    assert.equal(queuesForTestSet(finding("unknown_source", "note.practical")), false);
  });

  it("D10h: a superseded passage cited in a dalil is dropped and queued for the test set", () => {
    const cited = finding("superseded_cited", "dalil");
    assert.equal(actionOf(cited), "drop_item");
    assert.equal(queuesForTestSet(cited), true);
  });

  it("escalates a failing difference or revision note instead of dropping it, because dropping it would read as a settled ruling", () => {
    for (const site of ["note.difference", "note.revision"] as const) assert.equal(actionOf(finding("unknown_source", site)), "retry_attempt");
  });

  it("starts any pair the table does not list at a whole-attempt retry", () => {
    assert.equal(actionOf(finding("unknown_source", "clarifying_options")), "retry_attempt");
    assert.equal(actionOf(finding("incomplete", "headline")), "retry_attempt");
  });

  it("fails safe when a repair is claimed but the check did not perform one", () => {
    assert.equal(actionOf(finding("arabic_not_in_source", "dalil", null)), "retry_attempt");
  });

  it("only warns about field order, trailing text and a headline that does not lead with a missing reference", () => {
    assert.equal(actionOf(finding("out_of_order", "stream")), "warn");
    assert.equal(actionOf(finding("trailing_text", "stream")), "warn");
    assert.equal(actionOf(finding("headline_not_leading", "headline")), "warn");
    assert.deepEqual(dispose([finding("out_of_order", "stream")]), { kind: "accept" });
    assert.deepEqual(dispose([finding("headline_not_leading", "headline")]), { kind: "accept" });
  });

  it("reduces several findings on one value to the worst, and a drop beats a repair", () => {
    assert.deepEqual(dispose([]), { kind: "accept" });
    const repaired = dispose([finding("quote_not_verbatim", "note.practical", REPAIR)]);
    assert.deepEqual(repaired, { kind: "repair", edits: [REPAIR] });
    assert.equal(dispose([finding("quote_not_verbatim", "note.practical", REPAIR), finding("unknown_source", "note.practical")]).kind, "drop_item");
    assert.equal(dispose([finding("unknown_source", "note.exception"), finding("superseded_cited", "note.exception")]).kind, "withhold_item");
    const worst = finding("bad_json", "stream");
    assert.deepEqual(dispose([finding("unknown_source", "dalil"), worst]), { kind: "retry_attempt", finding: worst });
  });

});

describe("every repair the policy allows is produced by a check that performs it", () => {
  it("quote_dropped comes from a failing note quote, arabic_nulled from failing Arabic", () => {
    const ledger = ledgerOf(ONE, TWO);
    const badQuote = checkNote({ ...NOTES.practical, quote: { source: "S1", text: "kalimat yang tidak ada" } } as never, ledger);
    assert.equal(badQuote.value.quote, null);
    assert.deepEqual(
      badQuote.findings.map((item) => item.repair),
      [{ kind: "quote_dropped", id: "N2" }],
    );
    const badArabic = checkDalil({ id: "D1", kind: "quran", reference: "r", arabic: "نص غير موجود", translation: null, explanation: "e", explanation_basis: "explicit", sources: ["S2"] }, ledger);
    assert.equal(badArabic.value.arabic, null);
    assert.deepEqual(
      badArabic.findings.map((item) => item.repair),
      [{ kind: "arabic_nulled", id: "D1" }],
    );
    assert.equal(checkQuote({ source: "S1", text: "kalimat yang tidak ada" }, ledger).findings[0]?.repair, null);
  });
});

describe("what an attempt's end means (D10d)", () => {
  const failed = finding("unknown_source", "summary");

  it("delivers a complete attempt and cancels a cancelled one", () => {
    assert.deepEqual(nextStep({ kind: "complete" }, 1), { kind: "deliver" });
    assert.deepEqual(nextStep({ kind: "cancelled" }, 1), { kind: "cancel" });
  });

  it("retries a failed check once, then withholds", () => {
    assert.deepEqual(nextStep({ kind: "check_failed", finding: failed }, 1), { kind: "retry", because: { kind: "check", code: "unknown_source" } });
    assert.deepEqual(nextStep({ kind: "check_failed", finding: failed }, MAX_ATTEMPTS), { kind: "withhold", finding: failed });
  });

  it("retries only the provider failures a retry can help, and shares the one retry with check failures", () => {
    for (const code of ["overloaded", "blocked", "boot_timeout", "crashed", "unknown"] as const) {
      assert.deepEqual(nextStep({ kind: "provider_failed", code }, 1), { kind: "retry", because: { kind: "provider", code } }, code);
      assert.deepEqual(nextStep({ kind: "provider_failed", code }, MAX_ATTEMPTS), { kind: "fail", code }, code);
    }
    for (const code of ["not_signed_in", "rate_limited", "model_unavailable", "aborted"] as const) {
      assert.deepEqual(nextStep({ kind: "provider_failed", code }, 1), { kind: "fail", code }, code);
    }
  });
});
