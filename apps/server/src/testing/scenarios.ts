import { createEngine, loadPromptTemplate, memoryTraceSink, openConversations, type AnswerEngine, type AnswerEvent } from "../features/answer/index.ts";
import { claudeModelOptions, createHost, type Host, type HostDeps } from "../features/host/index.ts";
import { chunked, scriptedProvider, type Connection, type ScriptedAttempt } from "../features/providers/index.ts";
import type { EvidenceLevel, Passage } from "../features/search/index.ts";
import { answerConfig } from "../shared/config.ts";
import { GOOD_ANSWER, TEXT_ONE, TEXT_TWO, answerJson, makePassage } from "./answer-fixtures.ts";
import { fakeIndex, type FakeIndex } from "./fake-index.ts";
import { READER_ORDER, REVISED_ORDER } from "./reader-fixtures.ts";

/**
 * Named, repeatable runs of the real engine (real pipeline, real checks, real fold) with a scripted provider and a fake index
 * of fictional passages. One definition, three consumers: `pnpm dev:desktop -- --scenario <name>` shows a state without spending
 * usage, desktop tests record the events and feed them to the renderer's reducer, and `pnpm shots` draws each state.
 *
 * Why scenarios and not hand-written event lists: a hand-written list can describe a stream the engine would never produce.
 * A scenario can only produce what the engine produces.
 */
export const SCENARIO_PASSAGES: readonly Passage[] = [
  makePassage(1, TEXT_ONE, { sourceType: "hpt", title: "HPT Jilid 1, Bab Kompos", number: null, year: null, locator: { volume: "Jilid 1", kitab: "Kitab Pertanian", bab: "Bab Kompos" } }),
  makePassage(2, TEXT_TWO, { sourceType: "fatwa", title: "Fatwa Tarjih Uji 2", number: "2", year: 2003 }),
  makePassage(3, "Daun kering juga dapat dibakar, tetapi pembakaran di ruang terbuka dilarang di banyak daerah.", { sourceType: "tanya_jawab", title: "Tanya Jawab Uji 3", number: "3", year: 2011 }),
  makePassage(4, "Sampah dapur seperti kulit buah dan ampas kopi cocok dijadikan bahan kompos bila dicampur dengan daun kering.", { sourceType: "tanya_jawab", title: "Tanya Jawab Uji 4", number: "4", year: 2014 }),
  makePassage(5, "Pupuk kandang yang sudah matang boleh dicampurkan ke dalam tumpukan kompos.", { sourceType: "penjelasan", title: "Penjelasan Uji 5", number: null, year: 2019, locator: { kitab: "Kitab Pertanian", bab: "Bab Pupuk" } }),
];

const QUESTION = "Apakah kompos boleh dibuat dari sisa daun?";
const UNKNOWN_REFERENCE = { as_stated: "HPT Jilid 9, Bab Kompos", note: "Bab ini tidak ada di koleksi." };
const NOT_A_ANSWER = { ...GOOD_ANSWER, basis: null, headline: null, headline_short: null, summary: null, notes: [], dalil: [], quotes: [] };
const THREE_CITED = {
  notes: [(GOOD_ANSWER.notes as Record<string, unknown>[])[0], { ...(GOOD_ANSWER.notes as Record<string, unknown>[])[1], sources: ["S3"] }],
};
const RESET_FAR = "2099-01-01T00:00:00Z";

type Cut = (event: AnswerEvent) => boolean;

type Scenario = {
  readonly question: string;
  readonly script: (size: number) => readonly ScriptedAttempt[];
  readonly evidence?: EvidenceLevel;
  readonly connection?: Connection;
  /** Named points where a scenario can be frozen: nothing after the matching event is delivered. */
  readonly cuts?: Readonly<Record<string, Cut>>;
  /** `hpt host --scenario` fills the conversations folder with a fictional history first (riwayat-seed.ts). */
  readonly seed?: boolean;
  /** What the fake index holds, in retrieval order. Default: SCENARIO_PASSAGES. */
  readonly passages?: readonly Passage[];
};

const stream = (text: string, size: number, delayMs: number): ScriptedAttempt => ({ chunks: chunked(text, size), delayMs });
const refused = (code: "not_signed_in" | "rate_limited" | "blocked", resetsAt: string | null = null): ScriptedAttempt => ({ chunks: [], fail: { code, detail: "scripted", resetsAt } });

