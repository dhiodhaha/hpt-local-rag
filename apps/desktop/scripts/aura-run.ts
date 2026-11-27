import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { SCENARIOS } from "@hpt/server/testing";

/**
 * `pnpm aura [outDir] [--scenario <name>] [--delay-ms <n>] [--only pictures|timing|typing|story] [--rounds <n>] [--repeats <n>] [--dpr <n>] [--size <w>x<h>]`. Runs the built app on a scripted scenario (nothing
 * here spends usage) and checks the light behind the conversation pane in a real window.
 *
 *   pictures  idle, compose, send, think, streaming and done, one PNG of the pane each, plus a webm of the window.
 *   story     the owner's rules end to end: home, typing, the first ask rising and fading, the answer, a follow-up with no light, a conversation
 *             opened from Riwayat, and Pertanyaan baru fading the light back in. One window picture per step, and whether the aura loop runs.
 *   typing    the first keystroke and typing on the home screen: requestAnimationFrame gaps from before the first key to the end of the line.
 *   timing    requestAnimationFrame gaps and main-thread time for the whole ask, canvas against the reduced-motion fade as a baseline,
 *             then whether the loop sleeps once the light is gone and while the window is hidden.
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
const outDir = path.resolve(args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")) ?? path.join(appDir, "../../data/aura"));
const scenario = flag("--scenario", "settled") as keyof typeof SCENARIOS;
const delay = flag("--delay-ms", "70");
const only = flag("--only", "all");
const rounds = Number(flag("--rounds", "1"));
const repeats = Number(flag("--repeats", "2"));
const dpr = flag("--dpr", "");
const [width = 1440, height = 900] = flag("--size", "1440x900").split("x").map(Number);
fs.mkdirSync(outDir, { recursive: true });

const { ELECTRON_RENDERER_URL: _dev, ...baseEnv } = process.env;

/** The window is shown without taking focus, so keys the person types elsewhere never land in it. */
async function launch(extra: { video?: boolean }): Promise<{ app: ElectronApplication; page: Page }> {
  const keepAwake = ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
  const scale = dpr === "" ? [] : [`--force-device-scale-factor=${dpr}`];
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appDir, "--scenario", scenario, "--delay-ms", delay, ...keepAwake, ...scale],
    env: { ...baseEnv, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-aura-")) } as Record<string, string>,
    ...(extra.video ? { recordVideo: { dir: outDir, size: { width, height } } } : {}),
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setContentSize(size.width, size.height);
    win?.showInactive();
  }, { width, height });
  await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
  return { app, page };
}

const question = SCENARIOS[scenario].question;
async function auraState(page: Page, state: string, timeout = 30_000): Promise<void> {
  try {
    await page.waitForFunction((want) => document.querySelector(".aura")?.getAttribute("data-state") === want, state, { timeout });
  } catch (error) {
    const seen = await page.evaluate(() => ({ state: document.querySelector(".aura")?.getAttribute("data-state"), draft: document.querySelector("textarea")?.value, focused: document.hasFocus(), hidden: document.hidden }));
    throw new Error(`waiting for aura state ${state}: ${JSON.stringify(seen)}`, { cause: error });
  }
}
const shot = (page: Page, name: string) => page.locator("main").screenshot({ path: path.join(outDir, `${name}.png`) });
/** The rectangle the aura measured (`data-box`) next to the question box's own, both in pane pixels. They should agree to a pixel once the box has settled. */
const boxCheck = (page: Page) =>
  page.evaluate(() => {
    const aura = document.querySelector(".aura") as HTMLElement;
    const pane = aura.getBoundingClientRect();
    const rect = document.querySelector(".cv-box")?.getBoundingClientRect();
    return { measured: aura.dataset.box, dom: rect === undefined ? null : [rect.left - pane.left, rect.top - pane.top, rect.width, rect.height].map((value) => Math.round(value * 100) / 100).join(","), pane: [pane.width, pane.height].join("x") };
  });
