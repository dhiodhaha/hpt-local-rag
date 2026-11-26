<img src="assets/icon.svg" width="64" height="64" alt="">

# hpt-local-rag

A local question-answering app over the published Tarjih rulings of Muhammadiyah. It searches the rulings on your own computer and answers through your own Claude Code or Codex login, with every answer tied to the passages it cites. No API key and no server.

This is an independent personal project. It is not affiliated with, endorsed by, or connected to Muhammadiyah, the Majelis Tarjih dan Tajdid, or the ChatHPT service. Its answers are a study aid, not a fatwa.

## What this repo holds

- `apps/server`: the vault builder and the keyword search index. `pnpm hpt build` builds `data/hpt.sqlite` from the vault, `pnpm hpt search "<question>"` searches it, `pnpm hpt eval retrieval` scores it against the eval set, `pnpm hpt eval compare` pairs two runs, and `pnpm hpt eval evidence` checks the evidence floors.
- `pnpm hpt ask "<question>"` answers from the index through your Claude Code login and prints each checked field as it arrives, then the timings. `-c` continues the last conversation, `--note putusan/<slug>` pins the question to one document, `--model sonnet|opus|haiku` and `--effort low|medium|high` change the model, and `--json` prints the event stream. Traces go to `data/traces/`, conversations to `data/conversations/`, and the canary to `data/canary.txt` (or the `HPT_CANARY` variable).
- `docs/build-plan.md`: the phases and the decisions log.
- `docs/system-prompt-v2.md`: the answer format the app expects from the model.
- `docs/red-team-levels.md`: the security tests for the prompt.
- `docs/eval-dataset.md`: how the retrieval eval set was collected.

The ruling texts are not in this repo. They belong to the Majelis Tarjih dan Tajdid and stay on the owner's machine.

## Privacy

`hpt ask` runs the Claude Code process with your own login and no API key. That process, not this app, adds things the Agent SDK does not let you turn off. It sends your account email in a reminder and an `advisor` tool definition to the model. It also makes one session-title request to Haiku for each answer, and that request contains your question. The app keeps its own context small: no settings, plugins, hooks or other MCP servers are loaded, and nothing is saved to Claude Code's session history.

## Check before you push

Run `pnpm check:public`. It fails if any file under `data/` is tracked, or if a tracked file contains text from the eval conversations.
