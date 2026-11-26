# Token-capped passages and the evidence level

`hybrid.md` measured two problems in hybrid retrieval. This report covers both fixes and what they did to the numbers.

1. 4,011 of 8,704 citable passages (46%) exceeded the embedder's 512 tokens, so their vectors saw only the head of the text. The chunker now caps each passage by the tokens of its whole embedder input as well as by words.
2. The evidence level called 45 of the 125 hit conversations absent. It now reads the channel agreement and the cosine of the nearest passage, next to coverage.

Passage ids change with the chunker, which is why this lands before the answer engine stores any. `CHUNKER_VERSION` is 2.

The labels are silver, as before: they are the documents HPT's own agent read. This report holds numbers and conversation IDs only. `pnpm check:public` rejects question or answer text.

## Rerun

```
pnpm hpt build
pnpm hpt eval retrieval
pnpm hpt eval compare <run before>.json <run after>.json
pnpm hpt eval evidence <run>.json
```

## Verdict

- **The truncation is gone.** Every citable and map passage fits in 512 tokens, counted with the model's own tokenizer on the exact input. A build now fails if one does not.
- **Retrieval did not change beyond the noise floor.** Hybrid hit@10 is 0.821 against 0.828, recall@10 0.434 against 0.441 and MRR 0.540 against 0.538. One of 30 paired cells clears the floor, and chance alone gives about 1.5. The fix did not improve retrieval either. I keep it. A vector that saw only the first 512 tokens of a passage (a tenth of the longest) is a defect the answer engine would inherit, and the fix cost nothing measurable in recall. It costs 34% more passages, 6.4 MB of index and 54 s of warm build.
- **The evidence level separates better.** The J score (defined below) rises from 0.354 to 0.558. Hit conversations marked absent fall from 45 to 29 and unreferenced conversations marked strong from 8 to 4. 29 of 124 hits are still marked absent, and the numbers below show why.

## Build

Citable passages are the pieces of putusan notes. Map passages are the concept, entity, source-card and Quran notes. Words are whitespace-separated. Tokens are the length of the full embedder input: the `passage: ` prefix, the title, the section label and the text.

| Quantity | #3 (`40a22323`) | This change (`39959021`) |
| --- | --- | --- |
| Citable passages | 8,704 | 11,690 |
| Map passages | 11,040 | 11,474 |
| Citable words p50 / p90 / max | 259 / 294 / 300 | 182 / 274 / 300 |
| Map words p50 / p90 / max | not reported | 138 / 281 / 300 |
| Citable tokens p50 / p90 / max | 496 / 843 / 5,314 | 435 / 500 / 512 |
| Map tokens p50 / p90 / max | 249 / 572 / 1,320 | 260 / 510 / 512 |
| Citable passages over 512 tokens | 4,011 | 0 |
| Map passages over 512 tokens | 2,442 | 0 |
| Index file, keyword and vector | 89,767,936 bytes | 96,206,848 bytes |
| Embedding cache file | 92,499,968 bytes | 154,091,520 bytes |

Section boundaries are intact. For every note and source type, the total words in the new index equal the old one: 1,156 groups, none missing, none added, none different. The compiled-book split into `putusan` and `penjelasan` is unchanged.

Passage ids do not depend on the channels built. A keyword-only build and the hybrid build give the same 11,690 ids with the same text hashes, and the same 11,474 map passages.

### Build time

| Build | Total | Embedding | Inputs |
| --- | --- | --- | --- |
| #3, cold cache | 2,042.3 s | 1,989.7 s | 19,712 computed |
| #3, warm cache | 36.5 s | 0.9 s | 19,744 from the cache |
| This change, with #3's cache | 919.9 s | 829.0 s | 13,141 computed, 9,979 from the cache |
| This change, warm | 90.5 s | 1.0 s | 23,164 from the cache |
| This change, keyword only | 118.0 s | none | none |

