import fs from "node:fs";
import path from "node:path";
import { config } from "../../shared/config.ts";
import { listNoteIds, readSnapshotNote } from "./snapshot.ts";
import { createNoteConverter } from "./to-markdown.ts";

function writeIfChanged(file: string, content: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function removeStaleNotes(vaultDir: string, keep: ReadonlySet<string>): number {
  if (!fs.existsSync(vaultDir)) return 0;
  const stale = fs
    .readdirSync(vaultDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file.endsWith(".md") && !file.startsWith(".obsidian/") && !keep.has(file));
  for (const file of stale) fs.rmSync(path.join(vaultDir, file));
  return stale.length;
}

function buildVault() {
  const ids = listNoteIds(config.snapshotDir);
  const converter = createNoteConverter(new Set(ids), config.siteUrl);
  const emptyNotes: string[] = [];
  let written = 0;

  for (const id of ids) {
    const note = readSnapshotNote(config.snapshotDir, id);
    if (note.bodyHtml.trim() === "") emptyNotes.push(id);
    if (writeIfChanged(path.join(config.vaultDir, `${id}.md`), converter.toMarkdown(note))) written += 1;
  }
  const removed = removeStaleNotes(config.vaultDir, new Set(ids.map((id) => `${id}.md`)));

  const { resolved, unresolved } = converter.stats;
  const unresolvedLinks = [...unresolved.values()].reduce((sum, count) => sum + count, 0);
  const report = {
    notes: ids.length,
    emptyNotes,
    links: { resolved, unresolved: unresolvedLinks },
    unresolvedTargets: Object.fromEntries([...unresolved].sort((a, b) => b[1] - a[1])),
  };
  fs.writeFileSync(path.join(config.vaultDir, "_build-report.json"), JSON.stringify(report, null, 2));

  console.log(`Vault at ${config.vaultDir}: ${written} notes written, ${removed} stale notes removed`);
  console.log(`${ids.length} notes, ${resolved} wikilinks, ${unresolvedLinks} links to pages outside the snapshot, ${emptyNotes.length} empty notes`);
}

buildVault();
