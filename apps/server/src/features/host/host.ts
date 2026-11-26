import type { AnswerEngine, AnswerEvent, Conversations } from "../answer/index.ts";
import { CLAUDE_MODELS, type Connection, type Effort } from "../providers/index.ts";
import type { HptIndex } from "../search/index.ts";
import { PROTOCOL_VERSION, type AskParams, type CallId, type FromHost, type HostError, type HostStatus, type ModelOption } from "./client.ts";
import { ToHostSchema } from "./schema.ts";

/**
 * The server half of the wire. It validates what a renderer sends, runs it on the engine and streams the engine's events back.
 * `handle` takes a frame and a `send`, so the same Host runs behind fork IPC (`hpt host`) and an in-memory pipe (tests).
 *
 * Callers never coordinate steps. What the host hides:
 *   validation   untrusted params (schema.ts) and what they point at (the putusan exists, the model is in the catalog)
 *   ownership    the renderer holds an id and the host holds the history (D1, D15: no provider session in the UI process)
 *   order        one ask at a time per conversation, and `finished` is sent only after the turn is saved, so the UI enabling
 *                its composer on `finished` can never race the history the next ask reads
 *   cancel       one AbortController per call, aborted by `cancel`, by `close`, or by the parent going away
 *   guarantee    per call id: events, then exactly one result or error. A call id is never reused
 */
export type Backend = {
  readonly engine: AnswerEngine;
  readonly conversations: Conversations;
  readonly index: Pick<HptIndex, "hasPutusan" | "getPassages" | "info">;
};

export type HostDeps = {
  /** `unavailable` carries the reason the index could not open. The host still starts so the UI can say why. */
  readonly backend: Backend | { readonly unavailable: string };
  readonly models: readonly ModelOption[];
  readonly probe: () => Promise<Connection>;
  /** Closes the engine, its spare process and the index. */
  readonly close: () => Promise<void>;
  readonly log?: (line: string) => void;
};

export type Host = {
  readonly status: HostStatus;
  /** Announces the host and starts the login check. Call once, with the channel to the parent. */
  start(send: (frame: FromHost) => void): void;
  /** Never throws and never rejects. `frame` is `unknown` because it came from outside: it is parsed here, once. */
  handle(frame: unknown, send: (frame: FromHost) => void): void;
  /** Aborts every open call (each ends with `finished` cancelled), waits for them, then closes the engine. Idempotent. */
  close(): Promise<void>;
};

export const claudeModelOptions = (): ModelOption[] =>
  CLAUDE_MODELS.map((entry) => ({ provider: "claude", model: entry.model, effort: entry.effort, label: entry.label, isDefault: entry.isDefault }));

const idOf = (frame: unknown): CallId | null => {
  const id = typeof frame === "object" && frame !== null ? (frame as { id?: unknown }).id : undefined;
  return typeof id === "string" && id !== "" ? id : null;
};

type Overrides = { model?: string; effort?: Effort };
type Resolved = { readonly overrides: Overrides } | { readonly error: HostError };

