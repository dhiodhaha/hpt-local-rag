import { parseArgs } from "node:util";
import { compose } from "../compose.ts";
import { EXCEPTION_WITHHELD, type AnswerEvent, type Excerpt, type Finished, type Prose, type Scope, type SourceCard } from "../features/answer/index.ts";
import type { Effort } from "../features/providers/index.ts";
import { IndexUnavailableError } from "../features/search/index.ts";

export const ASK_USAGE = `Usage:
  hpt ask "<question>" [-c | --conversation <id>] [--note <note id>] [--model sonnet|opus|haiku|<id>]
                       [--effort low|medium|high] [--max-extra-calls <n>] [--json]`;

export const MODELS: Readonly<Record<string, string>> = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", haiku: "claude-haiku-5-5" };

export function parseScope(note: string | undefined): Scope | null {
  if (note === undefined) return null;
  if (!note.startsWith("putusan/")) throw new Error(`--note takes a putusan note id such as putusan/<slug>, not "${note}".`);
  return { kind: "document", noteId: note };
}

const seconds = (ms: number | undefined) => (ms === undefined ? "-" : `${(ms / 1000).toFixed(1)} s`);

function describe(card: SourceCard): string {
  const { passage } = card;
  const label = [passage.sourceType, passage.year, passage.number === null ? null : `no. ${passage.number}`].filter((part) => part !== null).join(" ");
  return `${card.n} ${label}`;
}

const ESC = String.fromCharCode(27);

export type PrinterOptions = {
  /** Rewrite the headline line when it settles, which needs a terminal that obeys cursor movement. Otherwise a new line says so. */
  readonly rewrite?: { readonly rows: number };
};

export function createPrinter(output: (text: string) => void, options: PrinterOptions = {}): (event: AnswerEvent) => void {
  let headline: { text: string; linesBelow: number } | null = null;
  const write = (text: string) => {
    if (headline !== null) headline.linesBelow += text.split("\n").length - 1;
    output(text);
  };
  const numbers = new Map<string, number>();
  let streamed = "";
  let printed = false;
  const n = (id: string) => numbers.get(id) ?? "?";
  const marks = (ids: readonly string[]) => (ids.length === 0 ? "" : `  [${ids.map(n).join(", ")}]`);
  const textOf = (prose: Prose) => prose.map((span) => (span.kind === "text" ? span.text : "")).join("");
  const citesOf = (prose: Prose) => [...new Set(prose.flatMap((span) => (span.kind === "cite" ? (span.passages ?? []) : [])))];
  const quote = (excerpt: Excerpt) => `"${excerpt.text.replace(/\s+/g, " ").slice(0, 100)}"`;

  return (event) => {
    switch (event.kind) {
      case "sources": {
        for (const card of event.added) numbers.set(card.passage.id, card.n);
        const label = event.added.map(describe).join(" · ");
        write(event.evidence === null ? `Sumber tambahan: ${label}\n` : `Sumber (${event.added.length}): ${label}  (bukti: ${event.evidence.level})\n`);
        return;
      }
      case "attempt":
        if (event.attempt > 1) write(`(percobaan ${event.attempt}${event.because === null ? "" : `, karena ${event.because.code}`})\n`);
        return;
      case "restart":
        write(`${event.copy}\n`);
        headline = null;
        streamed = "";
        printed = false;
        return;
      case "tool_call":
        write(`  panggilan tambahan ${event.n}: ${event.tool} "${event.arg}"${event.denied ? " (ditolak, batas habis)" : ""}\n`);
        return;
      case "progress": {
        const text = textOf(event.prose);
        if (!text.startsWith(streamed)) return;
        if (!printed) write("\nRingkasan: ");
        printed = true;
        write(text.slice(streamed.length));
        streamed = text;
        return;
      }
      case "field": {
        if (event.name === "headline" && event.value !== null) {
          const marker = options.rewrite === undefined ? "[memeriksa…]" : `${ESC}[2mmemeriksa…${ESC}[0m`;
          write(`\n${event.value} ${marker}\n`);
          headline = { text: event.value, linesBelow: 0 };
        }
        else if (event.name === "basis" && event.value !== null) write(`dasar: ${event.value}\n`);
        else if (event.name === "headline_short" && event.value !== null) write(`ringkas: ${event.value}\n`);
        else if (event.name === "summary" && event.value !== null) {
          const text = textOf(event.value);
          if (!printed) write("\nRingkasan: ");
          write(`${text.startsWith(streamed) ? text.slice(streamed.length) : text}\n`);
          const cites = citesOf(event.value);
          if (cites.length > 0) write(`  dikutip: ${cites.map(n).join(", ")}\n`);
          printed = false;
          streamed = "";
        } else if (event.name === "inference_note" && event.value !== null) write(`catatan inferensi: ${textOf(event.value)}\n`);
        else if (event.name === "clarifying_question" && event.value !== null) write(`\n${event.value}\n`);
        else if (event.name === "message" && event.value !== null) write(`\n${event.value}\n`);
        return;
      }
      case "settled": {
        const shown = headline;
        headline = null;
        if (shown === null) return;
        const up = shown.linesBelow + 1;
        if (options.rewrite !== undefined && up < options.rewrite.rows) output(`${ESC}[${up}A\r${ESC}[K${shown.text}${ESC}[${up}B\r`);
        else output("  headline terverifikasi\n");
        return;
      }
      case "item": {
        const edits = event.edits.length === 0 ? "" : `  (${event.edits.map((edit) => edit.kind).join(", ")})`;
        if (event.name === "notes") {
          if ("withheld" in event.value) write(`  catatan  [pengecualian ditahan] ${EXCEPTION_WITHHELD}${marks(event.value.passages)}\n`);
          else write(`  catatan  [${event.value.kind}] ${event.value.title}${marks(event.value.sources)}${edits}\n`);
        } else if (event.name === "dalil") {
          const { value } = event;
          write(`  dalil    ${value.kind} ${value.reference}  arab: ${value.arabic === null ? "tidak ada" : "dari sumber"}${marks(value.sources)}${edits}\n`);
        } else if (event.name === "quotes") write(`  kutipan  [${n(event.value.passage)}] ${quote(event.value)}\n`);
        else if (event.name === "unverified_references") write(`  tidak ditemukan: ${event.value.asStated}\n`);
        else write(`  pilihan  ${event.value}\n`);
        return;
      }
      case "finished":
        if (event.outcome.kind !== "delivered" && event.outcome.kind !== "cancelled") write(`\n${event.outcome.copy}\n`);
        return;
    }
  };
}

