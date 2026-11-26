import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = path.join(repoRoot, "data");

export const config = {
  snapshotDir: process.env.HPT_SNAPSHOT_DIR ?? path.resolve(repoRoot, "../general-2/hpt-corpus"),
  vaultDir: process.env.HPT_VAULT_DIR ?? path.join(dataDir, "vault"),
  indexFile: process.env.HPT_INDEX_FILE ?? path.join(dataDir, "hpt.sqlite"),
  revisionsFile: path.join(dataDir, "revisions.json"),
  qaFile: path.join(dataDir, "qa_pairs.jsonl"),
  evalDir: path.join(dataDir, "eval"),
  siteUrl: "https://hpt.muhammadiyah.or.id",
};
