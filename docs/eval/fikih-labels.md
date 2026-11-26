# Fikih Muhammadiyah labels: only the decision text is putusan

Before this change a whole table-of-contents section whose title started with KEPUTUSAN was labelled putusan. An answer would then say "Tarjih memutuskan" about commentary (D12, D12a). A decision span now starts at a Memutuskan or Menetapkan line after a KEPUTUSAN heading and ends at the next section boundary, heading-like line or closing line. Everything else in a compiled book is penjelasan, including the considerations and any KEPUTUSAN section with no such line. The rule and its marker table are in `decision-spans.ts`.

`CHUNKER_VERSION` is 3. Passages never cross a span boundary, so passage ids shift in the 5 books that have a span. No chats store ids yet. This report holds counts only. The spans themselves quote the corpus, so the build writes them to `data/labels/`, which git ignores.

## Rerun

```
pnpm hpt build
pnpm hpt eval retrieval
pnpm hpt eval compare <run before>.json <run after>.json
```

The build writes `data/labels/fikih-putusan-spans.json` and `fikih-putusan-spans.md`. Line numbers there count lines of the note body, from 1.

## Counts

Citable passages by source type. Index fingerprints are `39959021` before and `623dc944` after.

| Source type | Before | After |
| --- | --- | --- |
| putusan | 52 | 6 |
| penjelasan | 2,553 | 2,606 |
| fatwa | 6,112 | 6,112 |
| hpt | 1,154 | 1,154 |
| tanya_jawab | 1,819 | 1,819 |
| Total | 11,690 | 11,697 |

Words in the compiled books. The total is the same before and after: 381,796.

| Source type | Before | After |
| --- | --- | --- |
| putusan | 8,002 | 677 |
| penjelasan | 373,794 | 381,119 |

## Spans

- 5 spans, 677 words, 6 passages, in 5 of the 67 books. Their sizes are 37, 51, 78, 203 and 308 words. Four end at a closing line (a closing formula, dateline, signature block or label from the marker table) and one at a heading-like line. None reaches the end of a book, so the word cap for an ambiguous end did not apply.
- 10 KEPUTUSAN headings in 7 books produced no span. 5 ran to the end of the book, 2 ended at a closing line, 2 at the next section and 1 at a heading-like line, in each case with no marker line first.
- 7 marker lines in 7 books sit outside any KEPUTUSAN heading. They stay penjelasan and are listed in the log so a missed decision is easy to find.

The two cases that motivated the change:

| Case | Before | After |
| --- | --- | --- |
| Bagian M, last table-of-contents entry (Pekalongan KHGT, 6,590 words) | putusan to the end of the book | penjelasan: no Memutuskan or Menetapkan line follows its heading |
| Bagian P, KEPUTUSAN SIDANG PLENO (a book with no table of contents) | penjelasan | 1 putusan passage of 51 words, from its MEMUTUSKAN line to its closing lines |

## Retrieval

Hybrid retrieval, 151 labelled conversations, same eval as `token-chunks.md`.

| Variant | hit@10 before | hit@10 after | recall@10 before | recall@10 after | MRR before | MRR after |
| --- | --- | --- | --- | --- | --- | --- |
| keyword | 0.775 | 0.775 | 0.383 | 0.383 | 0.478 | 0.478 |
| vector | 0.709 | 0.709 | 0.352 | 0.352 | 0.468 | 0.468 |
| hybrid | 0.821 | 0.821 | 0.434 | 0.433 | 0.540 | 0.540 |

Retrieval did not move. Of the 30 paired cells (6 variants, 5 metrics), the largest difference is 0.001 and none clears the noise floor. Two runs of the old index also match to three decimals, so the runs carry no spread of their own.

Why so little moved: the eval's expected notes are whole putusan notes, and ranking never reads the source type. Only passage boundaries around the spans changed. The embedding cache confirms how few: the first rebuild embedded 18 passage inputs out of 23,171 and took the rest from the cache.

The source type decides what a later step may call a decision: a putusan passage can be cited as "Tarjih memutuskan", a penjelasan passage only as the book's explanation. That is the effect this change targets, and the retrieval eval cannot see it.
