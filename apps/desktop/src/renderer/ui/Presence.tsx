import { useEffect, useRef, useState, type ReactNode } from "react";

/** Shorter than the arrival: the person has already decided. */
export const EXIT_MS = 110;

/** Keeps the last value while `value` is null, so a closing popup still has its content to show while it fades out. */
export function useLast<T>(value: T | null): T | null {
  const last = useRef<T | null>(value);
  useEffect(() => {
    if (value !== null) last.current = value;
  });
  return value ?? last.current;
}

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