const boxChecks: Record<string, unknown> = {};
const windowShot = (page: Page, name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

async function pictures(): Promise<void> {
  const { app, page } = await launch({ video: true });
  await page.waitForTimeout(3500);
  await shot(page, "01-idle");
  boxChecks.homeIdle = await boxCheck(page);
  await windowShot(page, "01-home-idle-window");
  await page.locator("textarea").focus();
  await page.keyboard.type("a");
  await auraState(page, "compose");
  await page.waitForTimeout(3000);
  await windowShot(page, "02-home-typing-window");
  boxChecks.homeTyping = await boxCheck(page);
  await page.locator("textarea").fill(question);
  await page.waitForTimeout(500);
  await shot(page, "02-compose");
  await page.keyboard.press("Enter");
  await auraState(page, "think");
  await page.waitForTimeout(600);
  await shot(page, "03-think-early");
  await page.waitForTimeout(1500);
  await shot(page, "04-think");
  await page.waitForFunction(() => (document.querySelector("[data-turn] [data-card='answer'] .an-p")?.textContent?.length ?? 0) > 20, undefined, { timeout: 30_000 });
  await shot(page, "05-streaming");
  await auraState(page, "done");
  await page.waitForTimeout(400);
  await shot(page, "06-done-start");
  await page.waitForTimeout(3500);
  await shot(page, "07-done");
  await page.locator("textarea").fill("Bagaimana kalau");
  await page.waitForTimeout(2500);
  await shot(page, "08-follow-up-no-glow");
  await windowShot(page, "08-follow-up-no-glow-window");
  boxChecks.conversationFollowUp = await boxCheck(page);
  await page.locator("textarea").fill("");
  await page.waitForTimeout(500);
  fs.writeFileSync(path.join(outDir, "box-check.json"), JSON.stringify(boxChecks, null, 1));
  const video = page.video();
  await app.close();
  if (video !== null) fs.copyFileSync(await video.path(), path.join(outDir, "aura-run.webm"));
}

type Metrics = Record<string, number>;
type Gaps = { frames: number; p50: number; p95: number; p99: number; max: number; late: number; missed: number };

const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** A gap belongs to the phase of the frame that ended it. Late is more than 1.5 display intervals, and missed counts the frames it skipped. */
function gapsOf(gaps: readonly number[], interval: number): Gaps {
  const sorted = [...gaps].sort((a, b) => a - b);
  const late = gaps.filter((gap) => gap > interval * 1.5);
  return {
    frames: gaps.length,
    p50: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    p99: round(quantile(sorted, 0.99)),
    max: round(sorted.at(-1) ?? Number.NaN),
    late: late.length,
    missed: late.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / interval) - 1), 0),
  };
}

/** Frames the loop runs while the page waits: the page's own requestAnimationFrame calls, which are the aura's and nobody else's once the page is still. */
const rafCalls = (page: Page, ms: number) =>
  page.evaluate(async (wait) => {
    const counter = (window as unknown as { __raf: { calls: number } }).__raf;
    const before = counter.calls;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return counter.calls - before;
  }, ms);

