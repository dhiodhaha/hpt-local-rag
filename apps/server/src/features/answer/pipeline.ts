import { checkComplete, checkDalil, checkHeadlineLeads, checkMarkersSoFar, checkNote, checkQuote, toProse, type Checked } from "./checks.ts";
import { emptyAnswer, foldAnswer } from "./fold.ts";
import type { SourceLedger } from "./ledger.ts";
import { dispose, type Finding, type Site } from "./policy.ts";
import { createScanner, type ScanEvent, type Scanner } from "./scan.ts";
import type { Tripwire } from "./tripwire.ts";
import type { Answer, AnswerEvent, Edit, FieldValues, ItemValues, Note, WithheldException } from "./types.ts";
import { FIELD_ORDER, isField, isItemField, parseItem, parseScalar, PROGRESS_FIELDS, type FieldName, type ItemField, type ScalarField } from "./wire.ts";

/**
 * One attempt's field pipeline: model text in, committed AnswerEvents out. Synchronous and deterministic, so it is tested by
 * replaying fixture text in any chunking, with no provider, no clock and no model.
 *
 *   text delta ─► tripwire ─► scanner ─► per scan event:
 *       progress(summary)  checkMarkersSoFar ─► `progress` event (cites pending, canary-length tail held back)
 *       value / item       parse (wire.ts) ─► check (checks.ts) ─► dispose (policy.ts) ─► apply:
 *           accept / repair   the field or item is READY, with its edits (logged, D10c)
 *           drop_item         nothing is shown for it; recorded
 *           withhold_item     a WithheldException takes its place (D10f); recorded as test-set priority
 *           retry_attempt     seal the pipeline and return `abort` at once (D10d: the retry starts as early as the failure is seen)
 *
 * Release gate. A READY field is held until every field before it in FIELD_ORDER is settled (released, dropped, withheld or
 * known absent), and list items release in index order. So `basis` and `unverified_references` are always shown before
 * `headline` even when the model writes them the other way round, and an item is never shown before its checks (D10g). A
 * field the model left out is known absent only when the object closes. A misordered or incomplete stream costs latency,
 * never correctness.
 *
 * Three sequencing rules the pipeline owns. The canary is checked on the raw stream BEFORE the scanner sees a delta. A tool
 * call before anything was shown means the model thought aloud first, so the attempt's state is cleared. After something was
 * shown it is `tool_after_output`.
 */
export type Abort = { readonly finding: Finding };

export type PipelineStep = {
  readonly events: readonly AnswerEvent[];
  /** Non-null once the attempt cannot stand. The pipeline is sealed from then on: every later call returns an empty step. */
  readonly abort: Abort | null;
};

export type PipelineInput = {
  readonly ledger: SourceLedger;
  readonly tripwire: Tripwire;
};

export type Pipeline = {
  push(delta: string): PipelineStep;
  toolUse(): PipelineStep;
  finish(): PipelineStep;
  readonly answer: Answer;
  /** Everything noticed so far, repairs and drops included, for the trace. */
  readonly findings: readonly Finding[];
  readonly edits: readonly Edit[];
  /** True once anything was emitted: a retry now replaces something the reader saw. */
  readonly committed: boolean;
};

type Slot =
  | { readonly kind: "scalar"; readonly events: readonly AnswerEvent[] }
  | { readonly kind: "absent" }
  | { readonly kind: "list"; readonly outcomes: (readonly AnswerEvent[])[]; released: number; closed: boolean };

const SUMMARY_INDEX = FIELD_ORDER.indexOf("summary");
const NOTE_KINDS = ["exception", "practical", "difference", "revision", "referral"];

const finding = (code: Finding["code"], site: Site, detail: string): Finding => ({ code, site, detail, repair: null });

const scalarEvent = <K extends ScalarField>(name: K, value: FieldValues[K]): AnswerEvent => ({ kind: "field", name, value }) as AnswerEvent;
const itemEvent = <K extends ItemField>(name: K, value: ItemValues[K], edits: readonly Edit[]): AnswerEvent => ({ kind: "item", name, value, edits }) as AnswerEvent;

function peek(field: ItemField, raw: string): { site: Site; id: string } {
  let read: { kind?: unknown; id?: unknown } = {};
  try {
    read = JSON.parse(raw) as typeof read;
  } catch {
    // Not JSON at all: nothing can be read.
  }
  const id = typeof read.id === "string" ? read.id : "";
  if (field === "dalil" || field === "quotes") return { site: field, id };
  if (field === "notes" && typeof read.kind === "string" && NOTE_KINDS.includes(read.kind)) return { site: `note.${read.kind}` as Site, id };
  return { site: "stream", id };
}

