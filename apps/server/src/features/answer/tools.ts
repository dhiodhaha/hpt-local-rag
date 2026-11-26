import type { HptIndex } from "../search/index.ts";
import type { ToolHost, ToolReply, ToolSpec } from "../providers/index.ts";
import type { SourceLedger } from "./ledger.ts";
import { renderPassage } from "./prompt.ts";
import { FULL_PASSAGES } from "./retrieval.ts";
import type { Tripwire } from "./tripwire.ts";

/**
 * D2 to D2c: the extra calls the model may make, one budget per ANSWER. A quiet retry inherits what is left.
 *
 *   search(query)      index.search. New hits join the ledger and come back rendered like <context> entries with their S-ids.
 *                      A passage already in the ledger comes back under its existing S-id without its text (idempotent).
 *   get_passage(id)    `id` is an S-id from the context. Returns the full text of an excerpted passage.
 * With a budget of 0 the profile advertises no tools at all (D2c: Sajikan ulang and clarify use none; the eval compares 0, 2, 5).
 *
 * The budget is decremented synchronously when a call starts, so parallel calls cannot overspend. A call past the budget is
 * not run: the reply tells the model the budget is spent and to answer `insufficient` if the evidence is still short (D2b).
 * Every call, granted or denied, is logged with its argument (D2a). `host(attempt)` closes the previous attempt's host, so a
 * straggler call from an aborted process neither spends budget nor writes to the ledger.
 */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "search",
    description: "Search the collection again with different wording when the passages in <context> do not cover the question. New passages come back with ids you can cite.",
    params: { query: { description: "The search query, in the wording the sources would use." } },
  },
  {
    name: "get_passage",
    description: "Read one passage from <context> in full when its text is cut short (truncated=\"true\").",
    params: { id: { description: "A passage id from <context>, for example S3." } },
  },
];

export type ToolCallLog = {
  readonly n: number;
  readonly attempt: number;
  readonly tool: string;
  /** The query, or the S-id. Question-derived text, so it lives in the trace under data/ and never in a committed report. */
  readonly arg: string;
  readonly denied: boolean;
  readonly ms: number;
  readonly added: readonly string[];
};

export type ToolSession = {
  host(attempt: number, tripwire: Tripwire): ToolHost;
  readonly calls: readonly ToolCallLog[];
  readonly spent: number;
};

export type ToolSessionInput = {
  readonly index: HptIndex;
  readonly ledger: SourceLedger;
  readonly max: number;
  readonly searchLimit: number;
  readonly onCall: (log: ToolCallLog) => void;
  readonly now?: () => number;
};

const SPENT = "The extra-call budget is spent. If the evidence is still not enough, answer with type \"insufficient\" and do not guess.";

const failure = (text: string): ToolReply => ({ text, isError: true });

export function createToolSession(input: ToolSessionInput): ToolSession {
  const { index, ledger, max, searchLimit, onCall } = input;
  const now = input.now ?? (() => performance.now());
  const calls: ToolCallLog[] = [];
  let spent = 0;
  let open: { closed: boolean } | null = null;

  async function search(query: string, added: string[], isOpen: () => boolean): Promise<string> {
    const result = await index.search(query, { limit: searchLimit });
    if (!isOpen()) return "";
    if (result.hits.length === 0) return "No passages found.";
    return result.hits
      .map((hit, rank) => {
        const known = ledger.entryOf(hit.passage.id);
        if (known !== null) return `<passage id="${known.sid}" already_in_context="true"/>`;
        const entry = ledger.add(hit.passage, { origin: "tool", excerpted: rank >= FULL_PASSAGES });
        added.push(entry.sid);
        return renderPassage(entry, ledger, { full: false });
      })
      .join("\n");
  }

  return {
    get calls() {
      return calls;
    },
    get spent() {
      return spent;
    },
    host(attempt, tripwire) {
      if (open !== null) open.closed = true;
      const mine = { closed: false };
      open = mine;
      return {
        async invoke(name, args) {
          if (mine.closed) return failure("This attempt has ended.");
          const arg = name === "get_passage" ? (args.id ?? "") : (args.query ?? "");
          tripwire.feed(JSON.stringify(args));
          const started = now();
          const denied = spent >= max;
          if (!denied) spent += 1;
          const added: string[] = [];
          let reply: ToolReply;
          if (denied) reply = failure(SPENT);
          else if (name === "search" && arg.trim() !== "") reply = { text: await search(arg, added, () => !mine.closed), isError: false };
          else if (name === "get_passage") {
            const entry = ledger.resolve(arg);
            reply = entry === null ? failure(`No passage ${arg} in the context.`) : { text: renderPassage(entry, ledger, { full: true }), isError: false };
          } else reply = failure(`Unknown tool or empty argument: ${name}.`);
          if (mine.closed) return failure("This attempt has ended.");
          const log: ToolCallLog = { n: calls.length + 1, attempt, tool: name, arg, denied, ms: now() - started, added };
          calls.push(log);
          onCall(log);
          return reply;
        },
      };
    },
  };
}
