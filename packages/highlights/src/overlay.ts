import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading the rink's scoreboard graphic off a frame.
 *
 * Every rink and season paints a different one — the Rink 2 broadcast tile is
 * a translucent bar with a white clock box, the Rink 1 board a mock LED
 * scoreboard with red scores and dot-matrix digits — so where each field sits
 * and what its ink looks like is data, one file per board in `layouts/`.
 *
 * A digit is read one of two ways. A broadcast font is matched against glyph
 * templates learned from labelled frames; a seven-segment board is decoded by
 * which segments are lit, which needs no templates and cannot confuse an 8 for
 * a 6 the way a whole-glyph match can.
 *
 * NOTHING HERE GUESSES. A glyph that matches no template clearly, or a segment
 * pattern that is not a digit, reads as unknown, and an unknown field is null.
 * A wrong digit fakes a goal; an unknown one is skipped by the locator.
 */

export type Ink = "light" | "dark" | "red";
export type Field = { box: [number, number, number, number]; ink: Ink; thr?: number };
export type FieldName = "home" | "away" | "clock" | "period";

export type Layout = {
  name: string;
  what: string;
  /** Rink game ids this board was learned from or checked against. */
  seenOn: number[];
  fields: Record<FieldName, Field>;
  /** "word": the period box says "1st", "2nd", "OT2"…; "digit": it is a bare 1, 2, 3. */
  period: "word" | "digit";
  glyph: "templates" | "seg7";
  /** Blank rows one glyph may span — an LED board's segments have gaps. */
  bridge: number;
  /** The overlay is only up while this field is at least this bright. */
  on?: { field: FieldName; min: number };
  templateSize: [number, number];
  /**
   * "c0".."c9" clock digits, "s0".."s9" score digits, "p1".. period digits; unit
   * vectors. A digit can have more than one, named on from its first: "c0",
   * "c0b" — the summer 2026 tile drew its digits thinner than October's.
   */
  glyphs: Record<string, number[]>;
  /** Period words, by what the overlay shows. */
  words: Record<string, number[]>;
  /** Pixels at 1280x720 this recording paints the board away from where the boxes say — see `calibrate`. */
  offset?: [number, number];
};

/** One frame, 8-bit RGB, row-major. */
export type Frame = { width: number; height: number; rgb: Uint8Array };

export type OverlayReading = {
  /** As the overlay labels it: "1st", "2nd", "3rd", "OT2"… Turning that into the scoresheet's period is `periods.ts`. */
  period: string | null;
  clock: number | null;
  clockText: string;
  home: number | null;
  away: number | null;
};

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../layouts");

export function loadLayouts(dir = DIR): Layout[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Layout);
}

/** A binary mask: `ink[y * w + x]`. */
type Mask = { w: number; h: number; ink: Uint8Array };

/** Pillow's "L": the integer luma it rounds to, which is what the templates were learned on. */
const luma = (r: number, g: number, b: number) => (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16;

function crop(frame: Frame, f: Field): { mask: Mask; mean: number } {
  const [x0, x1, y0, y1] = f.box;
  const left = Math.trunc(frame.width * x0), right = Math.trunc(frame.width * x1);
  const top = Math.trunc(frame.height * y0), bottom = Math.trunc(frame.height * y1);
  const w = right - left, h = bottom - top;
  const ink = new Uint8Array(w * h);
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((top + y) * frame.width + left + x) * 3;
      const r = frame.rgb[o]!, g = frame.rgb[o + 1]!, b = frame.rgb[o + 2]!;
      const l = luma(r, g, b);
      sum += l;
      // Red: the red channel, not redness — colour is stored at half resolution, so a thin
      // red stroke's redness smears out while its red channel stays bright.
      const on = f.ink === "light" ? l > (f.thr ?? 150) : f.ink === "dark" ? l < (f.thr ?? 110) : r > (f.thr ?? 70);
      ink[y * w + x] = on ? 1 : 0;
    }
  }
  // A row that is nearly all ink is the edge of a box, not text.
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += ink[y * w + x]!;
    if (n / w > 0.6) ink.fill(0, y * w, (y + 1) * w);
  }
  return { mask: { w, h, ink }, mean: sum / (w * h) };
}

const rowHasInk = (m: Mask, y: number) => { for (let x = 0; x < m.w; x++) if (m.ink[y * m.w + x]) return true; return false; };

/**
 * Only the longest run of rows holding ink, across gaps of up to `bridge` blank
 * rows: specks at a box's edge, or ice showing through a translucent tile, are
 * not the text — and once joined to a digit they make it unreadable.
 */
