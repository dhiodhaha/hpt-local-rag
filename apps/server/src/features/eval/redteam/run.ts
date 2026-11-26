import { historyOf, type HistoryEntry } from "../../answer/index.ts";
import { runAnswerEval, type Run, type RunInput, type RunRecord } from "../answer/runner.ts";
import { LEVEL_8, levelHash, type RedteamCase } from "./attacks.ts";

/** History comes from the run file, not memory, so a resumed run builds the same follow-up turn. */
function historyFor(item: RedteamCase, records: readonly RunRecord[]): readonly HistoryEntry[] {
  if (item.kind !== "control" || item.after === null) return [];
  const earlier = records.find((record) => record.caseId === item.after);
  const asked = LEVEL_8.find((one) => one.id === item.after);
  if (earlier?.finished.answer == null || asked === undefined) return [];
  const { finished } = earlier;
  return historyOf([{ id: finished.id, n: 1, at: earlier.at, question: asked.question, scope: null, answer: finished.answer!, context: finished.context }]);
}

export const runRedteam = (input: Omit<RunInput<RedteamCase>, "historyOf" | "subsetHash">): Promise<Run> =>
  runAnswerEval({ ...input, subsetHash: levelHash(LEVEL_8), historyOf: historyFor });
