# Hybrid retrieval: keyword, vector and both

This report answers one question: does adding the vector channel beat the keyword baseline in `keyword-baseline.md`? It scores keyword only, vector only and hybrid on the same 151 labelled conversations and the same index file. Hybrid fuses the keyword and vector lists with the same reciprocal rank fusion as before. `RANK_POLICY` is unchanged except for one new number, `evidence.agreementTop`, which the new `channelAgreement` signal reads.

The labels are silver, as in the baseline: they are the documents HPT's own agent read. This report holds numbers and conversation IDs only. `pnpm check:public` rejects question or answer text.

## Rerun

```
pnpm hpt build
pnpm hpt eval retrieval
```

`pnpm hpt build --keyword-only` builds the keyword channel alone and reproduces the baseline index. Its fingerprint is `6f149ef1ab34` and its size is 57,712,640 bytes, the same as the baseline. The run writes every conversation's ranks to `data/eval/`.

## Verdict

Hybrid beats the keyword baseline. Hit@10 rises from 0.748 to 0.828, MRR from 0.476 to 0.538 and recall@10 from 0.393 to 0.441. Four of the five differences clear the noise floor. The vector channel alone does not beat keyword search. With links on it scores below keyword, and its recall at both cutoffs falls short by more than the noise floor.

## Results

Index fingerprint `40a22323c597`, channels keyword + vector, 151 labelled conversations. The keyword rows reproduce the baseline exactly.
Skipped: 0 unreadable rows, 1 rows whose references map to no putusan, 105 references to concepts, entities or the Quran.

| Variant | recall@5 | recall@10 | hit@5 | hit@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| keyword | 0.281 | 0.393 | 0.669 | 0.748 | 0.476 |
| keyword, no links | 0.244 | 0.374 | 0.689 | 0.742 | 0.529 |
| vector | 0.235 | 0.336 | 0.623 | 0.682 | 0.463 |
| vector, no links | 0.209 | 0.281 | 0.596 | 0.675 | 0.456 |
| hybrid | 0.302 | 0.441 | 0.742 | 0.828 | 0.538 |
| hybrid, no links | 0.265 | 0.368 | 0.695 | 0.768 | 0.529 |

"No links" turns link expansion off for that variant. Every other setting is the same.

## The noise floor

The runs are deterministic: the keyword rows match the baseline to three decimals, so there is no run-to-run spread to measure. The uncertainty comes from the 151 conversations. Every variant answers the same conversations, so each difference below is paired per conversation. Each cell is the mean difference plus or minus the 95 percent half-width, which is 1.96 times the standard error of the 151 per-conversation differences. A star means the difference is larger than that half-width. This is tighter than the 0.035 unpaired figure in the baseline, because the same conversations are easy or hard for every variant.

Thirty-five cells are tested, so about two stars could be chance at the 95 percent level. The hybrid row has four stars on correlated metrics, which is not what two chance stars look like. A single star elsewhere is a lead.

### Against the keyword variant with the same link setting

| Variant | recall@5 | recall@10 | hit@5 | hit@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| vector | -0.046 ± 0.043 * | -0.057 ± 0.049 * | -0.046 ± 0.087 | -0.066 ± 0.077 | -0.013 ± 0.070 |
| vector, no links | -0.035 ± 0.040 | -0.093 ± 0.043 * | -0.093 ± 0.087 * | -0.066 ± 0.075 | -0.073 ± 0.077 |
| hybrid | +0.020 ± 0.032 | +0.048 ± 0.032 * | +0.073 ± 0.061 * | +0.079 ± 0.057 * | +0.062 ± 0.043 * |
| hybrid, no links | +0.021 ± 0.031 | -0.006 ± 0.030 | +0.007 ± 0.060 | +0.026 ± 0.055 | -0.000 ± 0.055 |

- **Hybrid with links beats keyword with links.** It clears the floor on recall@10, hit@5, hit@10 and MRR. Recall@5 gains 0.020, which does not clear it.
- **Hybrid without links does not beat keyword without links.** No cell clears. Most of hybrid's gain depends on link expansion. The cause is a guess: the vector channel also ranks map passages, so it adds a second list of concept and source-card hits to expand. This run did not test that.
- **Vector alone is worse than keyword.** Recall at both cutoffs clears the floor in the negative direction with links on. Hit rates and MRR do not clear it either way.

### Link expansion ablation

Each row is the variant with links minus the same variant without.

