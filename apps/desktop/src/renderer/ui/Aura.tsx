import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { advanceClock, AURA, AURA_STATES, CORE_SIZE, frameMs, isResting, LOOP, paintPlan, paletteOf, retarget, rgbaOf, staticGlow, START_CLOCK, startSprings, TAIL_KNEE, stepSprings, type AuraSettings, type AuraState, type Box, type PaintCloud, type PaintPlan, type PaintTail, type Rgb, type Springs } from "../aura.ts";
import { REDUCED_QUERY } from "../motion.ts";
import { measureBox, watchBox } from "./questionBox.ts";

export { AURA_STATES };
export type { AuraState };

export type AuraProps = {
  state?: AuraState;
  settings?: AuraSettings;
  /** The question box. While typing, the light gathers into one glow centred on it, wherever it is in the pane. */
  box?: HTMLElement | null;
};

function subscribeReduced(notify: () => void): () => void {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

const reducedNow = (): boolean => window.matchMedia(REDUCED_QUERY).matches;

/**
 * Full motion paints one canvas. Reduced motion keeps the cross-fade of fixed gradients, one layer per state, so a change of state
 * is a fade of opacity and nothing drifts, cycles or springs. Both read the setting the way `installMotion` does (D28).
 */
export function Aura({ state = "idle", settings = AURA, box = null }: AuraProps) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, () => false);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className="aura" data-state={state} data-mode={reduced ? "fade" : "canvas"} aria-hidden="true">
      {reduced ? <AuraFade state={state} settings={settings} box={box} root={root} /> : <AuraCanvas state={state} settings={settings} box={box} />}
    </div>
  );
}

/** The layers of the reduced-motion light. Done and off show none of them, so the light fades out and nothing replaces it. */
const FADE_LAYERS = ["idle", "compose", "think"] as const;

/**
 * Reduced motion: one fixed layer per state, and a change of state is a fade of opacity. The compose layer is the canvas's glow on
 * the question box as fixed gradients, placed from the box's measured rectangle. Conversations show nothing.
 */
function AuraFade({ state, settings, box, root }: { state: AuraState; settings: AuraSettings; box: HTMLElement | null; root: RefObject<HTMLDivElement | null> }) {
  const [rect, setRect] = useState<Box | null>(null);
  useEffect(() => {
    const pane = root.current;
    if (box === null || pane === null) {
      setRect(null);
      return;
    }
    const measure = () => setRect(measureBox(pane, box));
    measure();
    return watchBox(pane, box, measure);
  }, [box, root]);
  const glow = useMemo(() => staticGlow(rect, settings, paletteOf((name) => getComputedStyle(document.documentElement).getPropertyValue(name))), [rect, settings]);
  return (
    <>
      {FADE_LAYERS.map((layer) => (
        <div key={layer} className="aura-l" data-layer={layer} data-on={layer === state} style={layer === "compose" && glow !== null ? { background: glow } : undefined} />
      ))}
    </>
  );
}

/**
 * A buffer pixel is 9 screen pixels wide and the light is faint, so in 8 bits each pixel's premultiplied colour rounds a little
 * differently and the upscale shows it as a faint grid of tinted cells. Half-float keeps the buffer smooth, and the only rounding
 * left is the one to the screen, which is the same as any gradient's. Without it the buffer is 8-bit as before.
 */
const FLOAT_BUFFER = { colorType: "float16" } as CanvasRenderingContext2DSettings;

/** Every gradient is two stops. A multi-stop radial gradient cost a 100 to 230 ms stall on its first frame in the tuner. */
function paintCloud(paint: CanvasRenderingContext2D, cloud: PaintCloud): void {
  const cone = (alpha: number, size: number) => {
    const gradient = paint.createRadialGradient(0, 0, 0, 0, 0, size);
    gradient.addColorStop(0, rgbaOf(cloud.colour, alpha));
    gradient.addColorStop(1, rgbaOf(cloud.colour, 0));
    paint.fillStyle = gradient;
    paint.fillRect(-size, -size, 2 * size, 2 * size);
  };
  paint.save();
  paint.translate(cloud.x, cloud.y);
  paint.scale(cloud.rx, cloud.ry);
  cone(cloud.alpha * (1 - cloud.core), 1);
  if (cloud.core > 0.001) cone(cloud.alpha * cloud.core, CORE_SIZE);
  paint.restore();
}

/**
 * The tuner's tail is a linear gradient of three stops. Painted as two gradients of two stops, one over each part, it is the same
 * pixels without the multi-stop shader, whose first use stalled a frame at the send.
 */
function paintTail(paint: CanvasRenderingContext2D, tail: PaintTail, width: number): void {
  const knee = tail.height * TAIL_KNEE;
  const part = (from: number, to: number, start: Rgb, startAlpha: number, end: Rgb, endAlpha: number) => {
    const gradient = paint.createLinearGradient(0, from, 0, to);
    gradient.addColorStop(0, rgbaOf(start, startAlpha));
    gradient.addColorStop(1, rgbaOf(end, endAlpha));
    paint.fillStyle = gradient;
    paint.fillRect(0, from, width, to - from);
  };
  part(0, knee, tail.top, tail.topAlpha, tail.mid, tail.midAlpha);
  part(knee, tail.height, tail.mid, tail.midAlpha, tail.top, 0);
}

