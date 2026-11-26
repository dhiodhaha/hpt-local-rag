import type { CSSProperties, ReactNode } from "react";
import { MOTION } from "../motion.ts";
import { usePresence } from "./Presence.tsx";

export type SwapSlotProps = {
  loading: boolean;
  skeleton: ReactNode;
  /** Off when the content brings its own entrance. */
  fade?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/** A skeleton and what replaces it share one grid cell: the skeleton fades out while the content fades in, so nothing jumps. */
export function SwapSlot({ loading, skeleton, fade = true, className, style, children }: SwapSlotProps) {
  const { mounted, closing } = usePresence(loading, MOTION.skeletonSwapMs);
  return (
    <div className={className === undefined ? "swap" : `swap ${className}`} style={style}>
      {mounted ? (
        <div className="swap-sk" data-closing={closing} aria-hidden="true">
          {skeleton}
        </div>
      ) : null}
      {loading ? null : <div className={fade && closing ? "swap-in" : undefined}>{children}</div>}
    </div>
  );
}
