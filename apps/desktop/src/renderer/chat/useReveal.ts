import { useEffect, useRef, useState } from "react";
import type { Prose } from "@hpt/server/client";
import { MOTION } from "../motion.ts";
import { advanceReveal, catchUpCps, revealProse, textLength } from "./prose.ts";

/**
 * Whether to reveal is decided once, when the component first renders: a summary that arrives while its turn is still running is
 * revealed, one that is already there (a reopened conversation, a card opened later) is shown whole. Later changes to `revealOnArrival` are
 * ignored on purpose, so finishing the turn never snaps a half-revealed sentence to its end. Instead, once `settled` turns true the
 * rest speeds up to finish within CATCH_UP_MS, so a long summary does not lag the finished answer.
 */
export function useReveal(prose: Prose | null, revealOnArrival: boolean, settled: boolean): { readonly prose: Prose | null; readonly complete: boolean; readonly animated: boolean } {
  const [animated] = useState(revealOnArrival);
  const total = prose === null ? 0 : textLength(prose);
  const [visible, setVisible] = useState(animated ? 0 : total);
  const shown = useRef(0);
  const rate = useRef<number | null>(null);
  const latest = useRef({ prose, total, settled });
  latest.current = { prose, total, settled };

  useEffect(() => {
    if (!animated || total === 0) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const { prose: current, total: target, settled: done } = latest.current;
      if (!done) rate.current = null;
      else if (rate.current === null) rate.current = catchUpCps(target - shown.current, MOTION.textRevealCps);
      shown.current = advanceReveal(shown.current, target, now - last, rate.current ?? MOTION.textRevealCps);
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
