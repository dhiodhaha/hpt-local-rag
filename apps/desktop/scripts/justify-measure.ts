import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";

/**
 * `node scripts/justify-measure.ts`: how a justified paragraph looks in the real Electron window, as numbers. It sets fictional
 * Indonesian paragraphs in the reader's own font at several column widths and measures every line that is not the last of its
 * paragraph: the gap between words as a multiple of a normal space, and the slack of the line per character in em, which is how far the letters open when the slack is spread over
 * them. It also reports whether Chromium here hyphenates (it does not, for any language) and supports `text-justify: inter-character`.
 */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEXTS = [
  "Pertanyaan yang sering diajukan oleh jamaah adalah bagaimana kedudukan shalat sunnah yang dikerjakan di atas kendaraan, ketika seseorang menempuh perjalanan yang cukup jauh dan tidak memungkinkan baginya untuk turun dari kendaraan pada setiap waktu shalat tiba. Persoalan ini telah dibahas dalam berbagai keputusan, dan jawabannya bergantung pada keadaan orang yang bertanya serta jenis shalat yang hendak dikerjakan.",
  "Shalat sunnah boleh dikerjakan sambil duduk di kendaraan, baik kendaraan darat maupun kendaraan laut. Rukuk dan sujud cukup dilakukan dengan isyarat, dan isyarat sujud dibuat lebih rendah daripada isyarat rukuk. Dasar yang dipakai antara lain hadis yang menerangkan bahwa Rasulullah mengerjakan shalat sunnah di atas tunggangannya menghadap ke arah mana pun tunggangan itu menghadap.",
  "Mengenai arah kiblat, cukup menghadap kiblat ketika takbiratul ihram bila hal itu mudah dilakukan, lalu shalat diteruskan mengikuti arah kendaraan sampai salam. Bila tidak mungkin menghadap kiblat pada saat takbiratul ihram, maka seseorang boleh menghadap ke arah mana saja kendaraannya berjalan, karena kewajiban menghadap kiblat gugur dalam keadaan yang menyulitkan.",
  "Adapun shalat fardu tetap dikerjakan dengan turun dari kendaraan bila waktunya memungkinkan. Jika waktu shalat hampir habis dan kendaraan tidak dapat berhenti, maka shalat dikerjakan di atas kendaraan sebisanya, dengan tetap menjaga kesempurnaan bacaan dan gerakan semampunya, kemudian tidak perlu diulang setelah sampai di tempat tujuan.",
  "Pembatalan shalat terjadi apabila seseorang meninggalkan salah satu rukun dengan sengaja, berbicara dengan orang lain, makan dan minum, atau melakukan gerakan berlebihan yang tidak termasuk gerakan shalat. Perbedaan pendapat mengenai hal ini dijelaskan dalam keputusan yang telah ditetapkan dan tidak perlu diulang di sini.",
];
const VARIANTS = [
  { name: "left", css: "text-align:left", lang: "id" },
  { name: "justify (inter-word)", css: "text-align:justify", lang: "id" },
  { name: "hyphens:auto, lang=id", css: "text-align:justify;hyphens:auto", lang: "id" },
  { name: "hyphens:auto, lang=en", css: "text-align:justify;hyphens:auto", lang: "en" },
  { name: "justify inter-character", css: "text-align:justify;text-justify:inter-character", lang: "id" },
];
const WIDTHS = [680, 600, 560, 480];

const { ELECTRON_RENDERER_URL: _dev, ...env } = process.env;
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [appDir, "--scenario", "reader", "--delay-ms", "0"],
  env: { ...env, HPT_NODE: process.execPath, HPT_SHOW_WINDOW: "1", HPT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "hpt-justify-")) } as Record<string, string>,
});
try {
  const page = await app.firstWindow();
  await page.locator("[data-host='ready']").waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  console.log(JSON.stringify(await page.evaluate(() => ({ chrome: /Chrome\/[\d.]+/.exec(navigator.userAgent)?.[0], textJustifyInterCharacter: CSS.supports("text-justify", "inter-character") }))));
  console.log(["width", "variant", "lines", "meanGap", "worstGap", "gaps>2x", "slackPerCharP95em", "slackPerCharMaxEm"].join("\t"));
  for (const width of WIDTHS) {
    for (const variant of VARIANTS) {
      const result = await page.evaluate(
        ({ texts, variant, width }) => {
          const host = document.createElement("div");
          host.lang = variant.lang;
          host.setAttribute("style", `position:fixed;left:0;top:0;width:${width}px;opacity:0;pointer-events:none;font-family:var(--font-read);font-size:19px;line-height:1.6;${variant.css}`);
          for (const text of texts) {
            const p = document.createElement("p");
            p.style.margin = "0 0 8px";
            text.split(" ").forEach((word, index, all) => {
              const span = document.createElement("span");
              span.textContent = word;
              p.append(span);
              if (index < all.length - 1) p.append(" ");
            });
            host.append(p);
          }
          document.body.append(host);
          const canvas = document.createElement("canvas").getContext("2d")!;
          const style = getComputedStyle(host);
          canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const space = canvas.measureText(" ").width;
          const em = parseFloat(style.fontSize);
          const means: number[] = [];
          const worst: number[] = [];
          const open: number[] = [];
          let lines = 0;
          for (const p of host.querySelectorAll("p")) {
            const rows: { top: number; left: number; right: number; text: string }[][] = [];
            for (const span of p.querySelectorAll("span")) {
              for (const rect of span.getClientRects()) {
                const fragment = { top: rect.top, left: rect.left, right: rect.right, text: span.textContent ?? "" };
                const last = rows.at(-1);
                if (last !== undefined && Math.abs((last[0] as { top: number }).top - fragment.top) < 6) last.push(fragment);
                else rows.push([fragment]);
              }
            }
            rows.forEach((row, index) => {
              lines += 1;
              if (index === rows.length - 1 || row.length < 2) return;
              const gaps = row.slice(1).map((entry, at) => entry.left - (row[at] as { right: number }).right);
              means.push(gaps.reduce((a, b) => a + b, 0) / gaps.length / space);
              worst.push(Math.max(...gaps) / space);
              const natural = row.reduce((sum, entry) => sum + canvas.measureText(entry.text).width, 0) + space * (row.length - 1);
              const chars = row.reduce((sum, entry) => sum + entry.text.length, 0) + row.length - 1;
              open.push(((row.at(-1) as { right: number }).right - (row[0] as { left: number }).left - natural) / chars / em);
            });
          }
          host.remove();
          const sorted = [...open].sort((a, b) => a - b);
          const round = (value: number, digits = 2) => Number(value.toFixed(digits));
          return {
            lines,
            mean: round(means.reduce((a, b) => a + b, 0) / Math.max(1, means.length)),
            worst: round(Math.max(0, ...worst)),
            over2: Math.round((means.filter((value) => value > 2).length / Math.max(1, means.length)) * 100),
            openP95: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0, 3),
            openMax: round(Math.max(0, ...open), 3),
          };
        },
        { texts: TEXTS, variant, width },
      );
      console.log([width, variant.name, result.lines, result.mean, result.worst, `${result.over2}%`, result.openP95, result.openMax].join("\t"));
    }
  }
} finally {
  await app.close();
}
