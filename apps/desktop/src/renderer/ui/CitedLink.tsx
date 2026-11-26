import type { ReactNode } from "react";

export const CITED_LINK_STATES = ["default", "current", "revised"] as const;
export type CitedLinkState = (typeof CITED_LINK_STATES)[number];

export type CitedLinkProps = {
  state?: CitedLinkState;
  where: string;
  snippet: string;
  /** The label of the `current` and `revised` states. */
  status?: string;
  mark?: ReactNode;
  onClick?: () => void;
};

const CHEVRON = (
  <svg className="cl-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/** A row in the reader's side panel that links a passage the answer quotes to its place in the putusan. */
export function CitedLink({ state = "default", where, snippet, status, mark, onClick }: CitedLinkProps) {
  return (
    <button type="button" className="cl" data-state={state} aria-current={state === "current" ? "location" : undefined} onClick={onClick}>
      <span className="cl-mk">{mark}</span>
      <span className="cl-tx">
        <span className="cl-wh">
          <span>{where}</span>
          {status === undefined ? null : <span className={state === "revised" ? "cl-st cl-rv" : "cl-st"}>{status}</span>}
        </span>
        <span className="cl-sn">{snippet}</span>
      </span>
      {state === "default" ? CHEVRON : null}
    </button>
  );
}
