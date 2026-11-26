import type { FailureCode } from "../providers/index.ts";
import type { Cause, Edit } from "./types.ts";

/**
 * D10 to D10h as DATA. This file is the only place that says what a failed check means. Checks only report findings, the
 * pipeline only applies dispositions, the engine only follows `nextStep`. Change a decision here and nothing else moves.
 *
 *   1. SITE     where in the answer the finding is: a field, or an item by kind. Sites are the unit D10e reasons about.
 *   2. ACTION   what that finding does at that site: warn | repair | drop_item | withhold_item | retry_attempt, from one table.
 *               Escalate by default: a (code, site) pair not listed means retry_attempt, so new fields and kinds start safe.
 *   3. DISPOSITION  several findings on one value reduce to the worst action. The pipeline applies it.
 * Then `nextStep` says what an attempt's end means: deliver, retry once, withhold, fail.
 */

export const SITES = [
  "type",
  "basis",
  "headline",
  "headline_short",
  "summary",
  "inference_note",
  "note.exception",
  "note.practical",
  "note.difference",
  "note.revision",
  "note.referral",
  "dalil",
  "quotes",
  "unverified_references",
  "clarifying_question",
  "clarifying_options",
  "message",
  /** Not a place in the answer: the whole stream (canary, malformed JSON, field order). */
  "stream",
] as const;
export type Site = (typeof SITES)[number];

