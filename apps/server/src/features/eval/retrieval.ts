import fs from "node:fs";
import type { NoteId } from "../corpus/index.ts";
import { noteIdOf, type Channel, type Evidence, type EvidenceLevel, type HptIndex } from "../search/index.ts";
import { percentile, rankExpected, summarizeCases, type CutoffSummary, type ExpectedRanks } from "./metrics.ts";

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
export type CaseResult = {
  id: string;
  ranks: ExpectedRanks;
  evidence: EvidenceLevel;
  signals: Evidence["signals"];
  ms: number;
  embedMs: number;
};

/** A conversation with no reference: only its evidence level and signals are known. */
export type UnreferencedResult = { id: string; evidence: EvidenceLevel; signals: Evidence["signals"] };

export type EvidenceSplit = Record<EvidenceLevel, number>;

export type Variant = { name: string; channels: readonly Channel[]; linkExpansion: boolean };

export type Spread = { p50: number; p95: number };

export type VariantReport = {
  variant: Variant;
  byCutoff: Record<number, CutoffSummary>;
  mrr: number;
  evidence: { hit: EvidenceSplit; miss: EvidenceSplit; unreferenced: EvidenceSplit };
  ms: { total: Spread; embed: Spread | null };
  results: CaseResult[];
  unreferenced: UnreferencedResult[];
};

export type RetrievalReport = {
  indexFingerprint: string;
  channels: readonly Channel[];
  cases: number;
  skipped: LoadedCases["skipped"];
  variants: VariantReport[];
};

const emptySplit = (): EvidenceSplit => ({ strong: 0, weak: 0, absent: 0 });
const HIT_LIMIT = 10;

const CHANNEL_SETS: readonly { name: string; channels: readonly Channel[] }[] = [
  { name: "keyword", channels: ["keyword"] },
  { name: "vector", channels: ["vector"] },
  { name: "hybrid", channels: ["keyword", "vector"] },
];

export function variantsFor(indexChannels: readonly Channel[]): Variant[] {
  return CHANNEL_SETS.filter((set) => set.channels.every((channel) => indexChannels.includes(channel))).flatMap((set) => [
    { name: set.name, channels: set.channels, linkExpansion: true },
    { name: `${set.name}, no links`, channels: set.channels, linkExpansion: false },
  ]);
}

const spreadOf = (values: readonly number[]): Spread => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95) });

async function runVariant(index: HptIndex, loaded: LoadedCases, variant: Variant): Promise<VariantReport> {
  const search = (question: string) => index.search(question, { limit: HIT_LIMIT, channels: variant.channels, linkExpansion: variant.linkExpansion });
  await search("shalat");

  const results: CaseResult[] = [];
  for (const qaCase of loaded.cases) {
    const result = await search(qaCase.question);
    const hitNotes = result.hits.map((hit) => [hit.passage.noteId, ...hit.duplicates.map(noteIdOf)]);
    results.push({
      id: qaCase.id,
      ranks: rankExpected(qaCase.expected, hitNotes),
      evidence: result.evidence.level,
      signals: result.evidence.signals,
      ms: result.ms.total,
      embedMs: result.ms.embed,
    });
  }
  const unreferenced: UnreferencedResult[] = [];
  for (const row of loaded.unreferenced) {
    const { evidence } = await search(row.question);
    unreferenced.push({ id: row.id, evidence: evidence.level, signals: evidence.signals });
  }
  const unreferencedSplit = emptySplit();
  for (const result of unreferenced) unreferencedSplit[result.evidence] += 1;

  const split = (isHit: boolean) => {
    const counts = emptySplit();
    for (const result of results) {
      const found = Object.values(result.ranks).some((rank) => rank !== null);
      if (found === isHit) counts[result.evidence] += 1;
    }
    return counts;
  };
  const summary = summarizeCases(results);
  return {
    variant,
    byCutoff: summary.byCutoff,
    mrr: summary.mrr,
    evidence: { hit: split(true), miss: split(false), unreferenced: unreferencedSplit },
    ms: {
      total: spreadOf(results.map((result) => result.ms)),
      embed: variant.channels.includes("vector") ? spreadOf(results.map((result) => result.embedMs)) : null,
    },
    results,
    unreferenced,
  };
}

export async function runRetrievalEval(input: { index: HptIndex; qaFile: string }): Promise<RetrievalReport> {
  const { index } = input;
  const loaded = loadCases(fs.readFileSync(input.qaFile, "utf8"), (noteId) => index.hasPutusan(noteId));
  const variants: VariantReport[] = [];
  for (const variant of variantsFor(index.info.channels)) variants.push(await runVariant(index, loaded, variant));
  return { indexFingerprint: index.info.fingerprint, channels: index.info.channels, cases: loaded.cases.length, skipped: loaded.skipped, variants };
}
