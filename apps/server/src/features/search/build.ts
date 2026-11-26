import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readVault, type NoteId, type VaultNote } from "../corpus/index.ts";
import { all, get, inTransaction, openDb, type Db } from "../../shared/db.ts";
import { chunkBody, sectionLabel, CHUNKER_VERSION, type Chunk } from "./chunk.ts";
import { fold, FOLD_VERSION } from "./fold.ts";
import { describeNote, describePassage, UnknownFolderError, type NoteMeta, type PassageMeta } from "./putusan-meta.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";
import { SOURCE_TYPES, passageId, type BuildOptions, type BuildReport, type PassageId, type SourceType } from "./types.ts";

export class BuildError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`${problems.length} problems:\n${problems.join("\n")}`);
    this.problems = problems;
  }
}

type PlannedPassage = { id: PassageId; chunk: Chunk; section: string | null; meta: PassageMeta; textHash: string };
type PlannedMapChunk = { chunk: Chunk; section: string | null; links: NoteId[]; textHash: string };

type NotePlan =
  | { kind: "putusan"; note: VaultNote; meta: NoteMeta; passages: PlannedPassage[]; unmatchedTocTitles: number }
  | { kind: "map"; note: VaultNote; chunks: PlannedMapChunk[] };

const sha = (text: string, length?: number) => createHash("sha256").update(text).digest("hex").slice(0, length);

/**
 * A link to `sources/x` counts as a link to `putusan/x` when that putusan exists: a source card is an index card
 * for the same document, and concepts link to the card rather than to the text.
 */
function putusanTarget(target: NoteId, putusanIds: ReadonlySet<NoteId>): NoteId | null {
  if (target.startsWith("putusan/")) return target;
  const cardOf = target.startsWith("sources/") ? `putusan/${target.slice("sources/".length)}` : null;
  return cardOf !== null && putusanIds.has(cardOf) ? cardOf : null;
}

export function planVault(notes: readonly VaultNote[]): NotePlan[] {
  const ids = new Set(notes.map((note) => note.id));
  const putusanIds = new Set(notes.filter((note) => note.collection === "putusan").map((note) => note.id));
  const problems: string[] = [];
  const plans: NotePlan[] = [];

  for (const note of notes) {
    const { chunks, unmatchedTocTitles } = chunkBody(note.body);
    for (const target of new Set(chunks.flatMap((chunk) => chunk.links))) {
      if (!ids.has(target)) problems.push(`${note.id}: link to ${target} resolves to no note`);
    }
    if (note.collection === "putusan") {
      try {
        const meta = describeNote(note);
        const passages = chunks.map((chunk) => ({
          id: passageId(note.id, chunk.ordinal),
          chunk,
          section: sectionLabel(chunk),
          meta: describePassage(note, meta, chunk),
          textHash: sha(chunk.text, 16),
        }));
        plans.push({ kind: "putusan", note, meta, passages, unmatchedTocTitles: unmatchedTocTitles.length });
      } catch (error) {
        if (!(error instanceof UnknownFolderError)) throw error;
        problems.push(error.message);
      }
    } else {
      const mapChunks = chunks.map((chunk) => ({
        chunk,
        section: sectionLabel(chunk),
        links: [...new Set(chunk.links.map((target) => putusanTarget(target, putusanIds)).filter((target) => target !== null))],
        textHash: sha(chunk.text, 16),
      }));
      plans.push({ kind: "map", note, chunks: mapChunks });
    }
  }
  if (problems.length > 0) throw new BuildError(problems);
  return plans;
}

function fingerprintOf(plans: readonly NotePlan[]): string {
  const hash = createHash("sha256");
  hash.update(`schema ${SCHEMA_VERSION} chunker ${CHUNKER_VERSION} fold ${FOLD_VERSION}\n`);
  for (const plan of plans) {
    if (plan.kind === "putusan") {
      for (const passage of plan.passages) hash.update(`${passage.id}:${passage.textHash}\n`);
    } else {
      for (const { chunk, textHash } of plan.chunks) hash.update(`${plan.note.id}#${chunk.ordinal}:${textHash}\n`);
    }
  }
  return hash.digest("hex");
}

type RevisionRow = { superseded: { id: string; textHash: string }; by: { id: string; textHash: string } };

