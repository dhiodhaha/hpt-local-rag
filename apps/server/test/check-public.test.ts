import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.ts";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/check-public-safe.mjs");

function checkWith(files: Record<string, string>): { code: number | null; output: string } {
  const repo = tempDir();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(repo, "scripts", "check-public-safe.mjs"));
  for (const [file, content] of Object.entries({ "README.md": "hello\n", ...files })) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  }
  git("add", "-f", "-A");
  const run = spawnSync("node", ["scripts/check-public-safe.mjs"], { cwd: repo, encoding: "utf8" });
  return { code: run.status, output: `${run.stdout}${run.stderr}` };
}

describe("pnpm check:public and the local-only files", () => {
  it("passes for a repo with no local data", () => {
    assert.equal(checkWith({}).code, 0);
  });

  it("fails when a trace, a conversation or the canary is tracked under data/", () => {
    for (const file of ["data/traces/2026-11-26.jsonl", "data/conversations/c-1.jsonl", "data/logs/input-2026-11-27.jsonl", "data/canary.txt"]) {
      const result = checkWith({ [file]: "{}\n" });
      assert.equal(result.code, 1, file);
      assert.match(result.output, /tracked under data\//);
    }
  });

  it("fails when a trace or conversation file is tracked anywhere else, whatever its extension", () => {
    for (const file of ["docs/traces/run.md", "logs/conversations/c-1.json", "notes/trace.jsonl"]) {
      const result = checkWith({ [file]: "x\n" });
      assert.equal(result.code, 1, file);
      assert.match(result.output, /stay local/);
    }
  });
});
