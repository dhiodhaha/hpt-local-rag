/**
 * The light behind the conversation pane (D35). Everything that is arithmetic lives here, with no DOM and no canvas, so the numbers
 * are tested directly: springs, the colour clock, the question-box glow, and the paint plan (where each cloud goes and in what colour).
 * The light shows on the home screen and in the first ask from it, and nowhere else (D35): `auraStateOf` is the one derived value. `ui/Aura.tsx` only owns the canvas, the observers, the animation loop and the state ref, and draws what `paintPlan` returns.
 *
 * `AuraSettings` has the shape of the desktop tuner's own JSON (`states`, `cloud`, `color`, `composeGlow`, `tail`, `bufferDivisor`), so
 * a pasted tuner JSON goes through `auraFromTuner` with no hand translation. `TUNED` is the tuner's "Fajar (desktop)" preset, pasted
 * as the tuner prints it, and `AURA` is what the app reads. The palette in that JSON is not read: the four colours are the
 * `--color-aura-*` tokens.
 */
export const AURA_STATES = ["idle", "compose", "think", "done", "off"] as const;
export type AuraState = (typeof AURA_STATES)[number];

export type AuraSettings = {
  readonly states: {
    /** `anchor` is the light's height in the pane, 0 at the top and 1 at the bottom. `mix` is 0 for light resting at the bottom and 1 for light falling from the top. */
    readonly idle: { readonly anchor: number; readonly intensity: number; readonly mix: number; readonly response: number };
    /** Typing has no anchor or strength of its own: they come from the question box and `composeGlow`. */
    readonly compose: { readonly mix: number; readonly response: number };
    readonly think: { readonly anchor: number; readonly intensity: number; readonly mix: number; readonly response: number };
    /** Done fades the strength to 0 and leaves the anchor and the mix where they were. */
    readonly done: { readonly response: number };
  };
  readonly cloud: {
    /** Cloud radius, in fractions of the pane width. */
    readonly radius: number;
    /** Horizontal drift of a cloud, in fractions of the pane width. */
    readonly driftAmp: number;
    /** Radians per second of the drift is `driftSpeed * 0.9`. */
    readonly driftSpeed: number;
    /** Vertical wobble of a cloud, in fractions of the pane height. */
    readonly wobble: number;
    /** Peak alpha of a cloud's centre, at strength 1. */
    readonly centerAlpha: number;
  };
  readonly color: {
    /** Seconds for the colours to go once round the palette while thinking. */
    readonly cycleSec: number;
    /** Colour clock speed outside the think state. */
    readonly idleSpeed: number;
  };
  /** While typing, the four clouds gather into one elliptical glow on the question box. Reach is in box widths (x) and in the tuner's 62 px box heights (y). */
  readonly composeGlow: {
    readonly reachX: number;
    readonly reachY: number;
    /** 1 is one wide fade. Lower is a denser core at the middle. */
    readonly softness: number;
    /** Peak combined alpha at the middle. */
    readonly intensity: number;
    /** Centre of the glow, in 62 px box heights from the box's middle. Positive is down. */
    readonly offsetY: number;
    /** How far the clouds wander within the glow, in reaches. */
    readonly drift: number;
  };
  /** Pixels the thinking light reaches below its anchor. */
  readonly tail: number;
  /** The paint buffer is the pane divided by this, and the upscale is the blur. */
  readonly bufferDivisor: number;
};

/** The tuner's "Fajar (desktop)" preset, as its JSON without `color.palette`, which is the tokens' to hold (hex literals live only in tokens.css). Paste a new one over this, palette or not. */
export const TUNED: unknown = {
  states: { idle: { anchor: 1.02, intensity: 0.24, mix: 0, response: 900 }, compose: { mix: 0, response: 1200 }, think: { anchor: 0.06, intensity: 0.62, mix: 1, response: 1400 }, done: { response: 1800 } },
  cloud: { radius: 0.42, driftAmp: 0.08, driftSpeed: 0.16, wobble: 0.03, centerAlpha: 0.55 },
  color: { cycleSec: 16, idleSpeed: 0.35 },
  composeGlow: { reachX: 0.75, reachY: 5.5, softness: 0.6, intensity: 0.85, offsetY: -0.2, drift: 0.12 },
  tail: 300,
  bufferDivisor: 9,
};

