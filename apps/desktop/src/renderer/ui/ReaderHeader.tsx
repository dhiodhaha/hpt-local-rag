import type { ReactNode } from "react";

export type ReaderHeaderProps = {
  title: string;
  meta: string;
  backLabel: string;
  /** The status badges beside the title. */
  badges?: ReactNode;
  /** null when the note has no table of contents, so its button is not drawn. */
  toc: { readonly open: boolean; readonly label: string; readonly onToggle: () => void } | null;
  onBack: () => void;
};

const BACK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 19-7-7 7-7M19 12H5" />
  </svg>
);

const LIST = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

/** The desktop reader's top bar: back to the answer, the putusan's title and metadata, its status badges, and the Daftar isi button. */
export function ReaderHeader({ title, meta, backLabel, badges, toc, onBack }: ReaderHeaderProps) {
  return (
    <header className="rh">
      <div className="rh-lead">
        <button type="button" className="rh-ib rh-back" data-reader-back onClick={onBack}>
          {BACK}
          <span>{backLabel}</span>
        </button>
      </div>
      <div className="rh-tx">
        <h1 className="rh-t" title={title}>
          {title}
        </h1>
        {meta === "" ? null : <div className="rh-m">{meta}</div>}
      </div>
      <div className="rh-bd">{badges}</div>
      {toc === null ? null : (
        <button type="button" className="rh-ib rh-toc" aria-label={toc.label} aria-pressed={toc.open} data-toc={toc.open ? "open" : "closed"} onClick={toc.onToggle}>
          {LIST}
        </button>
      )}
    </header>
  );
}
