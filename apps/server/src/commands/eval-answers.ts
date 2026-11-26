import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { compose } from "../compose.ts";
import type { Effort } from "../features/providers/index.ts";
import {
  CATEGORIES,
  assertLocked,
  candidatesFrom,
  compositionOf,
  formatCategories,
  formatChecks,
  formatAnswerComparison,
  formatCost,
  formatGate,
  formatLimiter,
  hashCases,
  loadSubset,
  lockOf,
  pairedHeadline,
  pickCases,
  readRecords,
  runAnswerEval,
  scoresOf,
  summarizeRun,
  withoutWhy,
  type AnswerCase,
  type Category,
  type ConfigReport,
  type DraftedCase,
  type PassageLookup,
} from "../features/eval/index.ts";
import { loadEmbedder, openIndex } from "../features/search/index.ts";
import { answerConfig, answerEvalConfig, config } from "../shared/config.ts";
import { MODELS } from "./ask.ts";

export const EVAL_ANSWERS_USAGE = `Usage:
  hpt eval answers-draft                       draft the 40 into data/eval/answer-subset.draft.json
  hpt eval answers-lock                        freeze the draft: data/eval/answer-subset.json and docs/eval/answer-subset.lock.json
  hpt eval answers [--model sonnet|opus|haiku|<id>] [--effort low|medium|high] [--max-extra-calls <n>]
                   [--run <id>] [--category <name>] [--first <n>] [--pause <ms>]
                                               run the locked subset one question at a time; run it again to resume
  hpt eval answers-report <run id>... [--out <file>]
                                               numbers and ids for the runs. The first run is the reference for the gate
  hpt eval answers-spread <run id> <repeat run id>
                                               same-question spread between two runs of one configuration`;

const byId = (a: { readonly id: string }, b: { readonly id: string }) => Number(a.id > b.id) - Number(a.id < b.id);

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readCases(file: string): DraftedCase[] {
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { cases: DraftedCase[] }).cases;
}

function printComposition(cases: readonly AnswerCase[]): void {
  const composition = compositionOf(cases);
  for (const category of CATEGORIES) console.log(`  ${category.padEnd(13)} ${composition[category].actual} of ${composition[category].target}`);
}

const openSearch = () => openIndex({ path: config.indexFile, embedder: () => loadEmbedder({ modelDir: config.modelDir, allowDownload: false }) });

export async function draftCommand(): Promise<number> {
  const index = openSearch();
  try {
    const candidates = await candidatesFrom(fs.readFileSync(config.qaFile, "utf8"), index);
    const written = fs.existsSync(answerEvalConfig.writtenFile) ? readCases(answerEvalConfig.writtenFile) : [];
    const draft = pickCases({ candidates, written, seed: answerEvalConfig.seed });
    writeJson(answerEvalConfig.draftFile, { cases: draft.cases });
    console.log(`Drafted ${draft.cases.length} cases from ${candidates.length} first-turn candidates and ${written.length} written questions.`);
    printComposition(draft.cases);
    const short = Object.entries(draft.shortfall);
    if (short.length > 0) console.log(`Short: ${short.map(([category, missing]) => `${category} by ${missing}`).join(", ")}. Add questions to ${answerEvalConfig.writtenFile}.`);
    console.log(`Draft written to ${answerEvalConfig.draftFile}. Each case says how it was categorized, so it can be spot-checked.`);
    return 0;
  } finally {
    index.close();
  }
}

export function lockCommand(): number {
  const cases = withoutWhy(readCases(answerEvalConfig.draftFile));
  if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("The draft has a repeated id.");
  if (fs.existsSync(answerEvalConfig.lockFile)) {
    const existing = JSON.parse(fs.readFileSync(answerEvalConfig.lockFile, "utf8")) as { hash: string };
    if (existing.hash === hashCases(cases)) {
      console.log("The draft is already locked: same hash.");
      return 0;
    }
    throw new Error(`${answerEvalConfig.lockFile} already holds a different lock. The subset is locked before any result, so delete the lock deliberately if you mean to replace it.`);
  }
  const lock = lockOf(cases, new Date().toISOString().slice(0, 10));
  assertLocked(cases, lock);
  writeJson(answerEvalConfig.subsetFile, { cases });
  writeJson(answerEvalConfig.lockFile, lock);
  console.log(`Locked ${cases.length} cases, hash ${lock.hash.slice(0, 12)}.`);
  printComposition(cases);
  console.log(`Commit ${answerEvalConfig.lockFile}. It has ids, categories and the hash only.`);
  return 0;
}

