import { useEffect, useState } from "react";

/**
 * True for `ms` after `name` moves from `from` to `to`, so the screen being left can fade out before the next one arrives. Any other
 * change of screen, and any change during the hold, ends it at once: whatever the person did next wins.
 */
export function useLeaveHold(name: string, from: string, to: string, ms: number): boolean {
  const [seen, setSeen] = useState(name);
  const [held, setHeld] = useState(false);
  if (name !== seen) {
    setSeen(name);
    setHeld(seen === from && name === to);
  }
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(timer);
  }, [held, ms]);
  return held;
}
