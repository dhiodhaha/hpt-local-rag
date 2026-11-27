import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Does any setting the Agent SDK reaches turn thinking off for a model? One call per variant. It reads the request body the
 * Claude process sent (OTEL_LOG_RAW_API_BODIES) and the thinking blocks and tokens that came back, so it checks the wire and not
 * the option that was set. Raw bodies go to data/eval/thinking-probe/ and stay local.
 *
 *   node scripts/probe-thinking.mjs [variant ...]      default: every variant, on claude-sonnet-5-5 at low effort
 *   PROBE_MODEL=claude-opus-5-5 node scripts/probe-thinking.mjs baseline
 */
if ((process.env.ANTHROPIC_API_KEY ?? "").trim() === "") {
  console.error("This probe calls a model, and evals never run on the Claude plan login (D34). Set ANTHROPIC_API_KEY to a Claude Console key and run it again.");
  process.exit(1);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { query } = await import(pathToFileURL(path.join(root, "apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs")).href);

const MODEL = process.env.PROBE_MODEL ?? "claude-sonnet-5-5";
const EFFORT = "low";
const PROMPT =
  "Seorang musafir menempuh perjalanan 95 km, berangkat setelah Zuhur dan tiba menjelang Maghrib. Tentukan shalat apa saja yang boleh dijamak dan diqashar, berapa total rakaat yang ia kerjakan hari itu, dan jelaskan alasannya langkah demi langkah. Periksa jawabanmu sebelum menulis.";

const VARIANTS = {
  baseline: { options: {}, env: {} },
  "thinking-disabled": { options: { thinking: { type: "disabled" } }, env: {} },
  "env-max-thinking-0": { options: {}, env: { MAX_THINKING_TOKENS: "0" } },
  "settings-always-thinking-false": { options: { settings: { alwaysThinkingEnabled: false } }, env: {} },
  "env-disable-thinking": { options: {}, env: { CLAUDE_CODE_DISABLE_THINKING: "1" } },
  "max-thinking-tokens-0": { options: { maxThinkingTokens: 0 }, env: {} },
  "thinking-enabled-1024": { options: { thinking: { type: "enabled", budgetTokens: 1024 } }, env: {} },
  "env-disable-adaptive": { options: {}, env: { CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1" } },
  "all-off": { options: { thinking: { type: "disabled" }, maxThinkingTokens: 0, settings: { alwaysThinkingEnabled: false } }, env: { MAX_THINKING_TOKENS: "0", CLAUDE_CODE_DISABLE_THINKING: "1" } },
};

const cwd = path.join(os.tmpdir(), "hpt-claude-cwd");
fs.mkdirSync(cwd, { recursive: true });
const outDir = path.join(root, "data", "eval", "thinking-probe");
fs.mkdirSync(outDir, { recursive: true });

function isolatedEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|AI_AGENT|ENABLE_CLAUDEAI)/i.test(key)) env[key] = value;
  const workspace = (process.env.ANTHROPIC_WORKSPACE_ID ?? "").trim();
  const headers = workspace === "" ? {} : { ANTHROPIC_CUSTOM_HEADERS: `anthropic-workspace-id: ${workspace}` };
  return { ...env, ANTHROPIC_API_KEY: apiKey, ...headers, ENABLE_CLAUDEAI_MCP_SERVERS: "false", ...extra };
}

async function probe(name) {
  const variant = VARIANTS[name];
  if (variant === undefined) throw new Error(`unknown variant ${name}. Choose from ${Object.keys(VARIANTS).join(", ")}.`);
  const rawDir = path.join(outDir, `raw-${name}`);
  fs.rmSync(rawDir, { recursive: true, force: true });
  const started = performance.now();
  const options = {
    model: MODEL,
    effort: EFFORT,
    systemPrompt: "Jawab ringkas dalam bahasa Indonesia.",
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    permissionMode: "dontAsk",
    includePartialMessages: true,
    persistSession: false,
    cwd,
    ...variant.options,
    env: isolatedEnv({ ...variant.env, OTEL_LOG_RAW_API_BODIES: `file:${rawDir}` }),
  };
  const seen = { blocks: [], firstTextMs: null, result: null, error: null };
  try {
    for await (const message of query({ prompt: PROMPT, options })) {
      const event = message.type === "stream_event" ? message.event : null;
      if (event?.type === "content_block_start") seen.blocks.push(event.content_block?.type);
      if (event?.type === "content_block_delta" && event.delta.type === "text_delta") seen.firstTextMs ??= Math.round(performance.now() - started);
      if (message.type === "result") seen.result = message;
    }
  } catch (cause) {
    seen.error = String(cause?.message ?? cause).slice(0, 300);
  }
  const wire = fs.existsSync(rawDir)
    ? fs
        .readdirSync(rawDir)
        .filter((file) => file.endsWith(".request.json"))
        .map((file) => JSON.parse(fs.readFileSync(path.join(rawDir, file), "utf8")))
        .map((request) => request.body ?? request)
        .filter((body) => body.model === MODEL)
        .map((body) => ({ thinking: body.thinking ?? null, effort: body.output_config?.effort ?? null }))
    : [];
  const usage = seen.result?.usage ?? {};
  return {
    variant: name,
    wireThinking: wire[0]?.thinking ?? null,
    wireEffort: wire[0]?.effort ?? null,
    thinkingBlock: seen.blocks.includes("thinking"),
    thinkingTokens: usage.thinkingTokens ?? seen.result?.modelUsage?.[MODEL]?.thinkingTokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    firstTextMs: seen.firstTextMs,
    isError: seen.result?.is_error ?? null,
    threw: seen.error,
  };
}

const names = process.argv.slice(2);
for (const name of names.length === 0 ? Object.keys(VARIANTS) : names) {
  const row = await probe(name);
  fs.appendFileSync(path.join(outDir, "summary.jsonl"), `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
}
