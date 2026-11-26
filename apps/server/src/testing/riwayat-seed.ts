import fs from "node:fs";
import path from "node:path";
import { createEngine, loadPromptTemplate, memoryTraceSink, type StoredTurn } from "../features/answer/index.ts";
import { chunked, scriptedProvider } from "../features/providers/index.ts";
import { answerConfig } from "../shared/config.ts";
import { answerJson } from "./answer-fixtures.ts";
import { fakeIndex } from "./fake-index.ts";
import { SCENARIO_PASSAGES } from "./scenarios.ts";

/**
 * A fictional history for `--scenario riwayat`: conversations on several days, one with a follow-up, so the sidebar groups, the
 * search, rename, delete and the full list can be looked at without a real conversation. The turns are produced by the real
 * engine from scripted answers, then dated back from `now`. Nothing here is corpus text.
 */
type Seed = {
  readonly daysAgo: number;
  readonly hour: number;
  readonly turns: readonly { readonly question: string; readonly headline: string; readonly short: string; readonly summary: string }[];
};

const SEEDS: readonly Seed[] = [
  {
    daysAgo: 0,
    hour: 9,
    turns: [
      { question: "Apakah kompos boleh dibuat dari sisa daun?", headline: "Menurut HPT, kompos boleh dibuat dari sisa daun.", short: "boleh", summary: "Kompos boleh dibuat dari sisa daun [S1]. Namun kompos harus matang sebelum dipakai [S2]." },
      { question: "Bagaimana kalau kompos belum matang?", headline: "Menurut HPT, kompos yang belum matang tidak boleh dipakai.", short: "tidak boleh dipakai", summary: "Kompos yang belum matang tidak boleh dipakai [S2]." },
    ],
  },
  { daysAgo: 0, hour: 7, turns: [{ question: "Bolehkah pupuk kandang dicampur ke dalam kompos?", headline: "Menurut HPT, pupuk kandang yang matang boleh dicampur.", short: "boleh, bila matang", summary: "Pupuk kandang yang sudah matang boleh dicampurkan ke dalam tumpukan kompos [S3]." }] },
  { daysAgo: 1, hour: 16, turns: [{ question: "Apakah daun kering boleh dibakar di kebun?", headline: "Berdasarkan HPT, pembakaran di ruang terbuka dilarang di banyak daerah.", short: "tidak dianjurkan", summary: "Daun kering dapat dibakar, tetapi pembakaran di ruang terbuka dilarang di banyak daerah [S3]." }] },
  { daysAgo: 3, hour: 11, turns: [{ question: "Bagaimana hukum menjual kompos hasil olahan sendiri?", headline: "Menurut HPT, menjual kompos yang matang diperbolehkan.", short: "boleh", summary: "Kompos yang sudah matang boleh diperjualbelikan [S1]." }] },
  { daysAgo: 5, hour: 8, turns: [{ question: "Kapan sisa makanan boleh dijadikan bahan kompos?", headline: "Menurut HPT, sisa makanan cocok dicampur dengan daun kering.", short: "boleh, dicampur daun kering", summary: "Sampah dapur seperti kulit buah dan ampas kopi cocok dijadikan bahan kompos bila dicampur dengan daun kering [S4]." }] },
  { daysAgo: 12, hour: 14, turns: [{ question: "Apakah ampas kopi cocok untuk kompos?", headline: "Menurut HPT, ampas kopi cocok untuk kompos.", short: "cocok", summary: "Ampas kopi cocok dijadikan bahan kompos [S4]." }] },
  { daysAgo: 40, hour: 10, turns: [{ question: "Bagaimana menimbang pupuk untuk zakat pertanian?", headline: "Menurut HPT, pupuk tidak dihitung dalam hasil panen.", short: "tidak dihitung", summary: "Pupuk yang dipakai tidak termasuk dalam hasil panen yang dizakati [S5]." }] },
];

const pad = (value: number, size = 2) => String(value).padStart(size, "0");
const idAt = (date: Date, tag: number) => `c-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${tag.toString(16).padStart(4, "0")}`;

export async function seedConversations(dir: string, now: Date = new Date()): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const prompt = loadPromptTemplate(answerConfig.systemPromptDoc);
  for (const [index, seed] of SEEDS.entries()) {
    const started = new Date(now.getFullYear(), now.getMonth(), now.getDate() - seed.daysAgo, seed.hour, 12 + index);
    const stored: StoredTurn[] = [];
    for (const [n, turn] of seed.turns.entries()) {
      const json = answerJson({ headline: turn.headline, headline_short: turn.short, summary: turn.summary });
      const engine = createEngine({ index: fakeIndex(SCENARIO_PASSAGES), provider: scriptedProvider([{ chunks: chunked(json, 28) }]), prompt, canary: "CANARY-seed", traces: memoryTraceSink(), settings: answerConfig.answer });
      const finished = await engine.ask({ question: turn.question, history: [], scope: null }, {});
      await engine.close();
      if (finished.answer === null) throw new Error(`the seed "${turn.question}" was not delivered`);
      const at = new Date(started.getTime() + n * 4 * 60_000);
      stored.push({ id: `seed-${index}-${n}`, n: n + 1, at: at.toISOString(), question: turn.question, scope: null, answer: finished.answer, context: finished.context });
    }
    fs.writeFileSync(path.join(dir, `${idAt(started, index + 1)}.jsonl`), `${stored.map((turn) => JSON.stringify(turn)).join("\n")}\n`);
  }
}
