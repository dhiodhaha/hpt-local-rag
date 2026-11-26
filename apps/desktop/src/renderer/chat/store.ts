import { createStore, type StoreApi } from "zustand/vanilla";
import { noteIdOf, type AnswerEvent, type AskCall, type ConversationId, type ConversationSummary, type HptClient, type NoteId, type OpenedTurn, type Passage, type PassageId, type Scope, type SearchResult } from "@hpt/server/client";
import { emptyRun, reduceRun, storedRun, type Run } from "./run.ts";

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
  readonly fresh: boolean;
};

export type Screen = "chat" | "all";

export type History = { readonly state: "loading" | "ready" | "failed"; readonly conversations: readonly ConversationSummary[] };

export type Search = { readonly open: boolean; readonly query: string; readonly settled: string | null; readonly result: SearchResult | null };

/** The reader: which passage of which turn's answer it was opened from, and the note it shows. Null when it is closed. */
export type ReaderLoad = { readonly state: "loading" } | { readonly state: "ready"; readonly passages: readonly Passage[] } | { readonly state: "failed" };

export type Reader = {
  /** The turn whose answer says what is cited. The reader reads that turn's run from `turns`, so a running answer keeps filling it. */
  readonly turn: string;
  readonly noteId: NoteId;
  /** The passage to show and mark as open. */
  readonly passage: PassageId;
  readonly load: ReaderLoad;
};

export type RowMenu = { readonly conversation: ConversationId; readonly x: number; readonly y: number };

export type ChatState = {
  /** null until the first ask of a conversation resolves, then the host's id. */
  readonly conversation: ConversationId | null;
  readonly turns: readonly Turn[];
  readonly draft: string;
  /** null is the host's default route. A manual pick is remembered for the session. */
  readonly choice: string | null;
  readonly reader: Reader | null;
  readonly screen: Screen;
  readonly history: History;
  readonly search: Search;
  readonly menu: RowMenu | null;
  readonly renaming: ConversationId | null;
  readonly confirming: ConversationSummary | null;
  readonly opening: ConversationId | null;
};

