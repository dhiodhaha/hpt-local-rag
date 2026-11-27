import { useEffect, useRef } from "react";

const FOLLOW_PX = 120;

/**
 * The conversation sticks to the bottom while a person is near it, so a streaming answer stays in view. Scrolling up lets go. A new
 * turn, or another conversation, takes hold again.
 */
export function useFollow(turnCount: number, conversation: string | null) {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    const inner = column.current;
    if (element === null || inner === null) return;
    const onScroll = () => {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
    };
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTo({ top: element.scrollHeight });
    });
    element.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(inner);
    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [turnCount > 0]);

  useEffect(() => {
    following.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turnCount, conversation]);

  return { scroller, column };
}