function band(m: Mask, bridge: number): Mask {
  const runs: [number, number][] = [];
  let start = -1, gap = 0;
  for (let y = 0; y < m.h + bridge + 1; y++) {
    if (y < m.h && rowHasInk(m, y)) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0 && ++gap > bridge) {
      runs.push([start, y - gap + 1]);
      start = -1;
      gap = 0;
    }
  }
  const out = new Uint8Array(m.ink.length);
  if (runs.length) {
    const [a, b] = runs.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best));
    out.set(m.ink.subarray(a * m.w, b * m.w), a * m.w);
  }
  return { w: m.w, h: m.h, ink: out };
}

type Part = { mask: Mask; top: number; bottom: number; left: number; right: number };

/** A field split into glyphs, by runs of columns that hold ink. */
function glyphs(m: Mask): Part[] {
  const col = (x: number) => { for (let y = 0; y < m.h; y++) if (m.ink[y * m.w + x]) return true; return false; };
  const out: Part[] = [];
  for (let x = 0; x < m.w;) {
    if (!col(x)) { x++; continue; }
    const x0 = x;
    while (x < m.w && col(x)) x++;
    const w = x - x0;
    let top = -1, bottom = -1, total = 0;
    for (let y = 0; y < m.h; y++) {
      let n = 0;
      for (let i = x0; i < x; i++) n += m.ink[y * m.w + i]!;
      total += n;
      if (n) { if (top < 0) top = y; bottom = y; }
    }
    if (top < 0 || total < 4) continue;
    const h = bottom - top + 1;
    const ink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) ink[y * w + i] = m.ink[(top + y) * m.w + x0 + i]!;
    out.push({ mask: { w, h, ink }, top, bottom, left: x0, right: x });
  }
  return out;
}

/**
 * Pillow's bilinear resize of an 8-bit image, exactly: a triangle filter whose
 * support widens with the scale when shrinking, 22-bit fixed-point weights, and
 * a rounded 8-bit image between the horizontal and vertical passes. The glyph
 * templates were learned through this; an approximation would shift every
 * correlation a little and move the confidence line under them.
 */
function coeffs(inSize: number, outSize: number): { lo: number[]; k: number[][] } {
  const PRECISION = 22;
  const scale = inSize / outSize, filterscale = Math.max(scale, 1), support = filterscale;
  const lo: number[] = [], k: number[][] = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    const w: number[] = [];
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const t = Math.abs((x + xmin - center + 0.5) / filterscale);
      const v = t < 1 ? 1 - t : 0;
      w.push(v);
      ww += v;
    }
    lo.push(xmin);
    k.push(w.map((v) => {
      const n = ww ? v / ww : 0;
      return n < 0 ? Math.trunc(-0.5 + n * (1 << PRECISION)) : Math.trunc(0.5 + n * (1 << PRECISION));
    }));
  }
  return { lo, k };
}

const clip8 = (v: number) => Math.min(255, Math.max(0, v >> 22));

function resize(src: Uint8Array, w: number, h: number, ow: number, oh: number): Uint8Array {
  const HALF = 1 << 21;
  let cur = src, cw = w;
  if (ow !== w) {
    const { lo, k } = coeffs(w, ow);
    const out = new Uint8Array(ow * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < ow; x++) {
        let ss = HALF;
        const kk = k[x]!;
        for (let i = 0; i < kk.length; i++) ss += cur[y * cw + lo[x]! + i]! * kk[i]!;
        out[y * ow + x] = clip8(ss);
      }
    }
    cur = out;
    cw = ow;
  }
  if (oh !== h) {
    const { lo, k } = coeffs(h, oh);
    const out = new Uint8Array(cw * oh);
    for (let y = 0; y < oh; y++) {
      const kk = k[y]!;
      for (let x = 0; x < cw; x++) {
        let ss = HALF;
        for (let i = 0; i < kk.length; i++) ss += cur[(lo[y]! + i) * cw + x]! * kk[i]!;
        out[y * cw + x] = clip8(ss);
      }
    }
    cur = out;
  }
  return cur;
}

/** A glyph as a zero-mean unit vector, ready to correlate with a template. */
function norm(m: Mask, [tw, th]: [number, number]): Float64Array {
  const px = new Uint8Array(m.ink.length);
  for (let i = 0; i < px.length; i++) px[i] = m.ink[i] ? 255 : 0;
  const r = resize(px, m.w, m.h, tw, th);
  const v = Float64Array.from(r);
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let n = 0;
  for (let i = 0; i < v.length; i++) { v[i]! -= mean; n += v[i]! * v[i]!; }
  n = Math.sqrt(n);
  if (n) for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };

/**
 * '.' is short. ':' is narrow and mostly gap — an LED board's colon spans nearly
 * the digits' height, like its thin '1', but a '1' has ink in most of its rows.
 */
