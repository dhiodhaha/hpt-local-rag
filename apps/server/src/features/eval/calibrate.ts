import { levelOf, RANK_POLICY, type EvidenceFloors, type EvidenceLevel } from "../search/index.ts";
import type { CaseResult, EvidenceSplit, UnreferencedResult, VariantReport } from "./retrieval.ts";

/**
 * hit: an expected note is in the top 10. miss: expected notes exist and none is. unreferenced: HPT answered
 * without reading a document. A miss or an unreferenced conversation is one the evidence level should not trust.
 */
export type Label = "hit" | "miss" | "unreferenced";

export type LabelledSignals = { label: Label; signals: CaseResult["signals"] };

/** The coverage floors stay under `strongCoverage`: a floor above it would raise the bar for strong without anyone choosing to. */
export const FLOOR_GRID = {
  coverage: [0.2, 0.3, 0.4, 0.5],
  agreement: [0.2, 0.4, 0.6],
  cosine: [0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89],
} as const;

const SPLITS = 200;
const SEED = 1;
const FLOOR_KEYS = ["coverage", "agreement", "cosine"] as const;

export function labelled(variant: Pick<VariantReport, "results" | "unreferenced">): LabelledSignals[] {
  const found = (result: CaseResult) => Object.values(result.ranks).some((rank) => rank !== null);
  return [
    ...variant.results.map((result): LabelledSignals => ({ label: found(result) ? "hit" : "miss", signals: result.signals })),
    ...variant.unreferenced.map((result: UnreferencedResult): LabelledSignals => ({ label: "unreferenced", signals: result.signals })),
  ];
}

function absentShare(levels: readonly { label: Label; level: EvidenceLevel }[], wanted: (label: Label) => boolean): number {
  const group = levels.filter((entry) => wanted(entry.label));
  return group.length === 0 ? 0 : group.filter((entry) => entry.level === "absent").length / group.length;
}

const levelsWith = (cases: readonly LabelledSignals[], floors: EvidenceFloors) => cases.map((entry) => ({ label: entry.label, level: levelOf(entry.signals, floors) }));

const separation = (levels: readonly { label: Label; level: EvidenceLevel }[]) =>
  absentShare(levels, (label) => label !== "hit") - absentShare(levels, (label) => label === "hit");

/**
 * Youden's J: the share of untrustworthy conversations the level calls absent, minus the share of hit conversations
 * it wrongly calls absent. It weighs both mistakes equally and has no tuning knob of its own.
 */
export function youden(cases: readonly LabelledSignals[], floors: EvidenceFloors): number {
  return separation(levelsWith(cases, floors));
}

export function gridFloors(): EvidenceFloors[] {
  return FLOOR_GRID.coverage.flatMap((coverage) =>
    FLOOR_GRID.agreement.flatMap((agreement) => FLOOR_GRID.cosine.map((cosine) => ({ coverage, agreement, cosine }))),
  );
}

/** The grid point with the highest J. A tie goes to the earliest point, which has the lowest floors. */
export function bestFloors(cases: readonly LabelledSignals[]): EvidenceFloors {
  let best = { floors: gridFloors()[0] as EvidenceFloors, score: -Infinity };
  for (const floors of gridFloors()) {
    const score = youden(cases, floors);
    if (score > best.score) best = { floors, score };
  }
  return best.floors;
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other] as T, shuffled[index] as T];
  }
  return shuffled;
}

export type LevelTable = Record<Label, EvidenceSplit>;

export type Calibration = {
  cases: Record<Label, number>;
  /** Floors fitted on every conversation. */
  fitted: EvidenceFloors;
  fittedJ: number;
  /** The floors in RANK_POLICY, which a rerun is meant to leave equal to `fitted`. */
  shipped: EvidenceFloors;
  shippedJ: number;
  shippedLevels: LevelTable;
  /** Each conversation judged with floors fitted on the other conversations. */
  leaveOneOut: { levels: LevelTable; j: number };
  /** Fit on a random half, score on the other half, over many halves. */
  splitHalf: { splits: number; heldOutJ: { mean: number; sd: number }; fittedFloors: Record<keyof EvidenceFloors, Record<string, number>> };
};

