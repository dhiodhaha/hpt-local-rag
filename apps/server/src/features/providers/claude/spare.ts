import { profileKey, type RunProfile } from "../types.ts";
import type { ClaudeOptions, ClaudeSdk, ClaudeWarm, ToolBinding } from "./sdk.ts";

/**
 * The warm-handle lifecycle as one small state machine. One process is booted ahead of time with `startup()`, serves exactly
 * one prompt, and is replaced.
 *
 *            warm(profile)                      claim(profile) with the same key
 *   empty ───────────────► starting ──ready──► ready ─────────────────────────────► empty   (the caller then replenishes)
 *     ▲                       │ boot fails             │ idle past `idleMs`, or close()
 *     └───────────────────────┴────────────────────────┘
 *
 *   claim with a different key  -> null, the slot is left alone
 *   claim while starting        -> waits for that boot up to the deadline, else null (a second boot would only compete for CPU)
 *   claim while empty           -> null
 *   warm with a different key   -> the parked process is closed and a new one starts
 *
 * A parked process is about 230 MB, so the slot holds one and gives it up after `idleMs`. The idle timer is unref'd.
 */
export type SpareState = { readonly phase: "empty" } | { readonly phase: "starting"; readonly key: string } | { readonly phase: "ready"; readonly key: string };

/**
 * A claimed process serves one question and is then discarded. Its handle refuses a second prompt, so reuse across questions or
 * across the retry attempts of one question is impossible by construction: every attempt claims a process booted for it.
 */
export function singleUse(warm: ClaudeWarm): ClaudeWarm {
  let used = false;
  return {
    query(prompt) {
      if (used) throw new Error("a warm process serves one question only");
      used = true;
      return warm.query(prompt);
    },
    close: () => warm.close(),
  };
}

export type StderrTail = { push(data: string): void; tail(): string };

export function stderrTail(maxChars = 600): StderrTail {
  let text = "";
  return {
    push(data) {
      text = `${text}${data}`.slice(-maxChars);
    },
    tail: () => text.replace(/\s+/g, " ").trim(),
  };
}

export type Built = { readonly options: ClaudeOptions; readonly binding: ToolBinding; readonly stderr: StderrTail };

export type Claimed = {
  readonly warm: ClaudeWarm;
  readonly binding: ToolBinding;
  readonly stderr: StderrTail;
  /** How long the caller waited for the process. 0 when it was already ready. */
  readonly waitedMs: number;
};

export type SpareOptions = {
  readonly sdk: ClaudeSdk;
  readonly build: (profile: RunProfile) => Built;
  readonly bootTimeoutMs: number;
  readonly idleMs: number;
};

export type SpareSlot = {
  readonly state: SpareState;
  /** Boot a process for this profile unless the slot already holds or is booting one with the same key. Never throws. */
  warm(profile: RunProfile): void;
  claim(profile: RunProfile, deadlineMs: number): Promise<Claimed | null>;
  close(): void;
};

type Entry = {
  readonly key: string;
  booted: Omit<Claimed, "waitedMs"> | null;
  boot: Promise<void>;
  closed: boolean;
  timer: NodeJS.Timeout | null;
};

export function createSpareSlot(options: SpareOptions): SpareSlot {
  let entry: Entry | null = null;

  function discard(target: Entry): void {
    target.closed = true;
    if (target.timer !== null) clearTimeout(target.timer);
    target.booted?.warm.close();
    if (entry === target) entry = null;
  }

  function start(profile: RunProfile): void {
    const built = options.build(profile);
    const target: Entry = { key: profileKey(profile), booted: null, boot: Promise.resolve(), closed: false, timer: null };
    target.boot = options.sdk.startup({ options: built.options, initializeTimeoutMs: options.bootTimeoutMs }).then(
      (warm) => {
        if (target.closed) {
          warm.close();
          return;
        }
        target.booted = { warm: singleUse(warm), binding: built.binding, stderr: built.stderr };
        target.timer = setTimeout(() => discard(target), options.idleMs);
        target.timer.unref();
      },
      () => {
        if (entry === target) entry = null;
      },
    );
    entry = target;
  }

  return {
    get state(): SpareState {
      if (entry === null) return { phase: "empty" };
      if (entry.booted === null) return { phase: "starting", key: entry.key };
      return { phase: "ready", key: entry.key };
    },
    warm(profile) {
      try {
        if (entry !== null && entry.key === profileKey(profile)) return;
        if (entry !== null) discard(entry);
        start(profile);
      } catch {
        entry = null;
      }
    },
    async claim(profile, deadlineMs) {
      const target = entry;
      if (target === null || target.key !== profileKey(profile)) return null;
      const started = Date.now();
      if (target.booted === null) {
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, deadlineMs);
        });
        await Promise.race([target.boot, deadline]);
        clearTimeout(timer);
      }
      if (target.booted === null || entry !== target) return null;
      if (target.timer !== null) clearTimeout(target.timer);
      entry = null;
      return { ...target.booted, waitedMs: Date.now() - started };
    },
    close() {
      if (entry !== null) discard(entry);
    },
  };
}
