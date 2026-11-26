import { useEffect, useRef, type ReactNode } from "react";

export type RowMenuProps = {
  /** Fixed position of the menu's top left corner, already kept inside the window. */
  x: number;
  y: number;
  closing: boolean;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

const PENCIL = <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />;
const TRASH = <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />;

const icon = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

export function RowMenu({ x, y, closing, onRename, onDelete, onClose }: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);
  const move = (step: 1 | -1) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  return (
    <div className="rm-scrim" data-closing={closing} onPointerDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={ref}
        className="rm"
        role="menu"
        aria-label="Opsi percakapan"
        data-closing={closing}
        style={{ left: x, top: y }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Tab") event.preventDefault();
        }}
      >
        <button type="button" role="menuitem" className="rm-it" onClick={onRename}>
          {icon(PENCIL)}
          Ganti nama
        </button>
        <button type="button" role="menuitem" className="rm-it rm-del" onClick={onDelete}>
          {icon(TRASH)}
          Hapus
        </button>
      </div>
    </div>
  );
}
