# Keyword retrieval baseline

This is the retrieval score of the keyword-only index, before vectors exist. Part 2 of Phase 1 adds the vector channel and must beat these numbers. The score uses no model: it runs the labelled eval questions through `HptIndex.search` and checks which expected documents come back.

The labels are silver. They are the documents HPT's own agent read for each conversation, not verified answers. Each conversation lists 15 references on average, and 105 of the 2,275 references point at concepts, entities or the Quran, which are not citable. The rest map from `sources/<slug>` to `putusan/<slug>`.

This report holds numbers and conversation IDs only. `pnpm check:public` rejects question or answer text.

## Rerun

```
pnpm hpt build
pnpm hpt eval retrieval
```

The run writes a JSON file with every conversation's ranks to `data/eval/`. The fingerprint below names the exact index the numbers came from.

## Results

Index fingerprint `6f149ef1ab34`, channels keyword, 151 labelled conversations.
Skipped: 0 unreadable rows, 1 rows whose references map to no putusan, 105 references to concepts, entities or the Quran.

| k | recall@k | best possible recall@k | hit@k |
|---|---|---|---|
| 5 | 0.281 | 0.824 | 0.669 |
| 10 | 0.393 | 0.981 | 0.748 |

MRR 0.476. Search time p50 12.0 ms, p95 29.5 ms.

| Evidence level | hit@10 | miss@10 | no references |
|---|---|---|---|
| strong | 46 | 5 | 11 |
| weak | 36 | 16 | 16 |
| absent | 31 | 17 | 66 |

A hit at k means one passage of an expected document (or of an identical copy of it) is among the first k passages. Recall at k is the share of a conversation's expected documents found in the first k passages, averaged over conversations. The best possible recall column is the same average if every one of the k passages were an expected document. It is below 1 because k passages cannot cover a conversation that expects more than k documents.

## Reading the numbers

**Recall is capped by the list length.** Recall@10 is 0.393 against a best possible 0.981, so the index finds about 40 percent of what a perfect ranking of ten passages could. Hit@10 is the fairer headline, because one conversation expects up to 18 documents and an answer needs far fewer.

**Ranking, not retrieval, loses most misses.** The 100-passage keyword pool contains an expected document for 0.894 of conversations, and 0.645 of all expected documents. Hit@10 is 0.748, so about 15 points of conversations have the right document retrieved but ranked below 10. The remaining 11 percent have no expected document in the pool at all. This is measured from the pool before fusion.

**Evidence level separates well at the top and poorly below it.** Strong is right in 46 of 51 conversations. Absent covers 17 misses, but also 31 conversations that did hit, and 66 of the 93 conversations without references. The coverage threshold counts the terms of the whole question, and questions have a median of 6 content terms and a maximum of 149. A long conversational question can fail the 0.34 coverage floor while still retrieving the right document. That reason is a guess. The thresholds are the first numbers to calibrate.

**Noise floor.** With 151 conversations the standard error of a hit rate near 0.75 is about 0.035, so differences smaller than that between runs are not evidence.

## Link expansion ablation

Each row changes one value in `RANK_POLICY` and reruns the eval on the same index.

| Variant | recall@5 | recall@10 | hit@5 | hit@10 | MRR |
|---|---|---|---|---|---|
| Baseline policy | 0.281 | 0.393 | 0.669 | 0.748 | 0.476 |
| No link expansion | 0.244 | 0.374 | 0.689 | 0.742 | 0.529 |
| Source cards only | 0.250 | 0.376 | 0.642 | 0.748 | 0.503 |
| Source cards and concepts | 0.273 | 0.386 | 0.662 | 0.755 | 0.468 |
| One passage per note | 0.281 | 0.404 | 0.669 | 0.755 | 0.477 |

Link expansion raises recall (0.281 against 0.244 at k = 5) and lowers MRR (0.476 against 0.529). It pulls in more expected documents and pushes the best one down. The hit rates differ by less than the noise floor. This run did not measure the spread of recall or MRR, so treat those two differences as a lead, not a result. The policy stays as designed in this PR. Part 2 should retune it once vectors change the candidate lists.