- **The cache kept 43% of the inputs** (9,979 of 23,164): passages that were already under the limit, unchanged by the new boundaries. A build from an empty cache was not timed here. Embedding runs 15.9 inputs per second here against 9.9 before, because the inputs are shorter.
- **The warm build is 54 s slower than before.** A separate run timed the chunking phase at 62.2 s and counted 1,115,361 tokenizer calls, about 56 µs each. The chunker prices every sentence and word of an oversized paragraph through the tokenizer. This is the limiter, and a measurement, not a guess. A cheaper estimate would cut it, and this report did not try.
- **The 118.0 s keyword-only time** is the one run, started right after the hybrid warm build. It includes loading the tokenizer, which every build now needs.

## Retrieval

Index fingerprint `39959021e33c`, channels keyword + vector, 151 labelled conversations. Skipped: 0 unreadable rows, 1 row whose references map to no putusan, 105 references to concepts, entities or the Quran.

| Variant | recall@5 | recall@10 | hit@5 | hit@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| keyword | 0.276 | 0.383 | 0.675 | 0.775 | 0.478 |
| keyword, no links | 0.264 | 0.366 | 0.695 | 0.755 | 0.521 |
| vector | 0.240 | 0.352 | 0.629 | 0.709 | 0.468 |
| vector, no links | 0.195 | 0.282 | 0.570 | 0.682 | 0.440 |
| hybrid | 0.306 | 0.434 | 0.762 | 0.821 | 0.540 |
| hybrid, no links | 0.267 | 0.363 | 0.675 | 0.768 | 0.510 |

The #3 rows, from `hybrid.md`: hybrid 0.302, 0.441, 0.742, 0.828, 0.538. Hybrid without links 0.265, 0.368, 0.695, 0.768, 0.529.

### The noise floor

The same 151 conversations are scored on both indexes, so each cell is paired per conversation: the mean difference plus or minus 1.96 standard errors of the 151 differences. A star means the difference is larger than that half-width. A rerun on the same index gives identical numbers (the two runs I made differ by 0.000 in every cell), so this is a question of which conversations are easy, not of run-to-run spread.

Each cell is this change minus #3.

| Variant | recall@5 | recall@10 | hit@5 | hit@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| keyword | -0.005 ± 0.013 | -0.010 ± 0.015 | +0.007 ± 0.029 | +0.026 ± 0.037 | +0.002 ± 0.020 |
| keyword, no links | +0.019 ± 0.021 | -0.009 ± 0.019 | +0.007 ± 0.034 | +0.013 ± 0.026 | -0.008 ± 0.032 |
| vector | +0.006 ± 0.013 | +0.016 ± 0.015 * | +0.007 ± 0.034 | +0.026 ± 0.041 | +0.006 ± 0.033 |
| vector, no links | -0.014 ± 0.019 | +0.001 ± 0.020 | -0.026 ± 0.058 | +0.007 ± 0.047 | -0.016 ± 0.039 |
| hybrid | +0.005 ± 0.019 | -0.006 ± 0.020 | +0.020 ± 0.047 | -0.007 ± 0.039 | +0.003 ± 0.031 |
| hybrid, no links | +0.001 ± 0.017 | -0.005 ± 0.023 | -0.020 ± 0.050 | +0.000 ± 0.049 | -0.019 ± 0.041 |

- **Thirty cells, one star.** Vector recall@10 gains 0.016. At the 95 percent level chance gives about 1.5 stars in 30 cells, so this is a lead and not a finding.
- **The keyword rows moved too**, though the keyword channel does not read vectors. The chunk boundaries changed, so keyword scores changed with them, by no more than the floor. That is a useful control: a move of this size in a channel the change did not target is the size of the noise from re-chunking alone.
- **Hybrid lost 5 conversations at hit@10 and gained 4.** Lost: `ddfa2cdf-35c6-495c-87ab-af99ff9077aa`, `3ab6a8d4-b1dc-400c-a699-ff1d0b7c1bd2`, `7456c1e2-efa6-4d31-af45-10e6c612c544`, `0d1bb853-225c-4ef0-8ea4-cb9fb92f1294-2`, `7f76432c-0c4b-4067-a5ff-3cf09d51f1ff`. Gained: `11063d2e-2ea5-415d-af90-9a9a88e64638`, `cbe0048c-ed7b-4610-9107-ef6d6dbaa729-3`, `3f7c7113-7804-4815-84e6-4cb33602e0fa`, `2785327c-fe82-4b39-a387-293ddcc0d75e`.

