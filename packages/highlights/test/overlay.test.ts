import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, loadLayouts, parseClockText, readOverlay, shifted, type Frame, type Layout } from "../src/overlay.ts";

/**
 * The reader against frames drawn here, because the rink's frames are its
 * footage and do not belong in a public repository. Against the real ones —
 * 1,521 frames of the 2026-10-07 and 2026-10-15 recordings, every field read
 * by eye — this port and the prototype it came from agree on every frame.
 */

const layouts = loadLayouts();
const led = layouts.find((l) => l.name === "rink1-led")!;
const tile = layouts.find((l) => l.name === "rink2-tile")!;

const W = 1280, H = 720;
const blank = (): Frame => ({ width: W, height: H, rgb: new Uint8Array(W * H * 3) });

function rect(f: Frame, x: number, y: number, w: number, h: number, [r, g, b]: [number, number, number]) {
  for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
    for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
      const o = (yy * W + xx) * 3;
      f.rgb[o] = r; f.rgb[o + 1] = g; f.rgb[o + 2] = b;
    }
  }
}

const SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
  "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

/** A seven-segment digit `w` by `h` pixels, strokes `s` thick, at (x, y). A "1" is drawn as a bare upright, as the boards draw it. */
function digit(f: Frame, d: string, x: number, y: number, w: number, h: number, colour: [number, number, number]) {
  const s = 3, mid = y + h / 2 - s / 2;
  if (d === "1") return rect(f, x + w - s, y, s, h, colour);
  const lit = SEGS[d]!;
  if (lit.includes("a")) rect(f, x, y, w, s, colour);
  if (lit.includes("g")) rect(f, x, mid, w, s, colour);
  if (lit.includes("d")) rect(f, x, y + h - s, w, s, colour);
  if (lit.includes("f")) rect(f, x, y, s, h / 2, colour);
  if (lit.includes("b")) rect(f, x + w - s, y, s, h / 2, colour);
  if (lit.includes("e")) rect(f, x, y + h / 2, s, h / 2, colour);
  if (lit.includes("c")) rect(f, x + w - s, y + h / 2, s, h / 2, colour);
}

/** Text into a field's box, as tall as the box allows: digits, a colon as two dots, a point as one. */
function write(f: Frame, layout: Layout, field: "home" | "away" | "clock" | "period", text: string, colour: [number, number, number]) {
  const [x0, , y0, y1] = layout.fields[field].box;
  const h = Math.min(22, Math.floor(H * (y1 - y0)) - 6), w = Math.round(h / 2);
  let x = W * x0 + 4;
  const y = H * y0 + 3;
  for (const ch of text) {
    if (ch === ":") { rect(f, x, y + h * 0.25, 2, 2, colour); rect(f, x, y + h * 0.7, 2, 2, colour); x += 6; }
    else if (ch === ".") { rect(f, x, y + h - 3, 2, 3, colour); x += 6; }
    else { digit(f, ch, x, y, w, h, colour); x += w + 4; }
  }
}

const YELLOW: [number, number, number] = [230, 210, 60];
const RED: [number, number, number] = [220, 30, 30];

test("decodes a seven-segment board: every digit, a colon, tenths under a minute", () => {
  for (const [clock, home, away, period] of [["10:28", "1", "2", "2"], ["4:57", "3", "0", "1"], ["38.5", "9", "6", "3"]] as const) {
    const f = blank();
    write(f, led, "clock", clock, YELLOW);
    write(f, led, "home", home, RED);
    write(f, led, "away", away, RED);
    write(f, led, "period", period, YELLOW);
    const r = readOverlay(f, led);
    assert.equal(r.clockText, clock);
    assert.deepEqual([r.home, r.away], [Number(home), Number(away)]);
    assert.equal(r.period, { "1": "1st", "2": "2nd", "3": "3rd" }[period]);
  }
});

