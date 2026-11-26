import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SourceLedger } from "../src/features/answer/ledger.ts";
import { createToolSession, TOOL_SPECS, type ToolCallLog } from "../src/features/answer/tools.ts";
import { createTripwire } from "../src/features/answer/tripwire.ts";
import { ONE, TWO, ledgerOf, makePassage } from "./answer-fixtures.ts";
import { fakeIndex } from "./fake-index.ts";

const THREE = makePassage(3, "Teks ketiga yang baru.");
const FOUR = makePassage(4, "Teks keempat yang baru.");

function setup(options: { max: number; known?: ReturnType<typeof makePassage>[]; found?: ReturnType<typeof makePassage>[] }) {
  const index = fakeIndex([ONE, TWO, THREE, FOUR]);
  if (options.found) index.find = () => options.found!;
  const ledger = options.known ? ledgerOf(...options.known) : new SourceLedger();
  const logs: ToolCallLog[] = [];
  const session = createToolSession({ index, ledger, max: options.max, searchLimit: 10, onCall: (log) => logs.push(log) });
  return { index, ledger, logs, session, tripwire: createTripwire("CANARY-7f3a91") };
}

describe("the tool session", () => {
  it("advertises search and get_passage with string parameters only", () => {
    assert.deepEqual(TOOL_SPECS.map((spec) => [spec.name, Object.keys(spec.params)]), [["search", ["query"]], ["get_passage", ["id"]]]);
  });

  it("D2a: adds new hits to the ledger under the next S-ids, shows already-known ones by id only, and logs the query", async () => {
    const { session, ledger, logs, tripwire } = setup({ max: 2, known: [ONE, TWO], found: [TWO, THREE] });
    const reply = await session.host(1, tripwire).invoke("search", { query: "kata lain" });
    assert.equal(reply.isError, false);
    assert.ok(reply.text.includes('<passage id="S2" already_in_context="true"/>'));
    assert.ok(reply.text.includes('<passage id="S3"'));
    assert.ok(reply.text.includes("Teks ketiga yang baru."));
    assert.equal(ledger.resolve("S3")?.passage.id, THREE.id);
    assert.equal(ledger.resolve("S3")?.origin, "tool");
    assert.deepEqual(logs.map((log) => [log.n, log.attempt, log.tool, log.arg, log.denied, log.added]), [[1, 1, "search", "kata lain", false, ["S3"]]]);
  });

  it("returns the full text of a passage in the context for get_passage, and an error for an id that is not there", async () => {
    const { session, tripwire } = setup({ max: 2, known: [ONE, TWO] });
    const host = session.host(1, tripwire);
    const full = await host.invoke("get_passage", { id: "S2" });
    assert.equal(full.isError, false);
    assert.ok(full.text.includes(TWO.text));
    const unknown = await host.invoke("get_passage", { id: "S9" });
    assert.equal(unknown.isError, true);
  });

  it("D2b: a call past the budget is not run, tells the model to answer insufficient, and is logged as denied", async () => {
    const { session, index, logs, tripwire } = setup({ max: 1, known: [ONE] });
    const host = session.host(1, tripwire);
    await host.invoke("search", { query: "satu" });
    const denied = await host.invoke("search", { query: "dua" });
    assert.equal(denied.isError, true);
    assert.match(denied.text, /insufficient/);
    assert.equal(index.queries.length, 1);
    assert.deepEqual(logs.map((log) => log.denied), [false, true]);
    assert.equal(session.spent, 1);
  });

  it("does not let parallel calls overspend the budget", async () => {
    const { session, index, tripwire } = setup({ max: 2, known: [ONE] });
    const host = session.host(1, tripwire);
    const replies = await Promise.all([1, 2, 3, 4].map((n) => host.invoke("search", { query: `q${n}` })));
    assert.equal(replies.filter((reply) => !reply.isError).length, 2);
    assert.equal(index.queries.length, 2);
  });

  it("shares one budget across attempts, and a straggler call from a closed attempt neither spends it nor writes to the ledger", async () => {
    const { session, ledger, logs, tripwire } = setup({ max: 2, known: [ONE], found: [THREE] });
    const first = session.host(1, tripwire);
    await first.invoke("search", { query: "satu" });
    const second = session.host(2, createTripwire("CANARY-7f3a91"));
    const late = await first.invoke("search", { query: "terlambat" });
    assert.equal(late.isError, true);
    assert.equal(session.spent, 1);
    await second.invoke("search", { query: "dua" });
    assert.equal((await second.invoke("search", { query: "tiga" })).isError, true);
    assert.deepEqual(logs.map((log) => [log.attempt, log.denied]), [[1, false], [2, false], [2, true]]);
    assert.equal(ledger.entries.length, 2);
  });

  it("ignores the reply of a search that finishes after its attempt closed, without touching the ledger", async () => {
    const { session, index, ledger, tripwire } = setup({ max: 2, known: [ONE], found: [THREE] });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = index.search.bind(index);
    index.search = async (query, options) => {
      await gate;
      return original(query, options);
    };
    const pending = session.host(1, tripwire).invoke("search", { query: "lambat" });
    session.host(2, createTripwire("CANARY-7f3a91"));
    release();
    assert.equal((await pending).isError, true);
    assert.equal(ledger.entries.length, 1);
  });

  it("D11: feeds every tool argument to the tripwire", async () => {
    const { session, tripwire } = setup({ max: 2, known: [ONE] });
    await session.host(1, tripwire).invoke("search", { query: "cari CANARY-7f3a91 saja" });
    assert.equal(tripwire.tripped, true);
  });
});