## What this baseline leaves out

- No vector channel. Part 2 adds it.
- No stemming. "Menyembelih" and "sembelih" are different terms.
- No hand review of the labels. Some misses may be labels that point at documents the question never needed.

## Misses at 10

38 conversations had no expected document in the first 10 passages. Each line gives the conversation ID, the number of expected documents and the evidence level.

- 9787cd1f-dd69-428f-acda-1718d3ee70c0, 1 expected, weak
- a19077f7-7029-4f0c-9db3-f7ff70dcca8a, 4 expected, weak
- ddfa2cdf-35c6-495c-87ab-af99ff9077aa, 18 expected, absent
- 3dced864-9f7a-408d-83c5-5349f82c44c3, 4 expected, absent
- d0c5c51e-c9d7-40e8-ab0e-adbc555abc5a, 8 expected, weak
- 85dff5b5-1a6d-4566-b6bb-1a799d3e1a29, 4 expected, weak
- 0b025d0d-b132-4df0-a18a-52141a526477, 4 expected, absent
- 11063d2e-2ea5-415d-af90-9a9a88e64638, 7 expected, absent
- cbe0048c-ed7b-4610-9107-ef6d6dbaa729-2, 6 expected, weak
- cbe0048c-ed7b-4610-9107-ef6d6dbaa729-3, 5 expected, weak
- 8b2ac94f-c1b2-4f82-ae64-77495839270a, 5 expected, weak
- e29f2958-54f7-47cd-b3f0-b30288fcb71c, 3 expected, strong
- 0307cb3e-c393-4c88-ab0f-0e14d97ebe4d, 1 expected, absent
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-7, 4 expected, weak
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-8, 3 expected, weak
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-9, 6 expected, absent
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-12, 7 expected, absent
- c2d8b06e-994b-4015-97b3-0a9fdab3ac85, 4 expected, weak
- 9346ccb2-25b5-4306-b249-e3604b8b37ca, 2 expected, absent
- 00e7ea92-a91f-4606-8acc-a6655b20f4e9, 3 expected, weak
- cddfdd42-ccf7-4677-849d-bb4479916960, 3 expected, absent
- b88532bc-f73b-4f1d-87fc-3874297cadc0, 5 expected, absent
- 1046288f-4405-47ab-be67-59cee94e6fb0, 2 expected, weak
- 1aecca39-57ea-4083-858b-3cf3cc207ba0, 7 expected, absent
- 41e7c941-fabf-4189-86c3-b2363036b6b9, 1 expected, weak
- 186ea347-4752-4ca0-8077-7cd3a965dff3, 10 expected, absent
- 3ab6a8d4-b1dc-400c-a699-ff1d0b7c1bd2, 6 expected, absent
- 7456c1e2-efa6-4d31-af45-10e6c612c544, 3 expected, weak
- 26763934-7a2c-49a9-91ab-e663fc25ed88, 3 expected, absent
- 2785327c-fe82-4b39-a387-293ddcc0d75e, 2 expected, weak
- b14de9f4-7eb4-44d5-93f9-4273542c201e, 8 expected, absent
- 0d1bb853-225c-4ef0-8ea4-cb9fb92f1294-2, 4 expected, strong
- 0d1bb853-225c-4ef0-8ea4-cb9fb92f1294-23, 3 expected, strong
- 0d1bb853-225c-4ef0-8ea4-cb9fb92f1294-26, 1 expected, strong
- 14b5b27a-32d6-4041-9020-6c7e9f559997, 4 expected, absent
- 7f76432c-0c4b-4067-a5ff-3cf09d51f1ff, 2 expected, weak
- 135d4c84-5fcc-4b16-bf80-969b895aa4ad-3, 1 expected, strong
- 135d4c84-5fcc-4b16-bf80-969b895aa4ad-4, 1 expected, absent
