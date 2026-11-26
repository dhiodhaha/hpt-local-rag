import type { ChannelLists } from "./channels.ts";
import type { Channel, Evidence, EvidenceLevel, MapCollection } from "./types.ts";

/**
 * Every ranking number, changed only from `hpt eval retrieval` output.
 * `evidence.floors` come from `hpt eval evidence`: the grid point that best separates conversations with a retrieved
 * reference from those without, validated leave-one-out. `strongCoverage` is a judgement and was not fitted.
 */
export const RANK_POLICY = {
  rrfK: 60,
  weight: { putusan: 1.0, sources: 0.8, concepts: 0.5, entities: 0.4, quran: 0.3 },
  expandTopMap: 20,
  expandLinksPerPassage: 5,
  maxPerNote: 2,
  evidence: { strongCoverage: 0.6, agreementTop: 5, floors: { coverage: 0.5, agreement: 0.4, cosine: 0.85 } },
} as const;

export type RankLookups = {
  citable: ReadonlyMap<number, { noteRowid: number; textHash: string }>;
  map: ReadonlyMap<number, { collection: MapCollection; links: readonly number[] }>;
  bestPassageOfNote: ReadonlyMap<number, number>;
};

export type ReasonDraft =
  | { kind: "direct"; channel: Channel; rank: number }
  | { kind: "via_link"; channel: Channel; rank: number; fromMapRowid: number };

export type Fused = {
  passageRowid: number;
  score: number;
  reasons: [ReasonDraft, ...ReasonDraft[]];
  duplicates: number[];
};

type Expansion = { channel: Channel; mapRowid: number; mapRank: number; collection: MapCollection; noteRowid: number };

function expansions(lists: readonly ChannelLists[], lookups: Pick<RankLookups, "map">): Expansion[] {
  const found: Expansion[] = [];
  for (const list of lists) {
    list.map.slice(0, RANK_POLICY.expandTopMap).forEach((mapRowid, index) => {
      const info = lookups.map.get(mapRowid);
      if (!info) return;
      for (const noteRowid of info.links.slice(0, RANK_POLICY.expandLinksPerPassage)) {
        found.push({ channel: list.channel, mapRowid, mapRank: index + 1, collection: info.collection, noteRowid });
      }
    });
  }
  return found;
}

function bestCitablePassageByNote(lists: readonly ChannelLists[], lookups: Pick<RankLookups, "citable">): Map<number, number> {
  const bestRank = new Map<number, number>();
  const representative = new Map<number, number>();
  for (const list of lists) {
    list.citable.forEach((rowid, index) => {
      const note = lookups.citable.get(rowid)?.noteRowid;
      if (note === undefined || index >= (bestRank.get(note) ?? Infinity)) return;
      bestRank.set(note, index);
      representative.set(note, rowid);
    });
  }
  return representative;
}

/** The searcher resolves these notes' passages before `fuse`. */
export function notesNeedingPassage(lists: readonly ChannelLists[], lookups: Pick<RankLookups, "citable" | "map">): number[] {
  const bestByNote = bestCitablePassageByNote(lists, lookups);
  return [...new Set(expansions(lists, lookups).map((expansion) => expansion.noteRowid))].filter((note) => !bestByNote.has(note));
}

export function fuse(lists: readonly ChannelLists[], lookups: RankLookups, limit: number): Fused[] {
  const scores = new Map<number, Omit<Fused, "passageRowid" | "duplicates">>();
  const add = (rowid: number, score: number, reason: ReasonDraft) => {
    const entry = scores.get(rowid);
    if (entry) {
      entry.score += score;
      entry.reasons.push(reason);
    } else {
      scores.set(rowid, { score, reasons: [reason] });
    }
  };

  for (const list of lists) {
    list.citable.forEach((rowid, index) => {
      add(rowid, RANK_POLICY.weight.putusan / (RANK_POLICY.rrfK + index + 1), { kind: "direct", channel: list.channel, rank: index + 1 });
    });
  }
  const bestByNote = bestCitablePassageByNote(lists, lookups);
  for (const expansion of expansions(lists, lookups)) {
    const rowid = bestByNote.get(expansion.noteRowid) ?? lookups.bestPassageOfNote.get(expansion.noteRowid);
    if (rowid === undefined) continue;
    add(rowid, RANK_POLICY.weight[expansion.collection] / (RANK_POLICY.rrfK + expansion.mapRank), {
      kind: "via_link",
      channel: expansion.channel,
      rank: expansion.mapRank,
      fromMapRowid: expansion.mapRowid,
    });
  }

  const ranked = [...scores].sort((a, b) => b[1].score - a[1].score || a[0] - b[0]);
  const byHash = new Map<string, Fused>();
  const perNote = new Map<number, number>();
  const fused: Fused[] = [];
  for (const [passageRowid, entry] of ranked) {
    const info = lookups.citable.get(passageRowid);
    if (!info) continue;
    const twin = byHash.get(info.textHash);
    if (twin) {
      twin.duplicates.push(passageRowid);
      continue;
    }
    const used = perNote.get(info.noteRowid) ?? 0;
    if (used >= RANK_POLICY.maxPerNote) continue;
    perNote.set(info.noteRowid, used + 1);
    const hit: Fused = { passageRowid, ...entry, duplicates: [] };
    byHash.set(info.textHash, hit);
    fused.push(hit);
  }
  return fused.slice(0, limit);
}

function channelAgreement(fused: readonly Fused[], channels: readonly Channel[]): number | null {
  const top = fused.slice(0, RANK_POLICY.evidence.agreementTop);
  if (channels.length < 2 || top.length === 0) return null;
  const found = (hit: Fused, channel: Channel) => hit.reasons.some((reason) => reason.kind === "direct" && reason.channel === channel);
  return top.filter((hit) => channels.every((channel) => found(hit, channel))).length / top.length;
}

export type EvidenceFloors = { coverage: number; agreement: number; cosine: number };

/**
 * Each signal that was measured either clears its floor or fails it.
 * absent: more than half of the measured signals fail. One weak signal alone does not condemn a hit, because the
 *   keyword and vector channels find different right answers.
 * strong: the top hit is a direct match, covers most of the question's terms, and no measured signal fails.
 * weak: everything else.
 * A keyword-only search measures coverage alone, so coverage alone decides there.
 */
export function levelOf(signals: Evidence["signals"], floors: EvidenceFloors = RANK_POLICY.evidence.floors): EvidenceLevel {
  const measured = [
    [signals.topCoverage, floors.coverage],
    [signals.channelAgreement, floors.agreement],
    [signals.nearestCosine, floors.cosine],
  ].filter((pair): pair is [number, number] => pair[0] !== null);
  const failed = measured.filter(([value, floor]) => value < floor).length;
  if (failed * 2 > measured.length) return "absent";
  if (signals.topIsDirect && signals.topCoverage >= RANK_POLICY.evidence.strongCoverage && failed === 0) return "strong";
  return "weak";
}

export function judgeEvidence(input: { fused: readonly Fused[]; topCoverage: number; channels: readonly Channel[]; nearestCosine: number | null }): Evidence {
  const top = input.fused[0];
  const topIsDirect = top?.reasons.some((reason) => reason.kind === "direct") ?? false;
  const signals = { topCoverage: input.topCoverage, topIsDirect, channelAgreement: channelAgreement(input.fused, input.channels), nearestCosine: input.nearestCosine };
  return { level: top ? levelOf(signals) : "absent", signals };
}
