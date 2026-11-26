import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PassageId } from "@hpt/server/client";
import { lastAtOrAbove, type ReaderDocument } from "./model.ts";

/** Where a passage lands below the top edge when the reader jumps to it, so the paragraph before it still shows. */
const JUMP_OFFSET = 140;
/** A passage counts as the one being read once its top has passed this line. Below the jump line, so a jump lands on its own target. */
const READING_LINE = 200;

export type ReaderScroll = {
  readonly scroller: RefObject<HTMLDivElement | null>;
  /** Ref callback for the element that wraps one passage. */
  readonly place: (id: PassageId) => (element: HTMLElement | null) => void;
  /** The passage the person is reading: the one at the reading line, or the one the last jump went to. */
  readonly current: PassageId;
  /** Instant on purpose: a jump follows a click or a key, and nothing about it needs to be watched. */
  jumpTo(id: PassageId): void;
};

/**
 * Scroll position and the passage it means, for one document. Opening (or moving to another passage) scrolls the target into
 * view before the first paint of the new position. A jump sets `current` itself and ignores the scroll event it causes, so the
 * reading line never overrules a jump that lands a short passage above the line.
 */
export function useReaderScroll(doc: ReaderDocument | null, target: PassageId): ReaderScroll {
  const scroller = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<PassageId, HTMLElement>());
  /** Where the last jump put the scroll position, until the scroll event it causes has been seen. */
  const jumped = useRef<number | null>(null);
  const [current, setCurrent] = useState(target);

  const place = useCallback(
    (id: PassageId) => (element: HTMLElement | null) => {
      if (element === null) elements.current.delete(id);
      else elements.current.set(id, element);
    },
    [],
  );

  const jumpTo = useCallback((id: PassageId) => {
    const view = scroller.current;
    const element = elements.current.get(id);
    if (view === null || element === undefined) return;
    const top = Math.max(0, element.offsetTop - JUMP_OFFSET);
    if (Math.abs(view.scrollTop - top) > 0.5) {
      view.scrollTop = top;
      jumped.current = view.scrollTop;
    }
    setCurrent(id);
  }, []);

  useLayoutEffect(() => {
    if (doc !== null) jumpTo(target);
  }, [doc, target, jumpTo]);

  useEffect(() => {
    const view = scroller.current;
    if (view === null || doc === null) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (jumped.current !== null) {
        const own = Math.abs(view.scrollTop - jumped.current) < 1;
        jumped.current = null;
        if (own) return;
      }
      const tops = doc.passages.map((passage) => elements.current.get(passage.id)?.offsetTop ?? Infinity);
      const at = lastAtOrAbove(tops, view.scrollTop + READING_LINE);
      const passage = doc.passages[Math.max(0, at)];
      if (passage !== undefined) setCurrent(passage.id);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      view.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [doc]);

  return { scroller, place, current, jumpTo };
}
