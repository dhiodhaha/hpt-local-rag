import fs from "node:fs";
import type { NoteId } from "../corpus/index.ts";
import { noteIdOf, type Channel, type EvidenceLevel, type HptIndex } from "../search/index.ts";
import { CUTOFFS, percentile, rankExpected, summarizeCases, type CutoffSummary, type ExpectedRanks } from "./metrics.ts";

export type QaCase = { id: string; question: string; expected: NoteId[] };

export type LoadedCases = {
  cases: QaCase[];
  /** Rows HPT answered without reading a document. They have no labels, but their evidence level is worth seeing. */
  unreferenced: { id: string; question: string }[];
  skipped: { badRows: number; fullyUnmapped: number; nonCitableReferences: number };
};

const CITABLE_REFERENCE = /^\/wiki\/(?:sources|putusan)\/([^/?#]+)$/;

function parseRow(line: string): { id: string; question: string; urls: string[] } | null {
  let row: { id?: unknown; question?: unknown; references?: unknown };
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof row.id !== "string" || typeof row.question !== "string") return null;
  if (row.references === undefined) return { id: row.id, question: row.question, urls: [] };
  if (!Array.isArray(row.references)) return null;
  const urls = row.references.map((reference: { url?: unknown }) => reference?.url);
  return urls.every((url) => typeof url === "string") ? { id: row.id, question: row.question, urls: urls as string[] } : null;
}

/**
 * HPT's references point at source cards ("/wiki/sources/x"). The card and the putusan share a slug, so a
 * reference maps to "putusan/x". References to concepts, entities and the Quran are not citable and are not labels.
 */
export function loadCases(jsonl: string, hasPutusan: (noteId: NoteId) => boolean): LoadedCases {
  const loaded: LoadedCases = { cases: [], unreferenced: [], skipped: { badRows: 0, fullyUnmapped: 0, nonCitableReferences: 0 } };
  for (const line of jsonl.split("\n").filter((text) => text.trim() !== "")) {
    const row = parseRow(line);
    if (!row) {
      loaded.skipped.badRows += 1;
      continue;
    }
    if (row.urls.length === 0) {
      loaded.unreferenced.push({ id: row.id, question: row.question });
      continue;
    }
    const expected = new Set<NoteId>();
    for (const url of row.urls) {
      const slug = CITABLE_REFERENCE.exec(url)?.[1];
      if (slug === undefined) loaded.skipped.nonCitableReferences += 1;
      else if (hasPutusan(`putusan/${slug}`)) expected.add(`putusan/${slug}`);
    }
    if (expected.size === 0) loaded.skipped.fullyUnmapped += 1;
    else loaded.cases.push({ id: row.id, question: row.question, expected: [...expected] });
  }
  return loaded;
}

export type CaseResult = { id: string; ranks: ExpectedRanks; evidence: EvidenceLevel; ms: number };

export type EvidenceSplit = Record<EvidenceLevel, number>;

export type RetrievalReport = {
  indexFingerprint: string;
  channels: readonly Channel[];
  cases: number;
  skipped: LoadedCases["skipped"];
  byCutoff: Record<number, CutoffSummary>;
  mrr: number;
  evidence: { hit: EvidenceSplit; miss: EvidenceSplit; unreferenced: EvidenceSplit };
  ms: { p50: number; p95: number };
  results: CaseResult[];
};

const emptySplit = (): EvidenceSplit => ({ strong: 0, weak: 0, absent: 0 });
const HIT_LIMIT = 10;

export async function runRetrievalEval(input: { index: HptIndex; qaFile: string }): Promise<RetrievalReport> {
  const { index } = input;
  const loaded = loadCases(fs.readFileSync(input.qaFile, "utf8"), (noteId) => index.hasPutusan(noteId));
  await index.search("shalat", { limit: HIT_LIMIT });

  const results: CaseResult[] = [];
  for (const qaCase of loaded.cases) {
    const result = await index.search(qaCase.question, { limit: HIT_LIMIT });
    const hitNotes = result.hits.map((hit) => [hit.passage.noteId, ...hit.duplicates.map(noteIdOf)]);
    results.push({ id: qaCase.id, ranks: rankExpected(qaCase.expected, hitNotes), evidence: result.evidence.level, ms: result.ms.total });
  }
  const unreferenced = emptySplit();
  for (const row of loaded.unreferenced) unreferenced[(await index.search(row.question, { limit: HIT_LIMIT })).evidence.level] += 1;

  const split = (isHit: boolean) => {
    const counts = emptySplit();
    for (const result of results) {
      const found = Object.values(result.ranks).some((rank) => rank !== null);
      if (found === isHit) counts[result.evidence] += 1;
    }
    return counts;
  };
  const summary = summarizeCases(results);
  const timings = results.map((result) => result.ms);
  return {
    indexFingerprint: index.info.fingerprint,
    channels: index.info.channels,
    cases: results.length,
    skipped: loaded.skipped,
    byCutoff: summary.byCutoff,
    mrr: summary.mrr,
    evidence: { hit: split(true), miss: split(false), unreferenced },
    ms: { p50: percentile(timings, 0.5), p95: percentile(timings, 0.95) },
    results,
  };
}

const fixed = (value: number, digits = 3) => value.toFixed(digits);

/** Numbers and ids only. A question or an answer never enters the report, because the report is committed. */
export function formatReport(report: RetrievalReport, options: { maxMisses: number }): string {
  const lines: string[] = [];
  lines.push(`Index fingerprint \`${report.indexFingerprint.slice(0, 12)}\`, channels ${report.channels.join(" + ")}, ${report.cases} labelled conversations.`);
  lines.push(
    `Skipped: ${report.skipped.badRows} unreadable rows, ${report.skipped.fullyUnmapped} rows whose references map to no putusan, ${report.skipped.nonCitableReferences} references to concepts, entities or the Quran.`,
    "",
    "| k | recall@k | best possible recall@k | hit@k |",
    "|---|---|---|---|",
  );
  for (const k of CUTOFFS) {
    const row = report.byCutoff[k] as CutoffSummary;
    lines.push(`| ${k} | ${fixed(row.recall)} | ${fixed(row.ceiling)} | ${fixed(row.hit)} |`);
  }
  lines.push("", `MRR ${fixed(report.mrr)}. Search time p50 ${fixed(report.ms.p50, 1)} ms, p95 ${fixed(report.ms.p95, 1)} ms.`);

  lines.push("", "| Evidence level | hit@10 | miss@10 | no references |", "|---|---|---|---|");
  for (const level of ["strong", "weak", "absent"] as const) {
    lines.push(`| ${level} | ${report.evidence.hit[level]} | ${report.evidence.miss[level]} | ${report.evidence.unreferenced[level]} |`);
  }

  const misses = report.results.filter((result) => Object.values(result.ranks).every((rank) => rank === null));
  lines.push("", `Misses at 10 (${misses.length}). Conversation id, expected notes, evidence level:`);
  for (const miss of misses.slice(0, options.maxMisses)) {
    lines.push(`- ${miss.id}, ${Object.keys(miss.ranks).length} expected, ${miss.evidence}`);
  }
  if (misses.length > options.maxMisses) lines.push(`- and ${misses.length - options.maxMisses} more in the JSON run output`);
  return lines.join("\n");
}
