import type { Effort } from "../providers/index.ts";

/** D20. The limits live as long as the engine. A new process starts with none, and a model is tried again once its reset time passes. */
export type Route = { readonly model: string; readonly effort: Effort };

/** Keyed by the model that is limited. A model with no entry has no fallback. */
export type Fallbacks = Readonly<Record<string, Route>>;

/** Model to the epoch milliseconds before which it is treated as limited. */
export type Limits = ReadonlyMap<string, number>;

/** When the provider gave no reset time, or one already past, a limited model is tried again after this long. A failed try costs one fast refusal. */
export const UNKNOWN_RESET_MS = 5 * 60_000;

export const NO_LIMITS: Limits = new Map();

/** A fallback on the same model would hit the same limit, so it is left out. */
export function planOf(primary: Route, fallbacks: Fallbacks): readonly [Route, ...Route[]] {
  const fallback = fallbacks[primary.model];
  return fallback === undefined || fallback.model === primary.model ? [primary] : [primary, fallback];
}

export function pickRoute(plan: readonly Route[], limits: Limits, nowMs: number): Route | null {
  return plan.find((route) => (limits.get(route.model) ?? 0) <= nowMs) ?? null;
}

export function withLimit(limits: Limits, model: string, resetsAt: string | null, nowMs: number): Limits {
  const reset = resetsAt === null ? Number.NaN : Date.parse(resetsAt);
  const until = reset > nowMs ? reset : nowMs + UNKNOWN_RESET_MS;
  return new Map(limits).set(model, until);
}
