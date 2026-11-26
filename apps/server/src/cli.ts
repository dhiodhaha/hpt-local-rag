import { parseArgs } from "node:util";
import { buildIndex, type BuildReport } from "./features/search/index.ts";
import { config } from "./shared/config.ts";

const USAGE = `Usage:
  hpt build [--vault <dir>] [--out <file>]`;

function printBuild(report: BuildReport, outFile: string): void {
  const mb = (report.bytes / 1_048_576).toFixed(1);
  console.log(`Built ${outFile} in ${(report.ms / 1000).toFixed(1)} s, ${mb} MB, fingerprint ${report.fingerprint.slice(0, 12)}`);
  console.log(`${report.counts.notes} notes, ${report.counts.passages} citable passages, ${report.counts.mapPassages} map passages, ${report.counts.mapLinks} map links`);
  console.log("Citable passages by source_type:", report.passagesBySourceType);
  const { p10, p50, p90, max } = report.wordCount;
  console.log(`Words per citable passage: p10 ${p10}, p50 ${p50}, p90 ${p90}, max ${max}`);
  console.log(report.drift === null ? "Drift: no earlier comparable index" : `Drift: ${report.drift.added} added, ${report.drift.removed} removed, ${report.drift.changed.length} changed`);
  console.log(`D12a hand-check: ${report.bookSections.length} compiled-book sections and ${report.unmatchedTocTitles.length} notes with unmatched table-of-contents titles are in ${outFile}.report.json`);
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "build") {
    const { values } = parseArgs({ args: rest, options: { vault: { type: "string" }, out: { type: "string" } } });
    const outFile = values.out ?? config.indexFile;
    const report = await buildIndex({
      vaultDir: values.vault ?? config.vaultDir,
      outFile,
      revisionsFile: config.revisionsFile,
      onProgress: (message) => console.log(message),
    });
    printBuild(report, outFile);
    return 0;
  }
  return fail(USAGE);
}

process.exitCode = await main(process.argv.slice(2));
