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
  { file: "03b-d9-6-settled-top", scenario: "settled", after: scrollToTop, frame: "D9.6 jawaban dari atas" },
  { file: "04-d7-3-rechecking", scenario: "restart", cut: "rechecking", frame: "D7.3" },
  { file: "05-d7-3-after-retry", scenario: "restart", frame: "D7.2 after a retry" },
  { file: "06-d7-4-unverified", scenario: "unverified-first", after: scrollToTop, frame: "D7.4" },
  { file: "07-fallback", scenario: "fallback", after: scrollToTop, frame: "D7.2 with the fallback notice" },
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
  { file: "18-many-dalil", scenario: "many-dalil", after: scrollToTop, frame: "D9.14 semua dalil ditulis di jawaban, tanpa lipatan" },
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
  { file: "30-reader-deep", scenario: "reader", after: (page) => openFromCard(page, 2), frame: "D6.8 bagian jauh di dalam putusan panjang" },
  { file: "31-reader-arabic", scenario: "reader", after: (page) => openFromCitation(page, 2), frame: "D6.8 teks Arab satu baris dan di dalam kalimat" },
  { file: "32-reader-sumber-tab", scenario: "reader", after: openSumberTab, frame: "D6.8 tab Sumber" },
  { file: "33-reader-toc-jump", scenario: "reader", after: jumpToLastBagian, frame: "D6.8 pindah bagian dari Daftar isi" },
  { file: "34-reader-revised", scenario: "reader-revised", after: (page) => openFromCard(page), frame: "D6.9 putusan direvisi" },
  { file: "35-reader-revised-passages", scenario: "reader-revised", after: openRevisedPassages, frame: "D6.9 bagian yang diubah" },
  { file: "37-reader-entering", scenario: "reader", after: enteringWithMotion, motion: true, frame: "gerak masuk, 90 ms setelah dibuka" },
  { file: "39-sources-card-hover", scenario: "settled", after: hoverSecondCard, frame: "D9.4 tertutup, arahkan kursor" },
  { file: "40-sumber-closed", scenario: "settled", frame: "D9.4 panel Sumber tertutup, tombol Sumber di kepala" },
  { file: "41-sumber-cards", scenario: "settled", after: openPanel, frame: "D9.4 kartu satu baris" },
  { file: "42-sumber-card-focus", scenario: "settled", after: focusSecondCard, frame: "D9.4 tertutup, fokus papan ketik" },
  { file: "43-sumber-preview", scenario: "settled", after: (page) => previewFromCitation(page, 2), frame: "D9.4 terbuka, pratinjau dari nomor kutipan 2" },
  { file: "44-sumber-preview-arabic", scenario: "many-dalil", after: previewLongArabicCard, frame: "D9.4 pratinjau dengan teks Arab panjang terbungkus" },
  { file: "45-margin-active", scenario: "settled", after: hoverMargin, frame: "D9.8a catatan pinggir dengan Buka sumber" },
  { file: "46-sidebar-tooltip", scenario: "riwayat", idle: true, after: hoverPanelIcon, frame: "D9.9 tooltip ikon panel" },
  { file: "47-sidebar-collapsed", scenario: "riwayat", idle: true, after: collapseSidebar, frame: "D9.9 sidebar disembunyikan dengan Ctrl B" },
  { file: "48-chat-sidebar-collapsed", scenario: "settled", after: collapseSidebar, frame: "D9.9 percakapan dengan sidebar disembunyikan" },
  { file: "49-follow-up-scrolled", scenario: "follow-up", followUp: "Bagaimana kalau kompos belum matang?", after: scrollToTop, frame: "D9.8a dua pertanyaan, digulir ke atas di bawah kabur atas" },
  { file: "50-inferred", scenario: "inferred", after: scrollToTop, frame: "D9.11 jawaban disimpulkan: catatan inferensi di paragraf pembuka, tanpa pil dan tanpa catatan di baris aksi" },
  { file: "51-margin-once", scenario: "many-dalil", after: scrollToTop, frame: "D9.6 catatan pinggir: tiap sumber sekali, berurutan, sejajar dengan baris pertama yang mengutipnya" },
  { file: "52-sidebar-active-hover", scenario: "riwayat", idle: true, after: hoverActiveRow, frame: "D9.9 baris aktif disorot: judul terpotong sebelum tombol titik tiga" },
  { file: "54-cite-opens-in-place", scenario: "settled", after: citeOpensInPlace, frame: "D9.15 nomor kutipan membuka kartunya di tempat: tidak ada yang terbang, kartu terlihat dan menyala sekali" },
  { file: "53-margin-after-panel-and-sidebar", scenario: "margin-tall", after: openCloseAndToggleSidebar, frame: "D9.6 catatan pinggir tetap sejajar setelah panel Sumber dibuka lalu ditutup, dan sidebar disembunyikan lalu ditampilkan" },
  { file: "56-reader-tj-citation", scenario: "reader-tj", after: (page) => openFromCitation(page, 1), frame: "D9.18 Halaman buku: Tanya Jawab fiktif dibuka dari tanda kutip 1" },
  { file: "57-reader-tj-second", scenario: "reader-tj", after: (page) => openFromCitation(page, 2), frame: "D9.18 Halaman buku: Tanya Jawab bernomor satu baris, dibuka dari tanda kutip 2" },
  { file: "58-sumber-arabic-rows", scenario: "arabic-rows", after: arabicRowsShowTheirBeginning, frame: "D9.20 baris Sumber satu baris dengan teks Arab panjang: awal di kanan, … di kiri; baris campuran tetap berurutan" },
  { file: "38-reader-closed-focus", scenario: "reader", after: closeWithEscape, frame: "Esc menutup, fokus kembali ke tanda kutip" },
];

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The reader's own words and numbers must not look like the source's pasal, ayat or paragraph numbering: a passage is a chunk the
 * index cut, not a paragraph of the source. The scenarios' passages are fictional and contain none of these words.
 */
