export type FilterChipProps = {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
};

export function FilterChip({ label, count, on, onClick }: FilterChipProps) {
  return (
    <button type="button" className="fc" data-state={on ? "on" : "off"} aria-pressed={on} onClick={onClick}>
      <span>{label}</span>
      <span className="fc-n">{count}</span>
    </button>
  );
}
