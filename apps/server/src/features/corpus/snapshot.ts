import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

/** A note id is its wiki path without the "/wiki/" prefix, e.g. "concepts/aamiin". */
export type NoteId = string;

export type SnapshotNote = {
  id: NoteId;
  title: string;
  kind: string;
  arabic: string | undefined;
  tags: string[];
  labels: string[];
  bodyHtml: string;
};

export function listNoteIds(snapshotDir: string): NoteId[] {
  const markdownDir = path.join(snapshotDir, "markdown");
  return fs
    .readdirSync(markdownDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length).split(path.sep).join("/"))
    .sort();
}

function htmlFileFor(snapshotDir: string, id: NoteId): string {
  const key = createHash("sha256").update(`/wiki/${id}`).digest("hex").slice(0, 20);
  return path.join(snapshotDir, "html", `${key}.html`);
}

function sliceBetween(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  if (from === -1) return "";
  const to = html.indexOf(end, from);
  return html.slice(from, to === -1 ? undefined : to + end.length);
}

export function readSnapshotNote(snapshotDir: string, id: NoteId): SnapshotNote {
  const html = fs.readFileSync(htmlFileFor(snapshotDir, id), "utf8");
  const hero = parse(sliceBetween(html, '<section class="wrap note-hero"', "</section>"));
  const article = parse(sliceBetween(html, '<article class="note-body"', "</article>")).querySelector("article");
  const chips = hero.querySelectorAll(".meta-chip");
  const textChips = chips.filter((chip) => !chip.classList.contains("arabic")).map((chip) => chip.text.trim());
  const markdownBlock = article?.querySelector(".md");

  return {
    id,
    title: hero.querySelector("h1.note-title")?.text.trim() ?? id,
    kind: hero.querySelector(".note-type")?.text.trim() ?? "",
    arabic: chips.find((chip) => chip.classList.contains("arabic"))?.text.trim(),
    tags: textChips.filter((chip) => chip.startsWith("#")).map((chip) => chip.slice(1)),
    labels: textChips.filter((chip) => !chip.startsWith("#")),
    bodyHtml: (markdownBlock ?? article)?.innerHTML ?? "",
  };
}
