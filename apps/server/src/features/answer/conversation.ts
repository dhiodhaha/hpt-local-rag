import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PassageId } from "../search/index.ts";
import { isConversationId, type ConversationId } from "./conversation-id.ts";
import type { AnswerEngine, AskOptions, Finished } from "./engine.ts";
import { citedOf } from "./fold.ts";
import type { CompleteAnswer, HistoryEntry, Scope, Turn } from "./types.ts";

/**
 * Conversations: the stored list of delivered turns, and the one place that turns them into a Turn's <history>.
 *
 * Storage is `<dir>/<id>.jsonl`, one line per DELIVERED turn, append-only. A crash mid-write leaves at worst a truncated last
 * line, which the reader skips. Recording is idempotent on the turn's id. Ids sort by creation time, so "latest" is the last
 * filename and there is no state to sync.
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
  turn(question: string, scope?: Scope | null): Turn;
  /** Build the turn, run it, and record the result if it was delivered. Returns Finished unchanged. */
  ask(engine: AnswerEngine, question: string, options?: AskOptions & { readonly scope?: Scope | null }): Promise<Finished>;
};

export type Conversations = {
  /** "new" creates one (no file until the first delivered turn). "latest" throws if there is none. Otherwise an id. */
  open(which: ConversationId | "new" | "latest"): Conversation;
  list(): readonly { readonly id: ConversationId; readonly turns: number }[];
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
  };
}
