import { MOTION } from "../motion.ts";

/**
 * The Sumber button and the Sumber panel are one surface (layoutId "sumber-surface") that travels between them. The tuner has no
 * key for a spring, so the two durations here come from the brief: about 0.35 s to open, 0.25 s to close, with no bounce. The rest
 * is on the existing keys: the content fades in over `sourcesEnterMs` after the surface has mostly grown, and out over
 * `wordFadeMs` before it shrinks home.
 */
export const SURFACE = "sumber-surface";
export const ICON = "sumber-icon";
export const LABEL = "sumber-label";

export const OPEN_SPRING = { type: "spring", duration: 0.35, bounce: 0 } as const;
export const CLOSE_SPRING = { type: "spring", duration: 0.25, bounce: 0 } as const;

const FADE_OUT_S = MOTION.wordFadeMs / 1000;

/** The surface waits for the content to leave before it shrinks home. */
export const CLOSE_DELAY_S = FADE_OUT_S;

export const SURFACE_RADII = { borderTopLeftRadius: 0, borderTopRightRadius: 32, borderBottomRightRadius: 32, borderBottomLeftRadius: 0 } as const;
export const BUTTON_RADII = { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 20, borderBottomLeftRadius: 20 } as const;

/** One entrance for all of the panel's content, with no stagger between cards. `lift` is 0 under reduced motion. */
export function contentFade(lift: number) {
  return {
    initial: { opacity: 0, y: lift },
    animate: { opacity: 1, y: 0, transition: { duration: MOTION.sourcesEnterMs / 1000, delay: 0.14, ease: MOTION.easing } },
    exit: { opacity: 0, transition: { duration: FADE_OUT_S, ease: MOTION.easing } },
  };
}
