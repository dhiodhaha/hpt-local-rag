import { FAILURE_COPY, type AnswerEvent, type ConversationId, type ConversationSummary, type OpenedConversation, type Outcome, type Scope, type SearchResult } from "../answer/client.ts";
import type { Connection, Effort, FailureCode } from "../providers/index.ts";

/**
 * The engine as a service for one UI process. This file is the browser-safe half: the wire types, the Pipe a transport
 * implements, and the client that turns a Pipe into the one call a UI makes. Both ends of the wire live in this feature, so a
 * frame change is a one-feature edit.
 *
 * What crosses the process boundary: AskParams (untrusted, validated by the host), AnswerEvent (the engine's own domain type,
 * unchanged), AskResult, HostStatus, Connection and HostError. A provider failure is not a HostError: it is a `finished`
 * event with outcome `failed`. Traces and provider types never cross (D16).
 */

export const PROTOCOL_VERSION = 1 as const;

/** One provider today. Adding "codex" makes every `Record<ProviderId, ...>` and switch fail to compile until it is handled. */
export type ProviderId = "claude";

/** One row of the model picker. The host owns the list and the UI only renders it. */
export type ModelOption = {
  readonly provider: ProviderId;
  readonly model: string;
  /** Chosen by the host from the catalog. The UI never chooses effort. */
  readonly effort: Effort;
  readonly label: string;
  readonly isDefault: boolean;
};

export type AskParams = {
  /** null starts a new conversation. Otherwise an id the host handed out before. */
  readonly conversation: ConversationId | null;
  readonly question: string;
  /** Set by the reader's composer. null from the chat composer. */
  readonly scope: Scope | null;
  /** null is the host's default route (Opus 5.5 low, with the D20 fallback). A manual pick of another model has no fallback. */
  readonly choice: { readonly provider: ProviderId; readonly model: string } | null;
};

export type AskResult = {
  /** Set also for an ask that did not deliver, so a retry can reuse it. A conversation has no file until its first delivered turn. */
  readonly conversation: ConversationId;
  /** The number this question has, or would have had if it was not delivered. */
  readonly turn: number;
  /** Equals the trace id. Empty when the ask was cancelled before it started. */
  readonly askId: string;
};

export type HostStatus = {
  readonly protocol: typeof PROTOCOL_VERSION;
  /** "unavailable": the index file is missing. The host still starts, so the app can say so instead of crash-looping. */
  readonly index: { readonly state: "ready"; readonly passages: number } | { readonly state: "unavailable"; readonly message: string };
  readonly models: readonly ModelOption[];
};

export type HostErrorCode = "bad_request" | "not_found" | "index_unavailable" | "host_down" | "cancelled" | "internal";
export type HostError = { readonly code: HostErrorCode; readonly message: string };

/**
 * One entry per method: its params, what streams before the result, and the result. `ask` streams. The Riwayat methods answer
 * once, so their `event` is `never`. Reserved for the reader: `passages`.
 */
export type Methods = {
  ask: { params: AskParams; event: AnswerEvent; result: AskResult };
  list: { params: null; event: never; result: { readonly conversations: readonly ConversationSummary[] } };
  open: { params: { readonly conversation: ConversationId }; event: never; result: OpenedConversation };
  search: { params: { readonly query: string }; event: never; result: SearchResult };
  rename: { params: { readonly conversation: ConversationId; readonly title: string }; event: never; result: { readonly conversation: ConversationSummary } };
  remove: { params: { readonly conversation: ConversationId }; event: never; result: { readonly conversation: ConversationId } };
};
export type MethodName = keyof Methods;
/** Every method but `ask`: one request, one result or error, no events. */
export type UnaryMethod = Exclude<MethodName, "ask">;

/** Chosen by the caller, unique per call. The host and the process between treat it as an opaque string. */
export type CallId = string;

export type ToHost =
  | { readonly kind: "hello" }
  | { [M in MethodName]: { readonly kind: "call"; readonly id: CallId; readonly method: M; readonly params: Methods[M]["params"] } }[MethodName]
  | { readonly kind: "cancel"; readonly id: CallId };

export type FromHost =
  | { readonly kind: "ready"; readonly status: HostStatus }
  /** The login check finished. Sent once per host start, after `ready`. */
  | { readonly kind: "connection"; readonly connection: Connection }
  /** Sent by the process that supervises the host, not by the host: it exited or could not start. */
  | { readonly kind: "down"; readonly reason: string }
  | { readonly kind: "event"; readonly id: CallId; readonly event: Methods[MethodName]["event"] }
  | { readonly kind: "result"; readonly id: CallId; readonly result: Methods[MethodName]["result"] }
  | { readonly kind: "error"; readonly id: CallId; readonly error: HostError };

/** The one thing a transport implements: Electron IPC in the app, a function pair in tests. Frames are plain JSON. */
export type Pipe = {
  send(frame: ToHost): void;
  subscribe(listener: (frame: FromHost) => void): () => void;
};

export type ConnectionState =
  | { readonly kind: "starting" }
  | { readonly kind: "ready"; readonly status: HostStatus; readonly connection: Connection }
  | { readonly kind: "down"; readonly reason: string };

export type AskCall = {
  readonly id: CallId;
  /** Resolves with the result. Rejects with a HostError when the ask could not run. In every case `onEvent` got exactly one `finished`, last. */
  readonly done: Promise<AskResult>;
  /** Idempotent. The engine answers with `finished` outcome `cancelled`. */
  cancel(): void;
};

