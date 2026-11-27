export const CITE_MARK_STATES = ["default", "active", "pending"] as const;
export type CiteMarkState = (typeof CITE_MARK_STATES)[number];

export type CiteMarkProps = {
  state?: CiteMarkState;
  c: string;
  /** The passage this mark cites. The margin looks the mark up by it, to sit level with its line. */
  passage?: string;
  onClick?: () => void;
};

export function CiteMark({ state = "default", c, passage, onClick }: CiteMarkProps) {
  return (
    <button type="button" className="c" data-state={state} data-cite={passage} disabled={state === "pending"} onClick={onClick}>
      {c}
    </button>
  );
}
