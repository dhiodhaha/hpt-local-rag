import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/client.ts");

describe("the browser-safe client entry", () => {
  it("bundles for a browser with no Node built-in, no native module and no dependency at all", async () => {
    const result = await build({ entryPoints: [entry], bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent" });
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(inputs.length > 3, "the entry pulled in its own modules");
    const outside = inputs.filter((input) => input.includes("node_modules"));
    assert.deepEqual(outside, [], "a dependency reached the renderer's bundle");
    const nodeImports = Object.values(result.metafile.inputs).flatMap((input) => input.imports.map((entry) => entry.path)).filter((specifier) => specifier.startsWith("node:"));
    assert.deepEqual(nodeImports, []);
    assert.doesNotMatch(result.outputFiles[0]?.text ?? "", /better-sqlite3|sqlite-vec|onnxruntime|@anthropic-ai/);
  });

  it("fails to bundle when an engine module is reachable, so the check can fail", async () => {
    const result = await build({ stdin: { contents: `export * from ${JSON.stringify(path.join(path.dirname(entry), "features/answer/engine.ts"))}`, resolveDir: path.dirname(entry), loader: "ts" }, bundle: true, platform: "browser", write: false, metafile: true, logLevel: "silent" }).catch(() => null);
    const reachesNode = result === null || Object.values(result.metafile.inputs).some((input) => input.imports.some((entry) => entry.path.startsWith("node:")));
    assert.equal(reachesNode, true);
  });
});
