import { useEffect, useLayoutEffect, useRef } from "react";
import { EXIT_MS, Presence, useLast } from "../ui/index.ts";
import { useChat } from "../chat/context.tsx";
import { ReaderView } from "./ReaderView.tsx";

/** Focus goes back to what opened the reader, a citation or a Sumber card, once the reader has closed. */
function useFocusReturn(open: boolean): void {
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      return;
    }
    const target = opener.current;
    opener.current = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus();
  }, [open]);
}

/**
 * The reader over the whole window. It is mounted for the length of its exit, so a person who closes it sees it fade and a person
 * who opens it again before that ends brings it back (the transition reverses, nothing restarts). Esc closes it.
 */
export function ReaderLayer() {
  const reader = useChat((state) => state.reader);
  const turns = useChat((state) => state.turns);
  const { closeReader, showPassage, retryReader } = useChat((state) => state);
  const shown = useLast(reader);
  const open = reader !== null;
  useFocusReturn(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeReader();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeReader]);

  return (
    <Presence show={open} exitMs={EXIT_MS}>
      {(closing) => {
        const turn = shown === null ? undefined : turns.find((entry) => entry.key === shown.turn);
        if (shown === null || turn === undefined) return null;
        return <ReaderView reader={shown} turn={turn} closing={closing} onClose={closeReader} onShow={showPassage} onRetry={retryReader} />;
      }}
    </Presence>
  );
}
