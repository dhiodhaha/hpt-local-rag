import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const config = {
  snapshotDir: process.env.HPT_SNAPSHOT_DIR ?? path.resolve(repoRoot, "../general-2/hpt-corpus"),
  vaultDir: process.env.HPT_VAULT_DIR ?? path.join(repoRoot, "data/vault"),
  siteUrl: "https://hpt.muhammadiyah.or.id",
};
