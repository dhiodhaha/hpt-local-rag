import { all, placeholders, type Db } from "../../shared/db.ts";
import type { FtsQuery } from "./fold.ts";
import type { Channel, SearchFilter } from "./types.ts";

/** Ranked rowids, best first. A rank is the index plus one. */
export type RankedList = readonly number[];

export type ChannelLists = {
  channel: Channel;
  /** passages.rowid */
  citable: RankedList;
  /** map_passages.rowid. Empty under a filter, because link expansion could break the filter. */
  map: RankedList;
};

/** Deep enough that link expansion and the per-note cap still leave `limit` hits. */
export const POOL = { citable: 100, map: 40 } as const;

const BM25 = "bm25(putusan_fts, 3.0, 2.0, 1.0)";
const MAP_BM25 = "bm25(map_fts, 3.0, 2.0, 1.0)";

export function hasFilter(filter: SearchFilter | undefined): boolean {
  return filter !== undefined && (filter.noteIds !== undefined || filter.sourceTypes !== undefined || filter.years !== undefined);
}

function scopeClause(filter: SearchFilter): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.noteIds) {
    conditions.push(`n.id IN (${placeholders(filter.noteIds.length)})`);
    params.push(...filter.noteIds);
  }
  if (filter.sourceTypes) {
    conditions.push(`p.source_type IN (${placeholders(filter.sourceTypes.length)})`);
    params.push(...filter.sourceTypes);
  }
  if (filter.years?.from !== undefined) {
    conditions.push("n.year >= ?");
    params.push(filter.years.from);
  }
  if (filter.years?.to !== undefined) {
    conditions.push("n.year <= ?");
    params.push(filter.years.to);
  }
  const where = conditions.length > 0 ? conditions.join(" AND ") : "1";
  return { sql: `rowid IN (SELECT p.rowid FROM passages p JOIN notes n ON n.rowid = p.note_rowid WHERE ${where})`, params };
}

/** The citable pool is computed inside a filter, not post-filtered, so a document scope never under-fills. */
export function keywordLists(db: Db, query: FtsQuery | null, filter: SearchFilter | undefined): ChannelLists {
  if (query === null) return { channel: "keyword", citable: [], map: [] };
  const scope = hasFilter(filter) ? scopeClause(filter as SearchFilter) : null;
  const citable = all<{ rowid: number }>(
    db,
    `SELECT rowid FROM putusan_fts WHERE putusan_fts MATCH ? ${scope ? `AND ${scope.sql}` : ""} ORDER BY ${BM25} LIMIT ${POOL.citable}`,
    query,
    ...(scope?.params ?? []),
  );
  const map = scope
    ? []
    : all<{ rowid: number }>(db, `SELECT rowid FROM map_fts WHERE map_fts MATCH ? ORDER BY ${MAP_BM25} LIMIT ${POOL.map}`, query);
  return { channel: "keyword", citable: citable.map((row) => row.rowid), map: map.map((row) => row.rowid) };
}

/** For notes reached only through a link: the passage that best matches the question, else the first one. */
export function bestPassageOfNotes(db: Db, noteRowids: readonly number[], query: FtsQuery | null): Map<number, number> {
  const best = new Map<number, number>();
  if (noteRowids.length === 0) return best;
  if (query !== null) {
    const matched = all<{ rowid: number; note: number }>(
      db,
      `SELECT putusan_fts.rowid AS rowid, p.note_rowid AS note
       FROM putusan_fts JOIN passages p ON p.rowid = putusan_fts.rowid
       WHERE putusan_fts MATCH ? AND p.note_rowid IN (${placeholders(noteRowids.length)})
       ORDER BY ${BM25}`,
      query,
      ...noteRowids,
    );
    for (const { rowid, note } of matched) if (!best.has(note)) best.set(note, rowid);
  }
  const unmatched = noteRowids.filter((note) => !best.has(note));
  if (unmatched.length > 0) {
    const firsts = all<{ rowid: number; note: number }>(
      db,
      `SELECT rowid, note_rowid AS note FROM passages WHERE ordinal = 1 AND note_rowid IN (${placeholders(unmatched.length)})`,
      ...unmatched,
    );
    for (const { rowid, note } of firsts) best.set(note, rowid);
  }
  return best;
}
