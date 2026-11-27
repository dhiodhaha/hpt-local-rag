import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunProfile } from "../types.ts";
import { MCP_SERVER_NAME, type ClaudeOptions } from "./sdk.ts";

/**
 * The spike's isolation recipe, in one place. A spare from `startup()` and a fresh `query()` take the same options, so they
 * behave identically: our system prompt, no built-in tools, no settings sources, only our MCP server, nothing that can prompt.
 */
/** D34: what a model-calling eval runs on. `workspace` is set when the key is not scoped to one (an organization key, `sk-ant-usr...`). */
export type ApiCredential = { readonly key: string; readonly workspace: string | null };

export function claudeOptions(profile: RunProfile, mcpServer: unknown, cwd: string, onStderr: (data: string) => void, api?: ApiCredential): ClaudeOptions {
  const hasTools = profile.tools.length > 0;
  return {
    model: profile.model,
    effort: profile.effort,
    systemPrompt: profile.system,
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: hasTools ? { [MCP_SERVER_NAME]: mcpServer } : {},
    allowedTools: hasTools ? [`mcp__${MCP_SERVER_NAME}__*`] : [],
    permissionMode: "dontAsk",
    includePartialMessages: true,
    persistSession: false,
    cwd,
    env: isolatedEnv(process.env, api),
    stderr: onStderr,
  };
}

const KEPT = new Set(["CLAUDE_CONFIG_DIR"]);

/**
 * Every CLAUDE*, ANTHROPIC* and AI_AGENT* variable is removed, so the login is used and a stray key never is. The one way a key
 * gets in is `api`, which only a model-calling eval passes (D34). The app and `hpt ask` never do. A workspace goes in as the
 * `anthropic-workspace-id` header through ANTHROPIC_CUSTOM_HEADERS, which Claude Code adds to every request.
 */
export function isolatedEnv(source: NodeJS.ProcessEnv, api?: ApiCredential): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (KEPT.has(key.toUpperCase()) || !/^(CLAUDE|ANTHROPIC|AI_AGENT|ENABLE_CLAUDEAI)/i.test(key)) env[key] = value;
  }
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  if (api === undefined || api.key === "") return env;
  env.ANTHROPIC_API_KEY = api.key;
  if (api.workspace !== null) env.ANTHROPIC_CUSTOM_HEADERS = `anthropic-workspace-id: ${api.workspace}`;
  return env;
}

/** The model sees cwd and CLAUDE.md discovery walks up from it, so it is an empty directory of our own. */
export function emptyCwd(): string {
  const dir = path.join(os.tmpdir(), "hpt-claude-cwd");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
