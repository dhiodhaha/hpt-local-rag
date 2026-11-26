import type { Effort } from "../types.ts";

/**
 * The Claude models a person can pick, and the route each one runs on. The picker lists these and the CLI's `--model` aliases
 * come from them, so a model is added in one place. `isDefault` is the route a question takes when nothing is picked (D7a).
 */
export type ClaudeModel = {
  readonly alias: string;
  readonly model: string;
  readonly effort: Effort;
  readonly label: string;
  readonly isDefault: boolean;
};

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  { alias: "opus", model: "claude-opus-5-5", effort: "low", label: "Opus 5.5", isDefault: true },
  { alias: "sonnet", model: "claude-sonnet-5-5", effort: "low", label: "Sonnet 5.5", isDefault: false },
];
