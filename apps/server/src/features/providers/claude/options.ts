import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunProfile } from "../types.ts";
import { MCP_SERVER_NAME, type ClaudeOptions } from "./sdk.ts";

/**
 * The spike's isolation recipe, in one place. A spare from `startup()` and a fresh `query()` take the same options, so they
 * behave identically: our system prompt, no built-in tools, no settings sources, only our MCP server, nothing that can prompt.
 */
export function claudeOptions(profile: RunProfile, mcpServer: unknown, cwd: string, onStderr: (data: string) => void): ClaudeOptions {
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
    env: isolatedEnv(process.env),
    stderr: onStderr,
  };
}

const KEPT = new Set(["CLAUDE_CONFIG_DIR"]);

/** Every CLAUDE*, ANTHROPIC* and AI_AGENT* variable is removed, so the login is used and a stray key never is. */
export function isolatedEnv(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (KEPT.has(key.toUpperCase()) || !/^(CLAUDE|ANTHROPIC|AI_AGENT|ENABLE_CLAUDEAI)/i.test(key)) env[key] = value;
  }
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return env;
}

/** The model sees cwd and CLAUDE.md discovery walks up from it, so it is an empty directory of our own. */
export function emptyCwd(): string {
  const dir = path.join(os.tmpdir(), "hpt-claude-cwd");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