### Why the retrieval numbers did not move

The cause is a guess, not a tested one. The labels are notes, not passages: a conversation counts as found when any passage of an expected note is in the top 10. A truncated passage still carried its first 512 tokens, and the head of a putusan often names its subject. So the truncation cost recall only where the answer sat in the tail and no other passage of the note matched. This run did not measure that share.

What the number is not measuring: the index did change (fingerprint, passage count and 13,141 fresh vectors), no input was skipped (every input was embedded or read from the cache, none dropped), and the run has no errors. The eval is sensitive to a change of this kind only above about 0.02 in recall@10 and 0.04 to 0.05 in hit rate, which is the floor above.

## Evidence levels

### The rule

The level reads three signals of the hybrid search:

- **coverage:** the share of the question's content terms in the top hit's title and text.
- **agreement:** the share of the top 5 hits that both channels found directly.
- **cosine:** the cosine between the question and its nearest citable passage.

Each measured signal either clears its floor or fails it.

- **absent:** more than half of the measured signals fail, or there are no hits.
- **strong:** the top hit is a direct match, its coverage is at least `strongCoverage` (0.6, unchanged and not fitted), and no measured signal fails.
- **weak:** everything else.

A search with one channel measures coverage alone, so coverage alone decides. `RANK_POLICY.evidence` holds all of it: `strongCoverage` 0.6, `agreementTop` 5, and the floors coverage 0.5, agreement 0.4, cosine 0.85. The old `absentCoverage` of 0.34 is gone.

### How the floors were chosen

The rule is Youden's J. Take the conversations the level should not trust: those with no hit at 10 and those where HPT read no document. J is the share of them the level calls absent, minus the share of hit conversations it calls absent. It weighs the two mistakes equally and has no knob. The floors are the point on a grid that maximises J: coverage 0.2 to 0.5 (kept under `strongCoverage`), agreement 0.2, 0.4 or 0.6, cosine 0.83 to 0.89. A tie goes to the lowest floors.

Conversations: 124 with a hit at 10, 27 without, 93 with no references. J protects the 124 hits and catches the other 120.

| Level | #3 rule, #3 index: hit | miss | no refs | #3 rule, new index: hit | miss | no refs | New rule: hit | miss | no refs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| strong | 47 | 1 | 8 | 43 | 1 | 8 | 41 | 1 | 4 |
| weak | 33 | 11 | 17 | 36 | 11 | 14 | 54 | 5 | 15 |
| absent | 45 | 14 | 68 | 45 | 15 | 71 | 29 | 21 | 74 |

| Rule | J |
| --- | --- |
| #3 rule on the new index | 0.354 |
| New rule, fitted on all 151 and 93 conversations | 0.558 |
| New rule, leave-one-out | 0.558 |
| New rule, fitted on a random half and scored on the other half, 200 halves | 0.498 ± 0.064 (sd) |

- **Leave-one-out gives the same table** as the fit on everything. That is stability, and it does not rule out overfitting by the grid. The split-half figure does the harder test: fit on 122 conversations, score on the other 122. Its held-out J of 0.498 is 0.06 below the fit, which is the honest expectation for new conversations.
- **Floor stability across the 200 halves.** Agreement 0.4: 170, 0.6: 24, 0.2: 6. Cosine 0.85: 63, 0.84: 55, 0.88: 49, 0.86: 22, 0.87: 8, 0.83: 2, 0.89: 1. Coverage 0.5: 144, 0.2: 43, 0.4: 10, 0.3: 3. Agreement is well determined. Cosine is a plateau between 0.84 and 0.88. Coverage is the weakest signal and its floor is not well determined, so treat 0.5 as one point on a flat surface.
- **Coverage 0.6 and 0.7 score the same.** A first grid that allowed them reached J 0.560, within 0.002 of 0.558, with the leave-one-out J dropping to 0.477. I capped the grid under `strongCoverage` because a coverage floor above it would raise the bar for strong without anyone choosing that.

