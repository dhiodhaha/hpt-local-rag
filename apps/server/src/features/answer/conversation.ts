import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PassageId } from "../search/index.ts";
import { isConversationId, type ConversationId } from "./conversation-id.ts";
import type { AnswerEngine, AskOptions, Finished } from "./engine.ts";
import { citedOf } from "./fold.ts";
import { normalizeTitle, searchOf, summaryOf, type ConversationSummary, type SearchResult } from "./history.ts";
import type { CompleteAnswer, HistoryEntry, Scope, Turn } from "./types.ts";

/**
 * Conversations: the stored list of delivered turns, and the one place that turns them into a Turn's <history>.
 *
 * Storage is `<dir>/<id>.jsonl`, one line per DELIVERED turn, append-only. A crash mid-write leaves at worst a truncated last
 * line, which the reader skips. Recording is idempotent on the turn's id. Ids sort by creation time, so "latest" is the last
 * filename and there is no state to sync.
 *
 * A rename lives in `<id>.meta.json` beside the turns, so the append-only turn file that `pnpm hpt ask` shares is never rewritten
 * and two writers never share a file.
 *
 * Only delivered answers are stored. Clarify, insufficient, out_of_scope and declined count, because a tapped clarifying
 * option is a follow-up. A withheld, failed or cancelled ask leaves no turn, so the user asks again against an unchanged
 * history.
 */
export type StoredTurn = {
  /** The ask's id. Equals the trace id. */
  readonly id: string;
  readonly n: number;
  readonly at: string;
  readonly question: string;
  readonly scope: Scope | null;
  readonly answer: CompleteAnswer;
  /** The ledger in order, so a stored answer's chips keep their numbers. */
  readonly context: readonly PassageId[];
};

export type Conversation = {
  readonly id: ConversationId;
  readonly turns: readonly StoredTurn[];
  /** null until the first delivered turn. */
  summary(): ConversationSummary | null;
  turn(question: string, scope?: Scope | null): Turn;
  /** Build the turn, run it, and record the result if it was delivered. Returns Finished unchanged. */
  ask(engine: AnswerEngine, question: string, options?: AskOptions & { readonly scope?: Scope | null }): Promise<Finished>;
};

export type Conversations = {
  /** "new" creates one (no file until the first delivered turn). "latest" throws if there is none. Otherwise an id. */
  open(which: ConversationId | "new" | "latest"): Conversation;
  list(): readonly { readonly id: ConversationId; readonly turns: number }[];
  /** Every stored conversation, newest first. Reads each file, which is fine for a person's own history. */
  summaries(): readonly ConversationSummary[];
  /** Every term must appear in the conversation's questions or stored answers. */
  search(query: string): SearchResult;
  /** An empty title clears the rename. Returns null when there is no such conversation. */
  rename(id: ConversationId, title: string): ConversationSummary | null;
  /** Deletes the turns and the rename. Idempotent: a conversation that is already gone is not an error. */
  remove(id: ConversationId): void;
};

export function historyOf(turns: readonly StoredTurn[]): HistoryEntry[] {
  return turns.map(({ n, question, answer }) => ({
    n,
    question,
    type: answer.type,
    gist: answer.headline ?? answer.clarifyingQuestion ?? answer.message,
    basis: answer.basis,
    cited: citedOf(answer),
  }));
}

function readTurns(file: string): StoredTurn[] {
  if (!fs.existsSync(file)) return [];
  const turns: StoredTurn[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      turns.push(JSON.parse(line) as StoredTurn);
    } catch {
      // A truncated last line from a crash mid-write.
    }
  }
  return turns;
}

const metaFile = (dir: string, id: ConversationId): string => path.join(dir, `${id}.meta.json`);

function readTitle(dir: string, id: ConversationId): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile(dir, id), "utf8")) as { title?: unknown };
    return typeof meta.title === "string" ? normalizeTitle(meta.title) : null;
  } catch {
    return null;
  }
}

export function newId(): ConversationId {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `c-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

export function openConversations(dir: string): Conversations {
  const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort() : []);

  function conversation(id: ConversationId): Conversation {
    const file = path.join(dir, `${id}.jsonl`);
    const turns = readTurns(file);
    return {
      id,
      get turns() {
        return turns;
      },
      summary: () => summaryOf(id, turns, readTitle(dir, id)),
      turn: (question, scope = null) => ({ question, history: historyOf(turns), scope }),
      async ask(engine, question, options = {}) {
        const { scope = null, ...rest } = options;
        const n = turns.length + 1;
        const finished = await engine.ask({ question, history: historyOf(turns), scope }, { ...rest, conversation: { id, turn: n } });
        if (finished.answer !== null && !turns.some((turn) => turn.id === finished.id)) {
          const stored: StoredTurn = { id: finished.id, n, at: new Date().toISOString(), question, scope, answer: finished.answer, context: finished.context };
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(file, `${JSON.stringify(stored)}\n`);
          turns.push(stored);
        }
        return finished;
      },
    };
  }

  const ids = () => files().map((name) => name.replace(/\.jsonl$/, ""));
  const stored = () =>
    ids().flatMap((id) => {
      const turns = readTurns(path.join(dir, `${id}.jsonl`));
      const summary = summaryOf(id, turns, readTitle(dir, id));
      return summary === null ? [] : [{ summary, turns }];
    });

  return {
    open(which) {
      if (which === "new") return conversation(newId());
      if (which === "latest") {
        const latest = files().at(-1);
        if (latest === undefined) throw new Error("There is no earlier conversation to continue.");
        return conversation(latest.replace(/\.jsonl$/, ""));
      }
      if (!isConversationId(which)) throw new Error(`"${which}" is not a conversation id.`);
      return conversation(which);
    },
    list: () => files().map((name) => ({ id: name.replace(/\.jsonl$/, ""), turns: readTurns(path.join(dir, name)).length })),
    summaries: () => stored().map((entry) => entry.summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    search: (query) => searchOf(stored(), query),
    rename(id, title) {
      if (!isConversationId(id)) throw new Error(`"${id}" is not a conversation id.`);
      const turns = readTurns(path.join(dir, `${id}.jsonl`));
      if (turns.length === 0) return null;
      const next = normalizeTitle(title);
      if (next === null) fs.rmSync(metaFile(dir, id), { force: true });
      else fs.writeFileSync(metaFile(dir, id), JSON.stringify({ title: next }));
      return summaryOf(id, turns, next);
    },
    remove(id) {
      if (!isConversationId(id)) throw new Error(`"${id}" is not a conversation id.`);
      fs.rmSync(path.join(dir, `${id}.jsonl`), { force: true });
      fs.rmSync(metaFile(dir, id), { force: true });
    },
  };
}
