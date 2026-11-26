import fs from "node:fs";
import path from "node:path";
import type { AnswerEngine, EngineSettings, Finished, HistoryEntry } from "../../answer/index.ts";
import type { FailureCode } from "../../providers/index.ts";

/**
 * Runs the locked subset through the SAME engine `hpt ask` uses (compose()), one case at a time. One subscription and one warm
 * process make sequential timings the honest ones for a single user.
 *
 * Each finished case is appended to a run file (`data/eval/answers-<runId>.jsonl`) as one RunRecord. The file holds answers, so
 * it stays under data/. A run is resumable: running again with the same file skips the cases already in it, so a usage limit
 * or a crash costs nothing already done. A refusal that no retry can fix (a spent limit, no login, a missing model) stops the
 * run and is not recorded, so the resumed run asks that question again.
 */
export type RunSettings = Partial<Pick<EngineSettings, "model" | "effort" | "maxExtraToolCalls">>;

export type RunCase = { readonly id: string; readonly question: string };

export type RunRecord = {
  readonly v: 1;
  readonly runId: string;
  /** The lock's hash. A run file never mixes two subsets. */
  readonly subsetHash: string;
  readonly caseId: string;
  readonly at: string;
  readonly finished: Finished;
};

const STOPS: ReadonlySet<FailureCode> = new Set<FailureCode>(["rate_limited", "not_signed_in", "model_unavailable"]);

export type StoppedBy = { readonly code: FailureCode; readonly caseId: string; readonly detail: string };

export type Run = {
  readonly runId: string;
  readonly records: readonly RunRecord[];
  /** Cases not yet in the file. Empty when the run is complete. */
  readonly remaining: readonly string[];
  readonly stoppedBy: StoppedBy | null;
};

export type RunInput<Case extends RunCase = RunCase> = {
  readonly engine: AnswerEngine;
  readonly cases: readonly Case[];
  readonly historyOf?: (item: Case, records: readonly RunRecord[]) => readonly HistoryEntry[];
  readonly subsetHash: string;
  readonly runId: string;
  readonly runFile: string;
  readonly overrides?: RunSettings;
  /** A wait before each ask, so the spare process that the last answer started is ready, as it is for a user who reads and types. */
  readonly pauseMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number, record: RunRecord) => void;
};

export function readRecords(file: string): RunRecord[] {
  if (!fs.existsSync(file)) return [];
  const records: RunRecord[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as RunRecord);
    } catch {
      // A truncated last line from a crash mid-write. The case is asked again.
    }
  }
  return records;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runAnswerEval<Case extends RunCase>(input: RunInput<Case>): Promise<Run> {
  const { engine, cases, runId, runFile, subsetHash } = input;
  const records = readRecords(runFile);
  const mixed = records.find((record) => record.subsetHash !== subsetHash);
  if (mixed !== undefined) throw new Error(`${runFile} holds results for another subset (${mixed.subsetHash.slice(0, 12)}). Start a new run id.`);
  const done = new Set(records.map((record) => record.caseId));
  const pending = cases.filter((item) => !done.has(item.id));
  let stoppedBy: StoppedBy | null = null;

  if (pending.length > 0) {
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    engine.warm();
  }
  for (const item of pending) {
    if (input.signal?.aborted) break;
    if (input.pauseMs) await sleep(input.pauseMs);
    const history = input.historyOf?.(item, records) ?? [];
    const finished = await engine.ask({ question: item.question, history: [...history], scope: null }, { label: item.id, overrides: input.overrides, signal: input.signal });
    const { outcome } = finished;
    if (outcome.kind === "cancelled") break;
    if (outcome.kind === "failed" && STOPS.has(outcome.code)) {
      stoppedBy = { code: outcome.code, caseId: item.id, detail: finished.trace.attempts.at(-1)?.failure?.detail ?? "" };
      break;
    }
    const record: RunRecord = { v: 1, runId, subsetHash, caseId: item.id, at: new Date().toISOString(), finished };
    fs.appendFileSync(runFile, `${JSON.stringify(record)}\n`);
    records.push(record);
    done.add(item.id);
    input.onProgress?.(done.size, cases.length, record);
  }
  return { runId, records, remaining: cases.filter((item) => !done.has(item.id)).map((item) => item.id), stoppedBy };
}