async function story(reduced: boolean): Promise<void> {
  const tag = reduced ? "reduced" : "motion";
  const dir = path.join(outDir, tag);
  fs.mkdirSync(dir, { recursive: true });
  const { app, page } = await launch({});
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction((mode) => document.querySelector(".aura")?.getAttribute("data-mode") === mode, reduced ? "fade" : "canvas");
  await page.evaluate(() => {
    const counter = { calls: 0 };
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      counter.calls += 1;
      return original(callback);
    };
    (window as unknown as { __raf: typeof counter }).__raf = counter;
  });
  const frames: Record<string, number> = {};
  const step = async (name: string, wait: number) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
  };
  const state = () => page.evaluate(() => document.querySelector(".aura")?.getAttribute("data-state"));
  const states: Record<string, string | null | undefined> = {};

  await step("s01-home-idle", 3500);
  frames.homeIdlePer1_5s = await rafCalls(page, 1500);
  await page.locator("textarea").focus();
  await page.keyboard.type("Apakah kompos boleh", { delay: 30 });
  await step("s02-home-typing", 2800);
  await page.locator("textarea").fill(question);
  await page.keyboard.press("Enter");
  await auraState(page, "think");
  await step("s03-send-plus-0.4s", 400);
  await step("s04-rising-plus-1.2s", 800);
  await page.waitForFunction(() => (document.querySelector("[data-turn] [data-card='answer'] .an-p")?.textContent?.length ?? 0) > 20, undefined, { timeout: 30_000 });
  await step("s05-answer-streaming", 0);
  await auraState(page, "done");
  await step("s06-done-plus-0.4s", 400);
  await step("s07-done-plus-1.2s", 800);
  await step("s08-done-plus-4s", 2800);
  frames.afterFirstAnswerPer1_5s = await rafCalls(page, 1500);
  await page.locator("textarea").focus();
  await page.keyboard.type("Bagaimana kalau kompos belum matang", { delay: 30 });
  await step("s09-follow-up-typing", 2500);
  states.followUpTyping = await state();
  frames.followUpTypingPer1_5s = await rafCalls(page, 1500);
  await page.locator("textarea").fill("");
  await page.keyboard.press("Control+k");
  await step("s10-new-question-plus-0.3s", 300);
  await step("s11-new-question-plus-0.9s", 600);
  await step("s12-new-question-plus-3s", 2100);
  states.afterNewQuestion = await state();
  await page.locator("textarea").focus();
  await page.keyboard.type("Apakah", { delay: 30 });
  await page.locator("textarea").fill(question);
  await page.keyboard.press("Enter");
  await auraState(page, "done");
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator("textarea").fill("");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(3000);
  await page.locator(".rw-side .rr").first().click();
  await page.locator("[data-turn]").first().waitFor({ timeout: 10_000 });
  await step("s13-opened-from-riwayat-plus-0.5s", 500);
  await step("s14-opened-from-riwayat-plus-3s", 2500);
  states.openedFromRiwayat = await state();
  frames.openedFromRiwayatPer1_5s = await rafCalls(page, 1500);
  fs.writeFileSync(path.join(dir, "story.json"), JSON.stringify({ reduced, states, frames }, null, 1));
  console.log(JSON.stringify({ tag, states, frames }));
  await app.close();
}

