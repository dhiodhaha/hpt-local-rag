export type RevisionNoticeProps = {
  title: string;
  text: string;
  action: string;
  onAction: () => void;
};

const CLOCK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);

const ARROW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** A calm notice at the top of a putusan that a later one replaced, with one action to open the newer ruling. */
export function RevisionNotice({ title, text, action, onAction }: RevisionNoticeProps) {
  return (
    <div className="rn">
      <div className="rn-hd">
        {CLOCK}
        <span className="rn-t">{title}</span>
      </div>
      <p className="rn-x">{text}</p>
      <button type="button" className="rn-a" onClick={onAction}>
        <span>{action}</span>
        {ARROW}
      </button>
    </div>
  );
}
