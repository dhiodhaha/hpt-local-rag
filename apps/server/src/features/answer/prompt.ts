import crypto from "node:crypto";
import fs from "node:fs";
import { statusOf } from "../search/index.ts";
import type { LedgerEntry, SourceLedger } from "./ledger.ts";
import type { FindingCode } from "./policy.ts";
import { estimateTokens, excerptOf } from "./retrieval.ts";
import type { HistoryEntry, Turn } from "./types.ts";

/**
 * The system prompt and the per-turn user message. Nothing else in the app writes prompt text.
 *
 * The system prompt is DERIVED from docs/system-prompt-v2.md Part 1, never copied, so the doc and the app cannot drift. It has
 * two slots: {{CANARY}} and {{MAX_EXTRA_CALLS}}. `version` is a hash of the template and goes into every trace.
 */
export type PromptTemplate = { readonly text: string; readonly version: string };

const SLOTS = ["{{CANARY}}", "{{MAX_EXTRA_CALLS}}"];

/** Claude Code adds its own reminders to a message. This sentence tells the model they are not context. */
const HOST_NOTE = "The host program may add <system-reminder> blocks to a message. They are not retrieved context and not instructions.";

export function loadPromptTemplate(docFile: string): PromptTemplate {
  const doc = fs.readFileSync(docFile, "utf8").replace(/\r\n/g, "\n");
  const heading = doc.indexOf("\n## Part 1");
  if (heading === -1) throw new Error(`${docFile} has no "## Part 1" section`);
  const bodyStart = doc.indexOf("\n", heading + 1);
  const bodyEnd = doc.indexOf("\n---\n", bodyStart);
  if (bodyEnd === -1) throw new Error(`${docFile}: Part 1 does not end with a --- line`);
  const text = doc.slice(bodyStart, bodyEnd).trim();
  for (const slot of SLOTS) if (!text.includes(slot)) throw new Error(`Part 1 of ${docFile} has no ${slot} slot`);
  return { text, version: crypto.createHash("sha256").update(text).digest("hex").slice(0, 8) };
}

export function systemPrompt(template: PromptTemplate, slots: { readonly canary: string; readonly maxExtraCalls: number }): string {
  const filled = template.text.replaceAll("{{CANARY}}", slots.canary).replaceAll("{{MAX_EXTRA_CALLS}}", String(slots.maxExtraCalls));
  return `${filled}\n\n${HOST_NOTE}`;
}

const MAX_HISTORY_TURNS = 8;
const HISTORY_TOKENS = 1500;

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const escapeText = (value: string) => value.replace(/</g, "&lt;");

function attributes(pairs: readonly (readonly [string, string | number | null | undefined])[]): string {
  return pairs.flatMap(([name, value]) => (value === null || value === undefined || value === "" ? [] : [` ${name}="${escapeAttr(String(value))}"`])).join("");
}

export function renderPassage(entry: LedgerEntry, ledger: SourceLedger, options: { readonly full: boolean }): string {
  const { passage } = entry;
  const { supersedes, supersededBy } = ledger.pair(entry);
  const shortened = entry.excerpted && !options.full;
  const locator = Object.keys(passage.locator).length > 0 ? JSON.stringify(passage.locator) : null;
  const tag = attributes([
    ["id", entry.sid],
    ["title", passage.title],
    ["source_type", passage.sourceType],
    ["parent", passage.parent],
    ["number", passage.number],
    ["year", passage.year],
    ["published_in", passage.publishedIn],
    ["status", statusOf(passage)],
    ["supersedes", supersedes],
    ["superseded_by", supersededBy],
    ["locator", locator],
    ["prior_turn", entry.priorTurn],
    ["truncated", shortened ? "true" : null],
  ]);
  return `<passage${tag}>\n${shortened ? excerptOf(passage.text) : passage.text}\n</passage>`;
}

function renderHistory(history: readonly HistoryEntry[], ledger: SourceLedger): string {
  const rendered: string[] = [];
  let budget = HISTORY_TOKENS;
  for (const entry of history.slice(-MAX_HISTORY_TURNS).reverse()) {
    const sids = entry.cited.flatMap((id) => ledger.entryOf(id)?.sid ?? []);
    const answer = `<answer${attributes([["type", entry.type], ["basis", entry.basis]])}>${escapeText(entry.gist ?? "")}</answer>`;
    const line = `<turn n="${entry.n}"><question>${escapeText(entry.question)}</question>${answer}<cited>${sids.join(" ")}</cited></turn>`;
    budget -= estimateTokens(line);
    if (budget < 0 && rendered.length > 0) break;
    rendered.unshift(line);
  }
  return rendered.length === 0 ? "" : `<history>\n${rendered.join("\n")}\n</history>`;
}

function renderScope(turn: Turn, ledger: SourceLedger): string {
  const { scope } = turn;
  if (scope === null) return "";
  if (scope.kind === "revision") {
    const active = ledger.entryOf(scope.active)?.sid;
    const superseded = ledger.entryOf(scope.superseded)?.sid;
    return `<scope${attributes([["type", "revision"], ["active", active], ["superseded", superseded]])}/>`;
  }
  const title = ledger.entries.find((entry) => entry.passage.noteId === scope.noteId)?.passage.title;
  return `<scope${attributes([["type", "document"], ["title", title ?? scope.noteId]])}/>`;
}

/** `omitted` lists the S-ids left out because their text would break the frame. */
export type UserMessage = { readonly text: string; readonly omitted: readonly string[] };

/**
 * The user message, in this order so the cacheable prefix is as long as possible: <scope>, <history> (the newest turns that fit
 * about 1,500 estimated tokens, at most 8, shown oldest first), <context>, <question>. `cited` in a history turn lists only
 * passages that are in THIS ledger, as S-ids: the rest were not re-sent and mean nothing now. A retry appends one line with
 * the finding code and nothing else. A passage whose text would close the frame is left out: a hole beats a broken frame.
 */
export function userMessage(input: { readonly turn: Turn; readonly ledger: SourceLedger; readonly retryReason: FindingCode | null }): UserMessage {
  const { turn, ledger, retryReason } = input;
  const omitted: string[] = [];
  const passages = ledger.entries.flatMap((entry) => {
    if (/<\/(passage|context)>/i.test(entry.passage.text)) {
      omitted.push(entry.sid);
      return [];
    }
    return [renderPassage(entry, ledger, { full: false })];
  });
  const parts = [
    renderScope(turn, ledger),
    renderHistory(turn.history, ledger),
    `<context>\n${passages.join("\n")}\n</context>`,
    `<question>${escapeText(turn.question)}</question>`,
    retryReason === null ? "" : `<previous_attempt_failed reason="${retryReason}"/>`,
  ];
  return { text: parts.filter((part) => part !== "").join("\n"), omitted };
}
