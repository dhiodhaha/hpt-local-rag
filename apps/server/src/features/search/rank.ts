import type { ChannelLists } from "./channels.ts";
import type { Channel, Evidence, MapCollection } from "./types.ts";

/**
 * Every ranking number, changed only from `hpt eval retrieval` output.
 */
export const RANK_POLICY = {
  rrfK: 60,
  weight: { putusan: 1.0, sources: 0.8, concepts: 0.5, entities: 0.4, quran: 0.3 },
  expandTopMap: 20,
  expandLinksPerPassage: 5,
  maxPerNote: 2,
  evidence: { strongCoverage: 0.6, absentCoverage: 0.34 },
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

/**
 * absent: no hits, or the top hit covers too few of the question's content terms.
 * strong: the top hit is a direct match and covers most of them.
 * weak: everything else.
 */
export function judgeEvidence(input: { fused: readonly Fused[]; topCoverage: number }): Evidence {
  const top = input.fused[0];
  const topIsDirect = top?.reasons.some((reason) => reason.kind === "direct") ?? false;
  const signals = { topCoverage: input.topCoverage, topIsDirect };
  if (!top || input.topCoverage < RANK_POLICY.evidence.absentCoverage) return { level: "absent", signals };
  if (topIsDirect && input.topCoverage >= RANK_POLICY.evidence.strongCoverage) return { level: "strong", signals };
  return { level: "weak", signals };
}