test("a pattern that is no digit reads as unknown, never as the nearest digit", () => {
  const f = blank();
  // Top and bottom bars only: not a digit on any board.
  const [x0, , y0] = led.fields.clock.box;
  rect(f, W * x0 + 4, H * y0 + 4, 11, 3, YELLOW);
  rect(f, W * x0 + 4, H * y0 + 23, 11, 3, YELLOW);
  const r = readOverlay(f, led);
  assert.equal(r.clockText, "?");
  assert.equal(r.clock, null);
});

test("a board with nothing on it is unknown in every field, not zero", () => {
  for (const layout of layouts) {
    const r = readOverlay(blank(), layout);
    assert.deepEqual([r.period, r.clock, r.home, r.away], [null, null, null, null], layout.name);
  }
  // The tile's clock box is white when the overlay is up; dark, it is down.
  assert.ok(tile.on);
});

test("clock text: M:SS, and the tenths some boards show in the last minute", () => {
  assert.equal(parseClockText("11:52"), 712);
  assert.equal(parseClockText("0:07"), 7);
  assert.equal(parseClockText("38.5"), 38);
  assert.equal(parseClockText("1?:27"), null);
  assert.equal(parseClockText("4:61"), null);
  assert.equal(parseClockText(""), null);
});

test("every layout is complete enough to read", () => {
  for (const l of layouts) {
    for (const f of ["home", "away", "clock", "period"] as const) {
      const [x0, x1, y0, y1] = l.fields[f].box;
      assert.ok(0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1, `${l.name}.${f}`);
    }
    if (l.glyph === "templates") {
      for (const d of "0123456789") assert.ok(l.glyphs[`c${d}`], `${l.name} has no clock template for ${d}`);
      for (const v of Object.values(l.glyphs)) assert.equal(v.length, l.templateSize[0] * l.templateSize[1]);
    }
    if (l.period === "word") assert.ok(Object.keys(l.words).length > 0, `${l.name} reads period words but has none`);
  }
});

test("the edge of the clock's box, caught in the crop, is not a leading 1", () => {
  // Summer 2026 on Rink 1: 8:43 read as 18:43, and 47.6 as 147.6.
  for (const clock of ["8:43", "47.6"]) {
    const f = blank();
    const [x0, , y0, y1] = led.fields.clock.box;
    rect(f, Math.trunc(W * x0), Math.trunc(H * y0), 2, Math.trunc(H * y1) - Math.trunc(H * y0), [200, 200, 200]);
    write(f, led, "clock", clock, YELLOW);
    assert.equal(readOverlay(f, led).clockText, clock);
  }
  // A real 1 well inside the box is still read.
  const f = blank();
  write(f, led, "clock", "18:43", YELLOW);
  assert.equal(readOverlay(f, led).clockText, "18:43");
});

test("a board painted a few pixels off where its layout says is found, and read", () => {
  // As far off as summer 2026's Rink 1 clock box was from October's, and more.
  const off = shifted(led, 14, -8);
  const frames = [["7:11", "4", "4"], ["10:28", "1", "2"], ["4:57", "3", "0"], ["0:59", "2", "5"]].map(([clock, home, away]) => {
    const f = blank();
    write(f, off, "clock", clock!, YELLOW);
    write(f, off, "home", home!, RED);
    write(f, off, "away", away!, RED);
    write(f, off, "period", "2", YELLOW);
    return f;
  });
  assert.ok(frames.some((f) => readOverlay(f, led).clock === null), "the boxes as they are should miss this board");
  const { layout, clocks } = calibrate(frames, led);
  assert.equal(clocks, frames.length);
  const [dx, dy] = layout.offset!;
  assert.ok(Math.abs(dx - 14) <= 4 && Math.abs(dy + 8) <= 4, `found at ${dx}, ${dy}`);
  assert.deepEqual(frames.map((f) => readOverlay(f, layout).clockText), ["7:11", "10:28", "4:57", "0:59"]);
});
