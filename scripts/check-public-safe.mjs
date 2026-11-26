import { execFileSync } from "node:child_process";
import fs from "node:fs";

const QA_FILE = "data/qa_pairs.jsonl";
const MIN_QUESTION_CHARS = 12;
const MIN_ANSWER_SENTENCE_CHARS = 40;

const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

function privateSnippets() {
  if (!fs.existsSync(QA_FILE)) return [];
  const rows = fs.readFileSync(QA_FILE, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const questions = rows.map((row) => normalize(row.question)).filter((text) => text.length >= MIN_QUESTION_CHARS);
  const answerSentences = rows
    .flatMap((row) => row.answer.split(/(?<=[.!?])\s+|\n+/))
    .map(normalize)
    .filter((text) => text.length >= MIN_ANSWER_SENTENCE_CHARS);
  return [...new Set([...questions, ...answerSentences])];
}

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const problems = tracked.filter((file) => file === "data" || file.startsWith("data/")).map((file) => `tracked under data/: ${file}`);

const snippets = privateSnippets();
for (const file of tracked) {
  if (!fs.existsSync(file) || fs.statSync(file).size > 2_000_000) continue;
  const text = normalize(fs.readFileSync(file, "utf8"));
  const leaked = snippets.find((snippet) => text.includes(snippet));
  if (leaked) problems.push(`${file} contains ChatHPT user text: "${leaked.slice(0, 40)}..."`);
}

if (snippets.length === 0) console.warn(`${QA_FILE} not found: only the data/ path check ran.`);
for (const problem of problems) console.error(problem);
console.log(`${tracked.length} tracked files, ${snippets.length} private snippets checked, ${problems.length} problems.`);
process.exit(problems.length > 0 ? 1 : 0);
