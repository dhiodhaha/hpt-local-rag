import type { ReactNode } from "react";

export const EXPAND_ROW_STATES = ["closed", "open"] as const;
export type ExpandRowState = (typeof EXPAND_ROW_STATES)[number];

export type ExpandRowProps = {
  state?: ExpandRowState;
  title: string;
  hint: string;
  count: string;
  onToggle?: () => void;
  children?: ReactNode;
};

export function ExpandRow({ state = "closed", title, hint, count, onToggle, children }: ExpandRowProps) {
  return (
    <>
      <button type="button" className="row" data-state={state} aria-expanded={state === "open"} onClick={onToggle}>
        <div className="l">
          <div className="title">{title}</div>
          <div className="hint">{hint}</div>
        </div>
        <div className="r">
          <span className="count">{count}</span>
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
        </div>
      </button>
      {state === "open" ? children : null}
    </>
  );
}