const CONNECTED: Connection = { state: "connected", subscription: "Claude Max" };

const reply = (type: string, extra: Record<string, unknown>) => answerJson({ ...NOT_A_ANSWER, type, ...extra });

export const SCENARIOS = {
  /** Riwayat: a fictional history on several days, and the same answer as `settled` for any new question. */
  riwayat: {
    question: QUESTION,
    script: (size) => [stream(answerJson(THREE_CITED), size, 0), stream(answerJson(THREE_CITED), size, 0)],
    seed: true,
  },
  /** Baca putusan: the answer cites three passages deep inside one long fictional note, so a citation opens the reader far from the top. */
  reader: { question: QUESTION, script: (size) => [stream(answerJson(THREE_CITED), size, 0)], passages: READER_ORDER },
  /** Baca putusan on a note a later one replaced in part: the notice, the dashed passages and the way to the newer ruling. */
  "reader-revised": { question: QUESTION, script: (size) => [stream(answerJson(THREE_CITED), size, 0)], passages: REVISED_ORDER },
  /** D7.1 then D7.2: the headline is marked verifying until the summary passes its checks. */
  settled: {
    question: QUESTION,
    script: (size) => [stream(answerJson(THREE_CITED), size, 0)],
    cuts: { thinking: (event) => event.kind === "sources", verifying: (event) => event.kind === "progress" && event.prose.some((span) => span.kind === "cite") },
  },
  /** A second question in the same conversation, for the earlier-turn card and the grouped Sumber panel. */
  "follow-up": {
    question: QUESTION,
    script: (size) => [
      stream(answerJson(THREE_CITED), size, 0),
      stream(answerJson({ headline: "Menurut HPT, kompos yang belum matang tidak boleh dipakai.", summary: "Kompos yang belum matang tidak boleh dipakai [S2]." , notes: [], dalil: [], quotes: [] }), size, 0),
    ],
  },
  /** D7.3: the summary fails its checks once, the calm "Memeriksa ulang sumber…" line replaces the card, the retry delivers. */
  restart: {
    question: QUESTION,
    script: (size) => [stream(answerJson({ summary: "Kompos [S9]." }), size, 0), stream(answerJson(THREE_CITED), size, 0)],
    cuts: { rechecking: (event) => event.kind === "restart" },
  },
  /** D7.4: an unverified reference is released before the headline. */
  "unverified-first": {
    question: "Katanya di HPT Jilid 9, Bab Kompos, kompos itu haram. Benar?",
    script: (size) => [
      stream(answerJson({ unverified_references: [UNKNOWN_REFERENCE], headline: "Rujukan yang Anda sebut tidak ditemukan; menurut HPT, kompos boleh dibuat dari sisa daun." }), size, 0),
    ],
    cuts: { reference: (event) => event.kind === "item" && event.name === "unverified_references" },
  },
  /** D20: the Opus limit is spent and Sonnet at low effort answers. */
  fallback: { question: QUESTION, script: (size) => [refused("rate_limited", RESET_FAR), stream(answerJson(THREE_CITED), size, 0)] },
  /** The engine emits `sources` before the type is known. With no evidence the panel must wait and then stay hidden. */
  "out-of-scope": {
    question: "Berapa harga emas hari ini?",
    evidence: "absent",
    script: () => [{ chunks: [reply("out_of_scope", { message: "Pertanyaan ini di luar bahasan Tarjih. Silakan ajukan pertanyaan tentang hukum Islam." })] }],
  },
  declined: {
    question: "Menurut Anda sendiri, mana pendapat yang paling benar?",
    script: () => [{ chunks: [reply("declined", { message: "Kami tidak memberi pendapat pribadi. Kami hanya menyampaikan keputusan dan penjelasan yang ada di koleksi." })] }],
  },
  insufficient: {
    question: "Bagaimana hukum kompos dari sisa makanan hewan peliharaan?",
    evidence: "weak",
    script: () => [{ chunks: [reply("insufficient", { message: "Kami belum menemukan keputusan HPT yang membahas hal ini. Berikut naskah yang paling dekat." })] }],
  },
  clarify: {
    question: "Bagaimana hukumnya?",
    evidence: "absent",
    script: () => [{ chunks: [reply("clarify", { clarifying_question: "Hukum apa yang Anda maksud?", clarifying_options: ["Hukum kompos", "Hukum pupuk kimia"] })] }],
  },
  "not-signed-in": { question: QUESTION, connection: { state: "not_signed_in" }, script: () => [refused("not_signed_in")] },
  blocked: { question: QUESTION, script: () => [refused("blocked")] },
  "limit-no-fallback": { question: QUESTION, script: () => [refused("rate_limited", RESET_FAR), refused("rate_limited", RESET_FAR)] },
  /** D10d: the checks fail twice, so the answer is not shown. */
  withheld: { question: QUESTION, script: (size) => [stream(answerJson({ summary: "Kompos [S9]." }), size, 0), stream(answerJson({ summary: "Kompos [S9]." }), size, 0)] },
} as const satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;
export const isScenarioName = (value: string): value is ScenarioName => value in SCENARIOS;
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