/** Typing on the home screen, the send, the answer, then a follow-up. One probe records every frame time and the moments the script acts, so each gap is filed under what was happening when it ended. */
async function typing(variant: "canvas" | "fade") {
  const { app, page } = await launch({});
  if (variant === "fade") await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction((mode) => document.querySelector(".aura")?.getAttribute("data-mode") === mode, variant);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const probe = { times: [] as number[], marks: {} as Record<string, number>, on: true };
    const loop = (time: number) => {
      if (!probe.on) return;
      probe.times.push(time);
      requestAnimationFrame(loop);
    };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    requestAnimationFrame(loop);
  });
  const mark = (name: string) => page.evaluate((label) => { (window as unknown as { __probe: { marks: Record<string, number> } }).__probe.marks[label] = performance.now(); }, name);

  await page.waitForTimeout(2000);
  await mark("homeFirstKey");
  await page.locator("textarea").focus();
  await page.keyboard.type(question, { delay: 70 });
  await mark("homeTypingEnd");
  await page.waitForTimeout(1500);
  await mark("send");
  await page.keyboard.press("Enter");
  await auraState(page, "think");
  await auraState(page, "done");
  await mark("done");
  await page.waitForTimeout(4000);
  await mark("followFirstKey");
  await page.keyboard.type("Bagaimana kalau kompos belum matang?", { delay: 70 });
  await mark("followTypingEnd");
  await page.waitForTimeout(2500);
  await mark("end");

  const probe = await page.evaluate(() => {
    const state = (window as unknown as { __probe: { times: number[]; marks: Record<string, number>; on: boolean } }).__probe;
    state.on = false;
    return { times: state.times, marks: state.marks };
  });
  await app.close();
  const m = probe.marks as Record<string, number>;
  const gaps = probe.times.slice(1).map((time, index) => ({ end: time, gap: time - probe.times[index]! }));
  const interval = quantile(gaps.map((entry) => entry.gap).sort((a, b) => a - b), 0.5);
  const between = (from: number, to: number) => gapsOf(gaps.filter((entry) => entry.end >= from && entry.end < to).map((entry) => entry.gap), interval);
  const first = (key: string) => gaps.filter((entry) => entry.end >= m[key]! && entry.end < m[key]! + 500).reduce((worst, entry) => Math.max(worst, entry.gap), 0);
  return {
    variant,
    displayIntervalMs: round(interval),
    idleBeforeTyping: between(0, m.homeFirstKey!),
    homeFirstKey500ms: { ...between(m.homeFirstKey!, m.homeFirstKey! + 500), worstGapMs: round(first("homeFirstKey")) },
    homeTyping: between(m.homeFirstKey! + 500, m.homeTypingEnd!),
    thinkAndStreaming: between(m.send!, m.done!),
    followFirstKey500ms: { ...between(m.followFirstKey!, m.followFirstKey! + 500), worstGapMs: round(first("followFirstKey")) },
    followTyping: between(m.followFirstKey! + 500, m.followTypingEnd!),
  };
}