function kind(p: Part, height: number): "." | ":" | null {
  const h = p.bottom - p.top + 1;
  if (h < height * 0.45) return ".";
  if (p.mask.w <= 4) {
    let rows = 0;
    for (let y = 0; y < p.mask.h; y++) for (let x = 0; x < p.mask.w; x++) if (p.mask.ink[y * p.mask.w + x]) { rows++; break; }
    if (rows < 0.5 * h) return ":";
  }
  return null;
}

/** Seven-segment digits by which of a b c d e f g are lit: a top, b/c right, d bottom, e/f left, g middle. */
const SEG7: Record<string, string> = {
  abcdef: "0", bc: "1", abdeg: "2", abcdg: "3", bcfg: "4", acdfg: "5", acdefg: "6", cdefg: "6",
  abc: "7", abcf: "7", abcdefg: "8", abcdfg: "9", abcfg: "9",
};
/**
 * Rows, then columns, as fractions of the digit. Each segment is sampled in its
 * middle, away from where it meets the next: a thick wall must not light a bar,
 * and the end of a bar must not light an upright — the top of a small "3" did.
 */
const SEGMENTS: [string, [number, number], [number, number]][] = [
  ["a", [0, 0.15], [0.35, 0.65]], ["b", [0.2, 0.4], [0.7, 1]], ["c", [0.6, 0.8], [0.7, 1]],
  ["d", [0.85, 1], [0.35, 0.65]], ["e", [0.6, 0.8], [0, 0.3]], ["f", [0.2, 0.4], [0, 0.3]],
  ["g", [0.42, 0.58], [0.35, 0.65]],
];

function seg7(p: Part, height: number): string {
  const { w, h, ink } = p.mask;
  // A bare upright is a '1', if it runs the digit's height.
  if (w < h * 0.3) return h >= height * 0.8 ? "1" : "?";
  // Every seven-segment digit is well taller than it is wide. Anything squatter — a lone
  // bar, the edge of a box — would light every sampled segment and read as an 8.
  if (h < w * 1.4) return "?";
  let lit = "";
  for (const [name, [r0, r1], [c0, c1]] of SEGMENTS) {
    const ya = Math.trunc(h * r0), yb = Math.max(Math.trunc(h * r1), ya + 1);
    const xa = Math.trunc(w * c0), xb = Math.max(Math.trunc(w * c1), xa + 1);
    let n = 0, on = 0;
    for (let y = ya; y < Math.min(yb, h); y++) for (let x = xa; x < Math.min(xb, w); x++) { n++; on += ink[y * w + x]!; }
    if (n && on / n > 0.2) lit += name;
  }
  return SEG7[lit] ?? "?";
}

/**
 * The edge of the box a field sits in, caught in its crop: a sliver against the
 * crop's side, taller than any text. The summer 2026 Rink 1 recordings framed
 * the clock box a few pixels further left than October's did, and its left
 * edge read as a leading "1" — 8:43 as 18:43, 47.6 as 147.6. A digit is never
 * that thin AND that tall AND on the crop's edge.
 */
const isEdge = (p: Part, m: Mask) => (p.left === 0 || p.right === m.w) && p.mask.w <= 3 && p.bottom - p.top + 1 >= m.h * 0.9;

function readText(m: Mask, layout: Layout, prefix: string): string {
  const parts = glyphs(m).filter((p) => !isEdge(p, m));
  if (!parts.length) return "";
  const height = Math.max(...parts.map((p) => p.bottom - p.top + 1));
  const templates = Object.entries(layout.glyphs).filter(([k]) => k[0] === prefix);
  let text = "";
  for (const p of parts) {
    const k = kind(p, height);
    if (k) { text += k; continue; }
    if (layout.glyph === "seg7") { text += seg7(p, height); continue; }
    if (!templates.length) { text += "?"; continue; }
    const v = norm(p.mask, layout.templateSize);
    // Each digit by its best template, so a digit's own second template is never its rival.
    const best = new Map<string, number>();
    for (const [key, t] of templates) best.set(key[1]!, Math.max(best.get(key[1]!) ?? -1, dot(v, t)));
    const scores = [...best].map(([d, c]) => [c, d] as const).sort((a, b) => b[0] - a[0]);
    // Unsure is unknown, never a guess.
    const sure = scores[0]![0] >= 0.6 && (scores.length === 1 || scores[0]![0] - scores[1]![0] >= 0.2);
    text += sure ? scores[0]![1] : "?";
  }
  return text;
}

function wordVec(m: Mask, size: [number, number]): Float64Array | null {
  let x0 = m.w, x1 = -1, y0 = m.h, y1 = -1, n = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.ink[y * m.w + x]) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (n < 15) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = m.ink[(y0 + y) * m.w + x0 + x]!;
  return norm({ w, h, ink }, size);
}

