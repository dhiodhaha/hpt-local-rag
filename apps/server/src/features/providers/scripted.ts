import type { Provider, ProviderEvent, ProviderFailure, ProviderRequest, Usage } from "./types.ts";

export type ScriptedAttempt = {
  readonly chunks: readonly string[];
  /** Tool calls made through `request.tools` after the given chunk index, in order. */
  readonly toolCalls?: readonly { readonly afterChunk: number; readonly name: string; readonly args: Readonly<Record<string, string>> }[];
  readonly delayMs?: number;
  /** Ends this attempt with a failure instead of a normal end. Chunks before it are still delivered. */
  readonly fail?: ProviderFailure;
  readonly usage?: Usage;
};

export type ScriptedProvider = Provider & {
  readonly requests: readonly ProviderRequest[];
  readonly warmed: readonly ProviderRequest["profile"][];
};

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const ABORTED: ProviderEvent = { kind: "end", outcome: { ok: false, failure: { code: "aborted", detail: "aborted", resetsAt: null } } };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One attempt per `run` call, in order. A run past the end of the script ends with failure `crashed`. */
export function scriptedProvider(attempts: readonly ScriptedAttempt[]): ScriptedProvider {
  const requests: ProviderRequest[] = [];
  const warmed: ProviderRequest["profile"][] = [];
  return {
    id: "scripted",
    requests,
    warmed,
    warm: (profile) => {
      warmed.push(profile);
    },
    close: async () => {},
    async *run(request, signal) {
      const attempt = attempts[requests.length];
      requests.push(request);
      if (attempt === undefined) {
        yield { kind: "end", outcome: { ok: false, failure: { code: "crashed", detail: "script exhausted", resetsAt: null } } };
        return;
      }
      yield { kind: "started", waitMs: 0, warm: false };
      for (const [index, chunk] of attempt.chunks.entries()) {
        if (attempt.delayMs) await sleep(attempt.delayMs);
        if (signal.aborted) {
          yield ABORTED;
          return;
        }
        yield { kind: "text", delta: chunk };
        for (const call of attempt.toolCalls ?? []) {
          if (call.afterChunk !== index) continue;
          yield { kind: "tool_use", name: call.name };
          await request.tools.invoke(call.name, call.args);
        }
      }
      if (signal.aborted) {
        yield ABORTED;
        return;
      }
      yield attempt.fail ? { kind: "end", outcome: { ok: false, failure: attempt.fail } } : { kind: "end", outcome: { ok: true, usage: attempt.usage ?? NO_USAGE } };
    },
  };
}

export function chunked(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += size) parts.push(text.slice(start, start + size));
  return parts;
}
