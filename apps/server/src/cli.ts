import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ASK_USAGE, askCommand } from "./commands/ask.ts";
import { HOST_USAGE, hostCommand } from "./commands/host.ts";
import { EVAL_ANSWERS_USAGE, evalAnswersCommand } from "./commands/eval-answers.ts";
import { EVAL_REDTEAM_USAGE, evalRedteamCommand } from "./commands/eval-redteam.ts";
import { calibrate, formatCalibration, formatComparison, formatReport, labelled, runRetrievalEval, type RetrievalReport } from "./features/eval/index.ts";
import { buildIndex, loadEmbedder, openIndex, statusOf, type BuildReport, type Channel, type SearchResult } from "./features/search/index.ts";
import { config } from "./shared/config.ts";

const USAGE = `Usage:
  hpt build [--vault <dir>] [--out <file>] [--keyword-only]
  hpt search "<question>" [--limit 10] [--note <note id>] [--channels keyword,vector] [--json]
  hpt ask "<question>" [-c] [--note <note id>] [--model sonnet|opus|haiku] [--effort low|medium|high] [--json]
  hpt host [--scenario <name>]   (started by the desktop app)
  hpt eval retrieval [--out <dir>] [--misses 30]
  hpt eval compare <before run.json> <after run.json>
  hpt eval evidence <run.json>
${EVAL_ANSWERS_USAGE}
${EVAL_REDTEAM_USAGE}`;

function printBuild(report: BuildReport, outFile: string): void {
  const mb = (report.bytes / 1_048_576).toFixed(1);
  console.log(`Built ${outFile} (${report.channels.join(" + ")}) in ${(report.ms / 1000).toFixed(1)} s, ${mb} MB, fingerprint ${report.fingerprint.slice(0, 12)}`);
  console.log(`${report.counts.notes} notes, ${report.counts.passages} citable passages, ${report.counts.mapPassages} map passages, ${report.counts.mapLinks} map links`);
  console.log("Citable passages by source_type:", report.passagesBySourceType);
  for (const kind of ["citable", "map"] as const) {
    const words = report.words[kind];
    const tokens = report.tokens[kind];
    console.log(`Words per ${kind} passage: p50 ${words.p50}, p90 ${words.p90}, max ${words.max}; ${words.overLimit} of ${words.passages} over ${report.words.limit}`);
    console.log(`Tokens per ${kind} passage: p50 ${tokens.p50}, p90 ${tokens.p90}, max ${tokens.max}; ${tokens.overLimit} of ${tokens.passages} over ${report.tokens.limit}`);
  }
  if (report.embedding) {
    const { embedding } = report;
    const cacheMb = (embedding.cacheBytes / 1_048_576).toFixed(1);
    console.log(`Embeddings (${embedding.model}, ${embedding.dims} dims): ${embedding.embedded} computed in ${(embedding.ms / 1000).toFixed(1)} s, ${embedding.cached} from the cache, cache file ${cacheMb} MB`);
  }
  console.log(report.drift === null ? "Drift: no earlier comparable index" : `Drift: ${report.drift.added} added, ${report.drift.removed} removed, ${report.drift.changed.length} changed`);
  const { decisionSpans } = report;
  console.log(`Fikih putusan spans: ${decisionSpans.spans} (${decisionSpans.words} words, ${decisionSpans.passages} passages), ${decisionSpans.keputusanWithoutSpan} KEPUTUSAN headings without one. Spot-check log: ${path.join(path.dirname(outFile), "labels", "fikih-putusan-spans.md")}`);
  console.log(`${report.unmatchedTocTitles.length} notes with unmatched table-of-contents titles are in ${outFile}.report.json`);
}

const MAX_LINK_REASONS = 3;

function printSearch(result: SearchResult): void {
  result.hits.forEach((hit, index) => {
    const { passage } = hit;
    const superseded = statusOf(passage) === "superseded" ? "superseded" : null;
    const label = [passage.sourceType, passage.year, passage.number ? `no. ${passage.number}` : null, superseded].filter((part) => part !== null).join(" · ");
    console.log(`${index + 1}. [${label}] ${passage.title}  #${passage.ordinal}  ${hit.score.toFixed(4)}`);
    const direct = hit.reasons.flatMap((reason) => (reason.kind === "direct" ? [`${reason.channel} #${reason.rank}`] : []));
    const linked = hit.reasons.flatMap((reason) => (reason.kind === "via_link" ? [`via ${reason.from.noteId} (${reason.channel} #${reason.rank})`] : []));
    const reasons = [...direct, ...linked.slice(0, MAX_LINK_REASONS), ...(linked.length > MAX_LINK_REASONS ? [`and ${linked.length - MAX_LINK_REASONS} more links`] : [])];
    const identical = hit.duplicates.length > 0 ? ` · ${hit.duplicates.length} identical collapsed` : "";
    console.log(`   ${reasons.join(" · ")}${identical}`);
    if (passage.section) console.log(`   section: ${passage.section}`);
    console.log(`   ${passage.text.replace(/\s+/g, " ").slice(0, 160)}...`);
  });
  const { evidence } = result;
  const via = evidence.signals.topIsDirect ? "direct" : "via link";
  const agreement = evidence.signals.channelAgreement === null ? "" : `, channels agree on ${(evidence.signals.channelAgreement * 100).toFixed(0)}% of the top hits`;
  const { ms } = result;
  const timings = `keyword ${ms.keyword.toFixed(1)} ms, query embedding ${ms.embed.toFixed(1)} ms, vector ${ms.vector.toFixed(1)} ms, total ${ms.total.toFixed(1)} ms`;
  console.log(`evidence ${evidence.level} (coverage ${evidence.signals.topCoverage.toFixed(2)}, ${via}${agreement}), ${timings}`);
  if (result.leads.length > 0) console.log(`leads: ${result.leads.map((lead) => lead.noteId).join(", ")}`);
}