/**
 * React owns the canvas and hands the state in through a ref; the frame loop never sets state. A state change moves the spring targets
 * and wakes the loop. The loop sleeps when there is no light to see and nothing still moving, and while the window is hidden.
 */
function AuraCanvas({ state, settings, box }: { state: AuraState; settings: AuraSettings; box: HTMLElement | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state, settings, box });
  const springs = useRef<Springs>(startSprings(settings));
  const aim = useRef<() => void>(() => {});

  useEffect(() => {
    latest.current = { state, settings, box };
    aim.current();
  }, [state, settings, box]);

  useEffect(() => {
    const visible = canvas.current;
    const buffer = document.createElement("canvas");
    const out = visible?.getContext("2d");
    const paint = buffer.getContext("2d", FLOAT_BUFFER);
    if (visible === null || !out || !paint) return;

    const palette = paletteOf((name) => getComputedStyle(document.documentElement).getPropertyValue(name));
    let clock = START_CLOCK;
    let pane = { width: 0, height: 0 };
    let questionBox: Box | null = null;
    let frame = 0;
    let previous: number | null = null;

    /** Also written to `data-box` on the pane, so a run can compare the measured rectangle with the DOM. */
    const measure = () => {
      const pane = visible.parentElement;
      const element = latest.current.box;
      questionBox = pane === null || element === null ? null : measureBox(pane, element);
      pane?.setAttribute("data-box", questionBox === null ? "" : `${questionBox.x},${questionBox.y},${questionBox.w},${questionBox.h}`);
    };

    const fit = (s: AuraSettings) => {
      const dpr = Math.min(window.devicePixelRatio || 1, LOOP.dprCap);
      const size = [Math.max(1, Math.round(pane.width * dpr)), Math.max(1, Math.round(pane.height * dpr)), Math.max(8, Math.round(pane.width / s.bufferDivisor)), Math.max(8, Math.round(pane.height / s.bufferDivisor))] as const;
      if (visible.width !== size[0]) visible.width = size[0];
      if (visible.height !== size[1]) visible.height = size[1];
      if (buffer.width !== size[2]) buffer.width = size[2];
      if (buffer.height !== size[3]) buffer.height = size[3];
    };

    const draw = (plan: PaintPlan, s: AuraSettings) => {
      fit(s);
      paint.setTransform(1, 0, 0, 1, 0, 0);
      paint.clearRect(0, 0, buffer.width, buffer.height);
      out.clearRect(0, 0, visible.width, visible.height);
      if (plan.clouds.length === 0) return;
      paint.setTransform(buffer.width / pane.width, 0, 0, buffer.height / pane.height, 0, 0);
      const { tail } = plan;
      if (tail !== null) paintTail(paint, tail, pane.width);
      for (const cloud of plan.clouds) paintCloud(paint, cloud);
      out.imageSmoothingEnabled = true;
      out.imageSmoothingQuality = "high";
      out.drawImage(buffer, 0, 0, buffer.width, buffer.height, 0, 0, visible.width, visible.height);
    };

    const tick = (now: number) => {
      frame = 0;
      const { state: current, settings: s } = latest.current;
      if (pane.width === 0 || pane.height === 0) {
        previous = null;
        return;
      }
      const dt = frameMs(previous, now);
      previous = now;
      springs.current = stepSprings(springs.current, dt);
      clock = advanceClock(clock, dt, current, s);
      draw(paintPlan(springs.current, clock, s, { pane, box: questionBox }, palette), s);
      if (isResting(springs.current)) {
        previous = null;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame !== 0 || document.hidden) return;
      previous = null;
      frame = requestAnimationFrame(tick);
    };

    /** Measure the box again, point the springs at the state's targets, and wake the loop. */
    const point = () => {
      measure();
      springs.current = retarget(springs.current, latest.current.state, latest.current.settings, { pane, box: questionBox });
      start();
    };

    const onVisibility = () => {
      if (!document.hidden) return start();
      cancelAnimationFrame(frame);
      frame = 0;
      previous = null;
    };

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      pane = { width: entry.contentRect.width, height: entry.contentRect.height };
      point();
    });
    observer.observe(visible);
    document.addEventListener("visibilitychange", onVisibility);
    aim.current = point;
    point();
    return () => {
      aim.current = () => {};
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, []);

  /** The box moves when it or anything around it changes size: its own height as the text wraps, the chips under it, the pane. */
  useEffect(() => {
    const visible = canvas.current;
    if (box === null || visible === null) return;
    const pane = visible.parentElement;
    if (pane === null) return;
    return watchBox(pane, box, () => aim.current());
  }, [box]);

  return <canvas ref={canvas} className="aura-canvas" />;
}
