export const AURA_STATES = ["idle", "compose", "think", "done"] as const;
export type AuraState = (typeof AURA_STATES)[number];

export type AuraProps = {
  state?: AuraState;
};

export function Aura({ state = "idle" }: AuraProps) {
  return <div className="aura" data-state={state} aria-hidden="true" />;
}