export function createPipeline(input: PipelineInput): Pipeline {
  const { ledger, tripwire } = input;
  const findings: Finding[] = [];
  const edits: Edit[] = [];
  let answer = emptyAnswer();
  let committed = false;
  let sealed = false;

  let scanner: Scanner = createScanner({ progressFields: PROGRESS_FIELDS });
  let slots = new Map<FieldName, Slot>();
  let cursor = 0;
  let highestSeen = -1;
  let rootClosed = false;
  let outsideObject = false;
  let lastShown: string | null = null;

  let step: { events: AnswerEvent[]; abort: Abort | null } = { events: [], abort: null };

  const emit = (events: readonly AnswerEvent[]) => {
    for (const event of events) {
      answer = foldAnswer(answer, event);
      step.events.push(event);
      committed = true;
    }
  };

  const abortWith = (cause: Finding) => {
    findings.push(cause);
    sealed = true;
    step.abort = { finding: cause };
  };

  function flush(): void {
    while (cursor < FIELD_ORDER.length) {
      const slot = slots.get(FIELD_ORDER[cursor] as FieldName);
      if (slot === undefined) return;
      if (slot.kind === "scalar") emit(slot.events);
      else if (slot.kind === "list") {
        while (slot.released < slot.outcomes.length) emit(slot.outcomes[slot.released++] as readonly AnswerEvent[]);
        if (!slot.closed) return;
      }
      cursor += 1;
      if (cursor > SUMMARY_INDEX && answer.headlineState === "verifying") emit([{ kind: "settled", name: "headline" }]);
    }
  }

  function noteOrder(name: FieldName): void {
    const index = FIELD_ORDER.indexOf(name);
    if (index < highestSeen) findings.push(finding("out_of_order", "stream", `${name} arrived after a later field`));
    highestSeen = Math.max(highestSeen, index);
  }

  function judge(all: readonly Finding[]) {
    findings.push(...all);
    const disposition = dispose(all);
    if (disposition.kind === "retry_attempt") {
      sealed = true;
      step.abort = { finding: disposition.finding };
      return null;
    }
    return disposition;
  }

  function onScalar(name: ScalarField, raw: string): void {
    noteOrder(name);
    const parsed = parseScalar(name, raw);
    if (!parsed.ok) return abortWith(finding("bad_shape", name, parsed.detail));
    if (tripwire.contains(JSON.stringify(parsed.value))) return abortWith(finding("canary", "stream", "the canary appeared in a field"));
    let value: unknown = parsed.value;
    let checked: Checked<unknown> | null = null;
    if ((name === "summary" || name === "inference_note") && typeof parsed.value === "string") {
      checked = toProse(parsed.value, ledger, true, name);
      value = checked.value;
    }
    if (judge(checked?.findings ?? []) === null) return;
    slots.set(name, { kind: "scalar", events: [scalarEvent(name, value as never)] });
  }

  function listSlot(name: ItemField): Extract<Slot, { kind: "list" }> {
    const existing = slots.get(name);
    if (existing?.kind === "list") return existing;
    const created: Extract<Slot, { kind: "list" }> = { kind: "list", outcomes: [], released: 0, closed: false };
    slots.set(name, created);
    return created;
  }

  function onItem(name: ItemField, raw: string): void {
    noteOrder(name);
    const outcomes = listSlot(name).outcomes;
    const parsed = parseItem(name, raw);
    if (!parsed.ok) {
      const { site, id } = peek(name, raw);
      const disposition = judge([finding("bad_shape", site, parsed.detail)]);
      if (disposition === null) return;
      const withheld: WithheldException = { withheld: "exception", id, passages: [] };
      outcomes.push(disposition.kind === "withhold_item" ? [itemEvent("notes", withheld, [])] : []);
      return;
    }
    if (tripwire.contains(JSON.stringify(parsed.value))) return abortWith(finding("canary", "stream", "the canary appeared in an item"));

    let checked: Checked<unknown> | null = null;
    if (name === "notes") checked = checkNote(parsed.value as Parameters<typeof checkNote>[0], ledger);
    else if (name === "dalil") checked = checkDalil(parsed.value as Parameters<typeof checkDalil>[0], ledger);
    else if (name === "quotes") checked = checkQuote(parsed.value as Parameters<typeof checkQuote>[0], ledger);
    const value: unknown = checked === null ? shapeOf(name, parsed.value) : checked.value;
    const disposition = judge(checked?.findings ?? []);
    if (disposition === null) return;

    const rewrites = checked?.rewrites ?? [];
    if (disposition.kind === "drop_item" || value === null) outcomes.push([]);
    else if (disposition.kind === "withhold_item") {
      const note = value as Note;
      const withheld: WithheldException = { withheld: "exception", id: note.id, passages: note.sources };
      outcomes.push([itemEvent("notes", withheld, [])]);
    } else {
      const applied = disposition.kind === "repair" ? [...rewrites, ...disposition.edits] : rewrites;
      edits.push(...applied);
      outcomes.push([itemEvent(name, value as never, applied)]);
    }
  }

  function onListEnd(name: ItemField, raw: string): void {
    noteOrder(name);
    if (raw !== "null" && !raw.startsWith("[")) return abortWith(finding("bad_shape", "stream", `${name} is not a list`));
    listSlot(name).closed = true;
  }

  function onProgress(text: string): void {
    if (cursor !== SUMMARY_INDEX) return;
    const early = checkMarkersSoFar("summary", text, ledger);
    if (judge(early) === null) return;
    const shown = text.slice(0, Math.max(0, text.length - tripwire.holdBack));
    if (shown === lastShown) return;
    lastShown = shown;
    emit([{ kind: "progress", name: "summary", prose: toProse(shown, ledger, false, "summary").value }]);
  }

  function onScan(event: ScanEvent): void {
    if (event.kind === "fence") edits.push({ kind: "fence_stripped" });
    else if (event.kind === "progress") onProgress(event.text);
    else if (event.kind === "item") {
      if (isItemField(event.field)) onItem(event.field, event.raw);
    } else if (event.kind === "value") {
      if (!isField(event.field)) return;
      if (isItemField(event.field)) onListEnd(event.field, event.raw);
      else onScalar(event.field, event.raw);
    } else if (event.kind === "end") {
      rootClosed = true;
      for (const name of FIELD_ORDER) if (!slots.has(name)) slots.set(name, { kind: "absent" });
    } else if (event.kind === "error") {
      if (event.reason === "trailing") findings.push(finding("trailing_text", "stream", "text after the closing brace"));
      else if (event.reason === "not_json" && !committed) outsideObject = true;
      else abortWith(finding("bad_json", "stream", event.reason));
    }
  }

  function run(work: () => void): PipelineStep {
    step = { events: [], abort: null };
    if (!sealed) work();
    return step;
  }

  function canaryTripped(): boolean {
    if (!tripwire.tripped) return false;
    abortWith(finding("canary", "stream", "the canary appeared in the stream or a tool argument"));
    return true;
  }

  return {
    push: (delta) =>
      run(() => {
        tripwire.feed(delta);
        if (canaryTripped()) return;
        if (outsideObject) return;
        for (const event of scanner.push(delta)) {
          onScan(event);
          flush();
          if (sealed) return;
        }
      }),
    toolUse: () =>
      run(() => {
        if (canaryTripped()) return;
        if (committed) return abortWith(finding("tool_after_output", "stream", "a tool call after the answer started"));
        scanner = createScanner({ progressFields: PROGRESS_FIELDS });
        slots = new Map();
        cursor = 0;
        highestSeen = -1;
        rootClosed = false;
        outsideObject = false;
        lastShown = null;
      }),
    finish: () =>
      run(() => {
        if (canaryTripped()) return;
        if (outsideObject) return abortWith(finding("bad_json", "stream", "text outside the object"));
        if (!rootClosed) return abortWith(finding("bad_json", "stream", "the stream ended inside the object"));
        const missing = checkComplete(answer);
        findings.push(...missing.slice(1));
        const first = missing[0];
        if (first !== undefined) return abortWith(first);
        findings.push(...checkHeadlineLeads(answer));
      }),
    get answer() {
      return answer;
    },
    findings,
    edits,
    get committed() {
      return committed;
    },
  };
}

function shapeOf(name: ItemField, value: unknown): unknown {
  if (name === "unverified_references") {
    const reference = value as { as_stated: string; note: string };
    return { asStated: reference.as_stated, note: reference.note };
  }
  return value;
}
