import { fold, tokens } from "../src/features/search/fold.ts";
import type { Embedder } from "../src/features/search/embed.ts";

export const SYNONYMS: Record<string, string> = { humus: "kompos", gudang: "lumbung" };

const bucketOf = (word: string, dims: number) => [...word].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % dims, 7);

export type FakeEmbedder = Embedder & { batches: string[][]; queries: string[] };

export function fakeEmbedder(options: { dims?: number; maxTokens?: number; id?: string } = {}): FakeEmbedder {
  const dims = options.dims ?? 64;
  const vectorOf = (text: string) => {
    const vector = new Float32Array(dims);
    for (const word of tokens(fold(text))) vector[bucketOf(SYNONYMS[word] ?? word, dims)] += 1;
    const length = Math.hypot(...vector) || 1;
    return vector.map((value) => value / length);
  };
  const batches: string[][] = [];
  const queries: string[] = [];
  return {
    id: options.id ?? "fake-bow",
    dims,
    maxTokens: options.maxTokens ?? 512,
    batches,
    queries,
    embedQuery: async (question) => {
      queries.push(question);
      return vectorOf(question);
    },
    embedPassages: async (inputs) => {
      batches.push([...inputs]);
      return inputs.map(vectorOf);
    },
    tokenCount: (input) => tokens(fold(input)).length + 2,
  };
}
