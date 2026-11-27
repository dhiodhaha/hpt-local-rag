import type { ReactNode } from "react";

export type TipButtonProps = {
  label: string;
  /** The shortcut, drawn in the tooltip and read out with the name. */
  kbd?: string;
  expanded?: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** An icon button whose tooltip names the action and its shortcut. The tooltip shows on a mouse hover and on keyboard focus. */
export function TipButton({ label, kbd, expanded, onClick, children }: TipButtonProps) {
  return (
    <button type="button" className="icon-btn tb" aria-label={kbd === undefined ? label : `${label} (${kbd})`} aria-expanded={expanded} onClick={onClick}>
      {children}
      <span className="tip" aria-hidden="true">
        {label}
        {kbd === undefined ? null : <kbd>{kbd}</kbd>}
      </span>
    </button>
  );
}
