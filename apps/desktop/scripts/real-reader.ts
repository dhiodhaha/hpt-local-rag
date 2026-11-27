import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import type { Answer } from "@hpt/server/client";

/**
 * Opens one stored conversation of the real app and photographs its Sumber panel and the reader on the passages you name. Nothing is
 * asked, so no model is called. The pictures hold corpus text: write them outside the repo.
 *
 * Usage: node scripts/real-reader.ts <outDir> --conversation <file.jsonl> --passage <id> [--passage <id> ...] [--tag <prefix>] [--motion]
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "../..");
const args = process.argv.slice(2);
const values = (name: string) => args.flatMap((arg, index) => (arg === name ? [args[index + 1] ?? ""] : []));
const outDir = path.resolve(args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--")) ?? path.join(repoRoot, "data/real-reader"));
const file = values("--conversation")[0];
const passages = values("--passage");
const tag = values("--tag")[0] ?? "real";
if (file === undefined || passages.length === 0) throw new Error("--conversation and at least one --passage are required");
fs.mkdirSync(outDir, { recursive: true });

const firstQuestion = (JSON.parse(fs.readFileSync(path.join(repoRoot, "data/conversations", file), "utf8").trim().split("\n")[0] ?? "{}") as { question: string; answer?: Answer }).question;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [appDir],
  env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-real-reader-")) } as Record<string, string>,
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
await page.emulateMedia({ reducedMotion: args.includes("--motion") ? "no-preference" : "reduce" });
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
const shot = (name: string) => page.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });

await page.locator(".rw-side .rr .body").first().waitFor({ timeout: 20_000 });
const rows = page.locator(".rw-side .rr");
const count = await rows.count();
let opened = false;
for (let at = 0; at < count && !opened; at += 1) {
  const title = (await rows.nth(at).locator(".rr-t").textContent()) ?? "";
  if (normalize(firstQuestion).startsWith(normalize(title).replace(/…$/, "").slice(0, 30))) {
    await rows.nth(at).locator(".body").click();
    opened = true;
  }
}
if (!opened) throw new Error("the conversation is not in the sidebar");
await page.locator("[data-turn]").last().waitFor();
await page.waitForTimeout(800);

const button = page.locator(".cv-src");
if ((await button.count()) > 0) await button.click();
await page.locator("[data-panel='sources']").waitFor();
await page.waitForTimeout(500);
await shot("panel-closed");

for (const [at, id] of passages.entries()) {
  const card = page.locator(`[data-source='${id}']`).first();
  await card.locator(".scard-head").click();
  await page.locator(`[data-source='${id}'][data-open='true']`).waitFor();
  await page.waitForTimeout(450);
  await shot(`panel-open-${at + 1}`);
  await card.getByRole("button", { name: "Buka sumber" }).click();
  await page.locator("[data-reader][data-load='ready']").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(700);
  await shot(`reader-${at + 1}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}
await app.close();
