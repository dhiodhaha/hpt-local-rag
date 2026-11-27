import type { Provider, ProviderRequest, RunProfile, ToolHost } from "../providers/index.ts";

/**
 * One small, tool-less model call that is allowed to fail. The follow-up rewrite (D33) and the conversation title (D36) are both
 * this: a process started for the call (D15, the answer process's isolation recipe), a time budget, and an answer that is either
 * text or a reason it is not. Nothing here throws, and nothing takes longer than the budget.
 */
export type SmallFallback = "timeout" | "failed" | "cancelled";

export type SmallResult =
  | { readonly text: string; readonly ms: number; readonly fallback: null }
  | { readonly text: null; readonly ms: number; readonly fallback: SmallFallback };

export type SmallCall = {
  readonly provider: Provider;
  readonly profile: RunProfile;
  readonly user: string;
  /** From the start of the call. Past it the call is abandoned and its process closed. */
  readonly budgetMs: number;
  readonly signal?: AbortSignal;
  readonly now: () => number;
};

const NO_TOOLS: ToolHost = { invoke: async () => ({ text: "This tool is not available.", isError: true }) };

type Consumed = { readonly kind: "reply"; readonly text: string } | { readonly kind: "failed" };

async function consume(provider: Provider, request: ProviderRequest, signal: AbortSignal): Promise<Consumed> {
  let text = "";
  try {
    for await (const event of provider.run(request, signal)) {
      if (event.kind === "text") text += event.delta;
      else if (event.kind === "end") return event.outcome.ok ? { kind: "reply", text } : { kind: "failed" };
    }
  } catch {
    return { kind: "failed" };
  }
  return { kind: "failed" };
}

export async function smallCall(input: SmallCall): Promise<SmallResult> {
  const { provider, profile, user, budgetMs, signal, now } = input;
  const started = now();
  const elapsed = () => Math.round(now() - started);
  if (signal?.aborted) return { text: null, ms: 0, fallback: "cancelled" };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, budgetMs);
  });
  try {
    const outcome = await Promise.race([consume(provider, { profile, user, tools: NO_TOOLS }, controller.signal), late]);
    if (outcome === "timeout") return { text: null, ms: elapsed(), fallback: "timeout" };
    if (signal?.aborted) return { text: null, ms: elapsed(), fallback: "cancelled" };
    if (outcome.kind === "failed") return { text: null, ms: elapsed(), fallback: "failed" };
    return { text: outcome.text, ms: elapsed(), fallback: null };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
