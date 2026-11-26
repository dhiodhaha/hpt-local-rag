import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { SCENARIOS, type ScenarioName } from "@hpt/server/testing";

/**
 * `pnpm shots`: one PNG per scenario state, from the built app, for design review (often on a phone). Each shot launches the real
 * app with `--scenario <name> [--cut <point>]`, so the picture is drawn by the same host, supervisor, client, store and components
 * the person uses. Nothing is mocked in the renderer.
 *
 * Usage: pnpm shots [outDir] [--only <file prefix>]. Default outDir is data/shots (gitignored).
 */
type Shot = {
  readonly file: string;
  readonly scenario: ScenarioName | null;
  readonly cut?: string;
  /** Asked after the first question has finished, in the same conversation. */
  readonly followUp?: string;
  readonly after?: (page: Page) => Promise<void>;
  /** The Doop frame this state is drawn from, for the review notes. */
  readonly frame: string;
};

const SHOTS: readonly Shot[] = [
  { file: "00-idle", scenario: null, frame: "A5 idle (desktop home)" },
  { file: "01-working", scenario: "settled", cut: "thinking", frame: "C5 Berpikir" },
  { file: "02-d7-1-verifying", scenario: "settled", cut: "verifying", frame: "D7.1" },
  { file: "03-d7-2-settled", scenario: "settled", frame: "D7.2" },
  { file: "04-d7-3-rechecking", scenario: "restart", cut: "rechecking", frame: "D7.3" },
  { file: "05-d7-3-after-retry", scenario: "restart", frame: "D7.2 after a retry" },
  { file: "06-d7-4-unverified", scenario: "unverified-first", frame: "D7.4" },
  { file: "07-fallback", scenario: "fallback", frame: "D7.2 with the fallback notice" },
  { file: "08-out-of-scope", scenario: "out-of-scope", frame: "6c Di luar cakupan" },
  { file: "09-declined", scenario: "declined", frame: "6d Ditolak" },
  { file: "10-insufficient", scenario: "insufficient", frame: "6b Rujukan belum cukup" },
  { file: "11-clarify", scenario: "clarify", frame: "6a Klarifikasi" },
  { file: "12-not-signed-in", scenario: "not-signed-in", frame: "D6.14 Galat tidak terhubung" },
  { file: "13-limit", scenario: "limit-no-fallback", frame: "D6.15 Galat batas pemakaian" },
  { file: "14-blocked", scenario: "blocked", frame: "StateNotice (blocked)" },
  { file: "15-withheld", scenario: "withheld", frame: "StateNotice (withheld, D10d)" },
  { file: "16-follow-up", scenario: "follow-up", followUp: "Bagaimana kalau kompos belum matang?", frame: "D6.2 Lanjutan" },
  { file: "17-model-menu", scenario: null, after: openModelMenu, frame: "D6.16 pemilih model" },
  { file: "18-dalil-open", scenario: "settled", after: openFirstRow, frame: "Dalil / Catatan dibuka" },
];

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function openModelMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Opus/ }).click();
  await page.getByRole("menu").waitFor();
}

async function openFirstRow(page: Page): Promise<void> {
  await page.locator("[data-row]").first().click();
}

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;

async function withApp<T>(args: string[], run: (app: ElectronApplication, page: Page) => Promise<T>): Promise<T> {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appDir, ...args],
    env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1" } as Record<string, string>,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("textarea").waitFor();
    await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
    return await run(app, page);
  } finally {
    await app.close();
  }
}

async function ask(page: Page, text: string, cut: boolean): Promise<void> {
  const before = await page.locator("[data-turn]").count();
  await page.locator("textarea").fill(text);
  await page.keyboard.press("Enter");
  await page.locator("[data-turn]").nth(before).waitFor();
  if (cut) return;
  await page.waitForFunction((index) => document.querySelectorAll("[data-turn]")[index]?.getAttribute("data-run") === "done", before, { timeout: 30_000 });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const outDir = path.resolve(args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--only") ?? path.join(appDir, "../../data/shots"));
  fs.mkdirSync(outDir, { recursive: true });
  const notes: string[] = [];
  for (const shot of SHOTS) {
    if (only !== null && !shot.file.startsWith(only ?? "")) continue;
    const launchArgs = shot.scenario === null ? [] : ["--scenario", shot.scenario, "--delay-ms", "0", ...(shot.cut === undefined ? [] : ["--cut", shot.cut])];
    const target = path.join(outDir, `${shot.file}.png`);
    await withApp(launchArgs, async (_app, page) => {
      if (shot.scenario !== null) {
        await ask(page, SCENARIOS[shot.scenario].question, shot.cut !== undefined);
        if (shot.followUp !== undefined) await ask(page, shot.followUp, false);
      }
      await shot.after?.(page);
      await page.waitForTimeout(shot.cut === undefined ? 400 : 250);
      await page.screenshot({ path: target });
    });
    notes.push(`${shot.file}.png  ${shot.frame}`);
    console.log(`wrote ${target}`);
  }
  fs.writeFileSync(path.join(outDir, "index.txt"), `${notes.join("\n")}\n`);
}

await main();