async function timing(variant: "canvas" | "fade") {
  const { app, page } = await launch({});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  if (variant === "fade") await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction((mode) => document.querySelector(".aura")?.getAttribute("data-mode") === mode, variant);
  const metrics = async (): Promise<Metrics> => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]));
  const busy = (from: Metrics, to: Metrics, wallS: number) => ({
    taskPct: round((((to.TaskDuration ?? 0) - (from.TaskDuration ?? 0)) / wallS) * 100, 1),
    scriptPct: round((((to.ScriptDuration ?? 0) - (from.ScriptDuration ?? 0)) / wallS) * 100, 1),
    layoutPct: round((((to.LayoutDuration ?? 0) - (from.LayoutDuration ?? 0)) / wallS) * 100, 1),
    stylePct: round((((to.RecalcStyleDuration ?? 0) - (from.RecalcStyleDuration ?? 0)) / wallS) * 100, 1),
  });

  const machine = await app.evaluate(({ app: electronApp, screen }) => ({ gpu: electronApp.getGPUFeatureStatus(), displayHz: screen.getPrimaryDisplay().displayFrequency, scale: screen.getPrimaryDisplay().scaleFactor }));
  await page.evaluate(() => {
    const counter = { calls: 0 };
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      counter.calls += 1;
      return original(callback);
    };
    (window as unknown as { __raf: typeof counter }).__raf = counter;
  });
  const calls = (ms: number) =>
    page.evaluate(async (wait) => {
      const counter = (window as unknown as { __raf: { calls: number } }).__raf;
      const before = counter.calls;
      await new Promise((resolve) => setTimeout(resolve, wait));
      return { calls: counter.calls - before, hidden: document.hidden };
    }, ms);

  await page.waitForTimeout(2500);
  const idleFrom = await metrics();
  const idleCalls = await calls(3000);
  const idleBusy = busy(idleFrom, await metrics(), 3);

  const windowOp = (op: "minimize" | "restore" | "hide" | "show") => app.evaluate(({ BrowserWindow }, which) => BrowserWindow.getAllWindows()[0]?.[which](), op);
  await windowOp("minimize");
  await page.waitForTimeout(500);
  const minimized = await calls(1500);
  await windowOp("restore");
  await page.waitForTimeout(500);
  const restored = await calls(1500);

  const forceHidden = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await forceHidden(true);
  await page.waitForTimeout(300);
  const forcedHidden = await calls(1500);
  await forceHidden(false);
  await page.waitForTimeout(300);
  const forcedShown = await calls(1500);

  await page.evaluate(() => {
    const aura = document.querySelector(".aura");
    const probe = { times: [] as number[], phases: [] as number[], on: true };
    let chars = 0;
    let frame = 0;
    let sent = false;
    const loop = (time: number) => {
      if (!probe.on) return;
      frame += 1;
      const think = aura?.getAttribute("data-state") === "think";
      sent ||= think;
      if (frame % 6 === 0) chars = [...document.querySelectorAll("[data-turn]")].at(-1)?.querySelector("[data-card='answer'] .an-p")?.textContent?.length ?? 0;
      probe.times.push(time);
      let phase = 3;
      if (!sent) phase = 0;
      else if (think) phase = chars === 0 ? 1 : 2;
      probe.phases.push(phase);
      requestAnimationFrame(loop);
    };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    requestAnimationFrame(loop);
  });

  let askBusy = { taskPct: 0, scriptPct: 0, layoutPct: 0, stylePct: 0 };
  let afterDone = { calls: -1, hidden: false };
  for (let round = 0; round < rounds; round += 1) {
    await page.locator("textarea").fill(round === 0 ? question : "Bagaimana kalau kompos belum matang?");
    await page.waitForTimeout(1500);
    const from = await metrics();
    const started = Date.now();
    await page.keyboard.press("Enter");
    await auraState(page, "think");
    await auraState(page, "done");
    if (round === 0) askBusy = busy(from, await metrics(), (Date.now() - started) / 1000);
    await page.waitForTimeout(4500);
  }

  const probe = await page.evaluate(() => {
    const state = (window as unknown as { __probe: { times: number[]; phases: number[]; on: boolean } }).__probe;
    state.on = false;
    return { times: state.times, phases: state.phases };
  });
  const gaps = probe.times.slice(1).map((time, index) => ({ gap: time - probe.times[index]!, phase: probe.phases[index + 1]! }));
  const interval = quantile(gaps.map((entry) => entry.gap).sort((a, b) => a - b), 0.5);
  const phase = (...wanted: number[]) => gapsOf(gaps.filter((entry) => wanted.includes(entry.phase)).map((entry) => entry.gap), interval);

  afterDone = await calls(2500);
  await page.locator("textarea").fill("Bagaimana kalau");
  await page.waitForTimeout(300);
  const typing = await calls(1000);
  await app.close();

  return {
    variant,
    machine,
    rounds,
    displayIntervalMs: round(interval),
    frameGaps: { beforeSend: phase(0), thinkingBeforeText: phase(1), streaming: phase(2), thinkingAndStreaming: phase(1, 2), afterAnswer: phase(3) },
    mainThreadBusy: { idleHome: idleBusy, firstAsk: askBusy },
    rafCalls: {
      idleHomePer3s: idleCalls,
      minimizedPer1_5s: minimized,
      restoredPer1_5s: restored,
      forcedHiddenPer1_5s: forcedHidden,
      forcedShownPer1_5s: forcedShown,
      afterAnswerSettledPer2_5s: afterDone,
      typingAfterAnswerPer1s: typing,
    },
  };
}

if (only === "all" || only === "pictures") {
  await pictures();
  console.log(`pictures and aura-run.webm in ${outDir}`);
}
if (only === "story") {
  await story(false);
  await story(true);
}
if (only === "typing") {
  const results = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) for (const variant of ["canvas", "fade"] as const) results.push(await typing(variant));
  fs.writeFileSync(path.join(outDir, "typing.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
if (only === "all" || only === "timing") {
  const results = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) for (const variant of ["canvas", "fade"] as const) results.push(await timing(variant));
  fs.writeFileSync(path.join(outDir, "timing.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
