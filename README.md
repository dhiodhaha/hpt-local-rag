<img src="assets/icon.svg" width="64" height="64" alt="">

# hpt-local-rag

A local question-answering app over the published Tarjih rulings of Muhammadiyah. It searches the rulings on your own computer and answers through your own Claude Code or Codex login, with every answer tied to the passages it cites. No API key and no server.

This is an independent personal project. It is not affiliated with, endorsed by, or connected to Muhammadiyah, the Majelis Tarjih dan Tajdid, or the ChatHPT service. Its answers are a study aid, not a fatwa.

## What this repo holds

- `apps/server`: the vault builder now, and the search index next.
- `docs/build-plan.md`: the phases and the decisions log.
- `docs/system-prompt-v2.md`: the answer format the app expects from the model.
- `docs/red-team-levels.md`: the security tests for the prompt.
- `docs/eval-dataset.md`: how the retrieval eval set was collected.

The ruling texts are not in this repo. They belong to the Majelis Tarjih dan Tajdid and stay on the owner's machine.

## Check before you push

Run `pnpm check:public`. It fails if any file under `data/` is tracked, or if a tracked file contains text from the eval conversations.
