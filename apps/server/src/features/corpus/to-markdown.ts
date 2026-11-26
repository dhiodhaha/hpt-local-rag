import TurndownService from "turndown";
import type { NoteId, SnapshotNote } from "./snapshot.ts";

export type LinkStats = {
  resolved: number;
  unresolved: Map<NoteId, number>;
};

const WIKI_HREF = /^\/wiki\/([a-z]+\/[^?#]+)/i;

/** Obsidian alias text can't hold "|" or brackets, and turndown's escapes are noise inside it. */
function cleanAlias(text: string): string {
  return text.replace(/\\/g, "").replace(/[[\]|]/g, "").replace(/\s+/g, " ").trim();
}

function listMarker(list: HTMLElement, item: HTMLElement): string {
  if (list.nodeName !== "OL") return "-";
  const start = Number(list.getAttribute("start") ?? 1);
  return `${start + Array.prototype.indexOf.call(list.children, item)}.`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(values: string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

function readLabels(labels: string[]) {
  const year = labels.map((label) => /^Tahun (\d{4})$/.exec(label)?.[1]).find(Boolean);
  const folder = labels.map((label) => /^Folder: (.+)$/.exec(label)?.[1]).find(Boolean);
  const rest = labels.filter((label) => !/^(Tahun \d{4}|Folder: .+)$/.test(label));
  return { year, folder, rest };
}

function frontmatter(note: SnapshotNote, sourceUrl: string): string {
  const { year, folder, rest } = readLabels(note.labels);
  const lines = [
    `title: ${yamlString(note.title)}`,
    `kind: ${yamlString(note.kind)}`,
    `source: ${yamlString(sourceUrl)}`,
  ];
  if (year) lines.push(`year: ${year}`);
  if (folder) lines.push(`folder: ${yamlString(folder)}`);
  if (note.arabic) lines.push(`arabic: ${yamlString(note.arabic)}`);
  if (rest.length > 0) lines.push(`labels: ${yamlList(rest)}`);
  if (note.tags.length > 0) lines.push(`tags: ${yamlList(note.tags)}`);
  return `---\n${lines.join("\n")}\n---`;
}

/** Links to snapshot notes become path-style wikilinks ([[concepts/aamiin|Aamiin]]); bare [[slug]] would be ambiguous because slugs repeat across folders. */
export function createNoteConverter(knownIds: ReadonlySet<NoteId>, siteUrl: string) {
  const stats: LinkStats = { resolved: 0, unresolved: new Map() };
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  turndown.addRule("wikilink", {
    filter: (node) => node.nodeName === "A" && WIKI_HREF.test(node.getAttribute("href") ?? ""),
    replacement: (content, node) => {
      const href = (node as HTMLElement).getAttribute("href") ?? "";
      const target = decodeURIComponent(WIKI_HREF.exec(href)?.[1] ?? "");
      const alias = cleanAlias(content);
      if (knownIds.has(target)) {
        stats.resolved += 1;
        return `[[${target}|${alias}]]`;
      }
      stats.unresolved.set(target, (stats.unresolved.get(target) ?? 0) + 1);
      return `[${alias}](${siteUrl}${href})`;
    },
  });

  // Cloudflare rewrote email addresses into /cdn-cgi/ links that only its script can decode.
  turndown.addRule("cloudflareEmail", {
    filter: (node) => node.nodeName === "A" && (node.getAttribute("href") ?? "").startsWith("/cdn-cgi/"),
    replacement: (content) => content,
  });

  // The site wraps every <li> in a <p>; turndown's default then emits "-   item" with blank lines between.
  turndown.addRule("tightListItem", {
    filter: "li",
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement;
      const marker = listMarker(parent, node as HTMLElement);
      const indent = " ".repeat(marker.length + 1);
      const text = content.trim().replace(/\n{2,}/g, "\n").replace(/\n/g, `\n${indent}`);
      return `${marker} ${text}\n`;
    },
  });

  function toMarkdown(note: SnapshotNote): string {
    const sourceUrl = `${siteUrl}/wiki/${note.id}`;
    const body = turndown.turndown(note.bodyHtml).trim();
    return `${frontmatter(note, sourceUrl)}\n\n# ${note.title}\n\n${body}\n`;
  }

  return { toMarkdown, stats };
}