function isRef(value: unknown): value is { id: string; textHash: string } {
  const ref = value as { id?: unknown; textHash?: unknown } | null;
  return typeof ref?.id === "string" && typeof ref.textHash === "string";
}

function readRevisions(file: string | undefined): RevisionRow[] {
  if (file === undefined || !fs.existsSync(file)) return [];
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new BuildError([`${file}: expected an array of {superseded, by}`]);
  const rows: RevisionRow[] = [];
  for (const row of parsed as { superseded?: unknown; by?: unknown }[]) {
    if (!isRef(row.superseded) || !isRef(row.by)) throw new BuildError([`${file}: every row must be {superseded: {id, textHash}, by: {id, textHash}}`]);
    rows.push({ superseded: row.superseded, by: row.by });
  }
  return rows;
}

/** Each pair names both passages and the hash of their text, so a chunker change cannot mark the wrong text superseded. */
function applyRevisions(db: Db, rows: readonly RevisionRow[]): void {
  const hashes = new Map(all<{ id: string; text_hash: string }>(db, "SELECT id, text_hash FROM passages").map((row) => [row.id, row.text_hash]));
  const problems: string[] = [];
  const successorOf = new Map<string, string>();
  const predecessors = new Set<string>();
  for (const { superseded, by } of rows) {
    for (const ref of [superseded, by]) {
      if (!hashes.has(ref.id)) problems.push(`revision names unknown passage ${ref.id}`);
      else if (hashes.get(ref.id) !== ref.textHash) problems.push(`revision expects another text for ${ref.id}`);
    }
    if (successorOf.has(superseded.id)) problems.push(`${superseded.id} is superseded twice`);
    if (predecessors.has(by.id)) problems.push(`${by.id} supersedes two passages`);
    successorOf.set(superseded.id, by.id);
    predecessors.add(by.id);
  }
  for (const start of successorOf.keys()) {
    const seen = new Set([start]);
    for (let next = successorOf.get(start); next !== undefined; next = successorOf.get(next)) {
      if (seen.has(next)) {
        problems.push(`revisions form a cycle through ${start}`);
        break;
      }
      seen.add(next);
    }
  }
  if (problems.length > 0) throw new BuildError(problems);
  for (const { superseded, by } of rows) {
    db.prepare("UPDATE passages SET superseded_by = ? WHERE id = ?").run(by.id, superseded.id);
    db.prepare("UPDATE passages SET supersedes = ? WHERE id = ?").run(superseded.id, by.id);
  }
}