export function createHost(deps: HostDeps): Host {
  const log = deps.log ?? ((line: string) => console.error(line));
  const { backend } = deps;
  const status: HostStatus = {
    protocol: PROTOCOL_VERSION,
    index: "unavailable" in backend ? { state: "unavailable", message: backend.unavailable } : { state: "ready", passages: backend.index.info.counts.passages },
    models: deps.models,
  };
  let connection: Connection = { state: "checking" };
  let closed = false;
  let closing: Promise<void> | null = null;
  const seen = new Set<CallId>();
  const controllers = new Map<CallId, AbortController>();
  const tails = new Map<string, Promise<void>>();
  const inflight = new Set<Promise<void>>();

  function resolve(params: AskParams, ready: Backend): Resolved {
    const { scope, choice } = params;
    if (scope?.kind === "document" && !ready.index.hasPutusan(scope.noteId)) return { error: { code: "bad_request", message: `${scope.noteId} is not a putusan in the index.` } };
    if (scope?.kind === "revision" && ready.index.getPassages([scope.active, scope.superseded]).size !== 2) return { error: { code: "bad_request", message: "a passage of the revision is not in the index." } };
    if (choice === null) return { overrides: {} };
    const option = deps.models.find((entry) => entry.provider === choice.provider && entry.model === choice.model);
    if (option === undefined) return { error: { code: "bad_request", message: `${choice.model} is not in the model list.` } };
    return { overrides: { model: option.model, effort: option.effort } };
  }

  async function execute(id: CallId, params: AskParams, ready: Backend, overrides: Overrides, signal: AbortSignal, send: (frame: FromHost) => void): Promise<void> {
    const conversation = ready.conversations.open(params.conversation ?? "new");
    const turn = conversation.turns.length + 1;
    if (signal.aborted) {
      send({ kind: "event", id, event: { kind: "finished", outcome: { kind: "cancelled" } } });
      send({ kind: "result", id, result: { conversation: conversation.id, turn, askId: "" } });
      return;
    }
    const held: { finished: AnswerEvent | null } = { finished: null };
    const finished = await conversation.ask(ready.engine, params.question, {
      scope: params.scope,
      overrides,
      signal,
      onEvent: (event) => {
        if (event.kind === "finished") held.finished = event;
        else send({ kind: "event", id, event });
      },
    });
    if (held.finished !== null) send({ kind: "event", id, event: held.finished });
    send({ kind: "result", id, result: { conversation: conversation.id, turn, askId: finished.id } });
  }

  function ask(id: CallId, params: AskParams, send: (frame: FromHost) => void): void {
    const fail = (error: HostError) => send({ kind: "error", id, error });
    if (closed) return fail({ code: "host_down", message: "the host is closing" });
    if (seen.has(id)) return fail({ code: "bad_request", message: "call id already used" });
    seen.add(id);
    if ("unavailable" in backend) return fail({ code: "index_unavailable", message: backend.unavailable });
    const resolved = resolve(params, backend);
    if ("error" in resolved) return fail(resolved.error);
    const controller = new AbortController();
    controllers.set(id, controller);
    const key = params.conversation ?? `new:${id}`;
    const run = (tails.get(key) ?? Promise.resolve())
      .then(() => execute(id, params, backend, resolved.overrides, controller.signal, send))
      .catch((cause: unknown) => {
        log(`ask ${id} failed: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`);
        fail({ code: "internal", message: "the engine failed" });
      })
      .finally(() => {
        controllers.delete(id);
        inflight.delete(run);
        if (tails.get(key) === run) tails.delete(key);
      });
    tails.set(key, run);
    inflight.add(run);
  }

  return {
    status,
    start(send) {
      send({ kind: "ready", status });
      deps.probe().then(
        (result) => {
          connection = result;
          send({ kind: "connection", connection });
        },
        () => {
          connection = { state: "unknown" };
          send({ kind: "connection", connection });
        },
      );
    },
    handle(frame, send) {
      const parsed = ToHostSchema.safeParse(frame);
      if (!parsed.success) {
        const id = idOf(frame);
        if (id === null) log("dropped a frame that is not a request");
        else send({ kind: "error", id, error: { code: "bad_request", message: "the request is not valid" } });
        return;
      }
      const request = parsed.data;
      if (request.kind === "hello") {
        send({ kind: "ready", status });
        if (connection.state !== "checking") send({ kind: "connection", connection });
        return;
      }
      if (request.kind === "cancel") {
        controllers.get(request.id)?.abort();
        return;
      }
      ask(request.id, request.params, send);
    },
    close() {
      closed = true;
      closing ??= (async () => {
        for (const controller of controllers.values()) controller.abort();
        await Promise.allSettled(inflight);
        await deps.close();
      })();
      return closing;
    },
  };
}
