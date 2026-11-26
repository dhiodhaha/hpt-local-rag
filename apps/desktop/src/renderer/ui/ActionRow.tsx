export type ActionRowProps = {
  title: string;
  hint: string;
  onClick?: () => void;
  /** Shown but not usable, for an action whose phase has not landed. */
  disabled?: boolean;
  /** The reason a disabled row gives on hover. */
  reason?: string;
};

export function ActionRow({ title, hint, onClick, disabled = false, reason }: ActionRowProps) {
  return (
    <button type="button" className="ar" onClick={onClick} disabled={disabled} title={disabled ? reason : undefined}>
      <span className="ar-i">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
      </span>
      <div className="ar-l">
        <div className="ar-title">{title}</div>
        <div className="ar-hint">{hint}</div>
      </div>
      <svg className="ar-ch" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}
