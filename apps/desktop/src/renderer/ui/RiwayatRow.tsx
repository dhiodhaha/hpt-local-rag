import { useEffect, useRef, type ReactNode } from "react";

export const RIWAYAT_ROW_STATES = ["default", "active", "swiped", "hover", "menu"] as const;
export const RIWAYAT_ROW_SIZES = ["drawer", "sidebar"] as const;
export const RIWAYAT_ROW_SNIPPETS = ["off", "on"] as const;
export type RiwayatRowState = (typeof RIWAYAT_ROW_STATES)[number];
export type RiwayatRowSize = (typeof RIWAYAT_ROW_SIZES)[number];
export type RiwayatRowSnippet = (typeof RIWAYAT_ROW_SNIPPETS)[number];

export type RiwayatRowEdit = {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
};

export type RiwayatRowProps = {
  state?: RiwayatRowState;
  size?: RiwayatRowSize;
  snippet?: RiwayatRowSnippet;
  time?: string;
  title: ReactNode;
  meta?: ReactNode;
  /** Replaces the title with a text field. Enter keeps the new name, Escape and leaving the field with no change do not. */
  edit?: RiwayatRowEdit | null;
  busy?: boolean;
  onSelect?: () => void;
  onMore?: (anchor: { readonly x: number; readonly y: number }) => void;
  onRename?: () => void;
  onDelete?: () => void;
};

function TitleField({ edit }: { edit: RiwayatRowEdit }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) edit.onCommit(ref.current?.value ?? edit.value);
    else edit.onCancel();
  };
  return (
    <input
      ref={ref}
      className="rr-edit"
      defaultValue={edit.value}
      aria-label="Nama percakapan"
      maxLength={120}
      spellCheck={false}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

export function RiwayatRow({ state = "default", size = "drawer", snippet = "off", time, title, meta, edit = null, busy = false, onSelect, onMore, onRename, onDelete }: RiwayatRowProps) {
  return (
    <div
      className="rr"
      data-state={state}
      data-size={size}
      data-snippet={snippet}
      data-editing={edit !== null}
      data-busy={busy}
      onContextMenu={
        onMore === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              onMore({ x: event.clientX, y: event.clientY });
            }
      }
    >
      {state === "swiped" ? (
        <div className="act">
          <button type="button" className="a ren" onClick={onRename}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Ganti nama
          </button>
          <button type="button" className="a del" onClick={onDelete}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
            </svg>
            Hapus
          </button>
        </div>
      ) : null}
      {edit === null ? (
        <button type="button" className="body" aria-current={state === "active" ? "true" : undefined} onClick={onSelect}>
          <div className="rr-t">{title}</div>
          <div className="m">
            <span className="rr-sn">{meta}</span>
            <span className="tm">{time}</span>
          </div>
        </button>
      ) : (
        <div className="body">
          <TitleField edit={edit} />
        </div>
      )}
      {onMore === undefined || edit !== null ? null : (
        <button
          type="button"
          className="more"
          aria-label="Opsi percakapan"
          aria-haspopup="menu"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onMore({ x: box.right + 6, y: box.top });
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      )}
    </div>
  );
}