export type ChatActions = {
  setDraft(text: string): void;
  chooseModel(model: string | null): void;
  /** Opens the note `passage` belongs to, at that passage. `turn` is the answer that cited it. */
  openReader(turn: string, passage: PassageId): void;
  /** Moves the open reader to another passage: in the same note at once, in another note after it loads. */
  showPassage(passage: PassageId): void;
  retryReader(): void;
  closeReader(): void;
  /** Does nothing while the last turn is still running: one ask at a time. */
  send(question: string): void;
  /** Cancelling drops the turn and puts the question back in the composer. Nothing was stored, so the history is unchanged. */
  cancel(): void;
  /** Asks the last question again after a failed or withheld answer. */
  retry(): void;
  newConversation(): void;
  refreshHistory(): Promise<void>;
  openConversation(id: ConversationId): Promise<void>;
  showAll(): void;
  openSearch(): void;
  closeSearch(): void;
  setQuery(query: string): void;
  openMenu(menu: RowMenu): void;
  closeMenu(): void;
  startRename(id: ConversationId): void;
  cancelRename(): void;
  commitRename(id: ConversationId, title: string): Promise<void>;
  askDelete(id: ConversationId): void;
  cancelDelete(): void;
  confirmDelete(): Promise<void>;
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

export const SEARCH_DELAY_MS = 150;

const turnOfStored = (stored: OpenedTurn): Turn => ({ key: stored.id, question: stored.question, at: Date.parse(stored.at), scope: stored.scope, requested: null, run: storedRun(stored), fresh: false });

const NO_SEARCH: Search = { open: false, query: "", settled: null, result: null };

export type StoreOptions = { newKey?: () => string; schedule?: Scheduler; now?: () => number; searchDelayMs?: number };

export function createChatStore(client: HptClient, options: StoreOptions = {}): ChatStore {
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  const searchDelayMs = options.searchDelayMs ?? SEARCH_DELAY_MS;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
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

    /** A note that arrives after the reader moved on is dropped: the answer to the question asked last wins. */
    async function loadReader(noteId: NoteId): Promise<void> {
      let load: ReaderLoad;
      try {
        load = { state: "ready", passages: (await client.request("passages", { noteId })).passages };
      } catch {
        load = { state: "failed" };
      }
      set((state) => (state.reader?.noteId === noteId && state.reader.load.state === "loading" ? { reader: { ...state.reader, load } } : state));
    }

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
          (result) => {
            set({ conversation: result.conversation });
            void get().refreshHistory();
          },
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
      reader: null,
      screen: "chat",
      history: { state: "loading", conversations: [] },
      search: NO_SEARCH,
      menu: null,
      renaming: null,
      confirming: null,
      opening: null,
      setDraft: (draft) => set({ draft }),
      chooseModel: (choice) => set({ choice }),
      openReader(turn, passage) {
        set({ reader: { turn, noteId: noteIdOf(passage), passage, load: { state: "loading" } } });
        void loadReader(noteIdOf(passage));
      },
      showPassage(passage) {
        const { reader } = get();
        if (reader === null) return;
        const noteId = noteIdOf(passage);
        if (noteId === reader.noteId && reader.load.state === "ready") {
          set({ reader: { ...reader, passage } });
          return;
        }
        set({ reader: { ...reader, noteId, passage, load: { state: "loading" } } });
        void loadReader(noteId);
      },
      retryReader() {
        const { reader } = get();
        if (reader === null) return;
        set({ reader: { ...reader, load: { state: "loading" } } });
        void loadReader(reader.noteId);
      },
      closeReader: () => set({ reader: null }),
      send(question) {
        const text = question.trim();
        if (text === "" || isBusy(get())) return;
        const turn: Turn = { key: newKey(), question: text, at: now(), scope: null, requested: get().choice, run: emptyRun(), fresh: true };
        set((state) => ({ turns: [...state.turns, turn], draft: "", reader: null, screen: "chat" }));
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
        clearTimeout(searchTimer);
        set({ conversation: null, turns: [], draft: "", reader: null, screen: "chat", search: NO_SEARCH, menu: null });
      },
      async refreshHistory() {
        try {
          const { conversations } = await client.request("list", null);
          set({ history: { state: "ready", conversations } });
        } catch {
          set((state) => ({ history: { state: "failed", conversations: state.history.conversations } }));
        }
      },
      async openConversation(id) {
        const state = get();
        if (isBusy(state)) return;
        if (state.conversation === id && state.screen === "chat") {
          set({ search: NO_SEARCH, menu: null });
          return;
        }
        set({ opening: id });
        try {
          const opened = await client.request("open", { conversation: id });
          if (get().opening !== id) return;
          set({ conversation: id, turns: opened.turns.map(turnOfStored), draft: "", reader: null, screen: "chat", search: NO_SEARCH, menu: null, opening: null });
        } catch {
          set({ opening: null });
          void get().refreshHistory();
        }
      },
      showAll() {
        set({ screen: "all", search: NO_SEARCH, menu: null });
      },
      openSearch() {
        set((state) => ({ search: { ...state.search, open: true }, menu: null }));
      },
      closeSearch() {
        clearTimeout(searchTimer);
        set({ search: NO_SEARCH });
      },
      setQuery(query) {
        clearTimeout(searchTimer);
        set((state) => ({ search: { ...state.search, query } }));
        if (query.trim() === "") {
          set((state) => ({ search: { ...state.search, settled: null, result: null } }));
          return;
        }
        searchTimer = setTimeout(() => {
          client.request("search", { query }).then(
            (result) => {
              if (get().search.query === query) set((state) => ({ search: { ...state.search, settled: query, result } }));
            },
            () => {},
          );
        }, searchDelayMs);
      },
      openMenu: (menu) => set({ menu }),
      closeMenu: () => set({ menu: null }),
      startRename: (id) => set({ renaming: id, menu: null }),
      cancelRename: () => set({ renaming: null }),
      async commitRename(id, title) {
        set({ renaming: null });
        try {
          const { conversation } = await client.request("rename", { conversation: id, title });
          set((state) => ({ history: { ...state.history, conversations: state.history.conversations.map((entry) => (entry.id === id ? conversation : entry)) } }));
          if (get().search.query !== "") get().setQuery(get().search.query);
        } catch {
          void get().refreshHistory();
        }
      },
      askDelete(id) {
        const found = get().history.conversations.find((entry) => entry.id === id);
        set({ confirming: found ?? null, menu: null });
      },
      cancelDelete: () => set({ confirming: null }),
      async confirmDelete() {
        const target = get().confirming;
        if (target === null) return;
        try {
          await client.request("remove", { conversation: target.id });
        } catch {
          set({ confirming: null });
          void get().refreshHistory();
          return;
        }
        set({ confirming: null });
        if (get().conversation === target.id) get().newConversation();
        await get().refreshHistory();
        if (get().search.query !== "") get().setQuery(get().search.query);
      },
    };
  });
  return store;
}