export type HptClient = {
  /** The same object until the state changes, for useSyncExternalStore. */
  readonly state: () => ConnectionState;
  subscribe(listener: () => void): () => void;
  /**
   * Starts a question. Before `ready` the call waits. After `down` it fails at once.
   *
   * Guarantee: `onEvent` sees the engine's events in order and then exactly one `finished`. When the host dies, rejects the
   * request or is not there, the client makes that `finished` itself (outcome `failed`, fixed Indonesian copy), so a UI has no
   * second path for "the stream just stopped".
   */
  ask(params: AskParams, onEvent: (event: AnswerEvent) => void): AskCall;
  /** Riwayat and its kin. Waits for `ready`, rejects with a HostError (also when the host is down). */
  request<M extends UnaryMethod>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]>;
};

/** Fixed Indonesian copy for host-level failures. Copy that comes from the engine stays in answer/copy.ts. */
export const HOST_ERROR_COPY: Readonly<Record<HostErrorCode, string>> = {
  bad_request: FAILURE_COPY.unknown,
  not_found: "Percakapan ini sudah tidak ada.",
  index_unavailable: "Indeks naskah belum tersedia. Bangun indeks dengan `pnpm hpt build`, lalu mulai ulang aplikasi.",
  host_down: FAILURE_COPY.crashed,
  cancelled: FAILURE_COPY.aborted,
  internal: FAILURE_COPY.unknown,
};

const HOST_FAILURE_CODE: Readonly<Record<Exclude<HostErrorCode, "cancelled">, FailureCode>> = {
  bad_request: "unknown",
  not_found: "unknown",
  index_unavailable: "unknown",
  host_down: "crashed",
  internal: "unknown",
};

const finishedFor = (error: HostError): AnswerEvent => {
  const outcome: Outcome =
    error.code === "cancelled" ? { kind: "cancelled" } : { kind: "failed", code: HOST_FAILURE_CODE[error.code], copy: HOST_ERROR_COPY[error.code] };
  return { kind: "finished", outcome };
};

type OpenCall = {
  readonly method: MethodName;
  readonly params: Methods[MethodName]["params"];
  /** Set for `ask` only: a call without it has no events, so no `finished` is made for it. */
  readonly onEvent: ((event: AnswerEvent) => void) | null;
  readonly resolve: (result: Methods[MethodName]["result"]) => void;
  readonly reject: (error: HostError) => void;
  sent: boolean;
  sawFinished: boolean;
};

export function createClient(pipe: Pipe, newId: () => CallId = () => crypto.randomUUID()): HptClient {
  let state: ConnectionState = { kind: "starting" };
  const listeners = new Set<() => void>();
  const open = new Map<CallId, OpenCall>();

  const setState = (next: ConnectionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  function end(id: CallId, call: OpenCall, error: HostError): void {
    open.delete(id);
    if (call.onEvent !== null && !call.sawFinished) {
      call.sawFinished = true;
      call.onEvent(finishedFor(error));
    }
    call.reject(error);
  }

  function dispatch(id: CallId, call: OpenCall): void {
    call.sent = true;
    pipe.send({ kind: "call", id, method: call.method, params: call.params } as ToHost);
  }

  pipe.subscribe((frame) => {
    switch (frame.kind) {
      case "ready": {
        const connection: Connection = state.kind === "ready" ? state.connection : { state: "checking" };
        setState({ kind: "ready", status: frame.status, connection });
        for (const [id, call] of open) if (!call.sent) dispatch(id, call);
        return;
      }
      case "connection":
        if (state.kind === "ready") setState({ ...state, connection: frame.connection });
        return;
      case "down":
        setState({ kind: "down", reason: frame.reason });
        for (const [id, call] of open) end(id, call, { code: "host_down", message: frame.reason });
        return;
      case "event": {
        const call = open.get(frame.id);
        if (call === undefined || call.onEvent === null || call.sawFinished) return;
        if (frame.event.kind === "finished") call.sawFinished = true;
        call.onEvent(frame.event);
        return;
      }
      case "result": {
        const call = open.get(frame.id);
        if (call === undefined) return;
        open.delete(frame.id);
        if (call.onEvent !== null && !call.sawFinished) call.onEvent(finishedFor({ code: "internal", message: "no finished event" }));
        call.resolve(frame.result);
        return;
      }
      case "error": {
        const call = open.get(frame.id);
        if (call !== undefined) end(frame.id, call, frame.error);
        return;
      }
    }
  });
  pipe.send({ kind: "hello" });

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request<M extends UnaryMethod>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> {
      const id = newId();
      const done = new Promise<Methods[M]["result"]>((resolve, reject) => {
        open.set(id, { method, params, onEvent: null, resolve: resolve as OpenCall["resolve"], reject, sent: false, sawFinished: false });
      });
      const call = open.get(id);
      if (call === undefined) throw new Error("the call was not registered");
      if (state.kind === "ready") dispatch(id, call);
      else if (state.kind === "down") end(id, call, { code: "host_down", message: state.reason });
      return done;
    },
    ask(params, onEvent) {
      const id = newId();
      const done = new Promise<AskResult>((resolve, reject) => {
        open.set(id, { method: "ask", params, onEvent, resolve: resolve as OpenCall["resolve"], reject, sent: false, sawFinished: false });
      });
      done.catch(() => {});
      const call = open.get(id);
      if (call === undefined) throw new Error("the call was not registered");
      if (state.kind === "ready") dispatch(id, call);
      else if (state.kind === "down") end(id, call, { code: "host_down", message: state.reason });
      return {
        id,
        done,
        cancel() {
          const current = open.get(id);
          if (current === undefined) return;
          if (current.sent) pipe.send({ kind: "cancel", id });
          else end(id, current, { code: "cancelled", message: HOST_ERROR_COPY.cancelled });
        },
      };
    },
  };
}
