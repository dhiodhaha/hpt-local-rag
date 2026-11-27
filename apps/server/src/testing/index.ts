/**
 * `@hpt/server/testing`: the Node-only entry for scripted runs and tests. Everything here uses fictional text, never corpus text.
 */
export { ARABIC, GOOD_ANSWER, ONE, TWO, answerJson, makePassage } from "./answer-fixtures.ts";
export { fakeIndex } from "./fake-index.ts";
export { READER_CITED, READER_NOTE, READER_PASSAGES, READER_TITLE, NEW_NOTE, OLD_NOTE, REVISED_NEW, REVISED_OLD, TJ_NOTE, TJ_PASSAGES, TJ_TITLE } from "./reader-fixtures.ts";
export type { FakeIndex } from "./fake-index.ts";
export { seedConversations } from "./riwayat-seed.ts";
export { memoryPipe } from "./memory-pipe.ts";
export { SCENARIOS, SCENARIO_NAMES, isScenarioName, recordScenario, scenarioDeps, scenarioHost, scenarioRig } from "./scenarios.ts";
export type { ScenarioName, ScenarioOptions, ScenarioRig } from "./scenarios.ts";