const ORDINAL: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };

export function parseClockText(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  // Under a minute some boards show tenths: "38.5".
  const s = /^(\d{1,2})\.(\d)$/.exec(t);
  return s ? Number(s[1]) : null;
}

export function readOverlay(frame: Frame, layout: Layout): OverlayReading {
  const field = (name: FieldName) => {
    const { mask, mean } = crop(frame, layout.fields[name]);
    return { mask: band(mask, layout.bridge), mean };
  };
  const on = layout.on ? field(layout.on.field).mean > layout.on.min : true;
  if (!on) return { period: null, clock: null, clockText: "", home: null, away: null };
  const score = (name: "home" | "away") => {
    const t = readText(field(name).mask, layout, "s");
    return /^\d{1,2}$/.test(t) ? Number(t) : null;
  };
  let clockText = readText(field("clock").mask, layout, "c");
  // A speck beside M:SS, never part of it.
  if (clockText.includes(":")) clockText = clockText.replaceAll(".", "");
  const periodMask = field("period").mask;
  let period: string | null = null;
  if (layout.period === "digit") {
    period = ORDINAL[readText(periodMask, layout, "p")] ?? null;
  } else {
    const v = wordVec(periodMask, layout.templateSize);
    const words = Object.entries(layout.words);
    if (v && words.length) {
      const [best, score] = words.map(([w, t]) => [w, dot(v, t)] as const).sort((a, b) => b[1] - a[1])[0]!;
      period = score > 0.8 ? best : null;
    }
  }
  return { period, clock: parseClockText(clockText), clockText, home: score("home"), away: score("away") };
}

/** A layout with every field moved `dx`, `dy` pixels at 1280x720. */
export function shifted(layout: Layout, dx: number, dy: number): Layout {
  const fields = Object.fromEntries(Object.entries(layout.fields).map(([k, f]) => {
    const [x0, x1, y0, y1] = f.box;
    return [k, { ...f, box: [x0 + dx / 1280, x1 + dx / 1280, y0 + dy / 720, y1 + dy / 720] }];
  })) as Layout["fields"];
  return { ...layout, fields, offset: [dx, dy] };
}

/** How far either way the board is looked for: a few digits' width, half a field's height. */
const REACH = { x: 16, y: 10 };

/**
 * Where this recording paints the board. The same graphic sits a few pixels
 * differently from one recording to the next — summer 2026's Rink 1 clock box
 * was far enough off October's to cut "7:11" to "7:1" — so the layout's boxes
 * are tried at every offset within reach, two pixels apart, and the board is
 * where the most frames read a clock (and, after that, a score). Of the
 * offsets that read best, the middle one: at the edge of that stretch a box
 * is about to clip a digit.
 */
export function calibrate(frames: Frame[], layout: Layout): { layout: Layout; clocks: number } {
  const tried: { dx: number; dy: number; score: number; clocks: number }[] = [];
  for (let dy = -REACH.y; dy <= REACH.y; dy += 2) {
    for (let dx = -REACH.x; dx <= REACH.x; dx += 2) {
      const l = shifted(layout, dx, dy);
      let score = 0, clocks = 0;
      for (const f of frames) {
        const r = readOverlay(f, l);
        if (r.clock !== null) { clocks++; score += 2; }
        if (r.home !== null && r.away !== null) score++;
      }
      tried.push({ dx, dy, score, clocks });
    }
  }
  const top = Math.max(...tried.map((t) => t.score));
  const best = tried.filter((t) => t.score >= top * 0.98);
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
  const centre = { dx: mid(best.map((t) => t.dx)), dy: mid(best.map((t) => t.dy)) };
  // The middle of two separate stretches can be neither: then the best offset nearest none.
  const chosen = best.find((t) => t.dx === centre.dx && t.dy === centre.dy)
    ?? [...best].sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0]!;
  return { layout: shifted(layout, chosen.dx, chosen.dy), clocks: chosen.clocks };
}

/**
 * How a template is learned: the glyphs of one field, each as the vector a
 * template is matched against, punctuation and box edges left out. A template
 * is the mean of these over frames whose text was read by eye.
 */
export function fieldGlyphs(frame: Frame, layout: Layout, name: FieldName): number[][] {
  const m = band(crop(frame, layout.fields[name]).mask, layout.bridge);
  const parts = glyphs(m).filter((p) => !isEdge(p, m));
  if (!parts.length) return [];
  const height = Math.max(...parts.map((p) => p.bottom - p.top + 1));
  return parts.filter((p) => !kind(p, height)).map((p) => [...norm(p.mask, layout.templateSize)]);
}
