import { execFile, fork, type ChildProcess } from "node:child_process";
import type { FromHost, ToHost } from "@hpt/server/client";
import { HostLaunchError, type HostLaunch } from "./host-launch.ts";

/**
 * Owns the engine child process and the routing between it and windows. A thin relay with policy:
 *
 *   routing    a reply goes back to the window that made the call
 *   ownership  a window that closes or reloads cancels every call it owns, so no orphan model run keeps spending the user's limit
 *   lifecycle  start, `ready`, exit becomes `down` for every window, and a bounded restart (3 in 60 s, then it stays down)
 *   shutdown   disconnect so the host closes its warm Claude process, wait, then kill the tree
 *
 * It reads `kind` and `id` of a frame and nothing else. Validation is the host's job and the types are the protocol's.
 * It imports nothing from Electron: the main process hands it a `Window` per web contents, so a test can use plain objects.
 */
export type HostState = "starting" | "ready" | "down";

export type Window = {
  send(frame: FromHost): void;
  /** "reload" when the page navigates away and "closed" when the window is gone. */
  on(event: "reload" | "closed", listener: () => void): void;
};

export type Supervisor = {
  readonly state: () => HostState;
  /** Registers a window and returns what it calls with each frame the page sends. */
  connect(window: Window): (frame: ToHost) => void;
  /** Stops the child and starts a new one. Asks in flight end with `down`. */
  restart(reason: string): Promise<void>;
  /** Idempotent. Resolves when the child is gone. */
  close(): Promise<void>;
};

export type SupervisorDeps = {
  readonly launch: () => HostLaunch;
  readonly log: (line: string) => void;
  /** Test seam: how long to wait before a restart. */
  readonly restartDelayMs?: number;
  readonly graceMs?: number;
};

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
  else child.kill("SIGKILL");
}

export function startSupervisor(deps: SupervisorDeps): Supervisor {
  const restartDelayMs = deps.restartDelayMs ?? 500;
  const graceMs = deps.graceMs ?? 3000;
  const windows = new Set<Window>();
  const owners = new Map<string, Window>();
  const restarts: number[] = [];
  let child: ChildProcess | null = null;
  let state: HostState = "starting";
  let ready: FromHost | null = null;
  let connection: FromHost | null = null;
  let closing = false;
  let exited: Promise<void> = Promise.resolve();
  let pendingRestart: NodeJS.Timeout | null = null;

  const broadcast = (frame: FromHost) => {
    for (const window of windows) window.send(frame);
  };

  function route(frame: FromHost): void {
    if (frame.kind === "ready") {
      state = "ready";
      ready = frame;
      connection = null;
      broadcast(frame);
    } else if (frame.kind === "connection") {
      connection = frame;
      broadcast(frame);
    } else if (frame.kind === "title") {
      broadcast(frame);
    } else if (frame.kind === "event" || frame.kind === "result" || frame.kind === "error") {
      owners.get(frame.id)?.send(frame);
      if (frame.kind !== "event") owners.delete(frame.id);
    }
  }

  function declareDown(reason: string): void {
    state = "down";
    ready = null;
    connection = null;
    owners.clear();
    broadcast({ kind: "down", reason });
  }

  function spawn(): void {
    let launch: HostLaunch;
    try {
      launch = deps.launch();
    } catch (cause) {
      const reason = cause instanceof HostLaunchError ? cause.message : `Mesin jawaban tidak bisa dimulai: ${cause instanceof Error ? cause.message : String(cause)}`;
      declareDown(reason);
      return;
    }
    state = "starting";
    const started = fork(launch.entry, [...launch.args], { ...launch.options, execPath: launch.execPath });
    child = started;
    started.stderr?.on("data", (data: Buffer) => deps.log(data.toString().trimEnd()));
    started.stdout?.on("data", (data: Buffer) => deps.log(data.toString().trimEnd()));
    started.on("message", (frame: FromHost) => {
      if (child === started) route(frame);
    });
    exited = new Promise<void>((resolve) => {
      started.once("exit", (code, signal) => {
        resolve();
        if (child !== started) return;
        child = null;
        if (closing) return;
        declareDown(`Mesin jawaban berhenti (${signal ?? `kode ${code}`}).`);
        scheduleRestart();
      });
      started.once("error", (cause) => {
        deps.log(`host process error: ${cause.message}`);
      });
    });
  }

  function scheduleRestart(): void {
    const now = Date.now();
    while (restarts.length > 0 && now - (restarts[0] ?? 0) > RESTART_WINDOW_MS) restarts.shift();
    if (restarts.length >= MAX_RESTARTS) {
      deps.log("the host exited too often, it stays down");
      return;
    }
    restarts.push(now);
    pendingRestart = setTimeout(() => {
      pendingRestart = null;
      if (!closing) spawn();
    }, restartDelayMs);
  }

  async function stop(): Promise<void> {
    if (pendingRestart !== null) clearTimeout(pendingRestart);
    pendingRestart = null;
    const stopping = child;
    child = null;
    if (stopping === null) return;
    const gone = new Promise<void>((resolve) => stopping.once("exit", () => resolve()));
    if (stopping.connected) stopping.disconnect();
    const timer = setTimeout(() => killTree(stopping), graceMs);
    await gone;
    clearTimeout(timer);
  }

  function cancelOwned(window: Window): void {
    for (const [id, owner] of owners) {
      if (owner !== window) continue;
      child?.send({ kind: "cancel", id } satisfies ToHost);
      owners.delete(id);
    }
  }

  spawn();

  return {
    state: () => state,
    connect(window) {
      windows.add(window);
      window.on("reload", () => cancelOwned(window));
      window.on("closed", () => {
        cancelOwned(window);
        windows.delete(window);
      });
      return (frame) => {
        if (frame.kind === "hello") {
          if (state === "ready" && ready !== null) window.send(ready);
          if (state === "ready" && connection !== null) window.send(connection);
          if (state === "down") window.send({ kind: "down", reason: "Mesin jawaban tidak berjalan." });
          return;
        }
        if (frame.kind === "call") {
          if (state !== "ready" || child === null || !child.connected) {
            window.send({ kind: "error", id: frame.id, error: { code: "host_down", message: "Mesin jawaban tidak berjalan." } });
            return;
          }
          owners.set(frame.id, window);
        }
        if (child?.connected) child.send(frame);
      };
    },
    async restart(reason) {
      deps.log(`restarting the host: ${reason}`);
      await stop();
      declareDown(reason);
      if (!closing) spawn();
    },
    async close() {
      if (closing) return exited;
      closing = true;
      await stop();
      await exited;
    },
  };
}
