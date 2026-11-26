import type { EvidenceLevel, HptIndex, Passage, PassageId, SearchHit, SearchOptions, SearchResult } from "../features/search/index.ts";

export type FakeIndex = HptIndex & {
  readonly queries: { readonly query: string; readonly options: SearchOptions | undefined }[];
  /** Which passages a query finds. Default: all of them, in order. */
  find: (query: string, options: SearchOptions | undefined) => readonly Passage[];
  evidence: (query: string) => EvidenceLevel;
};

const hitOf = (passage: Passage, rank: number): SearchHit => ({ passage, score: 1 / (rank + 1), reasons: [{ kind: "direct", channel: "keyword", rank }], duplicates: [] });

export function fakeIndex(passages: readonly Passage[]): FakeIndex {
  const queries: FakeIndex["queries"] = [];
  const index: FakeIndex = {
    queries,
    find: (_query, options) => {
      const noteIds = options?.filter?.noteIds;
      return passages.filter((passage) => noteIds === undefined || noteIds.includes(passage.noteId));
    },
    evidence: () => "strong",
    info: {
      path: "fake.sqlite",
      schemaVersion: 1,
      chunkerVersion: 1,
      foldVersion: 1,
      channels: ["keyword"],
      embedding: null,
      fingerprint: "fake-fingerprint",
      counts: { notes: passages.length, passages: passages.length, mapPassages: 0 },
    },
    async search(query, options) {
      queries.push({ query, options });
      const found = index.find(query, options).slice(0, options?.limit ?? 10);
      const level = index.evidence(query);
      const result: SearchResult = {
        hits: found.map(hitOf),
        leads: [],
        evidence: { level, signals: { topCoverage: 1, topIsDirect: true, channelAgreement: null, nearestCosine: null } },
        channels: ["keyword"],
        ms: { keyword: 1, embed: 0, vector: 0, total: 1 },
      };
      return result;
    },
    getPassages: (ids) => new Map(passages.filter((passage) => ids.includes(passage.id)).map((passage) => [passage.id as PassageId, passage])),
    passagesOfNote: (noteId) => passages.filter((passage) => passage.noteId === noteId).sort((a, b) => a.ordinal - b.ordinal),
    hasPutusan: () => true,
    close: () => {},
  };
  return index;
}
