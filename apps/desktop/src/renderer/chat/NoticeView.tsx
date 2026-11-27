import type { MouseEvent } from "react";
import { Button, StateNotice } from "../ui/index.ts";
import { COPY } from "./copy.ts";
import type { RunView } from "./view.ts";

type Notice = Extract<RunView, { kind: "notice" }>;

function textOf(outcome: Notice["outcome"]): { kind: "koneksi" | "batas"; title: string; body: string } {
  if (outcome.kind === "withheld") return { ...COPY.notice.withheld, body: outcome.copy };
  if (outcome.kind === "cancelled") return { ...COPY.notice.other, body: "Dibatalkan." };
  const known = { not_signed_in: COPY.notice.not_signed_in, rate_limited: COPY.notice.rate_limited, blocked: COPY.notice.blocked } as const;
  const entry = outcome.code === "not_signed_in" || outcome.code === "rate_limited" || outcome.code === "blocked" ? known[outcome.code] : COPY.notice.other;
  return { ...entry, body: outcome.copy };
}

/** Withheld, failed and cancelled asks. Whatever streamed before is not shown: the question stays and this takes the card's place. */
export function NoticeView({ notice, onRetry }: { notice: Notice; onRetry: (event: MouseEvent<HTMLButtonElement>) => void }) {
  const { kind, title, body } = textOf(notice.outcome);
  return (
    <div data-card="notice" data-code={notice.outcome.kind === "failed" ? notice.outcome.code : notice.outcome.kind}>
      <StateNotice kind={kind} title={title} body={body} actions={<Button tone="soft" label={COPY.retry} onClick={onRetry} />} />
    </div>
  );
}