function writeIndex(db: Db, plans: readonly NotePlan[], revisions: readonly RevisionRow[]): { mapLinks: number } {
  const noteRowids = new Map<NoteId, number>();
  const insertNote = db.prepare(
    "INSERT INTO notes (rowid, id, collection, title, source_url, folder, year, number, published_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertPassage = db.prepare(
    `INSERT INTO passages (rowid, id, note_rowid, ordinal, section, source_type, parent, locator, text, text_hash, word_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPassageFts = db.prepare("INSERT INTO putusan_fts (rowid, title, section, body) VALUES (?, ?, ?, ?)");
  const insertMapPassage = db.prepare("INSERT INTO map_passages (rowid, note_rowid, ordinal, section, text) VALUES (?, ?, ?, ?, ?)");
  const insertMapFts = db.prepare("INSERT INTO map_fts (rowid, title, section, body) VALUES (?, ?, ?, ?)");
  const insertLink = db.prepare("INSERT INTO map_links (map_rowid, note_rowid, position) VALUES (?, ?, ?)");

  let passageRowid = 0;
  let mapRowid = 0;
  let mapLinks = 0;
  inTransaction(db, () => {
    for (const plan of plans) {
      const rowid = noteRowids.size + 1;
      noteRowids.set(plan.note.id, rowid);
      const meta = plan.kind === "putusan" ? plan.meta : null;
      insertNote.run(rowid, plan.note.id, plan.note.collection, plan.note.title, plan.note.sourceUrl, plan.note.folder, meta?.year ?? plan.note.year, meta?.number ?? null, meta?.publishedIn ?? null);
    }
    for (const plan of plans) {
      const noteRowid = noteRowids.get(plan.note.id) as number;
      if (plan.kind === "putusan") {
        for (const passage of plan.passages) {
          passageRowid += 1;
          const { chunk } = passage;
          insertPassage.run(passageRowid, passage.id, noteRowid, chunk.ordinal, passage.section, passage.meta.sourceType, passage.meta.parent, JSON.stringify(passage.meta.locator), chunk.text, passage.textHash, chunk.wordCount);
          insertPassageFts.run(passageRowid, fold(plan.note.title), fold(passage.section ?? ""), fold(chunk.text));
        }
      } else {
        for (const { chunk, section, links } of plan.chunks) {
          mapRowid += 1;
          insertMapPassage.run(mapRowid, noteRowid, chunk.ordinal, section, chunk.text);
          insertMapFts.run(mapRowid, fold(plan.note.title), fold(section ?? ""), fold(chunk.text));
          links.forEach((target, position) => {
            insertLink.run(mapRowid, noteRowids.get(target) as number, position);
            mapLinks += 1;
          });
        }
      }
    }
    applyRevisions(db, revisions);
    db.exec("INSERT INTO putusan_fts (putusan_fts) VALUES ('optimize'); INSERT INTO map_fts (map_fts) VALUES ('optimize');");
  });
  return { mapLinks };
}

function writeMeta(db: Db, fingerprint: string): void {
  const insert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  const entries: [string, string][] = [
    ["schema_version", String(SCHEMA_VERSION)],
    ["chunker_version", String(CHUNKER_VERSION)],
    ["fold_version", String(FOLD_VERSION)],
    ["channels", JSON.stringify(["keyword"])],
    ["fingerprint", fingerprint],
    ["built_at", new Date().toISOString()],
  ];
  for (const [key, value] of entries) insert.run(key, value);
}

function verifyIndex(db: Db): string[] {
  const problems: string[] = [];
  const count = (sql: string) => (get<{ n: number }>(db, sql)?.n ?? 0);
  for (const [fts, table] of [["putusan_fts", "passages"], ["map_fts", "map_passages"]] as const) {
    const ftsRows = count(`SELECT count(*) AS n FROM ${fts}`);
    const tableRows = count(`SELECT count(*) AS n FROM ${table}`);
    if (ftsRows !== tableRows) problems.push(`${fts} has ${ftsRows} rows but ${table} has ${tableRows}`);
  }
  const gaps = all<{ id: string }>(
    db,
    `SELECT n.id FROM passages p JOIN notes n ON n.rowid = p.note_rowid
     GROUP BY p.note_rowid HAVING MIN(p.ordinal) <> 1 OR MAX(p.ordinal) <> COUNT(*)`,
  );
  for (const { id } of gaps) problems.push(`${id}: passage ordinals are not 1..n`);
  const empty = all<{ id: string }>(db, "SELECT id FROM notes WHERE collection = 'putusan' AND rowid NOT IN (SELECT note_rowid FROM passages)");
  for (const { id } of empty) problems.push(`${id}: putusan has no passages`);
  const unlinkedCards = all<{ id: string }>(
    db,
    `SELECT s.id FROM notes s
     WHERE s.collection = 'sources'
       AND EXISTS (SELECT 1 FROM notes p WHERE p.id = 'putusan/' || substr(s.id, 9))
       AND NOT EXISTS (
         SELECT 1 FROM map_passages mp
         JOIN map_links ml ON ml.map_rowid = mp.rowid
         JOIN notes p ON p.rowid = ml.note_rowid
         WHERE mp.note_rowid = s.rowid AND p.id = 'putusan/' || substr(s.id, 9))`,
  );
  for (const { id } of unlinkedCards) problems.push(`${id}: source card does not link its putusan`);
  return problems;
}

function readPassageHashes(file: string): Map<string, string> | null {
  if (!fs.existsSync(file)) return null;
  const db = openDb(file, { readonly: true });
  try {
    const versions = new Map(all<{ key: string; value: string }>(db, "SELECT key, value FROM meta").map((row) => [row.key, row.value]));
    const comparable =
      versions.get("schema_version") === String(SCHEMA_VERSION) &&
      versions.get("chunker_version") === String(CHUNKER_VERSION) &&
      versions.get("fold_version") === String(FOLD_VERSION);
    if (!comparable) return null;
    return new Map(all<{ id: string; text_hash: string }>(db, "SELECT id, text_hash FROM passages").map((row) => [row.id, row.text_hash]));
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function driftAgainst(before: Map<string, string> | null, after: ReadonlyMap<string, string>): BuildReport["drift"] {
  if (before === null) return null;
  const changed = [...after].filter(([id, hash]) => before.has(id) && before.get(id) !== hash).map(([id]) => id as PassageId);
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).length,
    removed: [...before.keys()].filter((id) => !after.has(id)).length,
    changed,
  };
}

function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

function summarize(plans: readonly NotePlan[]): Pick<BuildReport, "passagesBySourceType" | "wordCount" | "bookSections" | "unmatchedTocTitles"> {
  const passagesBySourceType = Object.fromEntries(SOURCE_TYPES.map((type) => [type, 0])) as Record<SourceType, number>;
  const words: number[] = [];
  const bookSections: BuildReport["bookSections"] = [];
  const unmatchedTocTitles: BuildReport["unmatchedTocTitles"] = [];
  for (const plan of plans) {
    if (plan.kind !== "putusan") continue;
    if (plan.unmatchedTocTitles > 0) unmatchedTocTitles.push({ noteId: plan.note.id, count: plan.unmatchedTocTitles });
    for (const { chunk, section, meta } of plan.passages) {
      passagesBySourceType[meta.sourceType] += 1;
      words.push(chunk.wordCount);
      if (meta.parent === null) continue;
      const last = bookSections[bookSections.length - 1];
      if (last && last.noteId === plan.note.id && last.section === (chunk.top ?? section)) {
        last.words += chunk.wordCount;
      } else {
        bookSections.push({ noteId: plan.note.id, section: chunk.top ?? section, sourceType: meta.sourceType, page: chunk.page, words: chunk.wordCount });
      }
    }
  }
  words.sort((a, b) => a - b);
  return {
    passagesBySourceType,
    wordCount: { p10: percentile(words, 0.1), p50: percentile(words, 0.5), p90: percentile(words, 0.9), max: words[words.length - 1] ?? 0 },
    bookSections,
    unmatchedTocTitles,
  };
}

/**
 * Full rebuild every time: the index is an artifact, so there are no migrations and no partial states.
 * The new file is written beside the old one and renamed over it, so a failure leaves the old index untouched.
 */
export async function buildIndex(options: BuildOptions): Promise<BuildReport> {
  const started = Date.now();
  const log = options.onProgress ?? (() => undefined);
  const nextFile = `${options.outFile}.next`;

  log("reading the vault");
  const notes = await readVault(options.vaultDir);
  log(`chunking ${notes.length} notes`);
  const plans = planVault(notes);
  const fingerprint = fingerprintOf(plans);
  const revisions = readRevisions(options.revisionsFile);

  fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
  fs.rmSync(nextFile, { force: true });
  const db = openDb(nextFile, { readonly: false });
  let mapLinks = 0;
  try {
    db.exec("PRAGMA page_size = 8192; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    db.exec(SCHEMA_SQL);
    log("writing the index");
    ({ mapLinks } = writeIndex(db, plans, revisions));
    writeMeta(db, fingerprint);
    const problems = verifyIndex(db);
    if (problems.length > 0) throw new BuildError(problems);
  } catch (error) {
    db.close();
    fs.rmSync(nextFile, { force: true });
    throw error;
  }
  db.close();

  const before = readPassageHashes(options.outFile);
  const after = new Map(plans.flatMap((plan) => (plan.kind === "putusan" ? plan.passages.map((p) => [p.id, p.textHash] as const) : [])));
  fs.renameSync(nextFile, options.outFile);

  const summary = summarize(plans);
  const report: BuildReport = {
    fingerprint,
    ms: Date.now() - started,
    bytes: fs.statSync(options.outFile).size,
    counts: {
      notes: notes.length,
      passages: Object.values(summary.passagesBySourceType).reduce((total, n) => total + n, 0),
      mapPassages: plans.reduce((total, plan) => total + (plan.kind === "map" ? plan.chunks.length : 0), 0),
      mapLinks,
    },
    ...summary,
    drift: driftAgainst(before, after),
  };
  fs.writeFileSync(`${options.outFile}.report.json`, JSON.stringify(report, null, 2));
  return report;
}
