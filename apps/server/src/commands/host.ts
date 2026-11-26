import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { compose } from "../compose.ts";
import { claudeModelOptions, createHost, type FromHost, type HostDeps } from "../features/host/index.ts";
import { probeClaude } from "../features/providers/index.ts";
import { IndexUnavailableError } from "../features/search/index.ts";

export const HOST_USAGE = `Usage:
  hpt host [--scenario <name> [--delay-ms <n>] [--cut <point>]]
  Started by the desktop app, which forks it and talks to it over IPC. It needs that parent and cannot be run on its own.`;

async function realDeps(): Promise<HostDeps> {
  const models = claudeModelOptions();
  const probe = () => probeClaude();
  try {
    const composed = await compose();
    composed.engine.warm();
    return { backend: { engine: composed.engine, conversations: composed.conversations, index: composed.index }, models, probe, close: composed.close };
  } catch (cause) {
    if (cause instanceof IndexUnavailableError) return { backend: { unavailable: cause.message }, models, probe, close: async () => {} };
    throw cause;
  }
}

async function scenarioDeps(name: string, delayMs: number, cut: string | undefined): Promise<HostDeps> {
  const { isScenarioName, scenarioDeps: build, SCENARIO_NAMES, SCENARIOS, seedConversations } = await import("../testing/index.ts");
  if (!isScenarioName(name)) throw new Error(`unknown scenario "${name}". Scenarios: ${SCENARIO_NAMES.join(", ")}.`);
  const conversationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-scenario-"));
  if ((SCENARIOS[name] as { readonly seed?: boolean }).seed === true) await seedConversations(conversationsDir);
  return build(name, { conversationsDir, delayMs, cut });
}

/**
 * The parent going away, however it died, closes the host, so the warm Claude process never outlives the app. SIGTERM does the
 * same, and a second signal exits at once.
 */
export async function hostCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { scenario: { type: "string" }, "delay-ms": { type: "string" }, cut: { type: "string" } } });
  const parent = process.send?.bind(process);
  if (parent === undefined) {
    console.error(HOST_USAGE);
    return 2;
  }
  const deps = values.scenario === undefined ? await realDeps() : await scenarioDeps(values.scenario, Number(values["delay-ms"] ?? 0), values.cut);
  const host = createHost(deps);
  const send = (frame: FromHost) => {
    if (process.connected) parent(frame);
  };
  return new Promise<number>((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) process.exit(1);
      closing = true;
      void host.close().finally(() => resolve(0));
    };
    process.on("message", (frame) => host.handle(frame, send));
    process.on("disconnect", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    host.start(send);
  });
}
