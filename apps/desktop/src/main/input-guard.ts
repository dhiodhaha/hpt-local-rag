import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The input boundary of the app's main process: who may send the host a frame, and what is written down about every question. Pure
 * functions over plain values, so each rule is a test and `index.ts` only reads Electron's objects into them.
 *
 * Why it exists: a question once reached the host that its owner did not type, and nothing said how. A frame from the renderer is
 * accepted only when it comes from our own window's main frame at the page we loaded, and every ask is logged with where it came
 * from. The log never holds the question: its length and the first 12 hex of its sha256 are enough to tell two asks apart.
 */
export const WINDOW_SECURITY = { contextIsolation: true, sandbox: true, nodeIntegration: false } as const;

export type ExpectedRenderer = { readonly kind: "origin"; readonly origin: string } | { readonly kind: "file"; readonly href: string };

/** The dev server's origin when electron-vite gave one, else the one file the build loads. */
export function expectedRenderer(rendererUrl: string | undefined, indexHtmlHref: string): ExpectedRenderer {
  if (rendererUrl === undefined || rendererUrl === "") return { kind: "file", href: indexHtmlHref };
  return { kind: "origin", origin: new URL(rendererUrl).origin };
}

export function urlAllowed(url: string, expected: ExpectedRenderer): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (expected.kind === "origin") return parsed.origin === expected.origin;
  const wanted = new URL(expected.href);
  return parsed.protocol === "file:" && parsed.pathname === wanted.pathname;
}

export type SenderFacts = {
  /** `event.sender` is our window's webContents. */
  readonly fromWindow: boolean;
  /** `event.senderFrame` is that webContents' main frame, not a child frame. */
  readonly isMainFrame: boolean;
  readonly frameUrl: string;
};

export type RejectReason = "other_sender" | "not_main_frame" | "wrong_origin" | "malformed_ask" | "untrusted_ask";
export type Verdict = { readonly ok: true } | { readonly ok: false; readonly reason: RejectReason };

export function senderVerdict(facts: SenderFacts, expected: ExpectedRenderer): Verdict {
  if (!facts.fromWindow) return { ok: false, reason: "other_sender" };
  if (!facts.isMainFrame) return { ok: false, reason: "not_main_frame" };
  if (!urlAllowed(facts.frameUrl, expected)) return { ok: false, reason: "wrong_origin" };
  return { ok: true };
}

export type AskFrame = {
  readonly id: string;
  readonly conversation: string | null;
  readonly question: string;
  readonly origin: { readonly via: string; readonly trusted: boolean; readonly focused: boolean; readonly turn: number };
};

export type Classified = { readonly kind: "other" } | { readonly kind: "ask"; readonly ask: AskFrame } | { readonly kind: "bad_ask" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Reads what the log needs from a frame that came over IPC and is `unknown`. The host validates the rest. */
export function classify(frame: unknown): Classified {
  if (!isRecord(frame) || frame.kind !== "call" || frame.method !== "ask") return { kind: "other" };
  const { id, params } = frame;
  if (typeof id !== "string" || id === "" || !isRecord(params)) return { kind: "bad_ask" };
  const { question, conversation, origin } = params;
  if (typeof question !== "string" || !isRecord(origin)) return { kind: "bad_ask" };
  if (typeof origin.via !== "string" || typeof origin.trusted !== "boolean" || typeof origin.focused !== "boolean" || typeof origin.turn !== "number") return { kind: "bad_ask" };
  return {
    kind: "ask",
    ask: { id, conversation: typeof conversation === "string" ? conversation : null, question, origin: { via: origin.via, trusted: origin.trusted, focused: origin.focused, turn: origin.turn } },
  };
}

/** An ask a script made (an untrusted DOM event) is dropped here as well, in case the page's own check was bypassed. */
export function askVerdict(classified: Classified): Verdict {
  if (classified.kind === "bad_ask") return { ok: false, reason: "malformed_ask" };
  if (classified.kind === "ask" && !classified.ask.origin.trusted) return { ok: false, reason: "untrusted_ask" };
  return { ok: true };
}

export type AskLogLine = {
  readonly time: string;
  readonly kind: "ask";
  readonly callId: string;
  readonly conversation: string | null;
  readonly turn: number;
  readonly via: string;
  readonly trusted: boolean;
  readonly focused: boolean;
  readonly windowFocused: boolean;
  readonly windowVisible: boolean;
  readonly questionChars: number;
  readonly questionSha12: string;
};

export const sha12 = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

export function askLogLine(input: { now: Date; ask: AskFrame; windowFocused: boolean; windowVisible: boolean }): AskLogLine {
  const { ask } = input;
  return {
    time: input.now.toISOString(),
    kind: "ask",
    callId: ask.id,
    conversation: ask.conversation,
    turn: ask.origin.turn,
    via: ask.origin.via,
    trusted: ask.origin.trusted,
    focused: ask.origin.focused,
    windowFocused: input.windowFocused,
    windowVisible: input.windowVisible,
    questionChars: ask.question.length,
    questionSha12: sha12(ask.question),
  };
}

export type RejectedLogLine = { readonly time: string; readonly kind: "rejected"; readonly reason: RejectReason; readonly senderUrl: string };

export const rejectedLogLine = (now: Date, reason: RejectReason, senderUrl: string): RejectedLogLine => ({ time: now.toISOString(), kind: "rejected", reason, senderUrl });

export type AnsweredLogLine = { readonly time: string; readonly kind: "answered"; readonly callId: string; readonly conversation: string; readonly turn: number; readonly askId: string };

/** The host's result for an ask: the conversation id a new conversation only gets now. Null for anything else. */
export function answeredLogLine(now: Date, callId: string, result: unknown): AnsweredLogLine | null {
  if (!isRecord(result) || typeof result.conversation !== "string" || typeof result.turn !== "number" || typeof result.askId !== "string") return null;
  return { time: now.toISOString(), kind: "answered", callId, conversation: result.conversation, turn: result.turn, askId: result.askId };
}

const pad = (value: number) => String(value).padStart(2, "0");

export const logFileFor = (logsDir: string, now: Date): string => path.join(logsDir, `input-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jsonl`);

/** One JSON object per line, appended. A log that cannot be written must never stop a question, so this never throws. */
export function appendLog(logsDir: string, now: Date, line: AskLogLine | RejectedLogLine | AnsweredLogLine, onError: (message: string) => void = () => {}): void {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(logFileFor(logsDir, now), `${JSON.stringify(line)}\n`);
  } catch (cause) {
    onError(`input log not written: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