export function summaryLines(finished: Finished): string[] {
  const { trace } = finished;
  const attempt = trace.attempts.at(-1);
  const mark = (name: string) => attempt?.committedMs.find((entry) => entry.name === name)?.ms;
  const edits = trace.attempts.flatMap((each) => each.edits).map((edit) => edit.kind);
  const findings = trace.attempts.flatMap((each) => each.findings);
  const wait = attempt === undefined ? "-" : `${attempt.providerWaitMs} ms (${attempt.warm ? "warm" : "fresh"})`;
  const first = [
    `retrieval ${trace.retrieval.ms} ms`,
    `provider wait ${wait}`,
    `first text ${seconds(attempt?.firstTextMs ?? undefined)}`,
    `headline ${seconds(mark("headline"))}`,
    `summary ${seconds(mark("summary"))}`,
    `settled ${seconds(mark("headline_settled"))}`,
    `done ${seconds(trace.totalMs)}`,
  ];
  const second = [
    `attempts ${trace.attempts.length}`,
    `tools ${trace.tools.length}`,
    `repairs ${edits.length}${edits.length === 0 ? "" : ` (${[...new Set(edits)].join(", ")})`}`,
    `findings ${findings.length}${findings.length === 0 ? "" : ` (${findings.map((found) => `${found.code}@${found.site}`).join(", ")})`}`,
    `${trace.model} ${trace.effort}`,
    trace.conversation === null ? null : `conversation ${trace.conversation}`,
  ].filter((part) => part !== null);
  return [`trace  ${first.join(" · ")}`, `       ${second.join(" · ")}`];
}

export async function askCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      continue: { type: "boolean", short: "c" },
      conversation: { type: "string" },
      note: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      "max-extra-calls": { type: "string" },
      json: { type: "boolean" },
    },
  });
  const question = positionals.join(" ").trim();
  if (question === "") {
    console.error(ASK_USAGE);
    return 1;
  }
  const effort = values.effort;
  if (effort !== undefined && !["low", "medium", "high"].includes(effort)) throw new Error(`--effort is low, medium or high, not "${effort}".`);
  const maxExtra = values["max-extra-calls"] === undefined ? undefined : Number(values["max-extra-calls"]);
  if (maxExtra !== undefined && (!Number.isInteger(maxExtra) || maxExtra < 0)) throw new Error("--max-extra-calls is a whole number, 0 or more.");
  const scope = parseScope(values.note);

  let composed: Awaited<ReturnType<typeof compose>>;
  try {
    composed = await compose();
  } catch (cause) {
    if (cause instanceof IndexUnavailableError) {
      console.error(cause.message);
      return 1;
    }
    throw cause;
  }
  const { engine, conversations, index, close } = composed;
  try {
    if (values.note !== undefined && !index.hasPutusan(values.note)) throw new Error(`${values.note} is not a putusan in the index.`);
    engine.warm();
    const conversation = conversations.open(values.continue ? "latest" : (values.conversation ?? "new"));
    const model = values.model === undefined ? undefined : (MODELS[values.model] ?? values.model);
    const finished = await conversation.ask(engine, question, {
      scope,
      overrides: { model, effort: effort as Effort | undefined, maxExtraToolCalls: maxExtra },
      onEvent: values.json ? (event) => console.log(JSON.stringify(event)) : createPrinter((text) => process.stdout.write(text), process.stdout.isTTY ? { rewrite: { rows: process.stdout.rows } } : {}),
    });
    const lines = summaryLines(finished);
    if (values.json) for (const line of lines) console.error(`# ${line}`);
    else console.log(`\n${lines.join("\n")}`);
    return finished.outcome.kind === "delivered" ? 0 : 1;
  } finally {
    await close();
  }
}
