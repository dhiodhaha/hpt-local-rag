export const AURA_STATES = ["idle", "compose", "think", "done"] as const;
export type AuraState = (typeof AURA_STATES)[number];

export type AuraProps = {
  state?: AuraState;
};

/** One layer per state, so a change of state is a cross-fade of opacity and not a jump between gradients. */
export function Aura({ state = "idle" }: AuraProps) {
  return (
    <div className="aura" data-state={state} aria-hidden="true">
      {AURA_STATES.map((layer) => (
        <div key={layer} className="aura-l" data-layer={layer} data-on={layer === state} />
      ))}
    </div>
  );
}