async function assertNoSourceNumbering(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    const chrome = [".rh", ".rd-toc", ".rd-tabs", ".rd-listhead", ".rd-list", ".rd-pos", ".rd-notice", ".cp-hd"].flatMap((selector) => [...document.querySelectorAll(`.rd ${selector}`)].map((element) => (element as HTMLElement).innerText));
    const labels = [...document.querySelectorAll(".rd [aria-label]")].map((element) => element.getAttribute("aria-label") ?? "");
    const markers = [...document.querySelectorAll(".rd .rd-p")].map((element) => ((element as HTMLElement).innerText.match(/^\(\d+\)/) ?? [""])[0]);
    return [...chrome, ...labels, ...markers].filter((text) => /\b(paragraf|pasal|ayat)\b/i.test(text) || /^\(\d+\)$/.test(text));
  });
  if (found.length > 0) throw new Error(`the reader shows source-like numbering: ${found.join(" | ")}`);
}

/** A citation mark opens the Sumber panel on that source's preview. Only "Buka sumber" in the preview opens Baca putusan. */
async function previewFromCitation(page: Page, number: number): Promise<void> {
  await page.locator("[data-card='answer'] .an-p .c", { hasText: new RegExp(`^${number}$`) }).first().click();
  await page.locator("[data-source][data-open='true']").waitFor();
  await page.waitForTimeout(350);
}

async function openReaderFromPreview(page: Page): Promise<void> {
  await page.locator("[data-source][data-open='true']").getByRole("button", { name: "Buka sumber" }).click();
  await page.locator("[data-reader][data-load='ready']").waitFor();
  await page.waitForTimeout(500);
  await assertNoSourceNumbering(page);
}

async function openFromCitation(page: Page, number: number): Promise<void> {
  await previewFromCitation(page, number);
  await openReaderFromPreview(page);
}

async function openPanel(page: Page): Promise<void> {
  const button = page.locator(".cv-src");
  if ((await button.count()) > 0) await button.click();
  await page.locator("[data-panel='sources']").waitFor();
  await page.waitForTimeout(350);
}