/** Every number the tuner can print, with the range of its slider. This table is the whole mapping: a path reads the same in the JSON and in `AuraSettings`. */
const TUNER_PATHS: readonly (readonly [path: string, min: number, max: number])[] = [
  ["states.idle.anchor", -0.1, 1.2],
  ["states.idle.intensity", 0, 1],
  ["states.idle.mix", 0, 1],
  ["states.idle.response", 200, 3000],
  ["states.compose.mix", 0, 1],
  ["states.compose.response", 200, 3000],
  ["states.think.anchor", -0.1, 1.2],
  ["states.think.intensity", 0, 1],
  ["states.think.mix", 0, 1],
  ["states.think.response", 200, 3000],
  ["states.done.response", 200, 3000],
  ["cloud.radius", 0.2, 1.2],
  ["cloud.driftAmp", 0, 0.3],
  ["cloud.driftSpeed", 0, 0.6],
  ["cloud.wobble", 0, 0.1],
  ["cloud.centerAlpha", 0.1, 1],
  ["color.cycleSec", 4, 40],
  ["color.idleSpeed", 0, 1],
  ["composeGlow.reachX", 0.2, 2],
  ["composeGlow.reachY", 0.5, 10],
  ["composeGlow.softness", 0, 1],
  ["composeGlow.intensity", 0.05, 1],
  ["composeGlow.offsetY", -2, 3],
  ["composeGlow.drift", 0, 0.5],
  ["tail", 0, 600],
  ["bufferDivisor", 4, 20],
];

type Tree = { [key: string]: unknown };
const isTree = (value: unknown): value is Tree => typeof value === "object" && value !== null && !Array.isArray(value);
const pathOf = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((node, key) => (isTree(node) ? node[key] : undefined), tree);

function withPath(tree: Tree, path: string, value: number): Tree {
  const [key, ...rest] = path.split(".") as [string, ...string[]];
  return { ...tree, [key]: rest.length === 0 ? value : withPath(isTree(tree[key]) ? tree[key] : {}, rest.join("."), value) };
}

/**
 * Reads a pasted tuner JSON over `base`. A number the JSON leaves out keeps its value in `base`, and a key the app does not read (the
 * palette) is ignored. A number outside its slider's range, or a JSON with no known number at all, throws, so a mangled paste never
 * reaches the screen.
 */
