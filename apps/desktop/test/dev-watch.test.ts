import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { changedFiles } from "../src/main/dev-watch.ts";

describe("the dev host restart", () => {
  it("counts a file only when its content changed, not when it was merely read or touched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpt-watch-"));
    const file = path.join(dir, "a.ts");
    fs.writeFileSync(file, "one");
    const known = new Map<string, string | null>();
    assert.deepEqual(changedFiles(known, [file]), [file], "the first sight of a file is a change");
    fs.utimesSync(file, new Date(), new Date());
    assert.deepEqual(changedFiles(known, [file]), []);
    fs.writeFileSync(file, "two");
    assert.deepEqual(changedFiles(known, [file]), [file]);
    assert.deepEqual(changedFiles(known, [file]), []);
    fs.rmSync(file);
    assert.deepEqual(changedFiles(known, [file]), [file], "a deleted file is a change");
  });
});