const SHORT_NAME = new Map(Object.entries(MODELS).map(([name, id]) => [id, name]));

export function runIdOf(settings: { model: string; effort: string; maxExtraToolCalls: number }): string {
  return `${SHORT_NAME.get(settings.model) ?? settings.model}-${settings.effort}-x${settings.maxExtraToolCalls}`;
}

const runFileOf = (runId: string) => path.join(answerEvalConfig.runsDir, `answers-${runId}.jsonl`);

function parseCount(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} is a whole number, 0 or more.`);
  return value;
}

export async function runCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { model: { type: "string" }, effort: { type: "string" }, "max-extra-calls": { type: "string" }, run: { type: "string" }, category: { type: "string" }, first: { type: "string" }, pause: { type: "string" } },
  });
  if (values.effort !== undefined && !["low", "medium", "high"].includes(values.effort)) throw new Error(`--effort is low, medium or high, not "${values.effort}".`);
  if (values.category !== undefined && !(CATEGORIES as readonly string[]).includes(values.category)) throw new Error(`--category is one of ${CATEGORIES.join(", ")}.`);
  const settings = {
    model: values.model === undefined ? answerConfig.answer.model : (MODELS[values.model] ?? values.model),
    effort: (values.effort ?? answerConfig.answer.effort) as Effort,
    maxExtraToolCalls: parseCount(values["max-extra-calls"], "max-extra-calls") ?? answerConfig.answer.maxExtraToolCalls,
  };
  const subset = loadSubset(answerEvalConfig.subsetFile, answerEvalConfig.lockFile);
  const cases = subset.cases
    .filter((item) => values.category === undefined || item.category === (values.category as Category))
    .sort(byId)
    .slice(0, parseCount(values.first, "first"));
  const runId = values.run ?? runIdOf(settings);
  const runFile = runFileOf(runId);

  const composed = await compose({ settings });
  try {
    // The first search loads the embedding model, about a second. The app loads it at launch, so the eval does too.
    await composed.index.search("shalat", { limit: 1 });
    console.log(`Run ${runId}: ${settings.model} ${settings.effort}, up to ${settings.maxExtraToolCalls} extra calls, ${cases.length} questions. Results go to ${runFile}.`);
    const run = await runAnswerEval({
      engine: composed.engine,
      cases,
      subsetHash: subset.hash,
      runId,
      runFile,
      overrides: settings,
      pauseMs: parseCount(values.pause, "pause") ?? 2000,
      onProgress: (done, total, record) => {
        const { trace } = record.finished;
        const headline = trace.attempts.at(-1)?.committedMs.find((mark) => mark.name === "headline")?.ms;
        const shown = headline === undefined ? "-" : `${(headline / 1000).toFixed(1)} s`;
        console.log(`${String(done).padStart(2)}/${total} ${record.caseId} ${record.finished.outcome.kind} headline ${shown} done ${(trace.totalMs / 1000).toFixed(1)} s tools ${trace.tools.length}`);
      },
    });
    if (run.stoppedBy !== null) {
      console.log(`\nStopped at ${run.stoppedBy.caseId}: ${run.stoppedBy.code}. ${run.stoppedBy.detail}`);
      console.log(`${run.remaining.length} questions remain. Run the same command again to resume.`);
      return 2;
    }
    console.log(run.remaining.length === 0 ? `\nRun ${runId} is complete.` : `\n${run.remaining.length} questions remain.`);
    return 0;
  } finally {
    await composed.close();
  }
}

type SearchIndex = ReturnType<typeof openSearch>;

const lookupOf =
  (index: SearchIndex): PassageLookup =>
  (ids) =>
    index.getPassages(ids);

const list = (ids: readonly string[]) => (ids.length === 0 ? "none" : ids.join(", "));

export function reportCommand(argv: string[]): number {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: "string" } } });
  if (positionals.length === 0) throw new Error("Name at least one run id.");
  const subset = loadSubset(answerEvalConfig.subsetFile, answerEvalConfig.lockFile);
  const index = openSearch();
  try {
    const lookup = lookupOf(index);
    const records = (runId: string) => {
      const found = readRecords(runFileOf(runId));
      if (found.length === 0) throw new Error(`${runFileOf(runId)} has no results.`);
      return found;
    };
    const reports: ConfigReport[] = positionals.map((runId) => summarizeRun({ runId, records: records(runId), cases: subset.cases, lookup }));
    const reference = reports[0] as ConfigReport;
    const referenceScores = scoresOf(records(reference.runId), subset.cases, lookup);
    const out: string[] = [
      `Subset hash ${subset.hash.slice(0, 12)}. Index ${reference.indexFingerprint.slice(0, 12)}. Prompt ${reference.promptVersion}.`,
      "",
      "## Headline and latency",
      formatAnswerComparison(reports),
      "",
      "## What the time before the first text is made of",
      formatLimiter(reports),
      "",
      "## Checks",
      formatChecks(reports),
      "",
      "## Cost",
      formatCost(reports),
    ];
    for (const report of reports) {
      const { ids } = report;
      out.push("", `## ${report.runId} by category`, formatCategories(report), "");
      out.push(`Type mismatches: ${list(ids.typeMismatch)}. Withheld: ${list(ids.withheld)}. Failed: ${list(ids.failed)}. Restarted: ${list(ids.restarted)}.`);
      if (report === reference) continue;
      const change = pairedHeadline(referenceScores, scoresOf(records(report.runId), subset.cases, lookup));
      const seconds = (ms: number) => (ms / 1000).toFixed(2);
      const sign = change.change > 0 ? "+" : "";
      const verdict = change.clears ? "outside noise" : "inside noise";
      out.push(`Paired headline p50 against ${reference.runId} over ${change.n} questions: ${sign}${seconds(change.change)} s, interval ${seconds(change.interval.lo)} to ${seconds(change.interval.hi)} s, ${verdict}.`);
      out.push("", `Gate against ${reference.runId}`, formatGate(report, reference));
    }
    const text = `${out.join("\n")}\n`;
    if (values.out === undefined) console.log(text);
    else fs.writeFileSync(values.out, text);
    return 0;
  } finally {
    index.close();
  }
}

