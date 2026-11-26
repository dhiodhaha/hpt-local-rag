import { createStore, type StoreApi } from "zustand/vanilla";
import type { AnswerEvent, AskCall, ConversationId, HptClient, PassageId, Scope } from "@hpt/server/client";
import { emptyRun, reduceRun, type Run } from "./run.ts";

/**
 * UI state, and only UI state. Zustand because it is small, lives outside React (so a test can drive it with a fake client) and
 * is subscribable per selector. The host's connection state is `client.state()`, read with useSyncExternalStore, not copied here.
 *
 * Not in this store, on purpose: a provider session (D15: every ask starts a fresh process and the host rebuilds the history from
 * its own file), and any boolean such as `isStreaming` or `showVerifying`. Those are derived from the last turn's Run in view.ts.
 */
export type Turn = {
  /** Local key, also the React key. */
  readonly key: string;
  readonly question: string;
  /** When the question was asked, for the header's "Hari ini, 13.30". */
  readonly at: number;
  readonly scope: Scope | null;
  /** The model id the person picked for this question, or null for the default route. */
  readonly requested: string | null;
  readonly run: Run;
};

export type ChatState = {
  /** null until the first ask of a conversation resolves, then the host's id. */
  readonly conversation: ConversationId | null;
  readonly turns: readonly Turn[];
  readonly draft: string;
  /** null is the host's default route. A manual pick is remembered for the session. */
  readonly choice: string | null;
  /** The passage a CiteMark or Sumber card has open. */
  readonly openSource: PassageId | null;
};

export type ChatActions = {
  setDraft(text: string): void;
  chooseModel(model: string | null): void;
  selectSource(id: PassageId | null): void;
  /** Does nothing while the last turn is still running: one ask at a time. */
  send(question: string): void;
  /** Cancelling drops the turn and puts the question back in the composer. Nothing was stored, so the history is unchanged. */
  cancel(): void;
  /** Asks the last question again after a failed or withheld answer. */
  retry(): void;
  newConversation(): void;
};

export type ChatStore = StoreApi<ChatState & ChatActions>;

export const isBusy = (state: ChatState): boolean => {
  const last = state.turns.at(-1);
  return last !== undefined && last.run.outcome === null;
};

/**
 * Folds events in one store update per animation frame. The summary streams word by word, about a hundred events a second: folding
 * is cheap and a React commit per event is not. Order is kept and nothing is dropped. `finished` flushes at once.
 */
export type EventBuffer = {
  push(key: string, event: AnswerEvent): void;
};

export type Scheduler = (flush: () => void) => void;

const frameOrTimeout: Scheduler = (flush) => {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    flush();
  };
  requestAnimationFrame(run);
  setTimeout(run, 50);
};

export function eventBuffer(apply: (key: string, events: readonly AnswerEvent[]) => void, schedule: Scheduler = frameOrTimeout): EventBuffer {
  let queued: { key: string; event: AnswerEvent }[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const batch = queued;
    queued = [];
    const keys = [...new Set(batch.map((entry) => entry.key))];
    for (const key of keys) apply(key, batch.filter((entry) => entry.key === key).map((entry) => entry.event));
  };
  return {
    push(key, event) {
      queued.push({ key, event });
      if (event.kind === "finished") flush();
      else if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
  };
}

export function createChatStore(client: HptClient, options: { newKey?: () => string; schedule?: Scheduler; now?: () => number } = {}): ChatStore {
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  let running: { readonly key: string; call: AskCall | null; cancelled: boolean } | null = null;
  let previous: AskCall | null = null;

  const store = createStore<ChatState & ChatActions>((set, get) => {
    const buffer = eventBuffer((key, events) => {
      set((state) => {
        const turns = state.turns.map((turn) => (turn.key === key ? { ...turn, run: events.reduce(reduceRun, turn.run) } : turn));
        const last = turns.at(-1);
        if (last?.key === key && last.run.outcome?.kind === "cancelled") return { turns: turns.slice(0, -1), draft: last.question };
        return { turns };
      });
    }, options.schedule);

    function start(turn: Turn): void {
      const entry: NonNullable<typeof running> = { key: turn.key, call: null, cancelled: false };
      running = entry;
      const begin = () => {
        if (entry.cancelled) return;
        const { conversation, choice } = get();
        const call = client.ask({ conversation, question: turn.question, scope: turn.scope, choice: choice === null ? null : { provider: "claude", model: choice } }, (event) => buffer.push(turn.key, event));
        entry.call = call;
        previous = call;
        call.done.then(
          (result) => set({ conversation: result.conversation }),
          () => {},
        );
      };
      if (previous === null) begin();
      else previous.done.then(begin, begin);
    }

    return {
      conversation: null,
      turns: [],
      draft: "",
      choice: null,
      openSource: null,
      setDraft: (draft) => set({ draft }),
      chooseModel: (choice) => set({ choice }),
      selectSource: (id) => set({ openSource: id }),
      send(question) {
        const text = question.trim();
        if (text === "" || isBusy(get())) return;
        const turn: Turn = { key: newKey(), question: text, at: now(), scope: null, requested: get().choice, run: emptyRun() };
        set((state) => ({ turns: [...state.turns, turn], draft: "", openSource: null }));
        start(turn);
      },
      cancel() {
        if (running === null) return;
        if (running.call === null) {
          running.cancelled = true;
          const { key } = running;
          set((state) => {
            const turn = state.turns.find((entry) => entry.key === key);
            return { turns: state.turns.filter((entry) => entry.key !== key), draft: turn?.question ?? state.draft };
          });
          return;
        }
        running.call.cancel();
      },
      retry() {
        const last = get().turns.at(-1);
        if (last === undefined || last.run.outcome === null || last.run.outcome.kind === "delivered") return;
        set((state) => ({ turns: state.turns.slice(0, -1) }));
        get().send(last.question);
      },
      newConversation() {
        if (isBusy(get())) return;
        set({ conversation: null, turns: [], draft: "", openSource: null });
      },
    };
  });
  return store;
}
