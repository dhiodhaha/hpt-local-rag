export const CITE_MARK_STATES = ["default", "active", "pending"] as const;
export type CiteMarkState = (typeof CITE_MARK_STATES)[number];

export type CiteMarkProps = {
  state?: CiteMarkState;
  c: string;
  onClick?: () => void;
};

export function CiteMark({ state = "default", c, onClick }: CiteMarkProps) {
  return (
    <button type="button" className="c" data-state={state} disabled={state === "pending"} onClick={onClick}>
      {c}
    </button>
  );
}
