# Follow-up latency, 2026-11-27

> Measured on the owner's Claude plan login before D34; later evals run on an API key.

Numbers and case ids only. The questions stay in `data/eval/followup-cases.json`, which is not committed.

**What ran.** 12 two-turn conversations (set hash `cee32786842b`), each a first question and the follow-up asked right after its answer. 10 follow-ups build on the first answer (`continue`), 2 change topic (`shift`, f11 and f12). The same engine as the app, Opus 5.5 at low effort, up to 2 extra tool calls, one case at a time with a 2 s pause. Index `623dc944dab6`, prompt `35463381`, both runs. `before` is origin/main at acf5c42a. `after` is the same engine with the rewrite and always-on carry-over (D33). Each run was done once.

`pnpm hpt eval followups --run <id>`, then `pnpm hpt eval followups-report before after`.

## Result

|  | first turn | follow-up | follow-up, continue only |
| --- | --- | --- | --- |
| before: conversations | 12 | 12 | 10 |
| delivered | 12/12 | 12/12 | 10/10 |
| first text, s | 3.3 / 14.2 | 12.5 / 15.2 | 4.3 / 13.8 |
| first text mean, s | 6.0 | 10.2 | 6.7 |
| headline, s | 3.9 / 14.3 | 12.5 / 15.2 | 5.0 / 13.8 |
| done, s | 16.1 / 22.9 | 16.9 / 21.0 | 15.9 / 19.6 |
| answers that called a tool | 3/12 | 6/12 | 4/10 |
| search queries before the answer | 12 | 19 | 16 |
| evidence | strong 11, absent 1 | strong 6, weak 6 | strong 5, weak 5 |
| follow-up context holds a first-turn citation | - | 9/12 | - |
| attempts | 12 | 12 | 10 |
| after: conversations | 12 | 12 | 10 |
| delivered | 12/12 | 12/12 | 10/10 |
| first text, s | 4.0 / 12.4 | 4.7 / 14.9 | 4.0 / 9.0 |
| first text mean, s | 5.8 | 6.4 | 4.5 |
| headline, s | 4.7 / 12.4 | 5.5 / 14.9 | 4.6 / 9.7 |
| done, s | 17.1 / 19.9 | 16.6 / 24.5 | 14.4 / 24.5 |
| answers that called a tool | 4/12 | 2/12 | 0/10 |
| search queries before the answer | 12 | 24 | 20 |
| evidence | strong 11, absent 1 | strong 9, weak 3 | strong 7, weak 3 |
| follow-up context holds a first-turn citation | - | 12/12 | - |
| attempts | 12 | 12 | 10 |

before citations: 12 follow-ups cite, 0 ids outside their context, 0 unresolved. Follow-ups that cite a first-turn passage: continue 7/10, shift (topic bleed) 0/2.
before ids: first turn not delivered none; follow-up not delivered none; follow-up called a tool f01, f03, f04, f09, f11, f12.

after citations: 12 follow-ups cite, 0 ids outside their context, 0 unresolved. Follow-ups that cite a first-turn passage: continue 10/10, shift (topic bleed) 0/2.
after rewrite: 12/12 used, 1.4 / 1.5 s p50 / p90, fallbacks -.
after ids: first turn not delivered none; follow-up not delivered none; follow-up called a tool f11, f12.

## What the numbers say

- **Tool round trips.** Follow-ups that continue the first answer: 4 of 10 called a tool before, 0 of 10 after. The two that still call one are the topic changes, which need evidence the first answer did not have.
- **Time to first text, continuing follow-ups.** Mean 6.7 s to 4.5 s, p90 13.8 s to 9.0 s. The median moves little (4.3 s to 4.0 s) because 6 of the 10 did not search before and now wait for the rewrite, so the distribution went from two humps to one.
- **What the rewrite costs.** 1.1 to 1.5 s per follow-up (p50 1.4 s, p90 1.5 s, max 1.54 s), all 12 arrived and were used, none fell back. Retrieval for a follow-up went from 230 ms p50 to 1,535 ms p50 (the rewrite, then a second search of about 0.15 s). A follow-up that needed no search pays about 1.4 s for it.
- **Which search won.** The rewrite was chosen in 11 of 12 and the bare question in 1. Evidence level did not predict which follow-ups searched before: 3 of the 6 with strong evidence searched anyway.
- **Citation quality and topic bleed.** 0 cited ids outside their context and 0 unresolved, before and after. Follow-ups that cite a first-turn passage: continue 7 of 10 before and 10 of 10 after, shift (topic bleed) 0 of 2 before and 0 of 2 after. Carry-over is now in the context of all 12 follow-ups, up from 9.
- **First turns.** The code path is unchanged, so the first-turn columns are the noise floor of a 12-case run: p50 3.3 s and 4.0 s, p90 14.2 s and 12.4 s, tool calls 3 and 4 of 12. First turns that open at 12 s or later happen in both runs. Their cause is outside this change and was not investigated here.

## Limits

One run per side and 12 conversations, so a p90 is one or two cases. The follow-ups were written for the set and are short and referring, like a person's; they are not drawn from a real transcript. In the real conversation that started this work every follow-up searched, against 6 of 12 here, so the gain on real use may be larger. The topic-change sample is 2 cases. The rewrite was warm in every follow-up here because each turn ended 2 s before the next began.
