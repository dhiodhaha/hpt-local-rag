/**
 * Values from the tuner: pasting its JSON over `MOTION` is the whole change. Components never hold a number.
 */
export type MotionConfig = {
  readonly easing: readonly [number, number, number, number];
  readonly thinkingPulseMs: number;
  readonly sourcesEnterMs: number;
  readonly sourcesStaggerMs: number;
  readonly sourcesOffsetPx: number;
  readonly citeResolveMs: number;
  readonly headlineEnterMs: number;
  readonly headlineOffsetPx: number;
  readonly headlineVerifyInk: number;
  readonly headlineSettleMs: number;
  readonly verifyPillFadeMs: number;
  readonly textRevealCps: number;
  readonly wordFadeMs: number;
  readonly fieldEnterMs: number;
  readonly fieldOffsetPx: number;
  readonly cardStaggerMs: number;
  readonly skeletonShimmerMs: number;
  readonly skeletonSwapMs: number;
  readonly restartFadeOutMs: number;
  readonly restartFadeInMs: number;
};

export const MOTION: MotionConfig = {
  easing: [0.2, 0.7, 0.2, 1],
  thinkingPulseMs: 1600,
  sourcesEnterMs: 200,
  sourcesStaggerMs: 40,
  sourcesOffsetPx: 8,
  citeResolveMs: 160,
  headlineEnterMs: 260,
  headlineOffsetPx: 4,
  headlineVerifyInk: 75,
  headlineSettleMs: 200,
  verifyPillFadeMs: 200,
  textRevealCps: 90,
  wordFadeMs: 120,
  fieldEnterMs: 220,
  fieldOffsetPx: 6,
  cardStaggerMs: 60,
  skeletonShimmerMs: 1400,
  skeletonSwapMs: 180,
  restartFadeOutMs: 200,
  restartFadeInMs: 240,
};

const ms = (value: number): string => `${value}ms`;
const px = (value: number): string => `${value}px`;

/** Reduced motion is gentler, not off: fades and colour changes stay, because they carry meaning. Offsets drop to zero here. */
export function motionVars(config: MotionConfig, reduced: boolean): Readonly<Record<string, string>> {
  const [x1, y1, x2, y2] = config.easing;
  return {
    "--m-ease": `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
    "--m-pulse": ms(config.thinkingPulseMs),
    "--m-sources-enter": ms(config.sourcesEnterMs),
    "--m-sources-stagger": ms(config.sourcesStaggerMs),
    "--m-sources-offset": px(reduced ? 0 : config.sourcesOffsetPx),
    "--m-cite": ms(config.citeResolveMs),
    "--m-headline-enter": ms(config.headlineEnterMs),
    "--m-headline-offset": px(reduced ? 0 : config.headlineOffsetPx),
    "--m-headline-ink": String(config.headlineVerifyInk),
    "--m-headline-settle": ms(config.headlineSettleMs),
    "--m-verify-fade": ms(config.verifyPillFadeMs),
    "--m-word-fade": ms(config.wordFadeMs),
    "--m-field-enter": ms(config.fieldEnterMs),
    "--m-field-offset": px(reduced ? 0 : config.fieldOffsetPx),
    "--m-card-stagger": ms(config.cardStaggerMs),
    "--m-shimmer": ms(config.skeletonShimmerMs),
    "--m-skeleton-swap": ms(config.skeletonSwapMs),
    "--m-restart-out": ms(config.restartFadeOutMs),
    "--m-restart-in": ms(config.restartFadeInMs),
  };
}

export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function installMotion(root: HTMLElement, win: Pick<Window, "matchMedia"> = window, config: MotionConfig = MOTION): () => void {
  const query = win.matchMedia(REDUCED_QUERY);
  const apply = () => {
    for (const [name, value] of Object.entries(motionVars(config, query.matches))) root.style.setProperty(name, value);
    root.dataset.motion = query.matches ? "reduced" : "full";
  };
  apply();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
