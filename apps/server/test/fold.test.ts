import assert from "node:assert/strict";
import { test } from "node:test";
import { contentTerms, coverage, fold, toFtsQuery, tokens } from "../src/features/search/fold.ts";

test("spelling variants of one transliterated word meet", () => {
  assert.equal(fold("wudhu"), fold("wudlu"));
  assert.equal(fold("wudlu"), fold("wudu"));
  assert.equal(fold("dzikir"), fold("zikir"));
  assert.equal(fold("Shalat"), fold("salat"));
});

test("accents, apostrophes and case do not change a match", () => {
  assert.equal(fold("Jum'at"), fold("jumat"));
  assert.equal(fold("tamattu’"), fold("tamattu"));
  assert.equal(fold("ṣalāt"), fold("salat"));
});

test("Arabic harakat are dropped and presentation forms become base letters", () => {
  assert.equal(fold("الصَّلاة"), fold("الصلاه"));
  assert.equal(fold("ﺍ"), "ا");
  assert.equal(fold("كــتاب"), fold("كتاب"));
});

test("content terms drop question words and keep the order of first appearance", () => {
  assert.deepEqual(contentTerms("Apa hukum wudhu bagi orang yang tidur? Wudu itu"), ["hukum", "wudu", "bagi", "orang", "tidur"]);
});

test("a question with no content terms builds no query", () => {
  assert.equal(toFtsQuery(contentTerms("apa itu?")), null);
});

test("the FTS query quotes every term, so user text cannot reach MATCH as syntax", () => {
  const query = toFtsQuery(contentTerms('kebun" OR NEAR(tanam'));
  assert.equal(query, '"kebun" OR "or" OR "near" OR "tanam"');
});

test("coverage is the share of terms found among the tokens", () => {
  const terms = ["kebun", "tanam", "panen", "pasar"];
  assert.equal(coverage(terms, "kebun dan tanam di pasar"), 0.75);
  assert.equal(coverage([], "kebun"), 0);
  assert.deepEqual(tokens("a-b c9"), ["a", "b", "c9"]);
});
