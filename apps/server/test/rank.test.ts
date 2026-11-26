import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChannelLists } from "../src/features/search/channels.ts";
import { fuse, judgeEvidence, levelOf, notesNeedingPassage, RANK_POLICY, type RankLookups } from "../src/features/search/rank.ts";
import type { Evidence } from "../src/features/search/types.ts";

type Citable = [rowid: number, noteRowid: number, hash?: string];

function lookups(citable: Citable[], map: RankLookups["map"] = new Map(), best: [number, number][] = []): RankLookups {
  return {
    citable: new Map(citable.map(([rowid, noteRowid, hash]) => [rowid, { noteRowid, textHash: hash ?? `hash-${rowid}` }])),
    map,
    bestPassageOfNote: new Map(best),
  };
}

const keyword = (citable: number[], map: number[] = []): ChannelLists => ({ channel: "keyword", citable, map, nearestCosine: null });
const vector = (citable: number[], map: number[] = []): ChannelLists => ({ channel: "vector", citable, map, nearestCosine: null });
const channels = ["keyword"] as const;

test("a better keyword rank scores higher and every hit says why", () => {
  const fused = fuse([keyword([10, 20, 30])], lookups([[10, 1], [20, 2], [30, 3]]), 10);
  assert.deepEqual(fused.map((hit) => hit.passageRowid), [10, 20, 30]);
  assert.ok(fused.every((hit) => hit.reasons.length >= 1));
  assert.deepEqual(fused[1]?.reasons, [{ kind: "direct", channel: "keyword", rank: 2 }]);
});

test("a concept hit lifts the putusan it links to past a direct hit one rank above it", () => {
  const map = new Map([[500, { collection: "concepts" as const, links: [2] }]]);
  const fused = fuse([keyword([10, 20], [500])], lookups([[10, 1], [20, 2]], map), 10);
  assert.deepEqual(fused.map((hit) => hit.passageRowid), [20, 10]);
  assert.deepEqual(fused[0]?.reasons.map((reason) => reason.kind), ["direct", "via_link"]);

  const onlyConcept = fuse([keyword([10], [500])], lookups([[10, 1], [20, 2]], map, [[2, 20]]), 10);
  assert.deepEqual(onlyConcept.map((hit) => hit.passageRowid), [10, 20]);
  assert.equal(onlyConcept[1]?.reasons[0]?.kind, "via_link");
});

test("a source card counts for more than a concept page, and an entity for less", () => {
  const link = (collection: "sources" | "concepts" | "entities") => new Map([[500, { collection, links: [2] }]]);
  const scoreOf = (collection: "sources" | "concepts" | "entities") =>
    fuse([keyword([], [500])], lookups([[20, 2]], link(collection), [[2, 20]]), 10)[0]?.score ?? 0;
  assert.ok(scoreOf("sources") > scoreOf("concepts"));
  assert.ok(scoreOf("concepts") > scoreOf("entities"));
});

test("notes reached only through a link are listed so the searcher can fetch their passage", () => {
  const map = new Map([[500, { collection: "sources" as const, links: [1, 2] }]]);
  assert.deepEqual(notesNeedingPassage([keyword([10], [500])], lookups([[10, 1]], map)), [2]);
});

test("only the top map passages expand", () => {
  const mapRowids = Array.from({ length: RANK_POLICY.expandTopMap + 1 }, (_value, index) => 1000 + index);
  const map = new Map(mapRowids.map((rowid, index) => [rowid, { collection: "sources" as const, links: [100 + index] }]));
  const needing = notesNeedingPassage([keyword([], mapRowids)], lookups([], map));
  assert.equal(needing.length, RANK_POLICY.expandTopMap);
});

test("passages with identical text collapse into the higher scored one and remember the twin", () => {
  const fused = fuse([keyword([10, 20, 30])], lookups([[10, 1, "same"], [20, 2, "same"], [30, 3]]), 10);
  assert.deepEqual(fused.map((hit) => hit.passageRowid), [10, 30]);
  assert.deepEqual(fused[0]?.duplicates, [20]);
});

test("at most maxPerNote passages of one note survive", () => {
  const rows: Citable[] = [[10, 1], [11, 1], [12, 1], [20, 2]];
  const fused = fuse([keyword([10, 11, 12, 20])], lookups(rows), 10);
  assert.deepEqual(fused.map((hit) => hit.passageRowid), [10, 11, 20]);
});

