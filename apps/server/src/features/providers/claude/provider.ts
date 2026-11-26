import { crashed, newMessageState, translate } from "./messages.ts";
import { claudeOptions, emptyCwd } from "./options.ts";
import { loadClaudeSdk, type ClaudeQuery, type ClaudeSdk } from "./sdk.ts";
import { createSpareSlot, stderrTail, type Built, type SpareSlot } from "./spare.ts";
import type { Provider, ProviderEvent, ProviderFailure, RunProfile } from "../types.ts";

export type ClaudeProviderOptions = {
  readonly sdk?: ClaudeSdk;
  /** A boot can take a minute on an oversubscribed host, so there is always a bound. Default 20 s. */
  readonly bootTimeoutMs?: number;
  readonly idleMs?: number;
};

const ABORTED: ProviderFailure = { code: "aborted", detail: "aborted", resetsAt: null };

const failed = (failure: ProviderFailure): ProviderEvent => ({ kind: "end", outcome: { ok: false, failure } });

/**
 * Claude Code login through the Agent SDK, no API key path. A claimed spare process serves the run when its profile
 * matches, else a fresh `query()` does (about 0.8 s slower to first text). After a claim the next spare boots while this
 * answer streams. `end` is yielded at `result` and the process is closed in the background, because the SDK iterator
 * lingers 1.1 to 1.3 s after it. Failures are classified here and never retried here: the engine's policy decides.
 */
export function claudeProvider(options: ClaudeProviderOptions = {}): Provider {
  const bootTimeoutMs = options.bootTimeoutMs ?? 20_000;
  const idleMs = options.idleMs ?? 600_000;
  let sdkLoad: Promise<ClaudeSdk> | null = null;
  let slotLoad: Promise<SpareSlot> | null = null;

  const getSdk = () => (options.sdk ? Promise.resolve(options.sdk) : (sdkLoad ??= loadClaudeSdk()));

  function build(sdk: ClaudeSdk, profile: RunProfile): Built {
    const binding = { host: null };
    const stderr = stderrTail();
    const server = profile.tools.length > 0 ? sdk.mcpServer(profile.tools, binding) : null;
    return { options: claudeOptions(profile, server, emptyCwd(), stderr.push), binding, stderr };
  }

  const getSlot = () => (slotLoad ??= getSdk().then((sdk) => createSpareSlot({ sdk, build: (profile) => build(sdk, profile), bootTimeoutMs, idleMs })));

  return {
    id: "claude",
    warm(profile) {
      getSlot().then(
        (slot) => slot.warm(profile),
        () => {},
      );
    },
    async close() {
      if (slotLoad !== null) (await slotLoad.catch(() => null))?.close();
    },
    async *run(request, signal) {
      const started = performance.now();
      if (signal.aborted) {
        yield failed(ABORTED);
        return;
      }
      let sdk: ClaudeSdk;
      let slot: SpareSlot;
      try {
        sdk = await getSdk();
        slot = await getSlot();
      } catch (cause) {
        yield failed(crashed(cause, ""));
        return;
      }
      const claimed = await slot.claim(request.profile, bootTimeoutMs);
      let query: ClaudeQuery;
      let binding: { host: typeof request.tools | null };
      let stderr: { tail(): string };
      try {
        if (claimed !== null) {
          ({ binding, stderr } = claimed);
          binding.host = request.tools;
          query = claimed.warm.query(request.user);
          slot.warm(request.profile);
        } else {
          const built = build(sdk, request.profile);
          ({ binding, stderr } = built);
          binding.host = request.tools;
          query = sdk.query({ prompt: request.user, options: built.options });
        }
      } catch (cause) {
        yield failed(crashed(cause, ""));
        return;
      }
      yield { kind: "started", waitMs: performance.now() - started, warm: claimed !== null };

      const state = newMessageState();
      let abortNow: () => void = () => {};
      const aborted = new Promise<"aborted">((resolve) => {
        abortNow = () => resolve("aborted");
      });
      const onAbort = () => {
        abortNow();
        query.close();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const iterator = query[Symbol.asyncIterator]();
      let ended = false;
      try {
        while (!ended) {
          const next = await Promise.race([iterator.next(), aborted]);
          if (next === "aborted" || next.done) break;
          for (const event of translate(next.value, state)) {
            yield event;
            if (event.kind === "end") ended = true;
          }
        }
        if (!ended) yield failed(signal.aborted ? ABORTED : crashed("the process ended without a result", stderr.tail()));
      } catch (cause) {
        if (!ended) yield failed(signal.aborted ? ABORTED : crashed(cause, stderr.tail()));
      } finally {
        signal.removeEventListener("abort", onAbort);
        binding.host = null;
        try {
          query.close();
        } catch {
          // The process is already gone.
        }
      }
    },
  };
}
