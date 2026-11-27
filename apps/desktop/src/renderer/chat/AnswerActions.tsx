import { useState, type ReactNode } from "react";
import { COPY } from "./copy.ts";

type Rating = "good" | "bad" | null;

const icon = (path: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const THUMB_UP = icon(<path d="M7 10v11M7 10 11 3a2 2 0 0 1 3 1.7V9h5.4a2 2 0 0 1 2 2.3l-1.2 7.5A2 2 0 0 1 18.2 20H7" />);
const THUMB_DOWN = icon(<path d="M17 14V3M17 14l-4 7a2 2 0 0 1-3-1.7V15H4.6a2 2 0 0 1-2-2.3l1.2-7.5A2 2 0 0 1 5.8 4H17" />);
const CHECK_ICON = icon(<path d="M20 6 9 17l-5-5" />);
const COPY_ICON = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </>,
);

export function AnswerActions({ text }: { text: string }) {
  const [rating, setRating] = useState<Rating>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="closing-acts" data-actions="answer">
      <button type="button" className="act-btn" aria-label={COPY.actions.good} aria-pressed={rating === "good"} onClick={() => setRating(rating === "good" ? null : "good")}>
        {THUMB_UP}
      </button>
      <button type="button" className="act-btn" aria-label={COPY.actions.bad} aria-pressed={rating === "bad"} onClick={() => setRating(rating === "bad" ? null : "bad")}>
        {THUMB_DOWN}
      </button>
      <button type="button" className="act-btn" aria-label={COPY.actions.copy} data-done={copied} onClick={copy}>
        {copied ? CHECK_ICON : COPY_ICON}
      </button>
      <span role="status" className="sr-only">
        {copied ? COPY.actions.copied : ""}
      </span>
    </div>
  );
}
