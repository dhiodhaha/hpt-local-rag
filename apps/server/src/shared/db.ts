import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export type Statement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type Db = {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
};

export function openDb(file: string, options: { readonly: boolean; vec?: boolean }): Db {
  const db = new Database(file, { readonly: options.readonly, fileMustExist: options.readonly });
  if (options.vec) {
    try {
      sqliteVec.load(db);
    } catch {
      // probeCapabilities reports it, so a keyword-only index still opens where the extension does not load.
    }
  }
  if (options.readonly) db.exec("PRAGMA query_only = ON");
  return db;
}

export type Capabilities = { fts5: boolean; vec: boolean };

export function probeCapabilities(db: Db): Capabilities {
  const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5").get() as { fts5: number };
  let vec = true;
  try {
    db.prepare("SELECT vec_version()").get();
  } catch {
    vec = false;
  }
  return { fts5: row.fts5 === 1, vec };
}

export function all<Row>(db: Db, sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

export function get<Row>(db: Db, sql: string, ...params: unknown[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** vec0 takes a vector as a little-endian float32 blob. */
export function vectorBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function vectorOf(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}
