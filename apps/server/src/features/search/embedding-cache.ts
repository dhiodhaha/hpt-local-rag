import fs from "node:fs";
import path from "node:path";
import { all, inTransaction, openDb, placeholders, vectorBlob, vectorOf } from "../../shared/db.ts";

export type EmbeddingCache = {
  lookup(model: string, hashes: readonly string[]): Map<string, Float32Array>;
  store(model: string, entries: readonly (readonly [hash: string, vector: Float32Array])[]): void;
  close(): void;
};

export function openEmbeddingCache(file: string): EmbeddingCache {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file, { readonly: false });
  db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
    model      TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    vector     BLOB NOT NULL,
    PRIMARY KEY (model, input_hash)
  ) STRICT, WITHOUT ROWID`);
  const insert = db.prepare("INSERT OR REPLACE INTO embeddings (model, input_hash, vector) VALUES (?, ?, ?)");
  return {
    lookup(model, hashes) {
      const found = new Map<string, Float32Array>();
      const unique = [...new Set(hashes)];
      for (let start = 0; start < unique.length; start += 500) {
        const slice = unique.slice(start, start + 500);
        const rows = all<{ input_hash: string; vector: Buffer }>(
          db,
          `SELECT input_hash, vector FROM embeddings WHERE model = ? AND input_hash IN (${placeholders(slice.length)})`,
          model,
          ...slice,
        );
        for (const row of rows) found.set(row.input_hash, vectorOf(row.vector));
      }
      return found;
    },
    store(model, entries) {
      inTransaction(db, () => {
        for (const [hash, vector] of entries) insert.run(model, hash, vectorBlob(vector));
      });
    },
    close: () => db.close(),
  };
}