async function openFromCard(page: Page, index = 0): Promise<void> {
  await openPanel(page);
  await page.locator("[data-source] .scard-head").nth(index).click();
  await page.locator("[data-source][data-open='true']").waitFor();
  await openReaderFromPreview(page);
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

async function enteringWithMotion(page: Page): Promise<void> {
  await previewFromCitation(page, 1);
  await page.locator("[data-source][data-open='true']").getByRole("button", { name: "Buka sumber" }).click();
  await page.locator(".rd").waitFor();
  await page.evaluate(() =>
    document.querySelector(".rd")?.getAnimations({ subtree: true }).forEach((animation) => {
      animation.pause();
      animation.currentTime = 90;
    }),
  );
}

async function hoverSecondCard(page: Page): Promise<void> {
  await openPanel(page);
  await page.locator("[data-source]").nth(0).hover();
  await page.waitForTimeout(250);
}

async function focusSecondCard(page: Page): Promise<void> {
  await openPanel(page);
  await page.locator("[data-source] .scard-head").nth(1).focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
}

async function previewLongArabicCard(page: Page): Promise<void> {
  await openPanel(page);
  await page.locator("[data-source] .scard-head").nth(3).click();
  await page.locator("[data-source][data-open='true']").waitFor();
  await page.waitForTimeout(350);
}

async function hoverMargin(page: Page): Promise<void> {
  await page.locator("[data-margin]").first().hover();
  await page.waitForTimeout(350);
}

/** The title ends before the "more" button in every combination of active, hover and focus, so the two never overlap. */
async function hoverActiveRow(page: Page): Promise<void> {
  await openNewestConversation(page);
  const row = page.locator(".rw-side .rr").first();
  const overlap = () =>
    row.evaluate((element) => {
      const more = element.querySelector(".more");
      const title = element.querySelector(".rr-t");
      if (more === null || title === null || getComputedStyle(more).display === "none") return false;
      return title.getBoundingClientRect().right > more.getBoundingClientRect().left + 0.5;
    });
  await row.hover();
  if (await overlap()) throw new Error("the active row's title overlaps its more button on hover");
  await row.locator(".body").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  if (await overlap()) throw new Error("the active row's title overlaps its more button on keyboard focus");
  await row.hover();
}

/**
 * Every margin note is level with the first line that cites it, or sits right under the note before it because that one is in its
 * way. A note anywhere lower than that is stale.
 */
async function assertNotesAligned(page: Page, when: string): Promise<void> {
  const rows = await page.evaluate(() => {
    const article = document.querySelector("[data-card='answer']");
    if (article === null) return [];
    const first = new Map<string, Element>();
    for (const mark of article.querySelectorAll<HTMLElement>("[data-cite]")) if (!first.has(mark.dataset["cite"] ?? "")) first.set(mark.dataset["cite"] ?? "", mark);
    return [...article.querySelectorAll<HTMLElement>(".an-margin [data-margin]")].map((note) => {
      const box = note.getBoundingClientRect();
      const mark = first.get(note.dataset["margin"] ?? "")?.getBoundingClientRect();
      return { id: note.dataset["margin"] ?? "", top: box.top, bottom: box.bottom, wanted: mark === undefined ? null : mark.top };
    });
  });
  const GAP = 12;
  const stale = rows.flatMap((row, index) => {
    const before = rows[index - 1];
    const allowed = before === undefined ? (row.wanted ?? row.top) : Math.max(row.wanted ?? row.top, before.bottom + GAP);
    return row.top > allowed + 2 ? [`${row.id} is ${Math.round(row.top - allowed)}px below where it belongs`] : [];
  });
  if (stale.length > 0) throw new Error(`margin notes are stale ${when}: ${stale.join("; ")}`);
}

async function openCloseAndToggleSidebar(page: Page): Promise<void> {
  await page.locator(".cv-scroll").evaluate((element) => element.scrollTo({ top: 0 }));
  await assertNotesAligned(page, "at the start");
  await page.locator(".cv-src").click();
  await page.waitForTimeout(900);
  await assertNotesAligned(page, "with the Sumber panel open");
  await page.locator(".sx-head .icon-btn").first().click();
  await page.waitForTimeout(900);
  await assertNotesAligned(page, "after the Sumber panel closed");
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(700);
  await assertNotesAligned(page, "with the sidebar hidden");
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(700);
  await assertNotesAligned(page, "with the sidebar shown again");
}

/** A citation number opens its card where it stands: nothing is added to the page outside the app, the card is in view and lit once. */
async function citeOpensInPlace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const added: string[] = [];
    new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => added.push((node as HTMLElement).className ?? node.nodeName)))).observe(document.body, { childList: true });
    (window as unknown as { __added: string[] }).__added = added;
  });
  await page.locator("[data-card='answer'] .an-p .c", { hasText: /^2$/ }).first().click();
  await page.locator("[data-source][data-open='true']").waitFor();
  await page.waitForTimeout(60);
  const lit = await page.locator("[data-source][data-open='true'] .scard-hit").count();
  if (lit !== 1) throw new Error(`the opened card should be lit once, found ${lit}`);
  await page.waitForTimeout(900);
  const added = await page.evaluate(() => (window as unknown as { __added: string[] }).__added);
  if (added.length > 0) throw new Error(`something was added to the page body while the card opened: ${added.join(", ")}`);
  const inView = await page.evaluate(() => {
    const card = document.querySelector("[data-source][data-open='true']")?.getBoundingClientRect();
    const list = document.querySelector(".sx-body")?.getBoundingClientRect();
    return card !== undefined && list !== undefined && card.top >= list.top - 1 && card.bottom <= list.bottom + 1;
  });
  if (!inView) throw new Error("the opened card is not inside the panel's list");
}