export function spreadCommand(argv: string[]): number {
  const [firstId, secondId] = argv;
  if (firstId === undefined || secondId === undefined) throw new Error("Name two run ids.");
  const subset = loadSubset(answerEvalConfig.subsetFile, answerEvalConfig.lockFile);
  const index = openSearch();
  try {
    const lookup = lookupOf(index);
    const scores = (runId: string) => scoresOf(readRecords(runFileOf(runId)), subset.cases, lookup);
    const second = scores(secondId);
    const sameQuestions = (runId: string) => scores(runId).filter((one) => second.some((other) => other.caseId === one.caseId)).sort((a, b) => Number(a.caseId > b.caseId) - Number(a.caseId < b.caseId));
    const [a, b] = [sameQuestions(firstId), second.sort((x, y) => Number(x.caseId > y.caseId) - Number(x.caseId < y.caseId))];
    const at = (values: number[], share: number) => values[Math.min(values.length - 1, Math.floor(share * values.length))] ?? 0;
    for (const field of ["headlineMs", "doneMs"] as const) {
      const gaps = a
        .flatMap((one, position) => {
          const x = one.timing[field];
          const y = b[position]?.timing[field];
          return x === null || y === null || y === undefined ? [] : [Math.abs(x - y)];
        })
        .sort((p, q) => p - q);
      const s = (ms: number) => (ms / 1000).toFixed(2);
      console.log(`${field}: ${gaps.length} questions run twice. Gap between the two runs of the same question: p50 ${s(at(gaps, 0.5))} s, p90 ${s(at(gaps, 0.9))} s, max ${s(gaps.at(-1) ?? 0)} s`);
    }
    return 0;
  } finally {
    index.close();
  }
}

export async function evalAnswersCommand(name: string, args: string[]): Promise<number> {
  if (name === "answers-draft") return draftCommand();
  if (name === "answers-lock") return lockCommand();
  if (name === "answers") return runCommand(args);
  if (name === "answers-report") return reportCommand(args);
  if (name === "answers-spread") return spreadCommand(args);
  console.error(EVAL_ANSWERS_USAGE);
  return 1;
}
