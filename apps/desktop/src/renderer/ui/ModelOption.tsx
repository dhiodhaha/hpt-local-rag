export const MODEL_OPTION_STATES = ["default", "hover", "current", "unavailable"] as const;
export type ModelOptionState = (typeof MODEL_OPTION_STATES)[number];

export type ModelOptionProps = {
  state?: ModelOptionState;
  label: string;
  note: string;
  onClick?: () => void;
};

export function ModelOption({ state = "default", label, note, onClick }: ModelOptionProps) {
  return (
    <button
      type="button"
      className="mo"
      role="menuitemradio"
      aria-checked={state === "current"}
      data-state={state}
      disabled={state === "unavailable"}
      onClick={onClick}
    >
      <div className="mo-bd">
        <span className="mo-l">{label}</span>
        <span className="mo-n">{note}</span>
      </div>
      <svg
        className="mo-ck"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}
