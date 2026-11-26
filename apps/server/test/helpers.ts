import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TokenBudget } from "../src/features/search/chunk.ts";

const VOCABULARY = [
  "kebun", "tanam", "musim", "panen", "pasar", "harga", "timbang", "sewa", "lumbung", "benih", "hujan", "angin",
  "jalan", "desa", "warga", "rapat", "laporan", "catatan", "gudang", "perahu", "nelayan", "jaring", "ombak", "pantai",
  "garam", "tambak", "udang", "bandeng", "pelabuhan", "kapal", "dermaga", "muatan", "sungai", "jembatan", "sawah", "irigasi",
];

/** Synthetic filler text: the real corpus is copyrighted, so tests never copy it. */
export function sentences(seed: number, wordCount: number): string {
  const words: string[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    const word = VOCABULARY[(seed * 7 + index * 5 + Math.floor(index / 9)) % VOCABULARY.length] as string;
    const startsSentence = index % 12 === 0;
    const endsSentence = index % 12 === 11 || index === wordCount - 1;
    const cased = startsSentence ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    words.push(endsSentence ? `${cased}.` : cased);
  }
  return words.join(" ");
}

export function hardWrapped(text: string, wordsPerLine = 6): string {
  const words = text.split(" ");
  const lines: string[] = [];
  for (let start = 0; start < words.length; start += wordsPerLine) lines.push(`${words.slice(start, start + wordsPerLine).join(" ")}  `);
  return lines.join("\n");
}

export function wordTotal(texts: readonly string[]): number {
  return texts.join(" ").split(/\s+/).filter(Boolean).length;
}

export type FixtureNote = {
  id: string;
  title: string;
  folder?: string;
  year?: number;
  body: string;
  backlink?: string;
};

export function noteMarkdown(note: FixtureNote): string {
  const lines = [`title: ${JSON.stringify(note.title)}`, `kind: ${JSON.stringify("Uji")}`, `source: ${JSON.stringify(`https://example.test/wiki/${note.id}`)}`];
  if (note.year !== undefined) lines.push(`year: ${note.year}`);
  if (note.folder !== undefined) lines.push(`folder: ${JSON.stringify(note.folder)}`);
  const backlink = note.backlink ? `\n\n## Sumber\n\n- [[${note.backlink}|Kartu]]` : "";
  return `---\n${lines.join("\n")}\n---\n\n# ${note.title}\n\n${note.body}${backlink}\n`;
}

export function writeVault(notes: readonly FixtureNote[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-vault-"));
  for (const note of notes) {
    const file = path.join(dir, `${note.id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, noteMarkdown(note));
  }
  return dir;
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hpt-test-"));
}

/** Every word costs `perWord` tokens and the title with its section costs `overhead`, so a heavy script can be modelled without a tokenizer. */
export function wordBudget(options: { max?: number; perWord?: number; overhead?: number } = {}): TokenBudget {
  const perWord = options.perWord ?? 1;
  const overhead = options.overhead ?? 0;
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  return { max: options.max ?? 100_000, overhead: (section) => overhead + words(section ?? "") * perWord, tokens: (text) => words(text) * perWord };
}

export const costOf = (budget: TokenBudget, section: string | null, text: string) => budget.overhead(section) + budget.tokens(text);
