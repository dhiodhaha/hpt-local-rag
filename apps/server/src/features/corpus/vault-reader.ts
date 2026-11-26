import fs from "node:fs/promises";
import path from "node:path";
import type { NoteId } from "./snapshot.ts";

export const COLLECTIONS = ["putusan", "sources", "concepts", "entities", "quran"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export type VaultNote = {
  id: NoteId;
  collection: Collection;
  slug: string;
  title: string;
  sourceUrl: string;
  folder: string | null;
  year: number | null;
  body: string;
};

export type LinkedText = {
  text: string;
  targets: NoteId[];
};

export class VaultFormatError extends Error {}

/** The writer only emits path-style links. A bare "[[1]]" in a document is footnote text, not a link. */
const WIKILINK = new RegExp(`\\[\\[((?:${COLLECTIONS.join("|")})/[^\\]|]+)(?:\\|([^\\]]*))?\\]\\]`, "g");
const BACKLINK_BLOCK = /\n## Sumber\n(?:\n- \[\[[^\n]*\]\][^\n]*)+\n*$/;

export function renderWikilinks(markdown: string): LinkedText {
  const targets: NoteId[] = [];
  const text = markdown.replace(WIKILINK, (_match, target: string, alias: string | undefined) => {
    targets.push(target);
    return alias ?? target;
  });
  return { text, targets };
}

function parseFrontmatter(raw: string, file: string): { fields: Record<string, unknown>; rest: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) throw new VaultFormatError(`${file}: missing frontmatter`);
  const fields: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const colon = line.indexOf(": ");
    if (colon === -1) throw new VaultFormatError(`${file}: frontmatter line is not "key: <json>": ${line}`);
    try {
      fields[line.slice(0, colon)] = JSON.parse(line.slice(colon + 2));
    } catch {
      throw new VaultFormatError(`${file}: frontmatter value is not JSON: ${line}`);
    }
  }
  return { fields, rest: raw.slice(match[0].length) };
}

function requireString(fields: Record<string, unknown>, key: string, file: string): string {
  const value = fields[key];
  if (typeof value !== "string") throw new VaultFormatError(`${file}: frontmatter "${key}" must be a string`);
  return value;
}

function optionalString(fields: Record<string, unknown>, key: string, file: string): string | null {
  return fields[key] === undefined ? null : requireString(fields, key, file);
}

function optionalYear(fields: Record<string, unknown>, file: string): number | null {
  const value = fields.year;
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new VaultFormatError(`${file}: frontmatter "year" must be an integer`);
  return value;
}

function isCollection(value: string): value is Collection {
  return (COLLECTIONS as readonly string[]).includes(value);
}

export function parseNote(id: NoteId, raw: string): VaultNote {
  const [folderName = "", ...slugParts] = id.split("/");
  const slug = slugParts.join("/");
  if (!isCollection(folderName) || slug === "") throw new VaultFormatError(`${id}: not in a known collection`);
  const { fields, rest } = parseFrontmatter(raw.replace(/\r\n/g, "\n"), id);
  const title = requireString(fields, "title", id);
  const withoutTitle = rest.replace(/^\s*# [^\n]*\n/, "");
  const body = folderName === "putusan" ? withoutTitle.replace(BACKLINK_BLOCK, "\n") : withoutTitle;
  return {
    id,
    collection: folderName,
    slug,
    title,
    sourceUrl: requireString(fields, "source", id),
    folder: optionalString(fields, "folder", id),
    year: optionalYear(fields, id),
    body: body.trim(),
  };
}

async function listVaultFiles(vaultDir: string): Promise<NoteId[]> {
  const files = await fs.readdir(vaultDir, { recursive: true, encoding: "utf8" });
  return files
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file.endsWith(".md") && file.includes("/") && !file.startsWith("."))
    .map((file) => file.slice(0, -".md".length))
    .sort();
}

export async function readVault(vaultDir: string, options: { concurrency?: number } = {}): Promise<VaultNote[]> {
  const ids = await listVaultFiles(vaultDir);
  const notes = Array.from<VaultNote>({ length: ids.length });
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < ids.length; index = next++) {
      const id = ids[index] as NoteId;
      notes[index] = parseNote(id, await fs.readFile(path.join(vaultDir, `${id}.md`), "utf8"));
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 32 }, worker));
  return notes;
}
