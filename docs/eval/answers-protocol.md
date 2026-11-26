# Answer eval protocol

This page is written before any model run. It fixes the subset, the sweep, the quality gate and the decision rules, so no result can move them. The report that follows, `answers-<date>.md`, holds numbers and ids only.

## What the eval decides

Answerable questions took 10 to 12 s to reach a headline at medium effort on Sonnet 5.5. The model thinks for up to 9 s before it writes. The SDK cannot switch thinking off on Sonnet 5.5, so `effort` and the model are the only levers. The eval answers two questions.

1. Which model and effort reach the headline in under 4 s (build plan D7 and section 1) without losing answer quality?
2. Is it safe to show the headline before the summary passes its checks (D14), or should the engine hold it?

It also measures how many extra tool calls an answer needs (D2, D2a).

## The subset

The subset is the locked 40 questions of D13. `hpt eval answers-draft` drafts it with no model call and a fixed seed. `hpt eval answers-lock` freezes it. The lock is `answer-subset.lock.json`, with ids, categories, origins and a hash. The question text stays under `data/eval/`.

| Category | Count | Source | How it is chosen |
| --- | --- | --- | --- |
| explicit | 15 | qa_pairs | HPT cited a putusan, our evidence is strong, a cited note is in our top 5 |
| inferred | 8 | qa_pairs | HPT cited a putusan, our evidence is not strong, a cited note is in our top 10 |
| differing | 5 | qa_pairs | HPT's answer mentions a difference of views, and a cited note is in our top 10 |
| revision | 4 | written | a ruling that the corpus itself says was revised or withdrawn |
| insufficient | 4 | written | an in-scope topic whose key term appears in no putusan note |
| fictional | 4 | written | an invented ruling number (2) or a light bait with an invented quotation or citation (2) |

Only first turns are drafted. A follow-up has no meaning without its history. Each case's category reason is in `data/eval/answer-subset.draft.json` for a later spot-check.

Two limits of the subset are known before the run.

- `data/revisions.json` does not exist (D8), so the index marks no passage as superseded. The revision category can only test whether the model says a ruling changed. The check that a superseded passage is never cited outside a revision note passes with nothing to catch.
- The unsourced rows in qa_pairs are red-team and chit-chat, not in-scope questions without evidence. The insufficient and fictional categories are written by hand for that reason.

## The sweep

Every run uses the 40 questions, one at a time, with the prompt and index of the commit that ran it.

| Stage | Configurations | `maxExtraToolCalls` |
| --- | --- | --- |
| 1 | Sonnet 5.5 medium, Sonnet 5.5 low, Haiku 5.5 medium, Opus 5.5 low | 2 |
| 2 | the best-latency stage 1 configuration that passes the gate | 0, then 1 |

Stage 2 runs only on the configuration that passes the quality gate with the lowest headline p50. If a usage limit stops a run, the runner keeps what finished and the same command resumes it.

## Scoring

All scoring is by code. No model judges an answer.

- **Time.** First text, headline shown, headline settled and done, from the start of the ask, p50 and p90. Headline time counts only answers (`type: answer`). The first headline a reader sees counts, even if a restart replaces it later.
- **Type.** An explicit, inferred or differing question wants `answer`. An insufficient question wants `insufficient`. A fictional question wants `unverified_references` filled, and no cited passage whose number and year match the invented reference. A revision question wants `answer` with a `revision` note that cites at least two passages.
- **Basis.** An explicit question wants `explicit`. An inferred question wants `inferred`.
- **Citations.** Every cited id is in the answer's own context and resolves in the index. A superseded passage cited outside a revision note counts as a finding.
- **Checks.** Findings by code across all attempts (raw model quality before retries hide it), repairs by kind, retries, and the rates of withheld and failed answers.
- **Restarts.** Answers where a retry replaced a headline the reader had already seen (D14).
- **Tools.** Extra calls per answer, denied calls, and the number of search queries.
- **Retrieval overlap.** For drafted questions, the share of HPT's cited notes found in our context, and in our citations.

A withheld or failed answer never passes its category check. It is counted on its own so the report does not blur "wrong" and "not shown".

## The gate and the decisions

Written before the sweep.

**Quality gate.** The reference is Sonnet 5.5 at medium effort with 2 extra calls. A configuration keeps quality when all of these hold.

1. Its type-match count is at most 2 lower than the reference of 40. Two cases is the paired noise on 40 questions.
2. Every delivered answer cites only ids in its context that resolve in the index, with no superseded passage outside a revision note.
3. No fictional question cites a passage that matches its invented reference.
4. Withheld plus failed answers are at most 2 more than the reference.
5. Basis matches for explicit and inferred questions are at most 2 lower than the reference.

**Speed.** A configuration meets the target when its headline p50 on answers is at most 4 s. The no-tool path is reported next to it.

**Default.** The lowest headline p50 among the configurations that pass the gate. If none reaches 4 s, the report says by how much it misses and keeps the lowest.

**D14.** Keep the verifying headline when a visible restart happens in at most 1 of the 40 answers of the chosen configuration. More than that and the engine should hold the headline until the summary passes.

## Noise floor

- **Sampling.** Each p50 and p90 has a 95 percent bootstrap interval over the 40 questions (2,000 seeded resamples). Two configurations are compared question by question, and a difference smaller than the interval of the paired differences is no measurable difference.
- **Run to run.** Each configuration is run once, so the same question's spread is not in those intervals. After the sweep, the chosen configuration repeats 10 of the explicit questions, and the report gives the same-question spread. A difference between configurations smaller than that spread is not reported as a win.
- **Limiter.** Time before the first text splits into retrieval, the wait for the provider process, and thinking. Output tokens per answer is the proxy for thinking, checked against the length of the visible answer.

## Cost accounting

A model call is one answer attempt. A retry is a second call, and each granted extra tool call adds one more model round trip. The Claude process also sends one small Haiku request per attempt to title the session, which the SDK does not allow us to switch off. The report gives answers asked, attempts, tool round trips, and token totals from the SDK's own usage.
