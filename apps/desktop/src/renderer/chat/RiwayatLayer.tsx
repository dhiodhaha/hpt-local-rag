import { useEffect, useRef } from "react";
import type { ConversationSummary } from "@hpt/server/client";
import { ConfirmDialog, Presence, RowMenu } from "../ui/index.ts";
import { useChat } from "./context.tsx";
import { COPY } from "./copy.ts";

/** Shorter than the arrival: the person has already decided. */
const EXIT_MS = 110;
const MENU_WIDTH = 196;
const MENU_HEIGHT = 104;

/** Keeps the last value while `value` is null, so a closing popup still has its content to show while it fades out. */
function useLast<T>(value: T | null): T | null {
  const last = useRef<T | null>(value);
  useEffect(() => {
    if (value !== null) last.current = value;
  });
  return value ?? last.current;
}

function Menu() {
  const menu = useChat((state) => state.menu);
  const { closeMenu, startRename, askDelete } = useChat((state) => state);
  const shown = useLast(menu);
  return (
    <Presence show={menu !== null} exitMs={EXIT_MS}>
      {(closing) =>
        shown === null ? null : (
          <RowMenu
            x={Math.max(8, Math.min(shown.x, window.innerWidth - MENU_WIDTH - 8))}
            y={Math.max(8, Math.min(shown.y, window.innerHeight - MENU_HEIGHT - 8))}
            closing={closing}
            onRename={() => startRename(shown.conversation)}
            onDelete={() => askDelete(shown.conversation)}
            onClose={closeMenu}
          />
        )
      }
    </Presence>
  );
}

function Delete() {
  const confirming = useChat((state) => state.confirming);
  const { cancelDelete, confirmDelete } = useChat((state) => state);
  const shown = useLast<ConversationSummary>(confirming);
  return (
    <Presence show={confirming !== null} exitMs={EXIT_MS}>
      {(closing) =>
        shown === null ? null : (
          <ConfirmDialog
            title={COPY.riwayat.deleteTitle}
            body={
              <>
                {COPY.riwayat.deleteLead} <b>“{shown.title}”</b> {COPY.riwayat.deleteBody}
              </>
            }
            cancelLabel={COPY.riwayat.cancel}
            confirmLabel={COPY.riwayat.confirmDelete}
            closing={closing}
            onCancel={cancelDelete}
            onConfirm={() => void confirmDelete()}
          />
        )
      }
    </Presence>
  );
}

export function RiwayatLayer() {
  return (
    <>
      <Menu />
      <Delete />
    </>
  );
}
