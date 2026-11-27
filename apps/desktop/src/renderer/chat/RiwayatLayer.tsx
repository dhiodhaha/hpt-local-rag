import type { ConversationSummary } from "@hpt/server/client";
import { ConfirmDialog, EXIT_MS, Presence, RowMenu, useLast } from "../ui/index.ts";
import { useChat } from "./context.tsx";
import { COPY } from "./copy.ts";

const MENU_WIDTH = 196;
const MENU_HEIGHT = 104;

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
