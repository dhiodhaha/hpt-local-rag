# Thinking off on Sonnet 5.5, 2026-11-26

This report holds numbers and mechanisms only. It checks one thing the answer eval left open: can any setting the Agent SDK reaches turn thinking off for Sonnet 5.5, so a Sonnet fallback or alternative could skip the 5 to 6 s the model spends thinking before it writes (see [answers-2026-11-26.md](answers-2026-11-26.md)).

## Verdict

**No setting turns thinking off for Sonnet 5.5.** Nine variants ran, one call each, at low effort. The request body the Claude process sent was read for each one. Every variant got a thinking block back, with 795 to 1,359 thinking tokens against 980 with no setting. The spread between runs of one setting is larger than any difference between settings, so none of them changed anything.

Because no setting works, the planned sweep (Sonnet 5.5 with thinking off on the 23 explicit and inferred questions, against the Opus and Sonnet runs in the answer eval) did not run. The default stays Opus 5.5 at low effort (D7a), and the fallback stays Sonnet 5.5 at low effort.

## What was tried

One call per row, Sonnet 5.5 at low effort, with a multi-step Indonesian prompt. "On the wire" is the `thinking` field of the request to the Messages API, from `OTEL_LOG_RAW_API_BODIES`. Thinking tokens come from the SDK's own usage.

| Setting | `thinking` on the wire | Thinking block returned | Thinking tokens | Output tokens | First text (s) |
| --- | --- | --- | --- | --- | --- |
| no setting | `{"type":"adaptive","display":"updates"}` | yes | 980 | 1780 | 9.6 |
| `thinking: { type: "disabled" }` option | `{"type":"adaptive","display":"updates"}` | yes | 816 | 1731 | 8.9 |
| env `MAX_THINKING_TOKENS=0` | `{"type":"adaptive","display":"updates"}` | yes | 1244 | 2225 | 12.7 |
| settings overlay `alwaysThinkingEnabled: false` | `{"type":"adaptive","display":"updates"}` | yes | 795 | 1605 | 8.0 |
| env `CLAUDE_CODE_DISABLE_THINKING=1` | field omitted | yes | 881 | 1820 | 8.7 |
| `maxThinkingTokens: 0` option | `{"type":"adaptive","display":"updates"}` | yes | 832 | 1835 | 8.6 |
| `thinking: { type: "enabled", budgetTokens: 1024 }` option | `{"type":"adaptive","display":"updates"}` | yes | 1359 | 2264 | 13.1 |
| env `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` | `{"type":"adaptive","display":"updates"}` | yes | 1000 | 1864 | 9.7 |
| all of the disabling settings together (`thinking`, `maxThinkingTokens`, settings overlay, both env variables) | field omitted | yes | 952 | 1723 | 10.5 |

## Why

- **The client turns `disabled` back into `adaptive`.** The `thinking: { type: "disabled" }` option, `MAX_THINKING_TOKENS=0`, `maxThinkingTokens: 0` and the `alwaysThinkingEnabled: false` overlay all reach the API as `{ "type": "adaptive", "display": "updates" }`. The Claude binary in SDK 0.3.332 holds the message "Thinking can't be turned off for ...", and a function that rewrites a disabled config to adaptive for a model that rejects it. That list comes from the server, so the reason Sonnet 5.5 is on it is a guess. The wire result is measured.
- **Removing the field does not turn thinking off either.** `CLAUDE_CODE_DISABLE_THINKING=1` is the one setting that changes the request: the `thinking` field is gone. Sonnet 5.5 still thinks, 881 tokens in that run. So omitting the field is not "off". The model thinks by default.
- **An explicit budget is not honored.** `{ type: "enabled", budgetTokens: 1024 }` is sent as adaptive, and the run used 1,359 thinking tokens.
- **The only `disabled` the client keeps is its own.** The binary marks its own helper calls as `mechanical`, and only those stay disabled. No SDK option sets that flag.

## Limits

- Each variant is one call, so a spread inside a setting is unmeasured. The 795 to 1,359 range across runs is the noise, and it is wider than any setting's effect.
- One prompt. On a one-line question at low effort, Sonnet 5.5 once chose not to think at all (0 thinking tokens, one run, not kept). Thinking is adaptive, so the model decides per prompt. The answer prompt is long and structured, and the answer eval measured about 5 s of thinking for it.
- Only the Agent SDK's own options, its environment variables and its settings overlay were tried. A direct Messages API call with `thinking: { type: "disabled" }` is outside this project, which answers through the Claude Code login and has no API key path.

## Reproduce

```
node scripts/probe-thinking.mjs
```

Nine model calls, about 2 minutes. Pass variant names to run fewer, and `PROBE_MODEL` to try another model. The raw request bodies are in `data/eval/thinking-probe/`.
