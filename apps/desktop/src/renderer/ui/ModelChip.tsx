import { PROVIDER_LOGOS, type Provider } from "./providerLogos";

export const MODEL_CHIP_STATES = ["default", "open"] as const;
export type ModelChipState = (typeof MODEL_CHIP_STATES)[number];

export type ModelChipProps = {
  provider?: Provider;
  state?: ModelChipState;
  model: string;
  onClick?: () => void;
};

export function ModelChip({ provider = "claude", state = "default", model, onClick }: ModelChipProps) {
  return (
    <button
      type="button"
      className="mc"
      data-state={state}
      aria-haspopup="menu"
      aria-expanded={state === "open"}
      onClick={onClick}
    >
      <img className="mc-lg" src={PROVIDER_LOGOS[provider]} alt="" />
      <span className="mc-t">{model}</span>
      <svg
        className="mc-cv"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
