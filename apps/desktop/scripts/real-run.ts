import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";

/**
 * Drives the app against the real engine and a real Claude login: two questions (one answerable, one out of scope) and one follow-up,
 * a screenshot at each stage and the time each stage appeared. It spends usage, a few model calls per run, and writes answer text
 * to the output folder, so point it outside the repo.
 *
 * Usage: node scripts/real-run.ts <outDir>
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(appDir, "../../data/real-run"));
fs.mkdirSync(outDir, { recursive: true });

const QUESTIONS = {
  answerable: "Apakah darah yang keluar dari hidung membatalkan wudhu?",
  outOfScope: "Siapa yang memenangkan Piala Dunia sepak bola tahun 2022?",
  followUp: "Bagaimana kalau darahnya hanya sedikit dan sudah berhenti?",
};

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [appDir], env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1" } as Record<string, string> });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));

const timings: Record<string, number> = {};
const shot = async (name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

type Probe = { panel: boolean; verifying: boolean; headline: boolean; done: boolean; view: string | null; text: string };

const probe = (index: number) =>
  page.evaluate((at): Probe => {
    const turn = document.querySelectorAll("[data-turn]")[at];
    return {
      panel: document.querySelector("[data-panel='sources']") !== null,
      verifying: turn?.querySelector("[data-headline='verifying']") != null,
      headline: turn?.querySelector("h2") != null,
      done: turn?.getAttribute("data-run") === "done",
      view: turn?.getAttribute("data-view") ?? null,
      text: turn?.querySelector("h2, [data-card]")?.textContent?.slice(0, 120) ?? "",
    };
  }, index);

async function ask(label: string, question: string, index: number): Promise<void> {
  await page.locator("textarea").fill(question);
  const sent = Date.now();
  await page.keyboard.press("Enter");
  const seen = new Set<string>();
  const mark = (key: string, name: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    timings[`${label}.${name}`] = Date.now() - sent;
  };
  for (;;) {
    const now = await probe(index);
    if (now.panel) {
      if (!seen.has("panel")) {
        mark("panel", "sourcesPanel");
        await shot(`${label}-1-sources`);
      }
    }
    if (now.verifying && !seen.has("verifying")) {
      mark("verifying", "headlineVerifying");
      await shot(`${label}-2-verifying`);
    }
    if (now.headline && !now.verifying && !seen.has("settled") && seen.has("verifying")) mark("settled", "headlineSettled");
    if (now.view !== null && now.view !== "working") mark("view", `firstView(${now.view})`);
    if (now.done) {
      mark("done", "done");
      break;
    }
    if (Date.now() - sent > 120_000) throw new Error(`${label} did not finish in 120 s`);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  await shot(`${label}-3-done`);
  const final = await probe(index);
  console.log(`${label}: view=${final.view}`);
}

await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
await page.waitForFunction(() => !document.body.innerText.includes("Memeriksa koneksi"), undefined, { timeout: 20_000 });
await shot("0-home");
await ask("answerable", QUESTIONS.answerable, 0);
await ask("followup", QUESTIONS.followUp, 1);
await page.getByRole("button", { name: "Pertanyaan baru" }).click();
await ask("outofscope", QUESTIONS.outOfScope, 0);
fs.writeFileSync(path.join(outDir, "timings.json"), JSON.stringify(timings, null, 2));
console.log(JSON.stringify(timings, null, 2));
await app.close();
