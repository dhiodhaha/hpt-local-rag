import fs from "node:fs";
import os from "node:os";
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
  readonly idle?: boolean;
  readonly after?: (page: Page) => Promise<void>;
  /** The Doop frame this state is drawn from, for the review notes. */
  readonly frame: string;
  /** Keep the operating system's motion setting instead of forcing reduced motion. */
  readonly motion?: boolean;
};

const SHOTS: readonly Shot[] = [
  { file: "00-idle", scenario: "settled", idle: true, frame: "A5 idle (desktop home)" },
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
  { file: "17-model-menu", scenario: "settled", idle: true, after: openModelMenu, frame: "D6.16 pemilih model" },
  { file: "18-dalil-open", scenario: "settled", after: openFirstRow, frame: "Dalil / Catatan dibuka" },
  { file: "19-riwayat-list", scenario: "riwayat", idle: true, after: openNewestConversation, frame: "D6.2 Lanjutan, dibuka dari riwayat" },
  { file: "20-riwayat-row-menu", scenario: "riwayat", idle: true, after: openRowMenu, frame: "D6.5 aksi baris" },
  { file: "21-riwayat-delete-confirm", scenario: "riwayat", idle: true, after: openDeleteConfirm, frame: "D6.5b konfirmasi hapus" },
  { file: "22-riwayat-rename", scenario: "riwayat", idle: true, after: startRename, frame: "D6.5 ganti nama" },
  { file: "23-riwayat-search-question", scenario: "riwayat", idle: true, after: (page) => search(page, "kompos"), frame: "D6.4 mencari di sidebar" },
  { file: "24-riwayat-search-answer", scenario: "riwayat", idle: true, after: (page) => search(page, "dilarang"), frame: "D6.4 hasil di jawaban tersimpan" },
  { file: "25-riwayat-empty", scenario: "settled", idle: true, frame: "D6.6 pertama kali" },
  { file: "26-riwayat-all", scenario: "riwayat", idle: true, after: openAll, frame: "D6.7 semua percakapan" },
  { file: "27-riwayat-all-search", scenario: "riwayat", idle: true, after: allSearch, frame: "D6.7 dengan pencarian dan filter" },
  { file: "28-reader-from-citation", scenario: "reader", after: (page) => openFromCitation(page, 1), frame: "D6.8 dibuka dari tanda kutip 1" },
  { file: "29-reader-from-card", scenario: "reader", after: (page) => openFromCard(page), frame: "D6.8 dibuka dari kartu Sumber" },
  { file: "30-reader-deep", scenario: "reader", after: (page) => openFromCard(page, 2), frame: "D6.8 paragraf jauh di dalam putusan panjang" },
  { file: "31-reader-arabic", scenario: "reader", after: (page) => openFromCitation(page, 2), frame: "D6.8 teks Arab satu baris dan di dalam kalimat" },
  { file: "32-reader-sumber-tab", scenario: "reader", after: openSumberTab, frame: "D6.8 tab Sumber" },
  { file: "33-reader-toc-jump", scenario: "reader", after: jumpToLastBagian, frame: "D6.8 pindah bagian dari Daftar isi" },
  { file: "34-reader-revised", scenario: "reader-revised", after: (page) => openFromCard(page), frame: "D6.9 putusan direvisi" },
  { file: "35-reader-revised-passages", scenario: "reader-revised", after: openRevisedPassages, frame: "D6.9 paragraf yang diubah" },
  { file: "36-reader-newer-note", scenario: "reader-revised", after: openNewerNote, frame: "D6.9 Buka putusan terbaru" },
  { file: "37-reader-entering", scenario: "reader", after: enteringWithMotion, motion: true, frame: "gerak masuk, 90 ms setelah dibuka" },
  { file: "39-sources-card-hover", scenario: "settled", after: hoverSecondCard, frame: "kartu Sumber yang kini membuka pembaca: sorotan di bawah kursor" },
  { file: "38-reader-closed-focus", scenario: "reader", after: closeWithEscape, frame: "Esc menutup, fokus kembali ke tanda kutip" },
];

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function openFromCitation(page: Page, number: number): Promise<void> {
  await page.locator("[data-card='answer'] .c", { hasText: new RegExp(`^${number}$`) }).first().click();
  await page.locator("[data-reader][data-load='ready']").waitFor();
  await page.waitForTimeout(500);
}

