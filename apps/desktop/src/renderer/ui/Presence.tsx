import { useEffect, useState, type ReactNode } from "react";

/** `closing` is true for `exitMs` after `show` goes false, so CSS can run its exit transition before the children go. */
export function usePresence(show: boolean, exitMs: number): { readonly mounted: boolean; readonly closing: boolean } {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [show, exitMs]);
  return { mounted: show || mounted, closing: !show && mounted };
}

export type PresenceProps = { show: boolean; exitMs: number; children: (closing: boolean) => ReactNode };

export function Presence({ show, exitMs, children }: PresenceProps) {
  const { mounted, closing } = usePresence(show, exitMs);
  return mounted ? children(closing) : null;
}
