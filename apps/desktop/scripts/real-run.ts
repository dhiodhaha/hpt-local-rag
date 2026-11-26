import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

/**
 * Spends real usage (three model calls) and writes answer text to the output folder, so point it outside the repo.
 *
 * Usage: node scripts/real-run.ts <outDir>
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(appDir, "../../data/real-run"));
fs.mkdirSync(outDir, { recursive: true });
const conversationsDir = path.resolve(appDir, "../../data/conversations");

const QUESTIONS = {
  first: "Bolehkah shalat dengan pakaian yang terkena sedikit darah?",
  followUp: "Bagaimana kalau darahnya banyak?",
  afterRestart: "Lalu apakah wudhu saya ikut batal?",
};

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-real-"));
const evidence: Record<string, unknown> = {};

async function launch(video: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appDir],
    env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: userData } as Record<string, string>,
    recordVideo: { dir: path.join(outDir, video), size: { width: 1440, height: 900 } },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Memeriksa koneksi"), undefined, { timeout: 20_000 });
  return { app, page };
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

async function ask(page: Page, label: string, question: string): Promise<number> {
  const before = await page.locator("[data-turn]").count();
  await page.locator("textarea").fill(question);
  const sent = Date.now();
  await page.keyboard.press("Enter");
  await page.locator("[data-turn]").nth(before).waitFor();
  await page.waitForFunction((index) => document.querySelectorAll("[data-turn]")[index]?.getAttribute("data-run") === "done", before, { timeout: 120_000 });
  const ms = Date.now() - sent;
  evidence[`${label}.doneMs`] = ms;
  await page.waitForTimeout(700);
  await shot(page, label);
  return ms;
}

const headlineOf = (page: Page, index: number) => page.evaluate((at) => document.querySelectorAll("[data-turn]")[at]?.querySelector("h2")?.textContent ?? null, index);

const storedFiles = () => new Set(fs.existsSync(conversationsDir) ? fs.readdirSync(conversationsDir).filter((name) => name.endsWith(".jsonl")) : []);
const filesBefore = storedFiles();

const first = await launch("video-1");
evidence["runtimeReducedMotion"] = await first.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
await shot(first.page, "0-home");
await ask(first.page, "1-first-answer", QUESTIONS.first);
const firstHeadline = await headlineOf(first.page, 0);
await ask(first.page, "2-follow-up", QUESTIONS.followUp);
const followUpHeadline = await headlineOf(first.page, 1);
await first.page.locator(".rw-side .rr .body").first().waitFor();
evidence["sidebarRowsBeforeRestart"] = await first.page.locator(".rw-side .rr").count();
await shot(first.page, "3-before-restart");
await first.app.close();

const created = [...storedFiles()].filter((name) => !filesBefore.has(name));
evidence["newConversationFiles"] = created.length;
const stored = created[0] === undefined ? [] : fs.readFileSync(path.join(conversationsDir, created[0]), "utf8").trim().split("\n");
evidence["storedTurns"] = stored.length;

const second = await launch("video-2");
await second.page.locator(".rw-side .rr .body").first().waitFor({ timeout: 20_000 });
evidence["sidebarRowsAfterRestart"] = await second.page.locator(".rw-side .rr").count();
const newestTitle = await second.page.locator(".rw-side .rr .rr-t").first().textContent();
evidence["newestRowIsTheQuestion"] = newestTitle?.startsWith(QUESTIONS.first.slice(0, 30)) ?? false;
await shot(second.page, "4-after-restart-list");
await second.page.locator(".rw-side .rr .body").first().click();
await second.page.locator("[data-turn]").nth(1).waitFor();
await second.page.waitForTimeout(900);
evidence["reopenedTurns"] = await second.page.locator("[data-turn]").count();
evidence["reopenedHeadlineMatchesFirstRun"] = (await headlineOf(second.page, 1)) === followUpHeadline;
evidence["firstTurnIsCollapsedFromStore"] = (await second.page.locator("[data-turn]").first().getAttribute("data-view")) === "earlier";
evidence["firstHeadlineCharsSeen"] = firstHeadline?.length ?? 0;
await shot(second.page, "5-reopened");
await ask(second.page, "6-continued-after-restart", QUESTIONS.afterRestart);
evidence["turnsAfterContinuing"] = await second.page.locator("[data-turn]").count();
await second.page.getByRole("button", { name: "Semua percakapan" }).click();
await second.page.locator(".al").waitFor();
await second.page.waitForTimeout(400);
await shot(second.page, "7-all-conversations");
await second.app.close();

fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
