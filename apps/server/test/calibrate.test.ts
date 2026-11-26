import assert from "node:assert/strict";
import { test } from "node:test";
import { bestFloors, calibrate, formatCalibration, gridFloors, youden, type Label, type LabelledSignals } from "../src/features/eval/calibrate.ts";
import { levelOf } from "../src/features/search/index.ts";

const answered = { topCoverage: 0.8, topIsDirect: true, channelAgreement: 0.8, nearestCosine: 0.9 };
const unanswered = { topCoverage: 0.1, topIsDirect: true, channelAgreement: 0, nearestCosine: 0.8 };

function cases(counts: Record<Label, number>): LabelledSignals[] {
  const signalsOf = (label: Label) => (label === "hit" ? answered : unanswered);
  return (Object.keys(counts) as Label[]).flatMap((label) => Array.from({ length: counts[label] }, () => ({ label, signals: signalsOf(label) })));
}

test("floors that call every unanswered conversation absent and no answered one score a perfect J", () => {
  const sample = cases({ hit: 20, miss: 5, unreferenced: 15 });
  const floors = bestFloors(sample);
  assert.equal(youden(sample, floors), 1);
  assert.equal(levelOf(answered, floors), "strong");
  assert.equal(levelOf(unanswered, floors), "absent");
});

test("when no floors separate the conversations, the lowest floors win", () => {
  const same = cases({ hit: 5, miss: 5, unreferenced: 5 }).map((entry) => ({ ...entry, signals: answered }));
  assert.deepEqual(bestFloors(same), gridFloors()[0]);
});

test("a calibration counts every conversation once in each table, and a rerun gives the same answer", () => {
  const sample = cases({ hit: 12, miss: 4, unreferenced: 8 });
  const result = calibrate(sample);
  for (const table of [result.shippedLevels, result.leaveOneOut.levels]) {
    assert.deepEqual(
      [table.hit, table.miss, table.unreferenced].map((split) => split.strong + split.weak + split.absent),
      [12, 4, 8],
    );
  }
  assert.equal(Object.values(result.splitHalf.fittedFloors.agreement).reduce((total, count) => total + count, 0), result.splitHalf.splits);
  assert.deepEqual(calibrate(sample), result);
  assert.match(formatCalibration(result), /Leave-one-out J 1\.000/);
});
