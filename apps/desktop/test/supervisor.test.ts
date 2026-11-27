import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { FromHost, ToHost } from "@hpt/server/client";
import { HostLaunchError, hostLaunch, scenarioFrom, type HostLaunch } from "../src/main/host-launch.ts";
import { startSupervisor, type Window } from "../src/main/supervisor.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarioLaunch = (delayMs: number): HostLaunch =>
  hostLaunch({ repoRoot, scenario: { name: "settled", delayMs, cut: null }, env: { ...process.env, HPT_NODE: process.execPath } });

const crashing = (): HostLaunch => ({ ...scenarioLaunch(0), entry: path.join(here, "fixtures", "crash.mjs"), args: [] });

function fakeWindow() {
  const frames: FromHost[] = [];
  const listeners: Record<"reload" | "closed", (() => void)[]> = { reload: [], closed: [] };
  const window: Window = { send: (frame) => frames.push(frame), on: (event, listener) => listeners[event].push(listener) };
  return { window, frames, fire: (event: "reload" | "closed") => listeners[event].forEach((listener) => listener()) };
}

async function until(check: () => boolean, label: string, ms = 15_000): Promise<void> {
  for (let waited = 0; waited < ms; waited += 20) {
    if (check()) return;
    await wait(20);
  }
  assert.fail(`timed out waiting for ${label}`);
}

const ask = (id: string): ToHost => ({ kind: "call", id, method: "ask", params: { conversation: null, question: "Apakah kompos boleh?", scope: null, choice: null, origin: { via: "enter", trusted: true, focused: true, turn: 1 } } });
const kinds = (frames: readonly FromHost[]) => frames.map((frame) => frame.kind);

describe("the supervisor with a real host process", () => {
  it("relays hello, a call and its stream, and replays ready to a window that joins late", async () => {
    const supervisor = startSupervisor({ launch: () => scenarioLaunch(0), log: () => {} });
    try {
      const first = fakeWindow();
      const send = supervisor.connect(first.window);
      await until(() => supervisor.state() === "ready", "ready");
      send({ kind: "hello" });
      send(ask("one"));
      await until(() => first.frames.some((frame) => frame.kind === "result"), "the result");
      assert.deepEqual(first.frames.filter((frame) => frame.kind === "event").at(-1), { kind: "event", id: "one", event: { kind: "finished", outcome: { kind: "delivered" } } });
      const late = fakeWindow();
      supervisor.connect(late.window)({ kind: "hello" });
      assert.equal(late.frames[0]?.kind, "ready");
      await until(() => late.frames.some((frame) => frame.kind === "connection"), "the replayed connection");
    } finally {
      await supervisor.close();
    }
  });

  it("sends a reply only to the window that made the call", async () => {
    const supervisor = startSupervisor({ launch: () => scenarioLaunch(0), log: () => {} });
    try {
      const a = fakeWindow();
      const b = fakeWindow();
      const sendA = supervisor.connect(a.window);
      supervisor.connect(b.window);
      await until(() => supervisor.state() === "ready", "ready");
      sendA(ask("mine"));
      await until(() => a.frames.some((frame) => frame.kind === "result"), "the result");
      assert.equal(b.frames.some((frame) => frame.kind === "event" || frame.kind === "result"), false);
    } finally {
      await supervisor.close();
    }
  });

  it("cancels what a reloaded window owns, so the host is free for the next ask", async () => {
    const supervisor = startSupervisor({ launch: () => scenarioLaunch(100), log: () => {} });
    try {
      const page = fakeWindow();
      const send = supervisor.connect(page.window);
      await until(() => supervisor.state() === "ready", "ready");
      send(ask("slow"));
      await wait(400);
      page.fire("reload");
      const started = Date.now();
      send(ask("next"));
      await until(() => page.frames.some((frame) => frame.kind === "result" && frame.id === "next"), "the next result", 20_000);
      assert.ok(Date.now() - started < 2000, "the first ask was still running");
      assert.equal(page.frames.some((frame) => frame.kind === "event" && frame.id === "slow"), true, "the first ask had streamed");
    } finally {
      await supervisor.close();
    }
  });

  it("says down when the host dies and recovers with a new process", async () => {
    let launches = 0;
    const supervisor = startSupervisor({ launch: () => (launches++ === 0 ? crashing() : scenarioLaunch(0)), log: () => {}, restartDelayMs: 50 });
    try {
      const page = fakeWindow();
      supervisor.connect(page.window);
      await until(() => page.frames.some((frame) => frame.kind === "down"), "down");
      await until(() => supervisor.state() === "ready", "recovery");
      assert.ok(kinds(page.frames).indexOf("down") < kinds(page.frames).indexOf("ready"));
    } finally {
      await supervisor.close();
    }
  });

  it("answers a call made while down with an error, and gives up after 3 restarts in a minute", async () => {
    let launches = 0;
    const supervisor = startSupervisor({
      launch: () => {
        launches += 1;
        return crashing();
      },
      log: () => {},
      restartDelayMs: 20,
    });
    try {
      const page = fakeWindow();
      const send = supervisor.connect(page.window);
      await until(() => launches === 4 && supervisor.state() === "down", "the fourth crash");
      await wait(200);
      assert.equal(launches, 4);
      send(ask("late"));
      assert.deepEqual(page.frames.at(-1), { kind: "error", id: "late", error: { code: "host_down", message: "Mesin jawaban tidak berjalan." } });
    } finally {
      await supervisor.close();
    }
  });

  it("restart() replaces the process and close() leaves none behind", async () => {
    const supervisor = startSupervisor({ launch: () => scenarioLaunch(0), log: () => {} });
    const page = fakeWindow();
    supervisor.connect(page.window);
    await until(() => supervisor.state() === "ready", "ready");
    await supervisor.restart("source changed");
    assert.ok(page.frames.some((frame) => frame.kind === "down" && frame.reason === "source changed"));
    await until(() => supervisor.state() === "ready", "ready again");
    await supervisor.close();
    await supervisor.close();
  });
});

describe("launching the host", () => {
  it("reads the scenario from the command line or the environment, and nothing else", () => {
    assert.equal(scenarioFrom(["electron", "."], {}), null);
    assert.deepEqual(scenarioFrom(["x", "--scenario", "restart", "--cut", "rechecking", "--delay-ms", "0"], {}), { name: "restart", delayMs: 0, cut: "rechecking" });
    assert.deepEqual(scenarioFrom([], { HPT_SCENARIO: "fallback" }), { name: "fallback", delayMs: 60, cut: null });
  });

  it("builds the node command for the repo's source and refuses a missing node", () => {
    const launch = hostLaunch({ repoRoot, scenario: { name: "restart", delayMs: 60, cut: null }, env: { HPT_NODE: process.execPath } });
    assert.equal(launch.execPath, process.execPath);
    assert.deepEqual(launch.args, ["host", "--scenario", "restart", "--delay-ms", "60"]);
    assert.ok(launch.entry.endsWith(path.join("apps", "server", "src", "cli.ts")));
    assert.throws(() => hostLaunch({ repoRoot, scenario: null, env: { HPT_NODE: path.join(repoRoot, "no-such-node") } }), HostLaunchError);
  });
});
