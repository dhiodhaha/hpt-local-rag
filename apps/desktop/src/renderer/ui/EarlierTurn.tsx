import type { ReactNode } from "react";
import { Badge } from "./Badge";

export const EARLIER_TURN_STATES = ["closed", "open"] as const;
export type EarlierTurnState = (typeof EARLIER_TURN_STATES)[number];

export type EarlierTurnProps = {
  state?: EarlierTurnState;
  question: string;
  verdict: string;
  inferred?: boolean;
  sources: string;
  answer?: ReactNode;
  onToggle?: () => void;
};

export function EarlierTurn({
  state = "closed",
  question,
  verdict,
  inferred = true,
  sources,
  answer,
  onToggle,
}: EarlierTurnProps) {
  const open = state === "open";
  return (
    <div className="turn" data-state={state} onClick={open ? undefined : onToggle}>
      <button type="button" className="head" aria-expanded={open} onClick={open ? onToggle : undefined}>
        <span className="turn-q">{question}</span>
        <span className="tog">
          <span className="tl">Ciutkan</span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <div className="verdict">{verdict}</div>
      <div className="turn-meta">
        {inferred ? (
          <span className="turn-bd">
            <Badge />
          </span>
        ) : null}
        <span className="turn-src">{sources}</span>
      </div>
      <div className="turn-body">{answer}</div>
    </div>
  );
}