export type ScenarioOptions = {
  /** Pause between streamed chunks, so a state can be looked at in a live window. 0 for tests and screenshots. */
  readonly delayMs?: number;
  /** One of the scenario's named cut points. */
  readonly cut?: string;
};

const CHUNK_CHARS = 28;

function cutOf(name: ScenarioName, cut: string | undefined): Cut | null {
  if (cut === undefined) return null;
  const cuts: Readonly<Record<string, Cut>> = (SCENARIOS[name] as Scenario).cuts ?? {};
  const found = cuts[cut];
  if (found === undefined) throw new Error(`scenario ${name} has no cut "${cut}". Cuts: ${Object.keys(cuts).join(", ") || "none"}.`);
  return found;
}

/** Delivers every event up to the cut and then goes quiet: the ask never ends, so the screen stays in that mid-stream state. */
function frozenAt(engine: AnswerEngine, cut: Cut): AnswerEngine {
  return {
    ...engine,
    async ask(turn, options = {}) {
      let frozen = false;
      const finished = await engine.ask(turn, {
        ...options,
        onEvent: (event) => {
          if (frozen) return;
          options.onEvent?.(event);
          frozen = cut(event);
        },
      });
      if (frozen) await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve(), { once: true }));
      return finished;
    },
  };
}

export type ScenarioRig = {
  readonly engine: AnswerEngine;
  readonly index: FakeIndex;
  /** The question the scenario was written for. Any question gets the same scripted answer: the script is the point. */
  readonly question: string;
  readonly connection: Connection;
};

export function scenarioRig(name: ScenarioName, options: ScenarioOptions = {}): ScenarioRig {
  const scenario: Scenario = SCENARIOS[name];
  const index = fakeIndex(scenario.passages ?? SCENARIO_PASSAGES);
  index.evidence = () => scenario.evidence ?? "strong";
  const script = scenario.script(CHUNK_CHARS).map((attempt) => ({ ...attempt, delayMs: options.delayMs ?? 0 }));
  const engine = createEngine({
    index,
    provider: scriptedProvider(script),
    prompt: loadPromptTemplate(answerConfig.systemPromptDoc),
    canary: "CANARY-scenario",
    traces: memoryTraceSink(),
    settings: answerConfig.answer,
  });
  const cut = cutOf(name, options.cut);
  return { engine: cut === null ? engine : frozenAt(engine, cut), index, question: scenario.question, connection: scenario.connection ?? CONNECTED };
}

/** Host dependencies for `hpt host --scenario <name>`, with conversations in `conversationsDir`. */
export function scenarioDeps(name: ScenarioName, options: ScenarioOptions & { readonly conversationsDir: string }): HostDeps {
  const rig = scenarioRig(name, options);
  return {
    backend: { engine: rig.engine, conversations: openConversations(options.conversationsDir), index: rig.index },
    models: claudeModelOptions(),
    probe: () => Promise.resolve(rig.connection),
    close: () => rig.engine.close(),
  };
}

export const scenarioHost = (name: ScenarioName, options: ScenarioOptions & { readonly conversationsDir: string }): Host => createHost(scenarioDeps(name, options));

/** Runs the scenario to its end, or to its cut, and returns every committed event in order. For tests. */
export async function recordScenario(name: ScenarioName, cut?: string): Promise<readonly AnswerEvent[]> {
  const rig = scenarioRig(name);
  const events: AnswerEvent[] = [];
  await rig.engine.ask({ question: rig.question, history: [], scope: null }, { onEvent: (event) => events.push(event) });
  const stop = cutOf(name, cut);
  const at = stop === null ? -1 : events.findIndex(stop);
  return at === -1 ? events : events.slice(0, at + 1);
}
