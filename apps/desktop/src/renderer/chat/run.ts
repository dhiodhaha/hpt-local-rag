import { emptyAnswer, foldAnswer, type Answer, type AnswerEvent, type Evidence, type Outcome, type Route, type SourceCard } from "@hpt/server/client";

/**
 * Everything the answer screen knows about one question, as a fold over that question's events. "Verifying", "rechecking", "skeleton",
 * "fallback notice" and "Sumber hidden" are not stored anywhere: view.ts derives them from this value, so two components can never
 * disagree about which state the screen is in.
 *
 * The answer part is the engine's own `foldAnswer`. This file adds only what that reducer ignores on purpose.
 */
export type FallbackNotice = { readonly route: Route; readonly from: string; readonly until: string };

export type Run = {
  readonly attempt: number;
  /** Append only and deduplicated by passage id. It survives a restart, because the Sumber panel stays while the answer is rechecked. */
  readonly sources: readonly SourceCard[];
  readonly evidence: Evidence | null;
  readonly answer: Answer;
  /** True once the summary's final prose has arrived. Before that it is still streaming. */
  readonly summaryDone: boolean;
  /** About the current attempt: a new `attempt` clears it and `fallback` sets it. */
  readonly fallback: FallbackNotice | null;
  /** How many restarts there were, and the engine's own copy for the latest. */
  readonly restart: { readonly count: number; readonly copy: string } | null;
  /** null while the ask is running. Set once, by `finished`. */
  readonly outcome: Outcome | null;
};

export const emptyRun = (): Run => ({ attempt: 0, sources: [], evidence: null, answer: emptyAnswer(), summaryDone: false, fallback: null, restart: null, outcome: null });

function addSources(known: readonly SourceCard[], added: readonly SourceCard[]): readonly SourceCard[] {
  const have = new Set(known.map((card) => card.passage.id));
  const fresh = added.filter((card) => !have.has(card.passage.id));
  return fresh.length === 0 ? known : [...known, ...fresh];
}

/** Exhaustive on purpose: a new event kind fails to compile here until someone decides what it means for the screen. */
export function reduceRun(run: Run, event: AnswerEvent): Run {
  switch (event.kind) {
    case "sources":
      return { ...run, sources: addSources(run.sources, event.added), evidence: event.evidence ?? run.evidence };
    case "attempt":
      return { ...run, attempt: event.attempt, fallback: null };
    case "fallback":
      return { ...run, fallback: { route: event.route, from: event.from, until: event.until } };
    case "restart":
      return { ...run, answer: foldAnswer(run.answer, event), summaryDone: false, restart: { count: (run.restart?.count ?? 0) + 1, copy: event.copy } };
    case "finished":
      return { ...run, outcome: event.outcome };
    case "tool_call":
      return run;
    case "field":
      return { ...run, answer: foldAnswer(run.answer, event), summaryDone: run.summaryDone || event.name === "summary" };
    case "settled":
    case "progress":
    case "item":
      return { ...run, answer: foldAnswer(run.answer, event) };
  }
}

export const runOf = (events: readonly AnswerEvent[]): Run => events.reduce(reduceRun, emptyRun());