test("the list is cut to the limit", () => {
  const rows: Citable[] = [[10, 1], [20, 2], [30, 3]];
  assert.equal(fuse([keyword([10, 20, 30])], lookups(rows), 2).length, 2);
});

test("without hits the evidence is absent, and a linked top hit is never strong", () => {
  assert.equal(judgeEvidence({ fused: [], topCoverage: 0, channels, nearestCosine: null }).level, "absent");

  const map = new Map([[500, { collection: "sources" as const, links: [2] }]]);
  const linked = fuse([keyword([], [500])], lookups([[20, 2]], map, [[2, 20]]), 10);
  const verdict = judgeEvidence({ fused: linked, topCoverage: 0.9, channels, nearestCosine: null });
  assert.equal(verdict.level, "weak");
  assert.equal(verdict.signals.topIsDirect, false);
});

const { floors, strongCoverage } = RANK_POLICY.evidence;
const signals = (overrides: Partial<Evidence["signals"]> = {}): Evidence["signals"] => ({
  topCoverage: strongCoverage + 0.1,
  topIsDirect: true,
  channelAgreement: floors.agreement + 0.2,
  nearestCosine: floors.cosine + 0.02,
  ...overrides,
});
const failing = { topCoverage: floors.coverage - 0.1, channelAgreement: floors.agreement - 0.2, nearestCosine: floors.cosine - 0.02 };

test("with every signal measured, strong needs all of them, and absent needs most of them to fail", () => {
  assert.equal(levelOf(signals()), "strong");
  assert.equal(levelOf(signals({ topIsDirect: false })), "weak");
  assert.equal(levelOf(signals({ topCoverage: floors.coverage })), "weak");
  assert.equal(levelOf(signals({ channelAgreement: failing.channelAgreement })), "weak");
  assert.equal(levelOf(signals({ topCoverage: failing.topCoverage, channelAgreement: failing.channelAgreement })), "absent");
  assert.equal(levelOf(signals(failing)), "absent");
});

test("a hit the vector channel found with few shared terms is not absent", () => {
  assert.equal(levelOf(signals({ topCoverage: failing.topCoverage })), "weak");
});

test("a keyword-only search measures coverage alone, so coverage alone decides", () => {
  const alone = (topCoverage: number) => signals({ topCoverage, channelAgreement: null, nearestCosine: null });
  assert.equal(levelOf(alone(failing.topCoverage)), "absent");
  assert.equal(levelOf(alone(floors.coverage)), "weak");
  assert.equal(levelOf(alone(strongCoverage)), "strong");
});

const both = ["keyword", "vector"] as const;

test("a passage that both channels rank outranks one that a single channel ranks first", () => {
  const rows: Citable[] = [[10, 1], [20, 2], [30, 3]];
  const fused = fuse([keyword([10, 20]), vector([30, 20])], lookups(rows), 10);
  assert.equal(fused[0]?.passageRowid, 20);
  assert.deepEqual(fused[0]?.reasons.map((reason) => reason.kind === "direct" && reason.channel), ["keyword", "vector"]);
});

test("channel agreement is the share of the top hits that every channel found directly, and absent with one channel", () => {
  const rows: Citable[] = [[10, 1], [20, 2], [30, 3], [40, 4]];
  const fused = fuse([keyword([10, 20, 30]), vector([20, 30, 40])], lookups(rows), 10);
  assert.deepEqual(fused.map((hit) => hit.passageRowid), [20, 30, 10, 40]);
  assert.equal(judgeEvidence({ fused, topCoverage: 0.8, channels: both, nearestCosine: 0.9 }).signals.channelAgreement, 0.5);
  assert.equal(judgeEvidence({ fused, topCoverage: 0.8, channels, nearestCosine: null }).signals.channelAgreement, null);
  assert.equal(judgeEvidence({ fused: [], topCoverage: 0, channels: both, nearestCosine: null }).signals.channelAgreement, null);
});

test("a concept hit in the vector channel expands to its putusan like a keyword one", () => {
  const map = new Map([[500, { collection: "concepts" as const, links: [2] }]]);
  const fused = fuse([vector([10], [500])], lookups([[10, 1], [20, 2]], map, [[2, 20]]), 10);
  assert.deepEqual(fused[1]?.reasons[0], { kind: "via_link", channel: "vector", rank: 1, fromMapRowid: 500 });
});