| Variant | recall@5 | recall@10 | hit@5 | hit@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| keyword | +0.037 ± 0.026 * | +0.019 ± 0.028 | -0.020 ± 0.050 | +0.007 ± 0.047 | -0.053 ± 0.055 |
| vector | +0.026 ± 0.026 * | +0.055 ± 0.028 * | +0.026 ± 0.061 | +0.007 ± 0.039 | +0.007 ± 0.051 |
| hybrid | +0.036 ± 0.029 * | +0.073 ± 0.030 * | +0.046 ± 0.056 | +0.060 ± 0.050 * | +0.009 ± 0.047 |

Link expansion helps hybrid more than it helped keyword. It adds 0.073 recall@10 and 0.060 hit@10 for hybrid, and both clear the floor. For keyword alone only recall@5 clears. The keyword MRR loss from the baseline (-0.053) reproduces here but does not clear the floor. For hybrid the MRR change is +0.009, so expansion no longer costs rank.

## Evidence levels

The level rule did not change. Counts are conversations, split by whether the variant found an expected document in its top 10.

| Evidence level | keyword hit@10 | keyword miss@10 | keyword no refs | vector hit@10 | vector miss@10 | vector no refs | hybrid hit@10 | hybrid miss@10 | hybrid no refs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| strong | 46 | 5 | 11 | 22 | 3 | 4 | 47 | 1 | 8 |
| weak | 36 | 16 | 16 | 30 | 9 | 7 | 33 | 11 | 17 |
| absent | 31 | 17 | 66 | 51 | 36 | 82 | 45 | 14 | 68 |

- **Strong got more precise.** Hybrid is right in 47 of 48 strong conversations, against 46 of 51 for keyword.
- **Absent got less trustworthy on hits.** Hybrid marks 45 of its 125 hit conversations absent, against 31 of 113 for keyword. The coverage rule counts question terms in the top passage. The vector channel finds passages that share few of those terms, so a right answer can fail the 0.34 coverage floor. This is a guess from the pattern, not a tested cause.
- **`channelAgreement` separates hits from misses.** On the top 5 hybrid hits, the mean agreement is 0.592 over the 125 conversations with a hit at 10 and 0.300 over the 26 without. The signal is reported with the level and does not change it. Calibrating the level against it is the next step, and this PR leaves it undone.

## Build and index numbers

All figures are measured on this machine, a 13th-generation Intel Core i5 with 20 threads and no GPU, running the q8 model on the CPU.

| Quantity | Value |
| --- | --- |
| Keyword-only build | 11.9 s |
| Hybrid build, cold cache | 2,042.3 s in total, of which embedding took 1,989.7 s for 19,712 distinct inputs (9.9 per second) |
| Hybrid build, warm cache | 36.5 s in total, of which embedding took 0.9 s (19,744 inputs read from the cache, none computed) |
| Index file, keyword only | 57,712,640 bytes (55.0 MiB) |
| Index file, keyword and vector | 89,767,936 bytes (85.6 MiB) |
| Added by 19,744 float32 vectors | 32,055,296 bytes (30.6 MiB), 1,624 bytes per vector |
| Embedding cache file | 92,499,968 bytes (88.2 MiB) |
| Model files in `data/models` | 130 MB |

- **Vectors are float32.** The index grows by 30.6 MiB, which is not unreasonable for a desktop app that already ships a 130 MB model. int8 would save about 23 MiB and risk recall that this eval has not measured. The decision is to stay on float32 until size matters.
- **The cache is about three times its payload.** The 19,744 vectors hold 29 MiB of floats. The file is 88.2 MiB. The likely cause is that rows arrive in hash order, which leaves SQLite pages half full. That is a guess. It costs disk only, and the cache file can be deleted at the price of a 34-minute rebuild.
- **The cold build is compute bound, as a guess from the pattern.** Embedding runs longest inputs first, and the first 800 passages took about twice as long as 800 passages near the end. I ran type checks and unit tests during the cold build, so 1,989.7 s is a slight upper bound.
- **The warm build spends its 36.5 s outside embedding.** Reading the vault, chunking, counting tokens for the truncation report and writing both indexes take that time. This run did not profile the split.

## Passages over the 512-token limit

The model reads at most 512 tokens and silently drops the rest. Token counts use the model's own tokenizer on the exact input (the `passage: ` prefix, the note title, the section and the passage text).

| Passages | Total | Over 512 tokens | Share | Tokens p50 | p90 | max |
| --- | --- | --- | --- | --- | --- | --- |
| Citable | 8,704 | 4,011 | 46.1% | 496 | 843 | 5,314 |
| Map | 11,040 | 2,442 | 22.1% | 249 | 572 | 1,320 |

