# How the retrieval eval set was collected

The retrieval eval uses 245 public conversations from the "Riwayat" page of hpt.muhammadiyah.or.id. This page records how they were collected so the eval can be repeated. The collection script and the data are not published: the conversations are other people's questions, and the answers are the service's content.

## Method

- Collected once, on 2026-11-25, with a headless browser that sent only GET requests and identified itself as read-only research.
- The collector read `robots.txt` first and skipped every disallowed path. It never opened login or account pages and did not download images, fonts or media.
- At least 2.6 seconds passed between network requests. Each response was cached locally, so a rerun sent no repeat requests.
- Sources on the Riwayat page: 148 conversations from the "Terpopuler" tab, 88 from "Terbaru", and 9 from the page's search box with the terms "prompt", "system prompt" and "instruksi" (for red-team examples).
- 152 of the 245 conversations list the documents the answer used. Those references are silver labels: they show what HPT's agent read, not a verified correct answer.

## Storage and reporting rules

- The data stays in `data/qa_pairs.jsonl` on the owner's machine. `data/` is gitignored.
- Eval reports in this repo show numbers and conversation IDs only, never question or answer text.
- `pnpm check:public` fails if a tracked file contains a question or an answer sentence from the set, or any path under `data/`.
