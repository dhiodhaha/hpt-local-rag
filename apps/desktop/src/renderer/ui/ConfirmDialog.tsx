import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export type ConfirmDialogProps = {
  title: string;
  body: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  closing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Focus starts on the first button, which is the safe choice. */
export function ConfirmDialog({ title, body, cancelLabel, confirmLabel, closing, onCancel, onConfirm }: ConfirmDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return (
    <div className="dlg-scrim" data-closing={closing} onPointerDown={onCancel}>
      <div
        ref={ref}
        className="dlg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        data-closing={closing}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Tab") {
            const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
            const at = buttons.indexOf(document.activeElement as HTMLElement);
            event.preventDefault();
            buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          }
        }}
      >
        <h2 id="dlg-title" className="dlg-title">
          {title}
        </h2>
        <div className="dlg-body">{body}</div>
        <div className="dlg-acts">
          <Button tone="soft" size="lg" label={cancelLabel} onClick={onCancel} />
          <Button tone="danger" size="lg" label={confirmLabel} onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}
