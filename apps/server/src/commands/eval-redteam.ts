import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { compose } from "../compose.ts";
import type { Effort } from "../features/providers/index.ts";
import { LEVEL_8, formatRedteam, readRecords, runRedteam, type Readings } from "../features/eval/index.ts";
import { loadEmbedder, openIndex } from "../features/search/index.ts";
import { answerConfig, answerEvalConfig, config } from "../shared/config.ts";
import { MODELS } from "./ask.ts";
import { runIdOf } from "./eval-answers.ts";

export const EVAL_REDTEAM_USAGE = `Usage:
  hpt eval redteam --level 8 [--model sonnet|opus|haiku|<id>] [--effort low|medium|high] [--max-extra-calls <n>]
                             [--run <id>] [--first <n>] [--pause <ms>]
                                               run red-team level 8 one case at a time; run it again to resume
  hpt eval redteam-report <run id> [--readings <file>] [--read-by "<who>"] [--out <file>]
                                               per-variant pass and fail and counts, no answer text`;

const runFileOf = (runId: string) => path.join(answerEvalConfig.runsDir, `redteam-${runId}.jsonl`);

function whole(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} is a whole number, 0 or more.`);
  return value;
}

async function runCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { level: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, "max-extra-calls": { type: "string" }, run: { type: "string" }, first: { type: "string" }, pause: { type: "string" } },
  });
  if (values.level !== "8") throw new Error("Only red-team level 8 is built. Pass --level 8.");
  if (values.effort !== undefined && !["low", "medium", "high"].includes(values.effort)) throw new Error(`--effort is low, medium or high, not "${values.effort}".`);
  const settings = {
    model: values.model === undefined ? answerConfig.answer.model : (MODELS[values.model] ?? values.model),
    effort: (values.effort ?? answerConfig.answer.effort) as Effort,
    maxExtraToolCalls: whole(values["max-extra-calls"], "max-extra-calls") ?? answerConfig.answer.maxExtraToolCalls,
  };
  const runId = values.run ?? `level8-${runIdOf(settings)}`;
  const runFile = runFileOf(runId);
  const cases = LEVEL_8.slice(0, whole(values.first, "first"));

  const composed = await compose({ settings });
  try {
    await composed.index.search("shalat", { limit: 1 });
    console.log(`Run ${runId}: ${settings.model} ${settings.effort}, up to ${settings.maxExtraToolCalls} extra calls, ${cases.length} cases. Results go to ${runFile}.`);
    const run = await runRedteam({
      engine: composed.engine,
      cases,
      runId,
      runFile,
      overrides: settings,
      pauseMs: whole(values.pause, "pause") ?? 2000,
      onProgress: (done, total, record) => {
        const { trace } = record.finished;
        console.log(`${String(done).padStart(2)}/${total} ${record.caseId} ${record.finished.outcome.kind} ${record.finished.answer?.type ?? "-"} done ${(trace.totalMs / 1000).toFixed(1)} s attempts ${trace.attempts.length}`);
      },
    });
    if (run.stoppedBy !== null) {
      console.log(`\nStopped at ${run.stoppedBy.caseId}: ${run.stoppedBy.code}. ${run.stoppedBy.detail}`);
      console.log(`${run.remaining.length} cases remain. Run the same command again to resume.`);
      return 2;
    }
    console.log(run.remaining.length === 0 ? `\nRun ${runId} is complete.` : `\n${run.remaining.length} cases remain.`);
    return 0;
  } finally {
    await composed.close();
  }
}

function reportCommand(argv: string[]): number {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { readings: { type: "string" }, "read-by": { type: "string" }, out: { type: "string" } } });
  const [runId] = positionals;
  if (runId === undefined) throw new Error("Name a run id.");
  const records = readRecords(runFileOf(runId));
  if (records.length === 0) throw new Error(`${runFileOf(runId)} has no results.`);
  const readings = values.readings === undefined ? undefined : (JSON.parse(fs.readFileSync(values.readings, "utf8")) as Readings);
  const index = openIndex({ path: config.indexFile, embedder: () => loadEmbedder({ modelDir: config.modelDir, allowDownload: false }) });
  try {
    const text = formatRedteam({ runId, cases: LEVEL_8, records, lookup: (ids) => index.getPassages(ids), readings, readBy: values["read-by"] });
    if (values.out === undefined) console.log(text);
    else fs.writeFileSync(values.out, text);
    return 0;
  } finally {
    index.close();
  }
}

export async function evalRedteamCommand(name: string, args: string[]): Promise<number> {
  if (name === "redteam") return runCommand(args);
  if (name === "redteam-report") return reportCommand(args);
  console.error(EVAL_REDTEAM_USAGE);
  return 1;
}
