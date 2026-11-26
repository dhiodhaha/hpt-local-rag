import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const QUIET_MS = 200;

const hashOf = (file: string): string | null => {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
};

function snapshot(dir: string, into: Map<string, string | null>): Map<string, string | null> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) snapshot(full, into);
    else into.set(full, hashOf(full));
  }
  return into;
}

/**
 * The files among `files` whose content differs from what `known` holds, which is updated. On Windows fs.watch also fires when an
 * antivirus scan or the indexer only reads a file, and restarting the host then would cut off an answer that is being written.
 */
export function changedFiles(known: Map<string, string | null>, files: Iterable<string>, hash: (file: string) => string | null = hashOf): string[] {
  const changed: string[] = [];
  for (const file of files) {
    const now = hash(file);
    if (known.get(file) === now) continue;
    known.set(file, now);
    changed.push(file);
  }
  return changed;
}

/** Dev only. The engine runs from source, so a saved file there restarts the host. Returns a function that stops watching. */
export function watchEngineSource(repoRoot: string, onChange: (file: string) => void): () => void {
  const root = path.join(repoRoot, "apps", "server", "src");
  const known = snapshot(root, new Map());
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(root, { recursive: true }, (_event, file) => {
    if (file === null) return;
    pending.add(path.join(root, String(file)));
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = changedFiles(known, [...pending].filter((entry) => !fs.existsSync(entry) || fs.statSync(entry).isFile()));
      pending.clear();
      if (changed[0] !== undefined) onChange(path.relative(root, changed[0]));
    }, QUIET_MS);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    watcher.close();
  };
}
