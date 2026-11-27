import { chooseProfile, decide, estimateCost, recentTraces } from "../features/eval/index.ts";
import type { ApiCredential } from "../features/providers/index.ts";
import { answerConfig } from "../shared/config.ts";

/**
 * D34: a model-calling eval never runs on the Claude plan login. It needs an API key from Claude Console, shows a cost estimate
 * first, and runs only with --confirm and under --max-usd. Local evals (retrieval, compare, evidence, the reports, draft and
 * lock) never reach this file.
 */
export const NEEDS_KEY = [
  "This eval calls a model, and evals never run on the Claude plan login: Anthropic's terms keep plan limits for ordinary, individual use of Claude Code and the Agent SDK (D34).",
  "Set ANTHROPIC_API_KEY to a key from Claude Console and run it again. It prints a cost estimate and waits for --confirm.",
].join("\n");

export const NEEDS_WORKSPACE =
  "This API key belongs to the organization, not to one workspace (sk-ant-usr...). Set ANTHROPIC_WORKSPACE_ID to the wrkspc_ ID of the workspace the eval should bill, and run it again.";

const WORKSPACE_ID = /^wrkspc_[A-Za-z0-9]+$/;

/** The key, and the workspace an organization key needs on every request (anthropic-workspace-id). */
export function requireApi(env: NodeJS.ProcessEnv = process.env): ApiCredential {
  const key = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (key === "") throw new Error(NEEDS_KEY);
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim() ?? "";
  if (workspace !== "" && !WORKSPACE_ID.test(workspace)) throw new Error(`ANTHROPIC_WORKSPACE_ID must be a wrkspc_ ID, not "${workspace}".`);
  if (workspace === "" && key.startsWith("sk-ant-usr")) throw new Error(NEEDS_WORKSPACE);
  return { key, workspace: workspace === "" ? null : workspace };
}

export const GATE_OPTIONS = { confirm: { type: "boolean" }, "max-usd": { type: "string" }, attempts: { type: "string" } } as const;

export const GATE_USAGE = "[--confirm] [--max-usd <dollars>] [--attempts <n>]";

export const DEFAULT_MAX_USD = 10;

export type GateValues = { readonly confirm?: boolean; readonly "max-usd"?: string; readonly attempts?: string };

function positive(text: string | undefined, name: string, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} is a number above 0.`);
  return value;
}

export type EvalPlan = {
  readonly model: string;
  readonly effort: string;
  /** Answers still to run, not those a resumed run file already holds. */
  readonly pending: number;
  /** Follow-up turns among them, each of which calls the rewrite. */
  readonly rewrites?: number;
};

/** Prints the estimate. True when the eval may start. */
export function gateEval(plan: EvalPlan, values: GateValues, print: (text: string) => void = console.log, tracesDir: string = answerConfig.tracesDir): boolean {
  const attempts = positive(values.attempts, "attempts", 1);
  const maxUsd = positive(values["max-usd"], "max-usd", DEFAULT_MAX_USD);
  const choice = chooseProfile(recentTraces(tracesDir), plan.model, plan.effort);
  const estimate = estimateCost({ model: plan.model, choice, cases: plan.pending, attempts, rewrites: plan.rewrites ?? 0 });
  const gate = decide(estimate, { confirm: values.confirm === true, maxUsd });
  print(gate.message);
  return gate.go;
}
