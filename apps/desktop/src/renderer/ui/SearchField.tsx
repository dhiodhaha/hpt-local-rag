import type { KeyboardEvent, Ref } from "react";

export type SearchFieldProps = {
  value: string;
  placeholder: string;
  label: string;
  clearLabel: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  size?: "sidebar" | "page";
};

export function SearchField({ value, placeholder, label, clearLabel, onChange, onClear, onKeyDown, inputRef, autoFocus, size = "sidebar" }: SearchFieldProps) {
  return (
    <div className="sf" data-size={size} data-filled={value !== ""} role="search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input ref={inputRef} className="sf-input" type="text" value={value} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} spellCheck={false} autoComplete="off" onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
      {value === "" ? null : (
        <button type="button" className="sf-x" aria-label={clearLabel} onClick={onClear}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
