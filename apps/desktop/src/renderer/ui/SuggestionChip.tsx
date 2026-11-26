export type SuggestionChipProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export function SuggestionChip({ label, onClick, disabled }: SuggestionChipProps) {
  return (
    <button type="button" className="sgc" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17 17 7M7 7h10v10" />
      </svg>
    </button>
  );
}