export const FINDING_CODES = [
  "canary", //               the protected token appeared in the stream or a tool argument
  "bad_json", //             the scanner hit a malformed byte, a duplicate key, or the stream ended inside the object
  "bad_shape", //            a value parsed but is not the schema's shape, or an item cites nothing
  "out_of_order", //         a field arrived before one that must precede it. The release gate reorders, so this only warns
  "trailing_text", //        text after the closing brace. Everything before it passed its checks, so this only warns
  "tool_after_output", //    the model called a tool after it had already started the answer
  "incomplete", //           the stream ended without what this `type` requires
  "unknown_source", //       a marker or `sources` entry is not in the ledger
  "superseded_cited", //     a superseded passage cited anywhere but a `revision` note (D10h)
  "quote_not_verbatim", //   a Latin quote is not an exact substring of its passage after normalisation
  "arabic_not_in_source", // Arabic that does not match a cited passage (harakat are never ignored, D10a)
  "headline_not_leading", // a reference is listed as unverified, but the headline does not open with that (D17)
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

/** `repair` is the edit the check already applied to its candidate value. It is null when the check has no repair for this finding. */
export type Finding = {
  readonly code: FindingCode;
  readonly site: Site;
  readonly detail: string;
  readonly repair: Edit | null;
};

export type Action = "warn" | "repair" | "drop_item" | "withhold_item" | "retry_attempt";

/** D10e: a serious failure is contained to its item at these sites. Everywhere else it escalates to the attempt. */
const ITEM_SCOPE: Readonly<Partial<Record<Site, Action>>> = {
  dalil: "drop_item",
  "note.practical": "drop_item",
  "note.referral": "drop_item",
  "note.exception": "withhold_item", // D10f: never silent. The pipeline emits a WithheldException.
  quotes: "drop_item", // A source-panel excerpt carries no claim, so losing it misleads nobody.
  // note.difference and note.revision are absent on purpose, so they escalate: dropping a differing view or a revision
  // notice makes the ruling read as settled and unchanged, the same harm D10f names for exceptions.
};

const NOTE_SITES = ["note.exception", "note.practical", "note.difference", "note.revision", "note.referral"] as const;

const RULES: Readonly<Record<FindingCode, Readonly<Partial<Record<Site, Action>>>>> = {
  canary: {}, //                       D10e: always stops the answer, whatever the site
  bad_json: {}, //                     D10d
  tool_after_output: {},
  incomplete: {},
  out_of_order: { stream: "warn" },
  trailing_text: { stream: "warn" },
  bad_shape: ITEM_SCOPE,
  unknown_source: ITEM_SCOPE, //       D10d and D10e
  superseded_cited: ITEM_SCOPE, //     D10e and D10h
  quote_not_verbatim: {
    //                                D10c: a Latin quote can be dropped when the claim is still backed by its source ids.
    //                                If the sources also fail, that is a second finding and the worse action wins.
    ...Object.fromEntries(NOTE_SITES.map((site) => [site, "repair" as const])),
    quotes: "drop_item",
  },
  arabic_not_in_source: { dalil: "repair" }, // D10b: null it, keep the card with translation and reference
  headline_not_leading: { headline: "warn" }, // D17: the trace and the eval count it, the reader still gets the answer
};

const RANK: Readonly<Record<Action, number>> = { warn: 0, repair: 1, drop_item: 2, withhold_item: 3, retry_attempt: 4 };

export function actionOf(finding: Finding): Action {
  const action = RULES[finding.code][finding.site] ?? "retry_attempt";
  // A repair the check did not perform is a bug in the check: fail safe rather than render an unrepaired value.
  if (action === "repair" && finding.repair === null) return "retry_attempt";
  return action;
}

export type Disposition =
  | { readonly kind: "accept" }
  | { readonly kind: "repair"; readonly edits: readonly Edit[] }
  | { readonly kind: "drop_item" }
  | { readonly kind: "withhold_item" }
  | { readonly kind: "retry_attempt"; readonly finding: Finding };

export function dispose(findings: readonly Finding[]): Disposition {
  let worst: Action = "warn";
  let trigger: Finding | null = null;
  for (const finding of findings) {
    const action = actionOf(finding);
    if (RANK[action] > RANK[worst]) {
      worst = action;
      trigger = finding;
    }
  }
  if (trigger === null) return { kind: "accept" };
  if (worst === "retry_attempt") return { kind: "retry_attempt", finding: trigger };
  if (worst === "withhold_item") return { kind: "withhold_item" };
  if (worst === "drop_item") return { kind: "drop_item" };
  return { kind: "repair", edits: findings.flatMap((finding) => (finding.repair === null ? [] : [finding.repair])) };
}

/** D10f and D10h: these cases go to the test set as a priority. The trace flags them. */
export function queuesForTestSet(finding: Finding): boolean {
  return finding.code === "superseded_cited" || actionOf(finding) === "withhold_item";
}

export type AttemptEnd =
  | { readonly kind: "complete" }
  | { readonly kind: "check_failed"; readonly finding: Finding }
  | { readonly kind: "provider_failed"; readonly code: FailureCode }
  | { readonly kind: "cancelled" };

export type NextStep =
  | { readonly kind: "deliver" }
  | { readonly kind: "retry"; readonly because: Cause }
  | { readonly kind: "withhold"; readonly finding: Finding }
  | { readonly kind: "fail"; readonly code: FailureCode }
  | { readonly kind: "cancel" };

/** D10d: one quiet retry. Check failures, provider failures and a switch to the fallback route (D20) share the same budget of attempts. */
export const MAX_ATTEMPTS = 2;

/** A retry can plausibly help. Not signed in, a spent limit and a missing model will fail the same way again. A safeguard block was stochastic in the spike (1 in 49). */
const RETRYABLE: ReadonlySet<FailureCode> = new Set<FailureCode>(["overloaded", "blocked", "boot_timeout", "crashed", "unknown"]);

/** `canFallBack`: a route that is not at its usage limit is left. A spent limit is the one provider failure that a different model can fix. */
export function nextStep(end: AttemptEnd, attempt: number, canFallBack = false): NextStep {
  if (end.kind === "complete") return { kind: "deliver" };
  if (end.kind === "cancelled") return { kind: "cancel" };
  const canRetry = attempt < MAX_ATTEMPTS;
  if (end.kind === "check_failed") {
    return canRetry ? { kind: "retry", because: { kind: "check", code: end.finding.code } } : { kind: "withhold", finding: end.finding };
  }
  if (canRetry && (RETRYABLE.has(end.code) || (end.code === "rate_limited" && canFallBack))) return { kind: "retry", because: { kind: "provider", code: end.code } };
  return { kind: "fail", code: end.code };
}
