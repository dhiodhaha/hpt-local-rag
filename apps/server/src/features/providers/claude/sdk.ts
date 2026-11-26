import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ToolHost, ToolSpec } from "../types.ts";

/**
 * The slice of @anthropic-ai/claude-agent-sdk this provider uses, as our own structural type. Messages stay loosely typed on
 * purpose: `messages.ts` is the one place that reads them, defensively. A fake of this shape drives the tests with no process.
 */
export type ClaudeMessage = { readonly type: string } & Readonly<Record<string, unknown>>;

export type ClaudeQuery = AsyncGenerator<ClaudeMessage, void> & { close(): void };

export type ClaudeWarm = { query(prompt: string): ClaudeQuery; close(): void };

export type ClaudeOptions = Readonly<Record<string, unknown>>;

/**
 * A warm process starts before any ask exists, so its in-process tools cannot close over an ask's ToolHost.
 * They call whichever host is bound here. One process serves one run, so the binding has one writer at a time.
 */
export type ToolBinding = { host: ToolHost | null };

export type ClaudeSdk = {
  query(args: { readonly prompt: string; readonly options: ClaudeOptions }): ClaudeQuery;
  startup(args: { readonly options: ClaudeOptions; readonly initializeTimeoutMs: number }): Promise<ClaudeWarm>;
  mcpServer(specs: readonly ToolSpec[], binding: ToolBinding): unknown;
};

export const MCP_SERVER_NAME = "tarjih";

/** Dynamic import, so nothing else in the app pays for the SDK and tests of every other module never load it. */
export async function loadClaudeSdk(): Promise<ClaudeSdk> {
  const [sdk, { z }] = await Promise.all([import("@anthropic-ai/claude-agent-sdk"), import("zod")]);
  return {
    query: ({ prompt, options }) => sdk.query({ prompt, options: options as Options }) as unknown as ClaudeQuery,
    startup: async ({ options, initializeTimeoutMs }) => {
      const warm = await sdk.startup({ options: options as Options, initializeTimeoutMs });
      return { query: (prompt) => warm.query(prompt) as unknown as ClaudeQuery, close: () => warm.close() };
    },
    mcpServer: (specs, binding) =>
      sdk.createSdkMcpServer({
        name: MCP_SERVER_NAME,
        version: "1.0.0",
        tools: specs.map((spec) => {
          const shape = Object.fromEntries(Object.entries(spec.params).map(([name, param]) => [name, z.string().describe(param.description)]));
          return sdk.tool(
            spec.name,
            spec.description,
            shape,
            async (args: Record<string, string>) => {
              const host = binding.host;
              if (host === null) return { content: [{ type: "text" as const, text: "This tool is not available right now." }], isError: true };
              const reply = await host.invoke(spec.name, args);
              return { content: [{ type: "text" as const, text: reply.text }], isError: reply.isError };
            },
            { annotations: { readOnlyHint: true }, alwaysLoad: true },
          );
        }),
      }),
  };
}
