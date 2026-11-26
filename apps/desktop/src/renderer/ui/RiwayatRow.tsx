import type { ReactNode } from "react";

export const RIWAYAT_ROW_STATES = ["default", "active", "swiped", "hover", "menu"] as const;
export const RIWAYAT_ROW_SIZES = ["drawer", "sidebar"] as const;
export const RIWAYAT_ROW_SNIPPETS = ["off", "on"] as const;
export type RiwayatRowState = (typeof RIWAYAT_ROW_STATES)[number];
export type RiwayatRowSize = (typeof RIWAYAT_ROW_SIZES)[number];
export type RiwayatRowSnippet = (typeof RIWAYAT_ROW_SNIPPETS)[number];

export type RiwayatRowProps = {
  state?: RiwayatRowState;
  size?: RiwayatRowSize;
  snippet?: RiwayatRowSnippet;
  time?: string;
  title: ReactNode;
  meta?: ReactNode;
  onSelect?: () => void;
  onMore?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
};

export function RiwayatRow({
  state = "default",
  size = "drawer",
  snippet = "off",
  time,
  title,
  meta,
  onSelect,
  onMore,
  onRename,
  onDelete,
}: RiwayatRowProps) {
  return (
    <div className="rr" data-state={state} data-size={size} data-snippet={snippet}>
      {state === "swiped" ? (
        <div className="act">
          <button type="button" className="a ren" onClick={onRename}>
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Ganti nama
          </button>
          <button type="button" className="a del" onClick={onDelete}>
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
            </svg>
            Hapus
          </button>
        </div>
      ) : null}
      <button type="button" className="body" aria-current={state === "active" ? "true" : undefined} onClick={onSelect}>
        <div className="rr-t">{title}</div>
        <div className="m">
          <span className="rr-sn">{meta}</span>
          <span className="tm">{time}</span>
        </div>
      </button>
      <button type="button" className="more" aria-label="Opsi percakapan" onClick={onMore}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
    </div>
  );
}
