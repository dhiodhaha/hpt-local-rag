import fs from "node:fs";
import path from "node:path";

const QUIET_MS = 400;

/** Dev only. The engine runs from source, so a saved file there restarts the host. Returns a function that stops watching. */
export function watchEngineSource(repoRoot: string, onChange: (file: string) => void): () => void {
  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(path.join(repoRoot, "apps", "server", "src"), { recursive: true }, (_event, file) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => onChange(String(file ?? "")), QUIET_MS);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    watcher.close();
  };
}
