import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import { SCENARIOS } from "@hpt/server/testing";

/**
 * `pnpm motion [outDir] [--scenario <name>] [--delay-ms <n>]`. The only script that does not ask the page for reduced motion.
 * Scenarios only: nothing here spends usage.
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
const outDir = path.resolve(args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")) ?? path.join(appDir, "../../data/motion"));
const scenario = flag("--scenario", "settled") as keyof typeof SCENARIOS;
const delay = flag("--delay-ms", "70");
fs.mkdirSync(outDir, { recursive: true });

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [appDir, "--scenario", scenario, "--delay-ms", delay],
  env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-motion-")) } as Record<string, string>,
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });

const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
await page.locator("textarea").fill(SCENARIOS[scenario].question);
const started = Date.now();
await page.keyboard.press("Enter");

type Sample = { ms: number; summaryChars: number; wordsFading: number; running: string[]; done: boolean };
const samples: Sample[] = [];
const names = new Set<string>();
for (let frame = 0; Date.now() - started < 9000; frame += 1) {
  const sample = await page.evaluate((): Omit<Sample, "ms"> => {
    const turn = document.querySelector("[data-turn]");
    const summary = turn?.querySelector("[data-card='answer'] > p");
    const running = document.getAnimations().flatMap((animation) => {
      const name = "animationName" in animation ? String((animation as CSSAnimation).animationName) : `transition:${(animation as CSSTransition).transitionProperty}`;
      return animation.playState === "running" ? [name] : [];
    });
    return { summaryChars: summary?.textContent?.length ?? 0, wordsFading: turn?.querySelectorAll(".m-word").length ?? 0, running: [...new Set(running)], done: turn?.getAttribute("data-run") === "done" };
  });
  for (const name of sample.running) names.add(name);
  samples.push({ ms: Date.now() - started, ...sample });
  await page.screenshot({ path: path.join(outDir, `frame-${String(frame).padStart(3, "0")}.png`) });
  if (sample.done && samples.filter((entry) => entry.done).length > 12) break;
  await page.waitForTimeout(60);
}

const growing = samples.filter((entry) => entry.summaryChars > 0 && entry.summaryChars < Math.max(...samples.map((s) => s.summaryChars)));
const rate = growing.length < 2 ? null : ((growing.at(-1)!.summaryChars - growing[0]!.summaryChars) / (growing.at(-1)!.ms - growing[0]!.ms)) * 1000;
const report = { scenario, reducedMotionReported: reduced, animationsSeen: [...names].sort(), summaryCharsPerSecond: rate === null ? null : Math.round(rate), samples };
fs.writeFileSync(path.join(outDir, "motion.json"), JSON.stringify(report, null, 2));
await app.close();
console.log(JSON.stringify({ ...report, samples: report.samples.length }, null, 2));