function tabulate(entries: readonly { label: Label; level: EvidenceLevel }[]): LevelTable {
  const table: LevelTable = {
    hit: { strong: 0, weak: 0, absent: 0 },
    miss: { strong: 0, weak: 0, absent: 0 },
    unreferenced: { strong: 0, weak: 0, absent: 0 },
  };
  for (const { label, level } of entries) table[label][level] += 1;
  return table;
}

export function calibrate(cases: readonly LabelledSignals[]): Calibration {
  const fitted = bestFloors(cases);
  const shipped = RANK_POLICY.evidence.floors;
  const counts: Record<Label, number> = { hit: 0, miss: 0, unreferenced: 0 };
  for (const { label } of cases) counts[label] += 1;

  const leaveOneOut = cases.map((entry, index) => ({
    label: entry.label,
    level: levelOf(entry.signals, bestFloors(cases.filter((_other, other) => other !== index))),
  }));

  const heldOut: number[] = [];
  const fittedFloors: Calibration["splitHalf"]["fittedFloors"] = { coverage: {}, agreement: {}, cosine: {} };
  for (let round = 0; round < SPLITS; round += 1) {
    const order = seededShuffle(cases, SEED + round);
    const half = Math.floor(order.length / 2);
    const floors = bestFloors(order.slice(0, half));
    heldOut.push(youden(order.slice(half), floors));
    for (const key of FLOOR_KEYS) fittedFloors[key][String(floors[key])] = (fittedFloors[key][String(floors[key])] ?? 0) + 1;
  }
  const mean = heldOut.reduce((total, value) => total + value, 0) / heldOut.length;
  const sd = Math.sqrt(heldOut.reduce((total, value) => total + (value - mean) ** 2, 0) / heldOut.length);

  return {
    cases: counts,
    fitted,
    fittedJ: youden(cases, fitted),
    shipped,
    shippedJ: youden(cases, shipped),
    shippedLevels: tabulate(levelsWith(cases, shipped)),
    leaveOneOut: { levels: tabulate(leaveOneOut), j: separation(leaveOneOut) },
    splitHalf: { splits: SPLITS, heldOutJ: { mean, sd }, fittedFloors },
  };
}

const fixed = (value: number) => value.toFixed(3);
const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const floorsText = (floors: EvidenceFloors) => `coverage ${floors.coverage}, agreement ${floors.agreement}, cosine ${floors.cosine}`;

/** Numbers only. */
export function formatCalibration(calibration: Calibration): string {
  const table = (title: string, levels: LevelTable) => [
    "",
    title,
    "",
    row(["Level", "hit@10", "miss@10", "no refs"]),
    row(["---", "---", "---", "---"]),
    ...(["strong", "weak", "absent"] as const).map((level) => row([level, String(levels.hit[level]), String(levels.miss[level]), String(levels.unreferenced[level])])),
  ];
  const { cases, splitHalf } = calibration;
  const stability = FLOOR_KEYS.map((key) => {
    const counts = Object.entries(splitHalf.fittedFloors[key]).sort((a, b) => b[1] - a[1]);
    return `- ${key} floor, chosen in ${splitHalf.splits} random halves: ${counts.map(([value, count]) => `${value} ${count}`).join(", ")}`;
  });
  return [
    `Conversations: ${cases.hit} with a hit at 10, ${cases.miss} without, ${cases.unreferenced} with no references.`,
    `Fitted on all of them: ${floorsText(calibration.fitted)}, J ${fixed(calibration.fittedJ)}.`,
    `In RANK_POLICY: ${floorsText(calibration.shipped)}, J ${fixed(calibration.shippedJ)}.`,
    ...table("Levels with the floors in RANK_POLICY.", calibration.shippedLevels),
    ...table("Levels with floors fitted on the other conversations for each one (leave-one-out).", calibration.leaveOneOut.levels),
    "",
    `Leave-one-out J ${fixed(calibration.leaveOneOut.j)}. Split-half held-out J: mean ${fixed(splitHalf.heldOutJ.mean)}, sd ${fixed(splitHalf.heldOutJ.sd)}.`,
    "",
    ...stability,
  ].join("\n");
}
