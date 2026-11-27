import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron, type Page } from "playwright";
import { SCENARIOS, type ScenarioName } from "@hpt/server/testing";

/**
 * `pnpm --filter @hpt/desktop exec node scripts/contact-sheet.ts <outDir> [--scene <name>] [--reduced]`
 *
 * Freezes every running animation and transition under one element, steps their clock in fixed steps and photographs each step, then
 * lays the photographs out as one sheet, so a motion can be judged frame by frame. Scenarios only: nothing here spends usage.
 */
type Scene = {
  readonly scenario: ScenarioName;
  readonly steps: readonly number[];
  /** Photographed region, in window pixels. */
  readonly clip: { x: number; y: number; width: number; height: number };
  readonly columns: number;
  /** Where the animations to step live. */
  readonly root: string;
  /** Gets the page ready, and returns the function that starts the motion to photograph. */
  readonly prepare: (page: Page) => Promise<() => Promise<void>>;
};

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function openPanel(page: Page): Promise<void> {
  const button = page.locator(".cv-src");
  if ((await button.count()) > 0) await button.click();
  await page.locator("[data-panel='sources']").waitFor();
  await page.waitForTimeout(700);
}

const click = (selector: string) => (page: Page) => page.evaluate((target) => (document.querySelector(target) as HTMLElement).click(), selector);

const SCENES: Record<string, Scene> = {
  "reader-open": {
    scenario: "reader-tj",
    steps: [0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440],
    clip: { x: 160, y: 735, width: 700, height: 130 },
    columns: 2,
    root: ".rd",
    prepare: async (page) => {
      await page.locator("[data-card='answer'] .an-p .c", { hasText: /^1$/ }).first().click();
      await page.locator("[data-source][data-open='true']").waitFor();
      await page.waitForTimeout(700);
      return async () => {
        await click("[data-source][data-open='true'] .scard-acts button")(page);
      };
    },
  },
  "row-open": {
    scenario: "settled",
    steps: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220],
    clip: { x: 1024, y: 60, width: 408, height: 340 },
    columns: 4,
    root: ".sx-body",
    prepare: async (page) => {
      await openPanel(page);
      return async () => {
        await click("[data-source] + [data-source] .scard-head")(page);
      };
    },
  },
  "row-close": {
    scenario: "settled",
    steps: [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132],
    clip: { x: 1024, y: 60, width: 408, height: 340 },
    columns: 4,
    root: ".sx-body",
    prepare: async (page) => {
      await openPanel(page);
      await click("[data-source] + [data-source] .scard-head")(page);
      await page.waitForTimeout(700);
      return async () => {
        await click("[data-source] + [data-source] .scard-head")(page);
      };
    },
  },
};

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = path.resolve(args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")) ?? os.tmpdir());
const sceneName = flag("--scene") ?? "row-open";
const scene = SCENES[sceneName];
if (scene === undefined) throw new Error(`no scene ${sceneName}. Scenes: ${Object.keys(SCENES).join(", ")}`);
const reduced = args.includes("--reduced");
fs.mkdirSync(outDir, { recursive: true });

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [appDir, "--scenario", scene.scenario, "--delay-ms", "0"],
  env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-sheet-")) } as Record<string, string>,
});
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
  await page.locator("textarea").fill(SCENARIOS[scene.scenario].question);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-turn]")?.getAttribute("data-run") === "done", undefined, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector(".caret") === null);
  await page.waitForTimeout(500);
  const start = await scene.prepare(page);
  await start();
  const found = await page.evaluate(async (root) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = (document.querySelector(root) ?? document).getAnimations({ subtree: true });
    (window as unknown as { __frozen: Animation[] }).__frozen = animations;
    for (const animation of animations) animation.pause();
    return animations.map((animation) => ("animationName" in animation ? `animation:${(animation as CSSAnimation).animationName}` : `transition:${(animation as CSSTransition).transitionProperty}`));
  }, scene.root);

  const frames: string[] = [];
  for (const step of scene.steps) {
    await page.evaluate((time) => {
      for (const animation of (window as unknown as { __frozen: Animation[] }).__frozen) animation.currentTime = time;
    }, step);
    await page.waitForTimeout(60);
    frames.push((await page.screenshot({ clip: scene.clip })).toString("base64"));
  }
  const rows = Math.ceil(scene.steps.length / scene.columns);
  const width = scene.columns * (scene.clip.width + 6) + 6;
  const height = rows * (scene.clip.height + 6) + 6;
  const windowOpened = app.waitForEvent("window");
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = new BrowserWindow({ x: 0, y: 0, width: size.width, height: size.height, useContentSize: true, show: true, frame: false });
    void win.loadURL("about:blank");
  }, { width, height });
  const sheet = await windowOpened;
  await sheet.waitForLoadState();
  const cells = frames.map((data, index) => `<div style="position:relative"><img src="data:image/png;base64,${data}" style="display:block;width:${scene.clip.width}px;height:${scene.clip.height}px;outline:1px solid #ccc"><span style="position:absolute;left:6px;top:4px;font:600 12px sans-serif;background:#000;color:#fff;padding:1px 6px;border-radius:9px">${scene.steps[index]} ms</span></div>`).join("");
  await sheet.setContent(`<body style="margin:0;background:#fff"><div style="display:grid;grid-template-columns:repeat(${scene.columns}, ${scene.clip.width}px);gap:6px;padding:6px">${cells}</div></body>`);
  await sheet.waitForTimeout(500);
  const target = path.join(outDir, `${sceneName}${reduced ? "-reduced" : ""}-sheet.png`);
  await sheet.screenshot({ path: target });
  console.log(`wrote ${target}\nanimations: ${found.join(", ")}`);
} finally {
  await app.close();
}
