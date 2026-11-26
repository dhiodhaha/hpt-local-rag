import { useEffect, useRef, useState } from "react";
import type { Prose } from "@hpt/server/client";
import { MOTION } from "../motion.ts";
import { advanceReveal, revealProse, textLength } from "./prose.ts";

/**
 * Whether to reveal is decided once, when the component first renders: a summary that arrives while its turn is still running is
 * revealed, one that is already there (a reopened conversation, a card opened later) is shown whole. Later changes to `revealOnArrival` are
 * ignored on purpose, so finishing the turn never snaps a half-revealed sentence to its end.
 */
export function useReveal(prose: Prose | null, revealOnArrival: boolean): { readonly prose: Prose | null; readonly complete: boolean; readonly animated: boolean } {
  const [animated] = useState(revealOnArrival);
  const total = prose === null ? 0 : textLength(prose);
  const [visible, setVisible] = useState(animated ? 0 : total);
  const shown = useRef(0);
  const latest = useRef({ prose, total });
  latest.current = { prose, total };

  useEffect(() => {
    if (!animated || total === 0) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const { prose: current, total: target } = latest.current;
      shown.current = advanceReveal(shown.current, target, now - last, MOTION.textRevealCps);
      last = now;
      const next = current === null ? 0 : textLength(revealProse(current, Math.floor(shown.current)));
      setVisible((before) => (before === next ? before : next));
      frame = shown.current < target ? requestAnimationFrame(tick) : 0;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated, total]);

  if (!animated || prose === null) return { prose, complete: true, animated };
  return { prose: revealProse(prose, visible), complete: visible >= total, animated };
}
