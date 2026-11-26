import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, renderWikilinks, VaultFormatError } from "../src/features/corpus/index.ts";
import { noteMarkdown } from "./helpers.ts";

test("a putusan loses its title line and its trailing backlink block, and keeps the rest", () => {
  const raw = noteMarkdown({ id: "putusan/contoh", title: "Contoh", folder: "Fatwa 2001", year: 2001, body: "Isi pertama.\n\nIsi kedua.", backlink: "sources/contoh" });
  const note = parseNote("putusan/contoh", raw);
  assert.equal(note.body, "Isi pertama.\n\nIsi kedua.");
  assert.deepEqual([note.collection, note.slug, note.title, note.folder, note.year], ["putusan", "contoh", "Contoh", "Fatwa 2001", 2001]);
});

test("a concept keeps its own Sumber section, because those are links worth following", () => {
  const raw = noteMarkdown({ id: "concepts/contoh", title: "Contoh", body: "Isi.", backlink: "sources/contoh" });
  assert.match(parseNote("concepts/contoh", raw).body, /## Sumber/);
});

test("a note the writer could not have produced is refused with its id", () => {
  assert.throws(() => parseNote("putusan/x", "tanpa frontmatter"), VaultFormatError);
  assert.throws(() => parseNote("putusan/x", '---\ntitle: bukan json\n---\n\nIsi'), /putusan\/x.*not JSON/);
  assert.throws(() => parseNote("putusan/x", '---\ntitle: "X"\nsource: "u"\nyear: "1998"\n---\n\nIsi'), /year/);
  assert.throws(() => parseNote("lain/x", '---\ntitle: "X"\nsource: "u"\n---\n\nIsi'), /collection/);
});

test("only path-style links are wikilinks, so footnote brackets stay as text", () => {
  const { text, targets } = renderWikilinks("Catatan [[1]] dan [[sources/a|Kartu A]] serta [[concepts/b]].");
  assert.equal(text, "Catatan [[1]] dan Kartu A serta concepts/b.");
  assert.deepEqual(targets, ["sources/a", "concepts/b"]);
});
