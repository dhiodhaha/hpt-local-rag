import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { advanceClock, AURA, auraFromTuner, auraStateOf, frameMs, glowAlpha, isFirstAsk, isResting, staticGlow, LOOP, NO_LIGHT, paintPlan, paletteAt, paletteOf, parseHex, retarget, rgbaOf, START_CLOCK, startSprings, stepSpring, stepSprings, TUNED, type Box, type Geometry, type Rgb, type Spring, type Springs } from "../src/renderer/aura.ts";

const PALETTE: readonly Rgb[] = [[240, 176, 114], [245, 211, 141], [235, 157, 182], [193, 174, 242]];
const PANE = { width: 1000, height: 600 };
const BOX: Box = { x: 150, y: 400, w: 700, h: 102 };
const HOME: Geometry = { pane: PANE, box: BOX };
const NO_BOX: Geometry = { pane: PANE, box: null };
const near = (actual: number, expected: number, within: number, what: string) => assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual} is not within ${within} of ${expected}`);

function run(spring: Spring, ms: number, frame = 1000 / 60): Spring {
  let now = spring;
  for (let at = 0; at < ms - 1e-9; at += frame) now = stepSpring(now, frame);
  return now;
}

const at = (v: number, to: number, vel = 0): Spring => ({ v, vel, to, response: 1000 });
const springs = (anchor: number, intensity: number, mix: number, gather = 0): Springs => ({ anchor: at(anchor, anchor), intensity: at(intensity, intensity), mix: at(mix, mix), gather: at(gather, gather) });

describe("a spring", () => {
  const rest: Spring = { v: 0, vel: 0, to: 1, response: 1000 };

  it("stays where it is when it is at its target", () => {
    const still = { v: 0.4, vel: 0, to: 0.4, response: 900 };
    assert.deepEqual(run(still, 2000), still);
  });

  it("arrives within a couple of percent after its response time, and never overshoots", () => {
    let spring = rest;
    let peak = 0;
    for (let ms = 0; ms < 3000; ms += 1000 / 60) {
      spring = stepSpring(spring, 1000 / 60);
      peak = Math.max(peak, spring.v);
      if (Math.abs(ms - 1000) < 8) assert.ok(1 - spring.v < 0.02, `still ${1 - spring.v} short at the response time`);
    }
    assert.ok(peak <= 1 + 1e-6, `overshot to ${peak}`);
    near(spring.v, 1, 1e-4, "settled");
  });

  it("does not depend much on the frame rate", () => {
    near(run(rest, 600, 1000 / 60).v, run(rest, 600, 1000 / 30).v, 0.01, "30 fps against 60 fps");
    near(run(rest, 600, 1000 / 60).v, run(rest, 600, 1000 / 144).v, 0.01, "144 fps against 60 fps");
  });

  it("takes a new target and response without losing its velocity, so a change of state curves instead of jerking", () => {
    const moving = run(rest, 300);
    assert.ok(moving.vel > 0.5, `velocity ${moving.vel}`);
    const redirected = retarget({ anchor: moving, intensity: moving, mix: moving, gather: moving }, "think", AURA, HOME).anchor;
    assert.equal(redirected.vel, moving.vel);
    assert.equal(redirected.v, moving.v);
    assert.notEqual(redirected.to, moving.to);
    const next = stepSpring(redirected, 1000 / 60);
    near(next.v - redirected.v, moving.vel / 60, 0.01, "the next frame still carries the old momentum");
  });

  it("moves all four springs together", () => {
    const start = startSprings(AURA);
    const later = stepSprings(retarget(start, "compose", AURA, HOME), 100);
    assert.ok(later.anchor.v < start.anchor.v && later.intensity.v > 0 && later.gather.v > 0);
  });
});

describe("what each state asks for", () => {
  const settled: Springs = springs(0.5, 0.5, 0.7, 0.4);
  const pick = (s: Springs) => [s.anchor.to, s.intensity.to, s.mix.to, s.gather.to, s.anchor.response];

  it("is the Fajar desktop table", () => {
    assert.deepEqual(pick(retarget(settled, "idle", AURA, HOME)), [1.02, 0.24, 0, 0, 900]);
    assert.deepEqual(pick(retarget(settled, "think", AURA, HOME)), [0.06, 0.62, 1, 0, 1400]);
  });

  it("gathers on the question box while typing: the anchor is the glow's centre in pane heights, the strength is the glow's", () => {
    const [anchor, intensity, mix, gather, ms] = pick(retarget(settled, "compose", AURA, HOME));
    near(anchor!, (400 + 51 - 62 * 0.2) / 600, 1e-12, "anchor");
    assert.deepEqual([intensity, mix, gather, ms], [0.85, 0, 1, 1200]);
  });

  it("follows the box when it moves, and keeps the idle light until there is a box to follow", () => {
    const higher = retarget(settled, "compose", AURA, { pane: PANE, box: { ...BOX, y: 100 } });
    near(higher.anchor.to, (100 + 51 - 12.4) / 600, 1e-12, "anchor of a box near the top");
    assert.deepEqual(pick(retarget(settled, "compose", AURA, NO_BOX)), [1.02, 0.24, 0, 0, 900]);
  });

  it("puts the light out in 600 ms when a conversation is opened, and leaves the anchor, the mix and the gather where they were", () => {
    assert.deepEqual(pick(retarget(settled, "off", AURA, HOME)), [0.5, 0, 0.7, 0.4, 600]);
  });

  it("brings light that has gone out back where it belongs at once, unseen, and only fades its strength in", () => {
    const gone: Springs = { anchor: at(0.06, 0.06), intensity: at(0.0001, 0), mix: at(1, 1), gather: at(0, 0) };
    const idle = retarget(gone, "idle", AURA, HOME);
    assert.deepEqual([idle.anchor.v, idle.mix.v, idle.anchor.vel], [1.02, 0, 0], "the anchor and the mix are already home");
    assert.equal(idle.intensity.v, 0.0001);
    assert.equal(idle.intensity.to, 0.24);
    const glow = retarget(gone, "compose", AURA, HOME);
    assert.equal(glow.gather.v, 1);
    const seen = retarget({ ...gone, intensity: at(0.3, 0) }, "idle", AURA, HOME);
    assert.equal(seen.anchor.v, 0.06, "light that can be seen is never moved by a jump");
    const staysOff = retarget(gone, "off", AURA, HOME);
    assert.equal(staysOff.anchor.v, 0.06);
  });

  it("fades the light out when the answer arrives and leaves the anchor, the mix and the gather where they were", () => {
    assert.deepEqual(pick(retarget(settled, "done", AURA, HOME)), [0.5, 0, 0.7, 0.4, 1800]);
  });
});

describe("the one derived state", () => {
  const at = (screen: "home" | "chat" | "all", firstAsk: boolean, busy: boolean, draft = "") => auraStateOf({ screen, firstAsk, busy, draft });

  it("is the soft light on an empty home and the glow on the box while something is typed there", () => {
    assert.equal(at("home", false, false), "idle");
    assert.equal(at("home", false, false, "k"), "compose");
  });

  it("thinks through the first ask from home and then fades to nothing, whatever is typed meanwhile", () => {
    assert.equal(at("chat", true, true), "think");
    assert.equal(at("chat", true, true, "lanjut"), "think");
    assert.equal(at("chat", true, false), "done");
    assert.equal(at("chat", true, false, "lanjut"), "done", "typing a follow-up after the first answer brings no glow");
  });

  it("is off for every other conversation view: typing or sending a follow-up, and one opened from Riwayat", () => {
    assert.equal(at("chat", false, false), "off");
    assert.equal(at("chat", false, false, "lanjut"), "off", "a follow-up being typed");
    assert.equal(at("chat", false, true), "off", "a follow-up being answered");
  });

  it("is off on Semua percakapan, even with a draft", () => {
    assert.equal(at("all", false, false), "off");
    assert.equal(at("all", true, true, "k"), "off");
  });

  it("knows the first ask from home by its only turn having an origin, which a stored turn does not", () => {
    assert.equal(isFirstAsk([{ origin: { turn: 1 } }]), true);
    assert.equal(isFirstAsk([{ origin: null }]), false, "one stored turn, opened from Riwayat");
    assert.equal(isFirstAsk([{ origin: { turn: 1 } }, { origin: { turn: 2 } }]), false, "a follow-up");
    assert.equal(isFirstAsk([]), false);
  });

  it("walks the whole story: home, typing, the first ask, its answer, a follow-up, Riwayat, and back to home", () => {
    const story = [
      at("home", false, false),
      at("home", false, false, "Apakah"),
      at("chat", true, true),
      at("chat", true, false),
      at("chat", true, false, "Bagaimana"),
      at("chat", false, true),
      at("chat", false, false),
      at("home", false, false),
    ];
    assert.deepEqual(story, ["idle", "compose", "think", "done", "done", "off", "off", "idle"]);
  });
});

describe("the loop's own rules", () => {
  it("caps a frame at 50 ms so a window back from the background does not jump", () => {
    assert.equal(frameMs(1000, 1016), 16);
    assert.equal(frameMs(1000, 60_000), 50);
    assert.equal(frameMs(null, 60_000), 1000 / 60);
  });

  it("rests only with no light and every spring settled", () => {
    const dark = { ...springs(0.06, 0, 1, 0), intensity: at(0.0001, 0) };
    assert.equal(isResting(dark), true);
    assert.equal(isResting({ ...dark, intensity: at(0.24, 0.24) }), false, "idle light keeps drifting");
    assert.equal(isResting({ ...dark, anchor: at(0.3, 0.06) }), false);
    assert.equal(isResting({ ...dark, mix: at(1, 1, 0.5) }), false);
    assert.equal(isResting({ ...dark, gather: at(0.5, 0) }), false, "the glow is still letting go");
    assert.equal(isResting({ ...dark, intensity: at(0.002, 0, 0.5) }), false);
  });

  it("runs the colours at full speed while thinking and at 0.35 times that otherwise", () => {
    const thinking = advanceClock(START_CLOCK, 16_000, "think", AURA);
    near(thinking.phase, 1, 1e-9, "one round in 16 s");
    near(advanceClock(START_CLOCK, 16_000, "idle", AURA).phase, 0.35, 1e-9, "idle");
    near(advanceClock(START_CLOCK, 16_000, "done", AURA).phase, 0.35, 1e-9, "done");
    assert.equal(thinking.t, 16);
  });
});

describe("colour", () => {
  it("reads the palette from the tokens and skips anything that is not a hex colour", () => {
    const tokens: Record<string, string> = { "--color-aura-1": " #f0b072", "--color-aura-2": "#F5D38D", "--color-aura-3": "red", "--color-aura-4": "#c1aef2" };
    assert.deepEqual(paletteOf((name) => tokens[name] ?? ""), [[240, 176, 114], [245, 211, 141], [193, 174, 242]]);
    assert.equal(parseHex("#fff"), null);
    assert.deepEqual(paletteOf(() => ""), []);
  });

  it("holds each palette colour at its stop and blends between stops with smoothstep", () => {
    assert.deepEqual(paletteAt(PALETTE, 0), PALETTE[0]);
    assert.deepEqual(paletteAt(PALETTE, 0.25), PALETTE[1]);
    assert.deepEqual(paletteAt(PALETTE, 1), PALETTE[0], "a full round comes back");
    assert.deepEqual(paletteAt(PALETTE, -0.75), PALETTE[1], "negative rounds wrap");
    const half = paletteAt(PALETTE, 0.125);
    near(half[0], (240 + 245) / 2, 1e-9, "half way is the mean");
    const quarter = paletteAt(PALETTE, 0.0625);
    near(quarter[0], 240 + (245 - 240) * 0.15625, 1e-9, "a quarter of the way is f squared times three minus two f, not f");
    assert.equal(rgbaOf([240.4, 176.6, 114], 1.4), "rgba(240,177,114,1)");
  });
});

describe("the paint plan", () => {
  it("paints nothing when there is no light or no palette", () => {
    assert.equal(paintPlan(springs(0.5, 0.002, 0), START_CLOCK, AURA, HOME, PALETTE), NO_LIGHT);
    assert.equal(paintPlan(springs(0.5, 0.6, 0), START_CLOCK, AURA, HOME, []), NO_LIGHT);
  });

  it("places four round clouds across the pane, drifting about their slots", () => {
    const rest = paintPlan(springs(1.02, 0.24, 0), START_CLOCK, AURA, HOME, PALETTE);
    assert.equal(rest.clouds.length, 4);
    rest.clouds.forEach((cloud, i) => {
      near(cloud.x, (1000 * (i + 0.5)) / 4 + Math.sin(i * 1.9) * 1000 * 0.08, 1e-9, `x of cloud ${i}`);
      near(cloud.y, 1.02 * 600 + Math.sin(i * 2.6) * 600 * 0.03, 1e-9, `y of cloud ${i}`);
      assert.equal(cloud.rx, 420);
      assert.equal(cloud.ry, 420);
      near(cloud.alpha, 0.24 * 0.55, 1e-12, `centre alpha of cloud ${i}`);
      assert.equal(cloud.core, 0);
    });
    const later = paintPlan(springs(1.02, 0.24, 0), { t: 10, phase: 0 }, AURA, HOME, PALETTE);
    near(later.clouds[2]!.x, 625 + Math.sin(10 * 0.16 * 0.9 + 2 * 1.9) * 80, 1e-9, "x after 10 s");
  });

  it("sizes the clouds from the pane width, so a wider pane is a bigger cloud", () => {
    const narrow = paintPlan(springs(0.5, 0.5, 0), START_CLOCK, AURA, { pane: { width: 390, height: 700 }, box: null }, PALETTE);
    const wide = paintPlan(springs(0.5, 0.5, 0), START_CLOCK, AURA, { pane: { width: 1440, height: 900 }, box: null }, PALETTE);
    near(narrow.clouds[0]!.rx, 390 * 0.42, 1e-9, "narrow radius");
    near(wide.clouds[0]!.rx / narrow.clouds[0]!.rx, 1440 / 390, 1e-9, "radius scales with width");
  });

  it("draws the tail only while the light flows from the top, down to the anchor plus the tail", () => {
    assert.equal(paintPlan(springs(0.06, 0.62, 0), START_CLOCK, AURA, HOME, PALETTE).tail, null);
    const tail = paintPlan(springs(0.06, 0.62, 1), START_CLOCK, AURA, HOME, PALETTE).tail;
    assert.ok(tail !== null);
    near(tail.height, 0.06 * 600 + 300, 1e-9, "tail reaches anchor + 300px");
    near(tail.topAlpha, 0.62 * 0.7, 1e-12, "top alpha");
    near(tail.midAlpha, 0.62 * 0.3, 1e-12, "middle alpha");
    const half = paintPlan(springs(0.06, 0.62, 0.5), START_CLOCK, AURA, HOME, PALETTE).tail;
    near(half!.topAlpha, 0.62 * 0.5 * 0.7, 1e-12, "mix scales the tail");
  });

  it("offsets each cloud's colour along the palette by its index", () => {
    const plan = paintPlan(springs(0.5, 0.5, 0), START_CLOCK, AURA, HOME, PALETTE);
    assert.deepEqual(plan.clouds[0]!.colour, PALETTE[0]);
    assert.deepEqual(plan.clouds[2]!.colour, paletteAt(PALETTE, 0.25));
  });
});

describe("the glow on the question box", () => {
  const glow = (gather: number, box: Box | null = BOX) => paintPlan(springs(0.5, 0.85, 0, gather), START_CLOCK, AURA, { pane: PANE, box }, PALETTE);
  const rx = 700 * 0.75;
  const ry = 62 * 5.5;
  const cy = 400 + 51 - 62 * 0.2;

  it("is four clouds in one ellipse of reachX box widths by reachY tuner box heights (62 px), centred on the box and nudged by offsetY", () => {
    const full = glow(1);
    full.clouds.forEach((cloud, i) => {
      near(cloud.rx, rx, 1e-9, `rx of cloud ${i}`);
      near(cloud.ry, ry, 1e-9, `ry of cloud ${i}`);
      near(cloud.x, 500 + ((i - 1.5) / 1.5) * 0.3 * rx + Math.sin(i * 1.9) * 0.12 * rx, 1e-9, `x of cloud ${i}`);
      near(cloud.y, cy + Math.sin(i * 2.6) * 0.12 * ry * 0.4, 1e-9, `y of cloud ${i}`);
    });
  });

  it("does not swell with a taller box: the vertical reach is the same for a one-line pill and a three-line composer", () => {
    const tall = glow(1, { ...BOX, h: 160 });
    assert.equal(tall.clouds[0]!.ry, glow(1).clouds[0]!.ry);
    assert.equal(tall.clouds[0]!.rx, glow(1).clouds[0]!.rx);
  });

  it("gives each cloud the alpha that makes four of them stack to the glow's strength", () => {
    near(1 - Math.pow(1 - glowAlpha(0.85), 4), 0.85, 1e-12, "four clouds stack to 0.85");
    near(1 - Math.pow(1 - glowAlpha(1), 4), 0.98, 1e-12, "capped under 1");
    near(glow(1).clouds[0]!.alpha, glowAlpha(0.85), 1e-12, "the plan uses it");
  });

  it("puts a denser core on the glow as softness drops: 0.6 of (1 - softness), and none at full softness", () => {
    near(glow(1).clouds[0]!.core, (1 - 0.6) * 0.6, 1e-12, "core at softness 0.6");
    const soft = paintPlan(springs(0.5, 0.85, 0, 1), START_CLOCK, { ...AURA, composeGlow: { ...AURA.composeGlow, softness: 1 } }, HOME, PALETTE);
    assert.equal(soft.clouds[0]!.core, 0);
  });

  it("blends from the four clouds to the glow as the gather spring rises, and is the four clouds below a hair of it", () => {
    const apart = glow(0);
    const half = glow(0.5);
    const full = glow(1);
    near(half.clouds[1]!.x, (apart.clouds[1]!.x + full.clouds[1]!.x) / 2, 1e-9, "x half way");
    near(half.clouds[1]!.ry, (apart.clouds[1]!.ry + full.clouds[1]!.ry) / 2, 1e-9, "ry half way");
    assert.equal(glow(0.001).clouds[0]!.core, 0);
    assert.equal(glow(0.001).clouds[0]!.rx, 420);
  });

  it("keeps the four clouds when there is no box to gather on", () => {
    assert.equal(glow(1, null).clouds[0]!.rx, 420);
  });
});

describe("the reduced-motion glow", () => {
  it("has nothing to draw before the box is measured", () => {
    assert.equal(staticGlow(null, AURA, PALETTE), null);
    assert.equal(staticGlow(BOX, AURA, []), null);
  });

  it("is the canvas's four clouds and their cores as two-stop ellipses on the box, and does not move", () => {
    const css = staticGlow(BOX, AURA, PALETTE)!;
    const layers = css.split("),radial-gradient(");
    assert.equal(layers.length, 8, "four clouds and four cores");
    assert.ok(css.includes("ellipse 525px 341px at 343px 439px"), "the first cloud is an ellipse of reachX box widths by reachY 62 px units, a third of a reach left of the box's middle and at its glow height");
    assert.ok(css.includes("ellipse 236px 153px at"), "a core is 0.45 of it");
    assert.equal(css.includes("%"), false, "all in pixels, none of the old wide percentages");
    assert.equal(staticGlow(BOX, AURA, PALETTE), css);
  });

  it("has no cores at full softness", () => {
    const soft = { ...AURA, composeGlow: { ...AURA.composeGlow, softness: 1 } };
    assert.equal(staticGlow(BOX, soft, PALETTE)!.split("),radial-gradient(").length, 4);
  });
});

describe("the settings", () => {
  const rows: Record<string, number> = {
    "states.idle.anchor": 1.02, "states.idle.intensity": 0.24, "states.idle.mix": 0, "states.idle.response": 900,
    "states.compose.mix": 0, "states.compose.response": 1200,
    "states.think.anchor": 0.06, "states.think.intensity": 0.62, "states.think.mix": 1, "states.think.response": 1400,
    "states.done.response": 1800,
    "cloud.radius": 0.42, "cloud.driftAmp": 0.08, "cloud.driftSpeed": 0.16, "cloud.wobble": 0.03, "cloud.centerAlpha": 0.55,
    "color.cycleSec": 16, "color.idleSpeed": 0.35,
    "composeGlow.reachX": 0.75, "composeGlow.reachY": 5.5, "composeGlow.softness": 0.6, "composeGlow.intensity": 0.85, "composeGlow.offsetY": -0.2, "composeGlow.drift": 0.12,
    tail: 300, bufferDivisor: 9,
  };
  const read = (tree: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree);

  it("ships the approved Fajar (desktop) preset, every number of it", () => {
    for (const [key, value] of Object.entries(rows)) assert.equal(read(AURA, key), value, key);
  });

  it("has no key but the tuner's own, so a pasted JSON replaces values and never adds code", () => {
    const keys = (tree: unknown, prefix = ""): string[] => Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => (typeof value === "object" ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]));
    assert.deepEqual(keys(AURA).sort(), Object.keys(rows).sort());
  });

  const TUNER_PALETTE = ["#F0B072", "#F5D38D", "#EB9DB6", "#C1AEF2"];

  it("takes the tuner's JSON as the tuner prints it, palette and all, and gives the same settings", () => {
    const printed = JSON.parse(JSON.stringify(TUNED)) as { color: Record<string, unknown> };
    printed.color.palette = TUNER_PALETTE;
    assert.deepEqual(auraFromTuner(printed), AURA);
  });

  it("changes only the numbers a pasted JSON names, whatever else it carries", () => {
    const next = auraFromTuner({ composeGlow: { reachX: 1.1, banana: 3 }, tail: 120, color: { palette: ["#000000", "#111111", "#222222", "#333333"] }, extra: 1 }, AURA);
    assert.equal(next.composeGlow.reachX, 1.1);
    assert.equal(next.tail, 120);
    assert.deepEqual({ ...next, composeGlow: AURA.composeGlow, tail: AURA.tail }, { ...AURA, composeGlow: AURA.composeGlow, tail: AURA.tail });
    assert.equal(next.composeGlow.reachY, 5.5);
    assert.equal(AURA.composeGlow.reachX, 0.75, "the preset itself is not touched");
  });

  it("refuses a JSON with a number out of its slider's range, one that is not a number, or nothing it knows", () => {
    assert.throws(() => auraFromTuner({ composeGlow: { reachX: 9 } }, AURA), /composeGlow\.reachX/);
    assert.throws(() => auraFromTuner({ tail: "300" }, AURA), /tail/);
    assert.throws(() => auraFromTuner({ states: { idle: { response: 0 } } }, AURA), /states\.idle\.response/);
    assert.throws(() => auraFromTuner({ palette: [] }, AURA), /no known/);
    assert.throws(() => auraFromTuner(null, AURA), /no known/);
    assert.throws(() => auraFromTuner({ tail: 100 }), /is missing/, "a first read has to be complete");
  });

  it("keeps the tuner's palette and the app's colour tokens the same four colours", () => {
    const tokens = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/renderer/styles/tokens.css"), "utf8");
    const palette = TUNER_PALETTE.map((hex) => hex.toLowerCase());
    assert.deepEqual([1, 2, 3, 4].map((n) => new RegExp(`--color-aura-${n}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1]?.toLowerCase()), palette);
  });

  it("limits the loop to 2x pixels, a 50 ms frame, light below 0.003 being none, and 600 ms for light going out", () => {
    assert.deepEqual(LOOP, { dprCap: 2, maxFrameMs: 50, restBelow: 0.003, offMs: 600 });
  });
});