type RowGeometry = { readonly text: string; readonly dir: string; readonly startsWithArabic: boolean; readonly cut: boolean; readonly line: { left: number; right: number }; readonly run: { left: number; right: number } | null; readonly latinLeft: number | null; readonly arabicLeft: number | null };

/**
 * A one-line row that starts with Arabic starts on the right: its first Arabic run is not clipped there, and when the row is too long
 * the cut and its ellipsis are on the left. A row that starts with Latin keeps its order, the Latin to the left of the Arabic.
 */
async function arabicRowsShowTheirBeginning(page: Page): Promise<void> {
  await openPanel(page);
  const rows = await page.evaluate<RowGeometry[]>(() =>
    [...document.querySelectorAll<HTMLElement>(".scard-line-text")].map((element) => {
      const box = element.getBoundingClientRect();
      const run = element.querySelector(".ar-run")?.getBoundingClientRect() ?? null;
      const text = element.textContent ?? "";
      const words = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let latin: Text | null = null;
      for (let node = words.nextNode(); node !== null && latin === null; node = words.nextNode()) if (/\p{Script=Latin}/u.test(node.textContent ?? "")) latin = node as Text;
      const range = document.createRange();
      if (latin !== null) range.selectNodeContents(latin);
      return {
        text: text.slice(0, 24),
        dir: getComputedStyle(element).direction,
        startsWithArabic: /^[^\p{L}]*\p{Script=Arabic}/u.test(text),
        cut: [element, ...element.querySelectorAll("*")].some((part) => part.scrollWidth > part.clientWidth + 1),
        line: { left: box.left, right: box.right },
        run: run === null ? null : { left: run.left, right: run.right },
        latinLeft: latin === null ? null : range.getBoundingClientRect().left,
        arabicLeft: (element.querySelector(".part-arabic") ?? element.querySelector(".ar-run"))?.getBoundingClientRect().left ?? null,
      };
    }),
  );
  const arabicRows = rows.filter((row) => row.run !== null);
  if (arabicRows.length < 4) throw new Error(`expected four rows with Arabic, found ${arabicRows.length}`);
  const problems = arabicRows.flatMap((row) => {
    if (row.run === null) return [];
    if (row.startsWithArabic) {
      const found = [];
      if (row.dir !== "rtl") found.push("is drawn left to right");
      if (row.run.right > row.line.right + 1) found.push(`loses its beginning: the run reaches ${Math.round(row.run.right)} and the row ends at ${Math.round(row.line.right)}`);
      return found.map((problem) => `"${row.text}" ${problem}`);
    }
    const found = [];
    if (row.dir !== "ltr" || row.latinLeft === null || row.arabicLeft === null || row.latinLeft >= row.arabicLeft) found.push("does not keep its reading order");
    if (row.run.right > row.line.right + 1) found.push(`loses the beginning of its Arabic: the run reaches ${Math.round(row.run.right)} and the row ends at ${Math.round(row.line.right)}`);
    return found.map((problem) => `"${row.text}" ${problem}`);
  });
  if (problems.length > 0) throw new Error(`Arabic rows are wrong: ${problems.join("; ")}`);
  if (arabicRows.filter((row) => row.cut).length < 4) throw new Error("fewer than four Arabic rows are cut, so the check proves little");
}

async function hoverPanelIcon(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Sembunyikan sidebar/ }).hover();
  await page.waitForTimeout(800);
}

async function collapseSidebar(page: Page): Promise<void> {
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(500);
}

async function scrollToTop(page: Page): Promise<void> {
  await page.locator(".cv-scroll").evaluate((element) => element.scrollTo({ top: 0 }));
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
