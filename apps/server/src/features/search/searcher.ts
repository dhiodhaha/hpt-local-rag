import fs from "node:fs";
import type { NoteId } from "../corpus/index.ts";
import { all, get, openDb, placeholders, probeCapabilities, type Db } from "../../shared/db.ts";
import { bestPassageOfNotes, keywordLists, vectorLists, type ChannelLists } from "./channels.ts";
import { CHUNKER_VERSION } from "./chunk.ts";
import type { Embedder, EmbedderSource } from "./embed.ts";
import { contentTerms, coverage, fold, FOLD_VERSION, toFtsQuery } from "./fold.ts";
import { fuse, judgeEvidence, notesNeedingPassage, type Fused, type ReasonDraft } from "./rank.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import type {
  Channel,
  HitReason,
  HptIndex,
  IndexInfo,
  Locator,
  MapCollection,
  NoteRef,
  Passage,
  PassageId,
  SearchHit,
  SearchOptions,
  SearchResult,
  SourceType,
} from "./types.ts";

export class IndexUnavailableError extends Error {}

const DEFAULT_LIMIT = 10;
const MAX_LEADS = 5;

type PassageRow = {
  rowid: number;
  id: string;
  note_id: string;
  ordinal: number;
  title: string;
  section: string | null;
  source_type: SourceType;
  parent: string | null;
  number: string | null;
  year: number | null;
  published_in: string | null;
  locator: string;
  supersedes: string | null;
  superseded_by: string | null;
  text: string;
  text_hash: string;
  source_url: string;
};

const PASSAGE_SELECT = `SELECT p.rowid AS rowid, p.id AS id, n.id AS note_id, p.ordinal AS ordinal, n.title AS title, p.section AS section,
  p.source_type AS source_type, p.parent AS parent, n.number AS number, n.year AS year, n.published_in AS published_in,
  p.locator AS locator, p.supersedes AS supersedes, p.superseded_by AS superseded_by, p.text AS text,
  p.text_hash AS text_hash, n.source_url AS source_url
  FROM passages p JOIN notes n ON n.rowid = p.note_rowid`;

function toPassage(row: PassageRow): Passage {
  return {
    id: row.id as PassageId,
    noteId: row.note_id,
    ordinal: row.ordinal,
    title: row.title,
    section: row.section,
    sourceType: row.source_type,
    parent: row.parent,
    number: row.number,
    year: row.year,
    publishedIn: row.published_in,
    locator: JSON.parse(row.locator) as Locator,
    supersedes: row.supersedes as PassageId | null,
    supersededBy: row.superseded_by as PassageId | null,
    text: row.text,
    textHash: row.text_hash,
    sourceUrl: row.source_url,
  };
}

function readInfo(db: Db, path: string): IndexInfo {
  const meta = new Map(all<{ key: string; value: string }>(db, "SELECT key, value FROM meta").map((row) => [row.key, row.value]));
  const versions: [string, number][] = [
    ["schema_version", SCHEMA_VERSION],
    ["chunker_version", CHUNKER_VERSION],
    ["fold_version", FOLD_VERSION],
  ];
  for (const [key, expected] of versions) {
    if (meta.get(key) !== String(expected)) throw new IndexUnavailableError(`${path} was built with another ${key}. Run \`pnpm hpt build\`.`);
  }
  const count = (table: string) => get<{ n: number }>(db, `SELECT count(*) AS n FROM ${table}`)?.n ?? 0;
  const model = meta.get("embedding_model");
  return {
    path,
    schemaVersion: SCHEMA_VERSION,
    chunkerVersion: CHUNKER_VERSION,
    foldVersion: FOLD_VERSION,
    channels: JSON.parse(meta.get("channels") ?? "[]") as Channel[],
    embedding: model === undefined ? null : { model, dims: Number(meta.get("embedding_dims")) },
    fingerprint: meta.get("fingerprint") ?? "",
    counts: { notes: count("notes"), passages: count("passages"), mapPassages: count("map_passages") },
  };
}

type MapInfo = { rowid: number; note_id: string; title: string; collection: MapCollection };