async function openFromCard(page: Page, index = 0): Promise<void> {
  await page.locator("[data-source]").nth(index).click();
  await page.locator("[data-reader][data-load='ready']").waitFor();
  await page.waitForTimeout(500);
}

async function openSumberTab(page: Page): Promise<void> {
  await openFromCitation(page, 1);
  await page.getByRole("tab", { name: /Sumber/ }).click();
  await page.waitForTimeout(300);
}

async function jumpToLastBagian(page: Page): Promise<void> {
  await openFromCitation(page, 1);
  await page.locator(".toc-row").last().click();
  await page.waitForTimeout(400);
}

async function openRevisedPassages(page: Page): Promise<void> {
  await openFromCard(page);
  await page.locator(".toc-row").last().click();
  await page.waitForTimeout(400);
}

async function openNewerNote(page: Page): Promise<void> {
  await openFromCard(page);
  await page.getByRole("button", { name: "Buka putusan terbaru" }).click();
  await page.locator("[data-reader='putusan/uji-istihadah-baru'][data-load='ready']").waitFor();
  await page.waitForTimeout(400);
}

async function enteringWithMotion(page: Page): Promise<void> {
  await page.locator("[data-card='answer'] .c").first().click();
  await page.locator(".rd").waitFor();
  await page.evaluate(() =>
    document.querySelector(".rd")?.getAnimations({ subtree: true }).forEach((animation) => {
      animation.pause();
      animation.currentTime = 90;
    }),
  );
}

async function hoverSecondCard(page: Page): Promise<void> {
  await page.locator("[data-source]").nth(1).hover();
  await page.waitForTimeout(250);
}

async function closeWithEscape(page: Page): Promise<void> {
  await openFromCitation(page, 2);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

async function openModelMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Opus/ }).click();
  await page.getByRole("menu").waitFor();
}

async function openFirstRow(page: Page): Promise<void> {
  await page.locator("[data-row]").first().click();
}

async function openNewestConversation(page: Page): Promise<void> {
  await page.locator(".rw-side .rr .body").first().click();
  await page.locator("[data-turn]").first().waitFor();
  await page.waitForTimeout(600);
}

async function openRowMenu(page: Page): Promise<void> {
  await openNewestConversation(page);
  const row = page.locator(".rw-side .rr").nth(1);
  await row.hover();
  await row.locator(".more").click();
  await page.getByRole("menu").waitFor();
  await page.waitForTimeout(300);
}

async function openDeleteConfirm(page: Page): Promise<void> {
  await openRowMenu(page);
  await page.getByRole("menuitem", { name: "Hapus" }).click();
  await page.getByRole("alertdialog").waitFor();
  await page.waitForTimeout(300);
}

async function startRename(page: Page): Promise<void> {
  await openRowMenu(page);
  await page.getByRole("menuitem", { name: "Ganti nama" }).click();
  const field = page.locator(".rr-edit");
  await field.waitFor();
  await field.fill("Kompos dari daun, catatan kebun");
}

async function search(page: Page, query: string): Promise<void> {
  await page.getByRole("button", { name: "Cari percakapan" }).click();
  await page.getByRole("searchbox").or(page.locator(".sf-input")).first().fill(query);
  await page.locator(".rw-count").first().waitFor();
  await page.waitForTimeout(300);
}

async function openAll(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Semua percakapan" }).click();
  await page.locator(".al").waitFor();
  await page.waitForTimeout(300);
}

async function allSearch(page: Page): Promise<void> {
  await openAll(page);
  await page.locator(".al .sf-input").fill("kompos");
  await page.locator(".al-line").waitFor();
  await page.getByRole("button", { name: /^November/ }).click();
  await page.waitForTimeout(300);
}

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;

async function withApp<T>(args: string[], reduced: boolean, run: (app: ElectronApplication, page: Page) => Promise<T>): Promise<T> {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [appDir, ...args],
    env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-shots-")) } as Record<string, string>,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
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
  await page.waitForFunction(() => document.querySelector(".caret") === null, undefined, { timeout: 30_000 });
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
    await withApp(launchArgs, shot.motion !== true, async (_app, page) => {
      if (shot.scenario !== null && shot.idle !== true) {
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