export function auraFromTuner(json: unknown, base?: AuraSettings): AuraSettings {
  let next: Tree = (base ?? ({} as AuraSettings)) as unknown as Tree;
  let found = 0;
  for (const [path, min, max] of TUNER_PATHS) {
    const value = pathOf(json, path);
    if (value === undefined) {
      if (base === undefined) throw new Error(`${path} is missing`);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} must be a number from ${min} to ${max}, got ${JSON.stringify(value)}`);
    next = withPath(next, path, value);
    found += 1;
  }
  if (found === 0) throw new Error("no known tuner setting in this JSON");
  return next as unknown as AuraSettings;
}

export const AURA: AuraSettings = auraFromTuner(TUNED);

/** Limits of the loop that are not tuned. */
export const LOOP = {
  /** The visible canvas is drawn at the display's pixel ratio up to this. */
  dprCap: 2,
  /** A frame counts for no more than this, so a window back from the background does not jump. */
  maxFrameMs: 50,
  /** Light below this is no light, and the loop may sleep once every spring has settled. */
  restBelow: 0.003,
  /** Spring response of the light going out when a conversation is opened or the Semua percakapan list is shown. The first answer's fade is the tuner's `done` response. */
  offMs: 600,
};

/** What the tuner fixes and does not offer a slider for. */
const CLOUDS = 4;
const COLOR_SPREAD = 0.5;
const GLOW_SPREAD = 0.3;
const CORE_R = 0.45;
const TAIL_TOP = 0.7;
const TAIL_MID = 0.3;
/** Where the tail's middle stop sits, in fractions of its height. */
export const TAIL_KNEE = 0.55;

/**
 * The one derived value. The light is on the home screen (soft while idle, the glow on the box while typing) and in the first ask
 * from home (think while the run has no outcome, then done, which fades to nothing). Everywhere else it is off: typing or sending a
 * follow-up, a conversation opened from Riwayat, and Semua percakapan.
 */
export type AuraScreen = "home" | "chat" | "all";
export type AuraInput = { readonly screen: AuraScreen; readonly firstAsk: boolean; readonly busy: boolean; readonly draft: string };

export function auraStateOf({ screen, firstAsk, busy, draft }: AuraInput): AuraState {
  if (screen === "all") return "off";
  if (screen === "home") return draft === "" ? "idle" : "compose";
  if (!firstAsk) return "off";
  return busy ? "think" : "done";
}

/** A conversation is the first ask from home when its only turn was asked here: a stored turn has no origin. */
export const isFirstAsk = (turns: readonly { readonly origin: unknown }[]): boolean => turns.length === 1 && turns[0]!.origin !== null;

/* Springs: critically damped, so they never bounce. A state change moves `to` and `response` and keeps `vel`. */
export type Spring = { readonly v: number; readonly vel: number; readonly to: number; readonly response: number };
/** `gather` is 0 for four separate clouds and 1 for the one glow on the question box. */
export type Springs = { readonly anchor: Spring; readonly intensity: Spring; readonly mix: Spring; readonly gather: Spring };

const STEPS = 4;
const SETTLE_POS = 5e-4;
const SETTLE_VEL = 1e-3;

export function stepSpring(spring: Spring, dtMs: number): Spring {
  const w = (2 * Math.PI) / (spring.response / 1000);
  const h = dtMs / 1000 / STEPS;
  let { v, vel } = spring;
  for (let step = 0; step < STEPS; step += 1) {
    const acc = -w * w * (v - spring.to) - 2 * w * vel;
    vel += acc * h;
    v += vel * h;
  }
  return { v, vel, to: spring.to, response: spring.response };
}

export function stepSprings(springs: Springs, dtMs: number): Springs {
  return { anchor: stepSpring(springs.anchor, dtMs), intensity: stepSpring(springs.intensity, dtMs), mix: stepSpring(springs.mix, dtMs), gather: stepSpring(springs.gather, dtMs) };
}

/** Light is dark at first and fades in, so a screen that mounts mid-session never pops. */
export function startSprings(settings: AuraSettings): Springs {
  const at = (v: number): Spring => ({ v, vel: 0, to: v, response: settings.states.idle.response });
  return { anchor: at(1.1), intensity: at(0), mix: at(0), gather: at(0) };
}

/** The question box and the pane, in pane pixels. `box` is null until it is measured, and then typing keeps the idle light. */
export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type PaneSize = { readonly width: number; readonly height: number };
export type Geometry = { readonly pane: PaneSize; readonly box: Box | null };

/**
 * The tuner's question box is a pill 62 px high, and the glow's vertical reach and offset are tuned in multiples of that. The app's
 * composer is taller (a text row and a row of chips) and grows as the text wraps, so its own height would swell the approved glow to
 * 1.6 times as tall and fill the pane. The width is the column's, which is the tuner's to within 5%, so reachX stays in box widths.
 */
export const GLOW_UNIT_H = 62;

/** Where the glow sits, in pane pixels. */
export function glowOf(box: Box, g: AuraSettings["composeGlow"]) {
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2 + GLOW_UNIT_H * g.offsetY, rx: box.w * g.reachX, ry: GLOW_UNIT_H * g.reachY };
}

/** `null` keeps the spring's current target. */
type Target = { readonly anchor: number | null; readonly intensity: number; readonly mix: number | null; readonly gather: number | null; readonly ms: number };

export function targetOf(state: AuraState, s: AuraSettings, geometry: Geometry): Target {
  const { idle, compose, think, done } = s.states;
  switch (state) {
    case "idle":
      return { anchor: idle.anchor, intensity: idle.intensity, mix: idle.mix, gather: 0, ms: idle.response };
    case "compose": {
      const { box, pane } = geometry;
      if (box === null || pane.height <= 0) return targetOf("idle", s, geometry);
      return { anchor: glowOf(box, s.composeGlow).cy / pane.height, intensity: s.composeGlow.intensity, mix: compose.mix, gather: 1, ms: compose.response };
    }
    case "think":
      return { anchor: think.anchor, intensity: think.intensity, mix: think.mix, gather: 0, ms: think.response };
    case "done":
      return { anchor: null, intensity: 0, mix: null, gather: null, ms: done.response };
    case "off":
      return { anchor: null, intensity: 0, mix: null, gather: null, ms: LOOP.offMs };
  }
}

/**
 * A state change keeps every spring's value and velocity. The exception is light that is not there: when it has gone out and is
 * about to come back (home after a conversation), the anchor, the mix and the gather take their new positions at once, unseen, so
 * the light fades in where it belongs instead of sliding there from where it went out.
 */
export function retarget(springs: Springs, state: AuraState, s: AuraSettings, geometry: Geometry): Springs {
  const target = targetOf(state, s, geometry);
  const unseen = springs.intensity.v < LOOP.restBelow && target.intensity > 0;
  const aim = (spring: Spring, to: number | null, jump: boolean): Spring => (jump && unseen && to !== null ? { v: to, vel: 0, to, response: target.ms } : { v: spring.v, vel: spring.vel, to: to ?? spring.to, response: target.ms });
  return { anchor: aim(springs.anchor, target.anchor, true), intensity: aim(springs.intensity, target.intensity, false), mix: aim(springs.mix, target.mix, true), gather: aim(springs.gather, target.gather, true) };
}

const settled = (spring: Spring): boolean => Math.abs(spring.v - spring.to) < SETTLE_POS && Math.abs(spring.vel) < SETTLE_VEL;

/** The loop may stop: no light to see and nothing still moving. */
export function isResting(springs: Springs): boolean {
  return springs.intensity.v < LOOP.restBelow && Object.values(springs).every(settled);
}

/** The first frame after a stop has no earlier one to measure from. A long gap (a hidden window) counts as `maxFrameMs`, so nothing jumps. */
export function frameMs(previous: number | null, now: number): number {
  return previous === null ? 1000 / 60 : Math.min(Math.max(now - previous, 0), LOOP.maxFrameMs);
}

/** `t` drives the drift, `phase` (in rounds) drives the colours. Both advance by capped frame time, never by the wall clock. */
export type Clock = { readonly t: number; readonly phase: number };
export const START_CLOCK: Clock = { t: 0, phase: 0 };

export function advanceClock(clock: Clock, dtMs: number, state: AuraState, s: AuraSettings): Clock {
  const dt = dtMs / 1000;
  return { t: clock.t + dt, phase: clock.phase + (dt / s.color.cycleSec) * (state === "think" ? 1 : s.color.idleSpeed) };
}

/* Colour */
export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function parseHex(text: string): Rgb | null {
  const match = HEX.exec(text.trim());
  return match === null ? null : [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

/** The palette is the `--color-aura-*` tokens. A token that is not a hex colour is skipped, and no colours means no light. */
export function paletteOf(read: (name: string) => string): readonly Rgb[] {
  return [1, 2, 3, 4].map((n) => parseHex(read(`--color-aura-${n}`))).filter((colour): colour is Rgb => colour !== null);
}

const smoothstep = (f: number): number => f * f * (3 - 2 * f);

/** Round the palette ring with smoothstep between stops, so a colour change never shows a corner. `at` is in rounds. */
export function paletteAt(palette: readonly Rgb[], at: number): Rgb {
  const n = palette.length;
  const x = (((at % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const f = smoothstep(x - i);
  const a = palette[i]!;
  const b = palette[(i + 1) % n]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const rgbaOf = (colour: Rgb, alpha: number): string => `rgba(${Math.round(colour[0])},${Math.round(colour[1])},${Math.round(colour[2])},${Math.min(1, Math.max(0, alpha))})`;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Four clouds painted over each other reach `intensity`: each carries the alpha that makes the four together equal it. */
export const glowAlpha = (intensity: number): number => 1 - Math.pow(1 - Math.min(intensity, 0.98), 1 / CLOUDS);

/* The paint plan: what to draw this frame, in pane pixels. A cloud is an ellipse of `rx` by `ry` fading from `alpha` to 0. With `core` above 0 a second, denser fade of 0.45 of its size and `core` of its alpha sits on top. */
export type PaintCloud = { readonly x: number; readonly y: number; readonly rx: number; readonly ry: number; readonly colour: Rgb; readonly alpha: number; readonly core: number };
export type PaintTail = { readonly height: number; readonly top: Rgb; readonly mid: Rgb; readonly topAlpha: number; readonly midAlpha: number };
export type PaintPlan = { readonly clouds: readonly PaintCloud[]; readonly tail: PaintTail | null };

export const NO_LIGHT: PaintPlan = { clouds: [], tail: null };
export const CORE_SIZE = CORE_R;

export function paintPlan(springs: Springs, clock: Clock, s: AuraSettings, geometry: Geometry, palette: readonly Rgb[]): PaintPlan {
  const intensity = Math.max(0, springs.intensity.v);
  if (palette.length === 0 || intensity < LOOP.restBelow) return NO_LIGHT;
  const { pane, box } = geometry;
  const anchor = springs.anchor.v * pane.height;
  const mix = Math.min(1, Math.max(0, springs.mix.v));
  const gather = box === null ? 0 : Math.min(1, Math.max(0, springs.gather.v));
  const { cloud, composeGlow } = s;

  const tail: PaintTail | null =
    mix > 0.001
      ? { height: Math.max(1, anchor + s.tail), top: paletteAt(palette, clock.phase), mid: paletteAt(palette, clock.phase + 0.12), topAlpha: intensity * mix * TAIL_TOP, midAlpha: intensity * mix * TAIL_MID }
      : null;

  const glow = box === null ? null : glowOf(box, composeGlow);
  const core = (1 - composeGlow.softness) * 0.6 * gather;
  const clouds: PaintCloud[] = [];
  for (let i = 0; i < CLOUDS; i += 1) {
    const dx = Math.sin(clock.t * cloud.driftSpeed * 0.9 + i * 1.9);
    const dy = Math.sin(clock.t * cloud.driftSpeed * 0.7 + i * 2.6);
    let x = (pane.width * (i + 0.5)) / CLOUDS + dx * pane.width * cloud.driftAmp;
    let y = anchor + dy * pane.height * cloud.wobble;
    let rx = pane.width * cloud.radius;
    let ry = rx;
    let alpha = intensity * cloud.centerAlpha;
    if (glow !== null && gather >= 0.002) {
      const gx = glow.cx + ((i - (CLOUDS - 1) / 2) / ((CLOUDS - 1) / 2)) * GLOW_SPREAD * glow.rx + dx * composeGlow.drift * glow.rx;
      const gy = glow.cy + dy * composeGlow.drift * glow.ry * 0.4;
      x = lerp(x, gx, gather);
      y = lerp(y, gy, gather);
      rx = lerp(rx, glow.rx, gather);
      ry = lerp(ry, glow.ry, gather);
      alpha = lerp(alpha, glowAlpha(intensity), gather);
    }
    clouds.push({ x, y, rx, ry, colour: paletteAt(palette, clock.phase + (i / CLOUDS) * COLOR_SPREAD), alpha, core: gather >= 0.002 ? core : 0 });
  }
  return { clouds, tail };
}

/**
 * The reduced-motion glow: the same four clouds and the same ellipse as `paintPlan` at full gather, as CSS gradients that never move.
 * `null` until the box is measured. Every gradient has two stops, like the canvas's.
 */
export function staticGlow(box: Box | null, s: AuraSettings, palette: readonly Rgb[]): string | null {
  if (box === null || palette.length === 0) return null;
  const glow = glowOf(box, s.composeGlow);
  const alpha = glowAlpha(s.composeGlow.intensity);
  const core = (1 - s.composeGlow.softness) * 0.6;
  const px = (value: number) => `${Math.round(value)}px`;
  const layers: string[] = [];
  for (let i = 0; i < CLOUDS; i += 1) {
    const colour = palette[i % palette.length]!;
    const at = `at ${px(glow.cx + ((i - (CLOUDS - 1) / 2) / ((CLOUDS - 1) / 2)) * GLOW_SPREAD * glow.rx)} ${px(glow.cy)}`;
    layers.push(`radial-gradient(ellipse ${px(glow.rx)} ${px(glow.ry)} ${at},${rgbaOf(colour, alpha * (1 - core))},${rgbaOf(colour, 0)})`);
    if (core > 0.001) layers.push(`radial-gradient(ellipse ${px(glow.rx * CORE_R)} ${px(glow.ry * CORE_R)} ${at},${rgbaOf(colour, alpha * core)},${rgbaOf(colour, 0)})`);
  }
  return layers.join(",");
}