function citableLookups(db: Db, rowids: readonly number[]): Map<number, { noteRowid: number; textHash: string }> {
  const unique = [...new Set(rowids)];
  if (unique.length === 0) return new Map();
  const rows = all<{ rowid: number; note_rowid: number; text_hash: string }>(
    db,
    `SELECT rowid, note_rowid, text_hash FROM passages WHERE rowid IN (${placeholders(unique.length)})`,
    ...unique,
  );
  return new Map(rows.map((row) => [row.rowid, { noteRowid: row.note_rowid, textHash: row.text_hash }]));
}

function mapLookups(db: Db, rowids: readonly number[]) {
  const unique = [...new Set(rowids)];
  const info = new Map<number, MapInfo>();
  const links = new Map<number, number[]>();
  if (unique.length > 0) {
    const marks = placeholders(unique.length);
    const rows = all<MapInfo>(
      db,
      `SELECT mp.rowid AS rowid, n.id AS note_id, n.title AS title, n.collection AS collection
       FROM map_passages mp JOIN notes n ON n.rowid = mp.note_rowid WHERE mp.rowid IN (${marks})`,
      ...unique,
    );
    for (const row of rows) info.set(row.rowid, row);
    const linkRows = all<{ map_rowid: number; note_rowid: number }>(
      db,
      `SELECT map_rowid, note_rowid FROM map_links WHERE map_rowid IN (${marks}) ORDER BY map_rowid, position`,
      ...unique,
    );
    for (const row of linkRows) links.set(row.map_rowid, [...(links.get(row.map_rowid) ?? []), row.note_rowid]);
  }
  const forRanking = new Map([...info].map(([rowid, row]) => [rowid, { collection: row.collection, links: links.get(rowid) ?? [] }]));
  return { info, forRanking };
}

function hydrate(db: Db, rowids: readonly number[]): Map<number, Passage> {
  if (rowids.length === 0) return new Map();
  const rows = all<PassageRow>(db, `${PASSAGE_SELECT} WHERE p.rowid IN (${placeholders(rowids.length)})`, ...rowids);
  return new Map(rows.map((row) => [row.rowid, toPassage(row)]));
}

function leadsFrom(lists: readonly ChannelLists[], mapInfo: ReadonlyMap<number, MapInfo>): NoteRef[] {
  const leads = new Map<NoteId, NoteRef>();
  for (const rowid of lists.flatMap((list) => list.map)) {
    const info = mapInfo.get(rowid);
    if (!info || info.collection === "sources" || leads.has(info.note_id)) continue;
    leads.set(info.note_id, { noteId: info.note_id, title: info.title, collection: info.collection });
    if (leads.size === MAX_LEADS) break;
  }
  return [...leads.values()];
}

function toReason(draft: ReasonDraft, mapInfo: ReadonlyMap<number, MapInfo>): HitReason {
  if (draft.kind === "direct") return draft;
  const from = mapInfo.get(draft.fromMapRowid) as MapInfo;
  return { kind: "via_link", channel: draft.channel, rank: draft.rank, from: { noteId: from.note_id, title: from.title, collection: from.collection } };
}

function toHit(fused: Fused, passages: ReadonlyMap<number, Passage>, mapInfo: ReadonlyMap<number, MapInfo>): SearchHit {
  const [first, ...rest] = fused.reasons;
  return {
    passage: passages.get(fused.passageRowid) as Passage,
    score: fused.score,
    reasons: [toReason(first, mapInfo), ...rest.map((reason) => toReason(reason, mapInfo))],
    duplicates: fused.duplicates.map((rowid) => (passages.get(rowid) as Passage).id),
  };
}

