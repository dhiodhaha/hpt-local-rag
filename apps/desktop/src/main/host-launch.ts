import { execFileSync, type ForkOptions } from "node:child_process";
import path from "node:path";

/**
 * Where and how the engine process starts. The only file that knows, so packaging changes this file and nothing else.
 *
 * Dev: the engine runs under the system Node (24 or newer, the repo's `engines`) straight from source, exactly as `pnpm hpt`
 * does. better-sqlite3 and the other native modules therefore load under the same ABI as the CLI, the tests and the evals, and
 * Electron's ABI never enters the loop. Packaged: decided in the packaging phase, behind this function (a pinned Node of the
 * same major, or Electron as Node with rebuilt modules).
 */
export type HostLaunch = {
  readonly execPath: string;
  readonly entry: string;
  readonly args: readonly string[];
  readonly options: Pick<ForkOptions, "cwd" | "env" | "windowsHide" | "stdio" | "execArgv" | "serialization">;
};

export type ScenarioRun = { readonly name: string; readonly delayMs: number; readonly cut: string | null };

export type LaunchInput = {
  readonly repoRoot: string;
  readonly scenario: ScenarioRun | null;
  readonly env: NodeJS.ProcessEnv;
};

const MIN_NODE_MAJOR = 24;

export class HostLaunchError extends Error {}

/** `--scenario <name> [--delay-ms <n>] [--cut <point>]` on the app's command line, or HPT_SCENARIO. Anything else is not ours. */
export function scenarioFrom(argv: readonly string[], env: NodeJS.ProcessEnv): ScenarioRun | null {
  const value = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const name = value("--scenario") ?? env.HPT_SCENARIO ?? null;
  if (name === null || name === "") return null;
  const delay = Number(value("--delay-ms") ?? env.HPT_SCENARIO_DELAY_MS ?? 60);
  return { name, delayMs: Number.isFinite(delay) ? delay : 60, cut: value("--cut") ?? env.HPT_SCENARIO_CUT ?? null };
}

function nodeMajor(execPath: string): number {
  try {
    return Number(execFileSync(execPath, ["-p", "process.versions.node.split('.')[0]"], { encoding: "utf8", timeout: 10_000 }).trim());
  } catch {
    throw new HostLaunchError(`Node tidak ditemukan di ${execPath}. Pasang Node ${MIN_NODE_MAJOR} atau lebih baru.`);
  }
}

/** The node that runs `pnpm` (npm_node_execpath) is the one the repo's scripts use, so it is the first choice. */
export function hostLaunch(input: LaunchInput): HostLaunch {
  const execPath = input.env.HPT_NODE ?? input.env.npm_node_execpath ?? "node";
  const major = nodeMajor(execPath);
  if (major < MIN_NODE_MAJOR) throw new HostLaunchError(`Node ${major} terlalu lama. Mesin jawaban memerlukan Node ${MIN_NODE_MAJOR} atau lebih baru.`);
  const scenario = input.scenario === null ? [] : ["--scenario", input.scenario.name, "--delay-ms", String(input.scenario.delayMs), ...(input.scenario.cut === null ? [] : ["--cut", input.scenario.cut])];
  return {
    execPath,
    entry: path.join(input.repoRoot, "apps", "server", "src", "cli.ts"),
    args: ["host", ...scenario],
    options: { cwd: input.repoRoot, env: input.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: [], serialization: "json" },
  };
}