const embedder = () => loadEmbedder({ modelDir: config.modelDir, allowDownload: false });

function parseChannels(text: string | undefined): Channel[] | undefined {
  if (text === undefined) return undefined;
  const names = text.split(",").map((name) => name.trim());
  const unknown = names.filter((name) => name !== "keyword" && name !== "vector");
  if (unknown.length > 0) throw new Error(`unknown channel ${unknown.join(", ")}. Use keyword, vector or keyword,vector.`);
  return names as Channel[];
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "build") {
    const { values } = parseArgs({ args: rest, options: { vault: { type: "string" }, out: { type: "string" }, "keyword-only": { type: "boolean" } } });
    const outFile = values.out ?? config.indexFile;
    const report = await buildIndex({
      vaultDir: values.vault ?? config.vaultDir,
      outFile,
      channels: values["keyword-only"] ? ["keyword"] : ["keyword", "vector"],
      embedding: { cacheFile: config.embeddingCacheFile, modelDir: config.modelDir },
      revisionsFile: config.revisionsFile,
      onProgress: (message) => console.log(message),
    });
    printBuild(report, outFile);
    return 0;
  }
  if (command === "search") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { limit: { type: "string" }, note: { type: "string" }, json: { type: "boolean" }, channels: { type: "string" } },
    });
    const question = positionals.join(" ").trim();
    if (question === "") return fail("Missing question.");
    const index = openIndex({ path: config.indexFile, embedder });
    try {
      const result = await index.search(question, {
        limit: values.limit === undefined ? undefined : Number(values.limit),
        channels: parseChannels(values.channels),
        filter: values.note === undefined ? undefined : { noteIds: [values.note] },
      });
      if (values.json) console.log(JSON.stringify(result, null, 2));
      else printSearch(result);
    } finally {
      index.close();
    }
    return 0;
  }
  if (command === "ask") {
    try {
      return await askCommand(rest);
    } catch (cause) {
      return fail(`${cause instanceof Error ? cause.message : String(cause)}
${ASK_USAGE}`);
    }
  }
  if (command === "host") {
    try {
      return await hostCommand(rest);
    } catch (cause) {
      return fail(`${cause instanceof Error ? cause.message : String(cause)}
${HOST_USAGE}`);
    }
  }
  if (command === "eval" && (rest[0]?.startsWith("answers") || rest[0]?.startsWith("followups"))) {
    try {
      return await evalAnswersCommand(rest[0], rest.slice(1));
    } catch (cause) {
      return fail(`${cause instanceof Error ? cause.message : String(cause)}
${EVAL_ANSWERS_USAGE}`);
    }
  }
  if (command === "eval" && rest[0]?.startsWith("redteam")) {
    try {
      return await evalRedteamCommand(rest[0], rest.slice(1));
    } catch (cause) {
      return fail(`${cause instanceof Error ? cause.message : String(cause)}
${EVAL_REDTEAM_USAGE}`);
    }
  }
  if (command === "eval" && rest[0] === "retrieval") {
    const { values } = parseArgs({ args: rest.slice(1), options: { out: { type: "string" }, misses: { type: "string" } } });
    const index = openIndex({ path: config.indexFile, embedder });
    try {
      const report = await runRetrievalEval({ index, qaFile: config.qaFile });
      const outDir = values.out ?? config.evalDir;
      fs.mkdirSync(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(outDir, `retrieval-${report.indexFingerprint.slice(0, 8)}-${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify(report, null, 2));
      console.log(formatReport(report, { maxMisses: Number(values.misses ?? 30) }));
      console.log(`\nRun written to ${file}`);
    } finally {
      index.close();
    }
    return 0;
  }
  if (command === "eval" && rest[0] === "compare") {
    const [beforeFile, afterFile] = rest.slice(1);
    if (beforeFile === undefined || afterFile === undefined) return fail(USAGE);
    const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as RetrievalReport;
    const [before, after] = [read(beforeFile), read(afterFile)];
    console.log(formatComparison(before, after, { before: before.indexFingerprint.slice(0, 8), after: after.indexFingerprint.slice(0, 8) }));
    return 0;
  }
  if (command === "eval" && rest[0] === "evidence") {
    const file = rest[1];
    if (file === undefined) return fail(USAGE);
    const report = JSON.parse(fs.readFileSync(file, "utf8")) as RetrievalReport;
    const hybrid = report.variants.find((variant) => variant.variant.name === "hybrid");
    if (!hybrid) return fail("this run has no hybrid variant to calibrate");
    console.log(formatCalibration(calibrate(labelled(hybrid))));
    return 0;
  }
  return fail(USAGE);
}

process.exitCode = await main(process.argv.slice(2));
