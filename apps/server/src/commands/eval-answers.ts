import fs from "node:fs";
import path from "node:path";
import { CATEGORIES, assertLocked, candidatesFrom, compositionOf, hashCases, lockOf, pickCases, withoutWhy, type AnswerCase, type DraftedCase } from "../features/eval/index.ts";
import { loadEmbedder, openIndex } from "../features/search/index.ts";
import { answerEvalConfig, config } from "../shared/config.ts";

export const EVAL_ANSWERS_USAGE = `Usage:
  hpt eval answers-draft                       draft the 40 into data/eval/answer-subset.draft.json
  hpt eval answers-lock                        freeze the draft: data/eval/answer-subset.json and docs/eval/answer-subset.lock.json`;

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

export async function draftCommand(): Promise<number> {
  const index = openIndex({ path: config.indexFile, embedder: () => loadEmbedder({ modelDir: config.modelDir, allowDownload: false }) });
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
  const drafted = readCases(answerEvalConfig.draftFile);
  const cases = withoutWhy(drafted);
  const ids = new Set(cases.map((item) => item.id));
  if (ids.size !== cases.length) throw new Error("The draft has a repeated id.");
  if (fs.existsSync(answerEvalConfig.lockFile)) {
    const existing = JSON.parse(fs.readFileSync(answerEvalConfig.lockFile, "utf8"));
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

export async function evalAnswersCommand(name: string, _args: string[]): Promise<number> {
  if (name === "answers-draft") return draftCommand();
  if (name === "answers-lock") return lockCommand();
  console.error(EVAL_ANSWERS_USAGE);
  return 1;
}