### Where the signals separate

Per-conversation AUC of each signal on the hybrid run, the share of pairs where the first group scores higher.

| Signal | hit vs miss | hit vs no refs | miss vs no refs |
| --- | --- | --- | --- |
| coverage | 0.641 | 0.761 | 0.690 |
| agreement | 0.782 | 0.775 | 0.508 |
| cosine | 0.708 | 0.812 | 0.650 |

On the top 5 hybrid hits, the mean channel agreement is 0.540 over the 124 conversations with a hit at 10 and 0.193 over the 27 without (0.592 and 0.300 on the #3 index). Cosine separates hits from unreferenced conversations best. Coverage separates least, which is why it alone over-flagged.

### What this leaves

- **29 of 124 hit conversations are still absent.** Down from 45. Moving a floor to rescue them also rescues the misses and the unreferenced ones, because J is flat there. The choice of how much to spend on each mistake is a product call, and J weighs them equally.
- **The labels are silver.** A "miss" is a conversation where retrieval did not find the documents HPT read. It may still have found good evidence, and an "unreferenced" conversation may be a greeting, an off-topic question or an in-scope one with no document. They are not hand-labelled, so J rewards calling all of them absent.
- **Single-channel levels are not calibrated.** On the same hybrid index, the keyword variant now marks 53 of 117 hit conversations absent (37 of 117 under the #3 rule), because 0.5 is a floor fitted for three signals. The vector variant, with coverage and cosine, marks 7 of 107. The desktop app ships the hybrid index, so I did not spend a floor on a keyword-only index.

## Latency

From the eval run, 151 conversations, one process, model loaded before timing. The nearest-neighbour scan covers 11,690 and 11,474 vectors now, against 8,704 and 11,040.

| Variant | search p50 ms | search p95 ms | query embedding p50 ms | query embedding p95 ms |
| --- | --- | --- | --- | --- |
| keyword | 12.1 | 28.2 | - | - |
| keyword, no links | 5.2 | 16.8 | - | - |
| vector | 34.5 | 45.2 | 3.5 | 7.3 |
| vector, no links | 27.2 | 31.4 | 3.3 | 6.8 |
| hybrid | 41.0 | 63.3 | 3.3 | 6.6 |
| hybrid, no links | 33.0 | 48.8 | 3.4 | 6.4 |

Hybrid search was 37.0 ms at p50 and 56.8 at p95. It is now 41.0 and 63.3. The scan is brute force and there are 17% more vectors, which fits the rise, but this run did not profile the split.

## Decisions

- **A passage is capped by tokens at the chunk and the unit.** A unit is at most half a chunk, in words and in tokens, so packing fills a chunk to within half a unit of its cap. A chunk is the sum of its units' tokens plus the overhead of its title and section. Whitespace-separated text adds up exactly in this tokenizer: on every one of the 23,164 inputs, the summed estimate equals the tokenizer's count of the whole input.
- **The section label is cut to 28 words in the embedder input.** In a scratch chunking with no token cap, 152 chunks carried a label of 20 words or more, and one note's label was 396 words, a list of titles that the heading rule had chained together. A label is two headings of at most 14 words, so a longer one is prose a markdown heading swallowed. The stored section keeps the full label.
- **A build with a passage over the limit fails.** The chunker prevents it, so the check catches a tokenizer that disagrees with the chunker, and not a corpus problem.
- **Every build loads the tokenizer, keyword-only included.** Boundaries depend on the model's limit, and an id must not depend on the channels built.

## What this report leaves out

- No test of the explanation for why retrieval did not move.
- No hand review of the silver labels, and no hand labels for the 93 unreferenced conversations.
- No cheaper chunker. The 62.2 s chunking phase is a measured cost.
- No time for a build from an empty embedding cache.
- No calibration of the single-channel levels.
