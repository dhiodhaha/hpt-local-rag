import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import { citedOf, noteIdOf, type Answer, type PassageId } from "@hpt/server/client";
import { openIndex } from "../../server/src/features/search/index.ts";

/**
 * Opens a stored conversation of the real app on the real index and checks that a citation and a Sumber card each open the right note
 * at the right passage. No question is asked, so no model is called. Writes screenshots and evidence.json to <outDir>, which holds
 * corpus text, so point it outside the repo.
 *
 * Usage: node scripts/reader-run.ts <outDir>
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "../..");
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "data/reader-run"));
fs.mkdirSync(outDir, { recursive: true });

type StoredLine = { question: string; answer: Answer };
const conversationsDir = path.join(repoRoot, "data/conversations");
const index = openIndex({ path: path.join(repoRoot, "data/hpt.sqlite") });
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const candidates = fs
  .readdirSync(conversationsDir)
  .filter((name) => name.endsWith(".jsonl"))
  .sort()
  .reverse()
  .flatMap((name) => {
    const turns = fs.readFileSync(path.join(conversationsDir, name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as StoredLine);
    const last = turns.at(-1);
    if (last === undefined || last.answer.type !== "answer") return [];
    const cited = citedOf(last.answer);
    const notes = new Set(cited.map((id) => noteIdOf(id)));
    const sizes = [...notes].map((note) => index.passagesOfNote(note).length);
    return cited.length >= 2 ? [{ name, firstQuestion: turns[0]?.question ?? "", answer: last.answer, cited, longest: Math.max(...sizes) }] : [];
  });
const chosen = candidates.sort((a, b) => b.longest - a.longest)[0];
if (chosen === undefined) throw new Error("no stored conversation with an answer that cites two passages");

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-reader-real-"));
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [appDir],
  env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: userData } as Record<string, string>,
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });

const evidence: Record<string, unknown> = { conversationFile: chosen.name, citedCount: chosen.cited.length, notesCited: new Set(chosen.cited.map((id) => noteIdOf(id))).size };
const shot = (name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

async function openChosenConversation(): Promise<void> {
  await page.locator(".rw-side .rr .body").first().waitFor({ timeout: 20_000 });
  const rows = page.locator(".rw-side .rr");
  const count = await rows.count();
  for (let at = 0; at < count; at += 1) {
    const title = (await rows.nth(at).locator(".rr-t").textContent()) ?? "";
    if (normalize(chosen?.firstQuestion ?? "").startsWith(normalize(title).replace(/…$/, "").slice(0, 30))) {
      await rows.nth(at).locator(".body").click();
      await page.locator("[data-turn]").last().waitFor();
      await page.waitForTimeout(800);
      return;
    }
  }
  throw new Error("the chosen conversation is not in the sidebar");
}

async function checkOpened(label: string, expected: PassageId): Promise<void> {
  const note = noteIdOf(expected);
  await page.locator(`[data-reader='${note}'][data-load='ready']`).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const passage = index.getPassages([expected]).get(expected);
  const section = page.locator(`[data-passage='${expected}']`);
  const inView = await section.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const view = element.closest(".rd-scroll")?.getBoundingClientRect();
    return view === undefined ? false : box.top >= view.top && box.top < view.bottom;
  });
  const shown = normalize((await section.locator(".rd-p, .rd-ar").allTextContents()).join(" "));
  const wanted = normalize(passage?.text ?? "");
  evidence[`${label}.noteMatches`] = true;
  evidence[`${label}.passageIsCurrent`] = (await section.getAttribute("data-current")) === "true";
  evidence[`${label}.passageInView`] = inView;
  evidence[`${label}.passageHasCitedLabel`] = (await section.locator(".cp[data-tone='cited']").count()) === 1;
  evidence[`${label}.textMatchesIndex`] = wanted !== "" && shown.replace(/\s/g, "") === wanted.replace(/\s/g, "");
  evidence[`${label}.passagesRendered`] = await page.locator("[data-passage]").count();
  evidence[`${label}.passagesInNote`] = index.passagesOfNote(note).length;
}

await openChosenConversation();
await shot("1-conversation-opened");

const latest = page.locator("[data-turn]").last();
const firstMark = latest.locator("[data-card='answer'] .c").first();
const markNumber = Number((await firstMark.textContent()) ?? "0");
const viaMark = chosen.cited[markNumber - 1] as PassageId;
await firstMark.click();
await checkOpened("fromCitation", viaMark);
await shot("2-from-citation");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
evidence["escapeClosed"] = (await page.locator("[data-reader]").count()) === 0;
evidence["focusReturnedToCitation"] = await page.evaluate(() => document.activeElement?.className === "c" && document.activeElement.closest("[data-card='answer']") !== null);

const otherCard = chosen.cited.find((id) => id !== viaMark) as PassageId;
await page.locator(`[data-source='${otherCard}']`).first().click();
await checkOpened("fromCard", otherCard);
await shot("3-from-card");
await page.getByRole("button", { name: "Kembali ke jawaban" }).click();
await page.waitForTimeout(400);
evidence["backClosed"] = (await page.locator("[data-reader]").count()) === 0;
evidence["focusReturnedToCard"] = await page.evaluate((id) => document.activeElement?.getAttribute("data-source") === id, otherCard);

await app.close();
index.close();
fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
