import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EmbeddingCache } from "./embedding-cache.ts";

export const E5_SMALL = { model: "Xenova/multilingual-e5-small", dtype: "q8", dims: 384, maxTokens: 512 } as const;

/** e5 is trained with these prefixes and loses recall without them. */
const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

export type Embedder = {
  /** Written into the index and part of every cache key, so a vector only meets vectors of the same model. */
  readonly id: string;
  readonly dims: number;
  readonly maxTokens: number;
  /** L2-normalised, so a dot product is the cosine. */
  embedQuery(question: string): Promise<Float32Array>;
  embedPassages(inputs: readonly string[]): Promise<Float32Array[]>;
  /** Tokens the model would read for a passage input, special tokens included, before it truncates. */
  tokenCount(input: string): number;
};

export type EmbedderSource = () => Promise<Embedder>;

export class ModelUnavailableError extends Error {}

export function passageInput(title: string, section: string | null, text: string): string {
  return [title, section, text].filter((part) => part !== null && part !== "").join("\n");
}

const inputHash = (input: string) => createHash("sha256").update(input).digest("hex");

export async function loadEmbedder(options: { modelDir: string; allowDownload: boolean }): Promise<Embedder> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.localModelPath = options.modelDir;
  env.cacheDir = options.modelDir;
  env.allowRemoteModels = options.allowDownload;
  const modelDir = path.join(options.modelDir, E5_SMALL.model);
  if (!options.allowDownload && !fs.existsSync(modelDir)) {
    throw new ModelUnavailableError(`${modelDir} is missing. Run \`pnpm hpt build\` once with a network connection.`);
  }
  const extractor = await pipeline("feature-extraction", E5_SMALL.model, { dtype: E5_SMALL.dtype });
  const embed = async (inputs: string[]): Promise<Float32Array[]> => {
    const output = await extractor(inputs, { pooling: "mean", normalize: true });
    const data = output.data as Float32Array;
    return inputs.map((_input, row) => data.slice(row * E5_SMALL.dims, (row + 1) * E5_SMALL.dims));
  };
  return {
    id: `${E5_SMALL.model}:${E5_SMALL.dtype}`,
    dims: E5_SMALL.dims,
    maxTokens: E5_SMALL.maxTokens,
    embedQuery: async (question) => (await embed([`${QUERY_PREFIX}${question}`]))[0] as Float32Array,
    embedPassages: (inputs) => embed(inputs.map((input) => `${PASSAGE_PREFIX}${input}`)),
    tokenCount: (input) => extractor.tokenizer.encode(`${PASSAGE_PREFIX}${input}`).length,
  };
}

export type EmbeddedAll = { vectors: Float32Array[]; cached: number; embedded: number; ms: number };

const BATCH_SIZE = 16;

/**
 * One vector per input, in order.
 * Longest inputs go first: a batch pads to its longest member, and sorted batches pad least.
 */
export async function embedAll(
  inputs: readonly string[],
  options: { embedder: Embedder; cache: EmbeddingCache; onProgress?: (message: string) => void },
): Promise<EmbeddedAll> {
  const { embedder, cache } = options;
  const started = performance.now();
  const hashes = inputs.map(inputHash);
  const known = cache.lookup(embedder.id, hashes);
  const firstInputOf = new Map<string, string>();
  inputs.forEach((input, index) => {
    const hash = hashes[index] as string;
    if (!known.has(hash) && !firstInputOf.has(hash)) firstInputOf.set(hash, input);
  });
  const missing = [...firstInputOf].sort((a, b) => b[1].length - a[1].length);

  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    const batch = missing.slice(start, start + BATCH_SIZE);
    const vectors = await embedder.embedPassages(batch.map(([, input]) => input));
    const entries = batch.map(([hash], index) => [hash, vectors[index] as Float32Array] as const);
    cache.store(embedder.id, entries);
    for (const [hash, vector] of entries) known.set(hash, vector);
    if ((start / BATCH_SIZE) % 50 === 49) options.onProgress?.(`embedded ${start + batch.length} of ${missing.length} new passages`);
  }
  return {
    vectors: hashes.map((hash) => known.get(hash) as Float32Array),
    cached: inputs.length - missing.length,
    embedded: missing.length,
    ms: performance.now() - started,
  };
}
