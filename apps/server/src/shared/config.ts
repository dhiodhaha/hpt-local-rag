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
  modelDir: process.env.HPT_MODEL_DIR ?? path.join(dataDir, "models"),
  embeddingCacheFile: process.env.HPT_EMBEDDING_CACHE ?? path.join(dataDir, "cache", "embeddings.sqlite"),
  siteUrl: "https://hpt.muhammadiyah.or.id",
};

export const answerConfig = {
  systemPromptDoc: path.join(repoRoot, "docs", "system-prompt-v2.md"),
  conversationsDir: path.join(dataDir, "conversations"),
  tracesDir: path.join(dataDir, "traces"),
  canaryFile: path.join(dataDir, "canary.txt"),
  answer: {
    model: "claude-opus-5-5",
    effort: "low",
    maxExtraToolCalls: 2,
    searchLimit: 10,
    evidenceTokens: 8000,
    fallbacks: { "claude-opus-5-5": { model: "claude-sonnet-5-5", effort: "low" } },
    rewrite: { model: "claude-haiku-5-5", effort: "low", budgetMs: 2500 },
  },
  /** D36: the title of a conversation, one small call after its first answer. Kept out of `answer` so a rig that scripts the provider has no title call unless it asks for one. */
  title: { model: "claude-haiku-5-5", effort: "low", budgetMs: 5000 },
} as const;

/** Answer eval files. Everything with question or answer text is under data/. Only the lock is committed: ids, categories and a hash. */
export const answerEvalConfig = {
  writtenFile: path.join(dataDir, "eval", "answer-written.json"),
  draftFile: path.join(dataDir, "eval", "answer-subset.draft.json"),
  subsetFile: path.join(dataDir, "eval", "answer-subset.json"),
  followupFile: path.join(dataDir, "eval", "followup-cases.json"),
  lockFile: path.join(repoRoot, "docs", "eval", "answer-subset.lock.json"),
  runsDir: path.join(dataDir, "eval"),
  seed: 13,
} as const;