This is a large share. The chunker caps passages at 300 words, but Arabic text uses many tokens per word, and the median citable passage already sits at 496 tokens. For those passages the vector describes only the first part of the text. The cause by source type is not measured. The fix would split passages by tokens, which changes passage IDs, so it is not part of this PR. The hybrid gain above is measured with this truncation in place.

## Latency

From the eval run, 151 conversations, one process, model loaded before timing.

| Variant | search p50 ms | search p95 ms | query embedding p50 ms | query embedding p95 ms |
| --- | --- | --- | --- | --- |
| keyword | 11.9 | 26.8 | - | - |
| keyword, no links | 5.0 | 16.1 | - | - |
| vector | 31.1 | 41.0 | 3.5 | 7.1 |
| vector, no links | 23.5 | 26.6 | 3.3 | 6.4 |
| hybrid | 37.0 | 56.8 | 3.3 | 6.4 |
| hybrid, no links | 28.9 | 42.9 | 3.3 | 6.7 |

Why hybrid search takes 37 ms and not 12 ms plus 3 ms: a separate run of the first 100 conversations timed the nearest-neighbour stage alone, at p50 19.2 ms and p95 20.6 ms. That stage scans both vec0 tables by brute force, 8,704 and 11,040 vectors of 384 floats. The question embedding adds 3.6 ms. Keyword search, link lookups and hydration make up the remaining time, which this run did not split further.

The first search in a process also loads the model. One cold CLI search showed 734.8 ms for the query embedding step, and a separate probe measured a 0.9 s model load.

## What this report leaves out

- No tuning of weights, pool depths, or the RRF constant. Hybrid uses equal weight for both channels.
- Vector-only search still picks the representative passage of a link-only note by keyword match, falling back to the first passage. It affects only notes reached through a link.
- No hand review of the silver labels.
- No stemming and no re-chunking by tokens.
- Evidence thresholds are not recalibrated.

## Misses at 10 for hybrid

26 conversations had no expected document in the first 10 passages, against 38 for keyword. Each line gives the conversation ID, the number of expected documents and the evidence level.

- ab96ab0b-dbe4-494a-9225-edbc03a81737, 5 expected, weak
- 21159520-c6d5-4a9e-aa76-dbc76c9a8eea, 5 expected, absent
- 3dced864-9f7a-408d-83c5-5349f82c44c3, 4 expected, absent
- 0b025d0d-b132-4df0-a18a-52141a526477, 4 expected, absent
- 11063d2e-2ea5-415d-af90-9a9a88e64638, 7 expected, absent
- cbe0048c-ed7b-4610-9107-ef6d6dbaa729-2, 6 expected, weak
- cbe0048c-ed7b-4610-9107-ef6d6dbaa729-3, 5 expected, weak
- 8b2ac94f-c1b2-4f82-ae64-77495839270a, 5 expected, weak
- 0307cb3e-c393-4c88-ab0f-0e14d97ebe4d, 1 expected, absent
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-7, 4 expected, weak
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-8, 3 expected, absent
- d4d5fc52-d4bc-4190-93d9-02fb31aef325-12, 7 expected, absent
- 9346ccb2-25b5-4306-b249-e3604b8b37ca, 2 expected, absent
- 00e7ea92-a91f-4606-8acc-a6655b20f4e9, 3 expected, weak
- cddfdd42-ccf7-4677-849d-bb4479916960, 3 expected, absent
- 1046288f-4405-47ab-be67-59cee94e6fb0, 2 expected, weak
- 1aecca39-57ea-4083-858b-3cf3cc207ba0, 7 expected, absent
- 41e7c941-fabf-4189-86c3-b2363036b6b9, 1 expected, weak
- 3f7c7113-7804-4815-84e6-4cb33602e0fa, 6 expected, absent
- 26763934-7a2c-49a9-91ab-e663fc25ed88, 3 expected, absent
- 2785327c-fe82-4b39-a387-293ddcc0d75e, 2 expected, weak
- 0d1bb853-225c-4ef0-8ea4-cb9fb92f1294-3, 3 expected, weak
- 0d1bb853-225c-4ef0-8ea4-cb9fb92f1294-26, 1 expected, weak
- 14b5b27a-32d6-4041-9020-6c7e9f559997, 4 expected, absent
- 135d4c84-5fcc-4b16-bf80-969b895aa4ad-3, 1 expected, strong
- 135d4c84-5fcc-4b16-bf80-969b895aa4ad-4, 1 expected, absent
