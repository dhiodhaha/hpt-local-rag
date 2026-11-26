import { METRICS, pairedDifference, scoreCase, type CutoffSummary, type Metric } from "./metrics.ts";
import type { CaseResult, RetrievalReport, VariantReport } from "./retrieval.ts";

const fixed = (value: number, digits = 3) => value.toFixed(digits);
const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const header = (cells: readonly string[]) => [row(cells), row(cells.map(() => "---"))];
const mean = (values: readonly number[]) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);

const METRIC_HEADER = ["recall@5", "recall@10", "hit@5", "hit@10", "MRR"];
const found = (result: CaseResult) => Object.values(result.ranks).some((rank) => rank !== null);

function scoresOf(report: VariantReport): Record<Metric, number[]> {
  const columns = Object.fromEntries(METRICS.map((metric) => [metric, [] as number[]])) as Record<Metric, number[]>;
  for (const result of report.results) {
    const scores = scoreCase(result.ranks);
    for (const metric of METRICS) columns[metric].push(scores[metric]);
  }
  return columns;
}

function differenceRow(label: string, before: VariantReport, after: VariantReport): string {
  const beforeScores = scoresOf(before);
  const afterScores = scoresOf(after);
  const cells = METRICS.map((metric) => {
    const { mean: difference, halfWidth, clears } = pairedDifference(beforeScores[metric], afterScores[metric]);
    return `${difference >= 0 ? "+" : ""}${fixed(difference)} ± ${fixed(halfWidth)}${clears ? " *" : ""}`;
  });
  return row([label, ...cells]);
}

function agreementLine(report: VariantReport): string {
  const agreement = (results: readonly CaseResult[]) => fixed(mean(results.map((result) => result.channelAgreement ?? 0)));
  const hits = report.results.filter(found);
  const misses = report.results.filter((result) => !found(result));
  return `Channel agreement on the top 5 hits of ${report.variant.name}: mean ${agreement(hits)} over ${hits.length} conversations with a hit at 10, ${agreement(misses)} over ${misses.length} without.`;
}

/** Numbers and ids only: the report is committed, so a question or an answer must never enter it. */
export function formatReport(report: RetrievalReport, options: { maxMisses: number }): string {
  const { skipped } = report;
  const lines: string[] = [
    `Index fingerprint \`${report.indexFingerprint.slice(0, 12)}\`, channels ${report.channels.join(" + ")}, ${report.cases} labelled conversations.`,
    `Skipped: ${skipped.badRows} unreadable rows, ${skipped.fullyUnmapped} rows whose references map to no putusan, ${skipped.nonCitableReferences} references to concepts, entities or the Quran.`,
    "",
    ...header(["Variant", ...METRIC_HEADER]),
  ];
  for (const { variant, byCutoff, mrr } of report.variants) {
    const [five, ten] = [byCutoff[5] as CutoffSummary, byCutoff[10] as CutoffSummary];
    lines.push(row([variant.name, fixed(five.recall), fixed(ten.recall), fixed(five.hit), fixed(ten.hit), fixed(mrr)]));
  }

  const byName = new Map(report.variants.map((variant) => [variant.variant.name, variant]));
  const keywordRows = report.variants.flatMap((candidate) => {
    const base = byName.get(candidate.variant.linkExpansion ? "keyword" : "keyword, no links");
    return base && base !== candidate ? [differenceRow(candidate.variant.name, base, candidate)] : [];
  });
  if (keywordRows.length > 0) {
    lines.push("", "Difference from the keyword variant with the same link setting. Each cell is the mean per-conversation difference ± the 95 percent noise floor, and a star means the difference clears it.", "");
    lines.push(...header(["Variant", ...METRIC_HEADER]), ...keywordRows);
  }

  const linkRows = report.variants.flatMap((candidate) => {
    const without = byName.get(`${candidate.variant.name}, no links`);
    return without ? [differenceRow(candidate.variant.name, without, candidate)] : [];
  });
  lines.push("", "Effect of link expansion: each variant minus the same variant with no links.", "");
  lines.push(...header(["Variant", ...METRIC_HEADER]), ...linkRows);

  const linked = report.variants.filter((variant) => variant.variant.linkExpansion);
  lines.push("", ...header(["Evidence level", ...linked.flatMap(({ variant }) => [`${variant.name} hit@10`, `${variant.name} miss@10`, `${variant.name} no refs`])]));
  for (const level of ["strong", "weak", "absent"] as const) {
    const cells = linked.flatMap((variant) => [variant.evidence.hit[level], variant.evidence.miss[level], variant.evidence.unreferenced[level]]);
    lines.push(row([level, ...cells.map(String)]));
  }

  lines.push("", ...header(["Variant", "search p50 ms", "search p95 ms", "query embedding p50 ms", "query embedding p95 ms"]));
  for (const { variant, ms } of report.variants) {
    const embed = ms.embed ? [fixed(ms.embed.p50, 1), fixed(ms.embed.p95, 1)] : ["-", "-"];
    lines.push(row([variant.name, fixed(ms.total.p50, 1), fixed(ms.total.p95, 1), ...embed]));
  }

  const focus = byName.get("hybrid") ?? report.variants[0];
  if (focus) {
    const misses = focus.results.filter((result) => !found(result));
    if (focus.variant.channels.length > 1) lines.push("", agreementLine(focus));
    lines.push("", `Misses at 10 for ${focus.variant.name} (${misses.length}). Conversation id, expected notes, evidence level:`);
    for (const miss of misses.slice(0, options.maxMisses)) lines.push(`- ${miss.id}, ${Object.keys(miss.ranks).length} expected, ${miss.evidence}`);
    if (misses.length > options.maxMisses) lines.push(`- and ${misses.length - options.maxMisses} more in the JSON run output`);
  }
  return lines.join("\n");
}