async function search(db: Db, info: IndexInfo, embedder: () => Promise<Embedder>, question: string, options: SearchOptions): Promise<SearchResult> {
  const started = performance.now();
  const channels = options.channels ?? info.channels;
  for (const channel of channels) {
    if (!info.channels.includes(channel)) throw new Error(`this index has no ${channel} channel`);
  }
  const terms = contentTerms(question);
  const query = toFtsQuery(terms);

  const ms = { keyword: 0, embed: 0, vector: 0, total: 0 };
  const lists: ChannelLists[] = [];
  if (channels.includes("keyword")) {
    lists.push(keywordLists(db, query, options.filter));
    ms.keyword = performance.now() - started;
  }
  if (channels.includes("vector") && question.trim() !== "") {
    const embedStarted = performance.now();
    const vector = await (await embedder()).embedQuery(question);
    ms.embed = performance.now() - embedStarted;
    const searchStarted = performance.now();
    lists.push(vectorLists(db, vector, options.filter));
    ms.vector = performance.now() - searchStarted;
  }

  const map = mapLookups(db, lists.flatMap((list) => list.map));
  const fusionLists = options.linkExpansion === false ? lists.map((list) => ({ ...list, map: [] })) : lists;
  const citable = citableLookups(db, lists.flatMap((list) => list.citable));
  const missing = notesNeedingPassage(fusionLists, { citable, map: map.forRanking });
  const bestPassageOfNote = bestPassageOfNotes(db, missing, query);
  for (const [rowid, row] of citableLookups(db, [...bestPassageOfNote.values()])) citable.set(rowid, row);
  const fused = fuse(fusionLists, { citable, map: map.forRanking, bestPassageOfNote }, options.limit ?? DEFAULT_LIMIT);

  const passages = hydrate(db, [...new Set(fused.flatMap((entry) => [entry.passageRowid, ...entry.duplicates]))]);
  const hits = fused.map((entry) => toHit(entry, passages, map.info));
  const top = hits[0]?.passage;
  const topCoverage = top ? coverage(terms, fold(`${top.title} ${top.text}`)) : 0;
  return {
    hits,
    leads: leadsFrom(lists, map.info),
    evidence: judgeEvidence({ fused, topCoverage, channels: lists.map((list) => list.channel), nearestCosine: lists.find((list) => list.channel === "vector")?.nearestCosine ?? null }),
    channels,
    ms: { ...ms, total: performance.now() - started },
  };
}

function lazyEmbedder(info: IndexInfo, source: EmbedderSource | undefined): () => Promise<Embedder> {
  let loaded: Promise<Embedder> | null = null;
  return () => {
    if (source === undefined) return Promise.reject(new Error("this index has a vector channel, so openIndex needs an embedder"));
    loaded ??= source().then((embedder) => {
      if (embedder.id !== info.embedding?.model) {
        throw new IndexUnavailableError(`${info.path} was embedded with ${info.embedding?.model}, not ${embedder.id}. Run \`pnpm hpt build\`.`);
      }
      return embedder;
    });
    return loaded;
  };
}

/** Opens the index read-only. Throws IndexUnavailableError when it is missing or was built by other code. */
export function openIndex(options: { path: string; embedder?: EmbedderSource }): HptIndex {
  if (!fs.existsSync(options.path)) throw new IndexUnavailableError(`${options.path} is missing. Run \`pnpm hpt build\`.`);
  const db = openDb(options.path, { readonly: true, vec: true });
  const capabilities = probeCapabilities(db);
  if (!capabilities.fts5) throw new IndexUnavailableError("this SQLite build has no FTS5");
  const info = readInfo(db, options.path);
  if (info.channels.includes("vector") && !capabilities.vec) throw new IndexUnavailableError("sqlite-vec did not load, so the vector channel is unavailable");
  const embedder = lazyEmbedder(info, options.embedder);
  return {
    info,
    search: (question, searchOptions = {}) => search(db, info, embedder, question, searchOptions),
    getPassages(ids) {
      if (ids.length === 0) return new Map();
      const rows = all<PassageRow>(db, `${PASSAGE_SELECT} WHERE p.id IN (${placeholders(ids.length)})`, ...ids);
      return new Map(rows.map((row) => [row.id as PassageId, toPassage(row)]));
    },
    hasPutusan: (noteId) => get(db, "SELECT 1 AS found FROM notes WHERE id = ? AND collection = 'putusan'", noteId) !== undefined,
    close: () => db.close(),
  };
}
