/**
 * AERIAL OPEN — every living/scattered point-figure, built on the shared pose
 * shader: world motes (ice sparkle / drift glints / hills / peaks), the golden
 * retriever, six hockey players + one neutral rink rat, and the seated bench
 * watchers (with their snow-capped benches). Ported verbatim from
 * docs/aerial-tournament/final.html.
 */
import * as THREE from "three";
import { DRIFT_W, PAL, driftH, pondR } from "./constants";
import { bez2, clamp, lerp, lineSeg, rand, sampleEllipsoid } from "./math";
import { buildSystem, type MoteFillTmp, type MoteSystem, type ScalarUniform } from "./pose";
import type { Goal } from "./goals";

export type BuildCtx = {
  root: THREE.Object3D;
  motes: MoteSystem[];
  uScale: ScalarUniform;
  texSoft: THREE.Texture;
};

// ---------------- world motes: ice / drift sparkle / hills / peaks ----------
export function buildWorldMotes(ctx: BuildCtx): MoteSystem {
  return buildSystem(ctx.root, ctx.motes, ctx.uScale, ctx.texSoft, 25000, (i, p) => {
    let region: number;
    if (i < 9000) region = 0; else if (i < 14000) region = 1; else if (i < 18000) region = 3; else region = 2;
    if (region === 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (pondR(a) - 3);
      p.h[0] = Math.cos(a) * r; p.h[2] = Math.sin(a) * r;
      p.h[1] = 0.3 + Math.random() * 0.6;
      const spark = Math.random() < 0.05;
      const mixv = Math.random();
      p.col[0] = lerp(PAL.iceA[0], PAL.iceB[0], mixv); p.col[1] = lerp(PAL.iceA[1], PAL.iceB[1], mixv); p.col[2] = lerp(PAL.iceA[2], PAL.iceB[2], mixv);
      if (spark) { p.col[0] = PAL.spark[0]; p.col[1] = PAL.spark[1]; p.col[2] = PAL.spark[2]; }
      p.size = spark ? rand(1.2, 1.8) : rand(0.5, 1.05);
      p.delay = rand(0.15, 0.45);
    } else if (region === 1) {
      // drift sparkle — glints riding ON the sculpted drift ring
      const a2 = Math.random() * Math.PI * 2;
      const t = Math.pow(Math.random(), 0.85);
      const rr = pondR(a2) + 2 + t * DRIFT_W;
      p.h[0] = Math.cos(a2) * rr; p.h[2] = Math.sin(a2) * rr;
      p.h[1] = driftH(a2, t) + 0.4 + Math.random() * 0.9;
      const b = 0.50 + Math.random() * 0.38;
      p.col[0] = PAL.bank[0] * b; p.col[1] = PAL.bank[1] * b; p.col[2] = PAL.bank[2] * b;
      p.size = rand(0.6, 1.5);
      p.delay = rand(0.35, 0.62);
    } else if (region === 3) {
      const a3 = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      const backB = 0.5 - 0.5 * Math.sin(a3);
      const dist = 175 + Math.random() * 85 + backB * 25;
      const mound = 14 + backB * 42;
      const hy = Math.pow(Math.random(), 1.4) * mound;
      const wob = Math.sin(a3 * 5.0) * 8 + Math.sin(a3 * 11.0) * 4;
      const rr3 = dist + wob + rand(-14, 14);
      p.h[0] = Math.cos(a3) * rr3; p.h[2] = Math.sin(a3) * rr3;
      p.h[1] = hy + 0.5;
      const warm3 = Math.pow(clamp(hy / (mound + 1), 0, 1), 1.2);
      p.col[0] = lerp(PAL.hill[0] * 0.6, PAL.bank[0], warm3);
      p.col[1] = lerp(PAL.hill[1] * 0.6, PAL.bank[1], warm3);
      p.col[2] = lerp(PAL.hill[2] * 0.6, PAL.bank[2], warm3);
      p.size = rand(1.4, 3.2);
      p.delay = rand(0.05, 0.30);
    } else {
      const peaks = 6;
      const pk = (Math.random() * peaks) | 0;
      const baseAng = -Math.PI / 2 + ((pk + Math.random()) / peaks - 0.5) * Math.PI * 0.95;
      const backBias = 0.5 - 0.5 * Math.sin(baseAng);
      const d2 = 238 + rand(-16, 46) + pk * 5;
      const height = 150 + backBias * 210;
      const hy2 = Math.pow(Math.random(), 1.25) * height;
      const spreadTop = 52 + backBias * 42;
      const spread = (1.0 - hy2 / (height + 1)) * spreadTop + 7;
      const aa = baseAng + rand(-1, 1) * (spread / d2);
      const rr2 = d2 + rand(-spread, spread) * 0.5;
      p.h[0] = Math.cos(aa) * rr2; p.h[2] = Math.sin(aa) * rr2; p.h[1] = hy2 + 1.0;
      const tt = clamp(hy2 / (height + 1), 0, 1);
      const warm = Math.pow(tt, 1.25);
      p.col[0] = lerp(PAL.mtnLo[0], PAL.mtnHi[0], warm);
      p.col[1] = lerp(PAL.mtnLo[1], PAL.mtnHi[1], warm);
      p.col[2] = lerp(PAL.mtnLo[2], PAL.mtnHi[2], warm);
      p.size = rand(2.2, 5.2);
      p.delay = rand(0.0, 0.18);
    }
  }, { uBreath: { value: 0.35 }, uSize: { value: 1.5 } });
}

// ---- THE GOLDEN RETRIEVER (faces +X) ---------------------------------------
// deep-gold back, cream chest and belly, darker floppy ears, feathered tail
export function buildDogSystem(ctx: BuildCtx): MoteSystem {
  const dog = buildSystem(ctx.root, ctx.motes, ctx.uScale, ctx.texSoft, 640, (i, p) => {
    const o = [0, 0, 0];
    let part = 0, ph = 0;
    let cA: readonly number[] = PAL.dogGold, cB: readonly number[] = PAL.dogLight, mixT = -1;
    if (i < 200) {                                   // body — long, deep-chested
      sampleEllipsoid(-0.4, 3.1, 0, 3.4, 1.55, 1.35, o);
      mixT = clamp((3.1 - o[1]!) / 2.2, 0, 1) * 0.8;  // belly goes cream
      cB = PAL.dogCream;
    } else if (i < 262) {                            // chest / neck
      sampleEllipsoid(2.3, 3.6, 0, 1.5, 1.5, 1.15, o);
      mixT = clamp((3.6 - o[1]!) / 2.0, 0, 1) * 0.9;
      cB = PAL.dogCream;
    } else if (i < 342) {                            // head
      sampleEllipsoid(4.6, 4.9, 0, 1.05, 0.95, 0.85, o); part = 1;
      cA = PAL.dogLight; cB = PAL.dogCream; mixT = clamp((4.9 - o[1]!) / 1.6, 0, 1) * 0.6;
    } else if (i < 384) {                            // snout
      sampleEllipsoid(5.9, 4.55, 0, 0.85, 0.42, 0.42, o); part = 1;
      cA = PAL.dogCream; mixT = -1;
    } else if (i < 432) {                            // floppy ears — hang beside the head
      const s2 = Math.random() < 0.5 ? 1 : -1;
      lineSeg(4.45, 5.35, s2 * 0.85, 4.15, 4.0, s2 * 1.1, 0.26, o); part = 1;
      cA = PAL.dogEar; mixT = -1;
    } else if (i < 500) {                            // tail — up-curved plume, feathering to the tip
      const tt2 = Math.random();
      bez2([-3.4, 3.2, 0], [-5.3, 4.1, 0], [-6.5, 5.5, 0], tt2, o);
      const fe = 0.14 + tt2 * 0.5;
      o[0]! += rand(-fe, fe); o[1]! += rand(-fe, fe); o[2]! += rand(-fe, fe);
      part = 2; mixT = tt2 * 0.85; cB = PAL.dogCream;
    } else {                                         // four legs
      const li = i % 4;
      const hips: Array<[number, number]> = [[2.2, 0.95], [2.2, -0.95], [-2.55, 0.95], [-2.55, -0.95]];
      const hp = hips[li]!;
      lineSeg(hp[0], 2.7, hp[1], hp[0] + 0.18, 0.28, hp[1] * 1.06, 0.20, o);
      part = 3; ph = li === 0 ? 0.0 : li === 1 ? 0.55 : li === 2 ? 3.30 : 3.85;
      mixT = clamp((2.7 - o[1]!) / 2.4, 0, 1) * 0.7; cB = PAL.dogCream;
      if (o[1]! < 0.65) p.size = rand(1.6, 2.4);      // paws read a touch heavier
    }
    p.h[0] = o[0]!; p.h[1] = o[1]!; p.h[2] = o[2]!;
    let cc: readonly number[];
    if (mixT >= 0) cc = [lerp(cA[0]!, cB[0]!, mixT), lerp(cA[1]!, cB[1]!, mixT), lerp(cA[2]!, cB[2]!, mixT)];
    else cc = cA;
    if (Math.random() < 0.07) cc = PAL.dogCream;     // scattered warm glints in the coat
    p.col[0] = cc[0]! * 0.72; p.col[1] = cc[1]! * 0.72; p.col[2] = cc[2]! * 0.72;
    if (!p.size || p.size === 1) p.size = rand(1.1, 2.1);
    p.delay = rand(0.60, 0.86);
    p.part = part; p.ph = ph;
  }, { uBreath: { value: 0.5 }, uSize: { value: 1.5 }, uSwirl: { value: 0.16 }, uHipY: { value: 2.65 }, uLegOut: { value: 0.28 }, uFigScale: { value: 0.66 } });
  dog.u.uFogNear.value = 3000;
  dog.u.uFogFar.value = 6000;
  return dog;
}

// ---- PLAYERS — hockey players (faces +X): skates, legs, jersey, stick ------
function playerFill(base: readonly number[], hot: readonly number[]) {
  return (i: number, p: MoteFillTmp) => {
    const o = [0, 0, 0];
    let part = 0, ph = 0, col: readonly number[] = base, b = 1;
    if (i < 24) {           // left skate blade + boot
      lineSeg(-0.55, 0.32, 0.76, 0.75, 0.34, 0.70, 0.10, o); part = 3; ph = 0; col = PAL.gear; b = 0.72;
    } else if (i < 48) {    // right skate
      lineSeg(-0.55, 0.32, -0.76, 0.75, 0.34, -0.70, 0.10, o); part = 3; ph = Math.PI; col = PAL.gear; b = 0.72;
    } else if (i < 82) {    // left leg
      lineSeg(0.02, 0.55, 0.74, 0.16, 3.0, 0.58, 0.16, o); part = 3; ph = 0; col = base; b = 0.45;
    } else if (i < 116) {   // right leg
      lineSeg(0.02, 0.55, -0.74, 0.16, 3.0, -0.58, 0.16, o); part = 3; ph = Math.PI; col = base; b = 0.45;
    } else if (i < 178) {   // torso — jersey, forward lean baked
      sampleEllipsoid(0.25, 4.05, 0, 0.95, 1.15, 0.80, o); o[0]! += (o[1]! - 3.0) * 0.30;
      col = base; b = 0.55;
    } else if (i < 198) {   // shoulders / arm hint
      sampleEllipsoid(0.45, 4.95, 0, 1.25, 0.42, 1.02, o); o[0]! += (o[1]! - 3.0) * 0.30;
      col = base; b = 0.66;
    } else if (i < 216) {   // head
      sampleEllipsoid(0.75, 5.85, 0, 0.52, 0.55, 0.52, o); part = 1; col = PAL.headSkin; b = 0.72;
    } else if (i < 238) {   // stick shaft
      lineSeg(1.15, 4.35, 0.30, 3.05, 0.42, 0.62, 0.10, o); part = 7; col = PAL.gear; b = 0.62;
    } else {                // stick blade on the ice
      lineSeg(3.05, 0.30, 0.62, 3.95, 0.28, 0.80, 0.08, o); part = 7; col = PAL.gear; b = 0.78;
    }
    p.h[0] = o[0]!; p.h[1] = o[1]!; p.h[2] = o[2]!;
    const br = b * (0.82 + Math.random() * 0.22);
    p.col[0] = col[0]! * br; p.col[1] = col[1]! * br; p.col[2] = col[2]! * br;
    p.size = part === 7 || part === 3 ? rand(0.85, 1.4) : rand(1.0, 1.75);
    p.delay = rand(0.5, 0.82);
    p.part = part; p.ph = ph;
    // a few hot accents so figures read at distance
    if (i >= 116 && i < 178 && Math.random() < 0.07) { p.col[0] = hot[0]! * 0.8; p.col[1] = hot[1]! * 0.8; p.col[2] = hot[2]! * 0.8; }
  };
}

export type PlayerState = "coast" | "skate" | "support" | "stop" | "drift" | "carry" | "chasePass" | "free";

export type Player = {
  sys: MoteSystem;
  team: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  speed: number;
  targetSpeed: number;
  target: THREE.Vector3;
  state: PlayerState;
  timer: number;
  stride: number;
  gait: number;
  lean: number;
  crouch: number;
  blPrev: [THREE.Vector3, THREE.Vector3];
  ratPh: number;
};

/** Index of the neutral free skater (the lone rink rat). */
export const RAT = 6;

export function buildPlayers(ctx: BuildCtx): Player[] {
  const players: Player[] = [];
  const starts = [
    { x: -34, z: -20, team: 0 }, { x: 30, z: 16, team: 1 },
    { x: 4, z: 42, team: 0 },   { x: -18, z: 30, team: 1 },
    { x: 46, z: -10, team: 0 }, { x: -48, z: 6, team: 1 },
    { x: -58, z: -62, team: 2 },                                  // the lone rink rat
  ];
  for (let d = 0; d < starts.length; d++) {
    const st = starts[d]!;
    const base = st.team === 0 ? PAL.teamA : st.team === 1 ? PAL.teamB : PAL.neutral;
    const hot = st.team === 0 ? PAL.teamAHot : st.team === 1 ? PAL.teamBHot : PAL.spark;
    const sys = buildSystem(ctx.root, ctx.motes, ctx.uScale, ctx.texSoft, 256, playerFill(base, hot),
      { uBreath: { value: 0.32 }, uSize: { value: 1.7 }, uHipY: { value: 3.05 }, uLegOut: { value: 0.85 } });
    sys.u.uFogNear.value = 2200;
    sys.u.uFogFar.value = 5000;
    players.push({
      sys, team: st.team,
      pos: new THREE.Vector3(st.x, 0, st.z),
      vel: new THREE.Vector3(), heading: rand(-Math.PI, Math.PI),
      speed: 0, targetSpeed: 8,
      target: new THREE.Vector3(st.x, 0, st.z),
      state: "coast", timer: rand(0.5, 2.0),
      stride: rand(0, 6), gait: 0, lean: 0, crouch: 0,
      blPrev: [new THREE.Vector3(st.x, 0, st.z), new THREE.Vector3(st.x, 0, st.z)],
      ratPh: rand(0, 6),
    });
  }
  return players;
}

// ---- GOALIES — one per net, team-hued, tracking the puck --------------------
function goalieFill(base: readonly number[]) {
  return (i: number, p: MoteFillTmp) => {
    const o = [0, 0, 0];
    let part = 0, col: readonly number[] = base, b = 1;
    if (i < 30) {          // left leg pad — the big bright slab
      lineSeg(0.38, 0.40, 0.95, 0.30, 2.45, 0.85, 0.22, o); col = PAL.gear; b = 1.0;
    } else if (i < 60) {   // right pad
      lineSeg(0.38, 0.40, -0.95, 0.30, 2.45, -0.85, 0.22, o); col = PAL.gear; b = 1.0;
    } else if (i < 78) {   // skates
      const sgn = i % 2 === 0 ? 1 : -1;
      lineSeg(-0.2, 0.3, sgn * 0.9, 0.75, 0.3, sgn * 0.82, 0.10, o); col = PAL.gear; b = 0.8;
    } else if (i < 138) {  // torso — wide, crouched forward
      sampleEllipsoid(0.15, 3.35, 0, 1.0, 1.05, 1.05, o); o[0]! += (o[1]! - 2.4) * 0.30;
      col = base; b = 0.60;
    } else if (i < 156) {  // shoulders
      sampleEllipsoid(0.35, 4.3, 0, 1.25, 0.40, 1.15, o); o[0]! += (o[1]! - 2.4) * 0.30;
      col = base; b = 0.70;
    } else if (i < 174) {  // head / mask
      sampleEllipsoid(0.6, 4.95, 0, 0.5, 0.52, 0.5, o); part = 1; col = PAL.headSkin; b = 0.72;
    } else if (i < 188) {  // blocker
      sampleEllipsoid(0.75, 3.0, -1.35, 0.32, 0.34, 0.30, o); col = PAL.gear; b = 0.9;
    } else if (i < 202) {  // glove
      sampleEllipsoid(0.75, 3.2, 1.35, 0.38, 0.38, 0.34, o); col = PAL.gear; b = 0.9;
    } else if (i < 220) {  // paddle shaft
      lineSeg(0.9, 3.0, 0.12, 1.35, 0.35, 0.06, 0.09, o); part = 7; col = PAL.gear; b = 0.72;
    } else {               // blade flat in front
      lineSeg(1.35, 0.3, -0.05, 2.2, 0.28, 0.25, 0.08, o); part = 7; col = PAL.gear; b = 0.9;
    }
    p.h[0] = o[0]!; p.h[1] = o[1]!; p.h[2] = o[2]!;
    const br = b * (0.82 + Math.random() * 0.2);
    p.col[0] = col[0]! * br; p.col[1] = col[1]! * br; p.col[2] = col[2]! * br;
    p.size = rand(0.95, 1.7);
    p.delay = rand(0.5, 0.8);
    p.part = part; p.ph = 0;
  };
}

export type Goalie = { sys: MoteSystem; goal: Goal; z: number; lunge: number; ph: number };

export function buildGoalies(ctx: BuildCtx, goalA: Goal, goalB: Goal): Goalie[] {
  const goalies: Goalie[] = [];
  // net A is defended by team 0 (they shoot at B), net B by team 1
  const defs2 = [{ goal: goalA, base: PAL.teamA }, { goal: goalB, base: PAL.teamB }];
  for (let gi2 = 0; gi2 < defs2.length; gi2++) {
    const sys = buildSystem(ctx.root, ctx.motes, ctx.uScale, ctx.texSoft, 232, goalieFill(defs2[gi2]!.base),
      { uBreath: { value: 0.26 }, uSize: { value: 1.7 }, uHipY: { value: 2.5 }, uLegOut: { value: 0 } });
    sys.u.uFogNear.value = 2200;
    sys.u.uFogFar.value = 5000;
    goalies.push({ sys, goal: defs2[gi2]!.goal, z: 0, lunge: 0, ph: gi2 * 2.4 });
  }
  return goalies;
}

// ---- BENCHES + WATCHERS on the near shore ----------------------------------
export type Bench = { a: number; x: number; z: number; y: number; heading: number };

export type BenchesAndWatchers = {
  benchA: Bench;
  benchB: Bench;
  benchMat: THREE.MeshBasicMaterial;
  benchSnowMat: THREE.MeshBasicMaterial;
};

export function buildBenchesAndWatchers(ctx: BuildCtx): BenchesAndWatchers {
  const benchMat = new THREE.MeshBasicMaterial({ color: 0x2c3d52, transparent: true, opacity: 0, fog: false });
  const benchSnowMat = new THREE.MeshBasicMaterial({ color: 0xa8c2de, transparent: true, opacity: 0, fog: false });
  function buildBench(a: number): Bench {
    const r = pondR(a) + 15;
    const gx = Math.cos(a) * r, gz = Math.sin(a) * r;
    const gp = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 12), benchMat); plank.position.y = 2.0; gp.add(plank);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 12.2), benchSnowMat); cap.position.y = 2.32; gp.add(cap);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.0, 0.55), benchMat); l1.position.set(0, 1.0, -4.6); gp.add(l1);
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.0, 0.55), benchMat); l2.position.set(0, 1.0, 4.6); gp.add(l2);
    const by = driftH(a, 13 / DRIFT_W) - 0.35;
    gp.position.set(gx, by, gz);
    gp.rotation.y = Math.PI - a;
    ctx.root.add(gp);
    return { a, x: gx, z: gz, y: by, heading: a + Math.PI };
  }
  const benchA = buildBench(0.58);   // clear of the east goal's sightline
  const benchB = buildBench(2.88);
  // seated watchers, baked to their bench spots (a couple of quiet regulars)
  const seats = [
    { bench: benchA, off: -3.4, tint: PAL.teamA }, { bench: benchA, off: 0.4, tint: PAL.watch },
    { bench: benchB, off: -3.0, tint: PAL.teamB }, { bench: benchB, off: 0.6, tint: PAL.watch }, { bench: benchB, off: 3.8, tint: PAL.dogLight },
  ];
  const perW = 96;
  const sys = buildSystem(ctx.root, ctx.motes, ctx.uScale, ctx.texSoft, perW * seats.length, (i, p) => {
    let si = (i / perW) | 0;
    if (si >= seats.length) si = seats.length - 1;
    const S = seats[si]!, j = i % perW, o = [0, 0, 0];
    if (j < 42) { sampleEllipsoid(0, 3.35, 0, 0.85, 1.05, 0.75, o); o[0]! -= (o[1]! - 2.3) * 0.10; }
    else if (j < 56) { sampleEllipsoid(0.15, 4.75, 0, 0.5, 0.52, 0.5, o); }
    else if (j < 76) { const s2 = Math.random() < 0.5 ? 0.45 : -0.45; lineSeg(0, 2.42, s2, 1.05, 2.3, s2 * 1.15, 0.14, o); }
    else { const s3 = Math.random() < 0.5 ? 0.5 : -0.5; lineSeg(1.05, 2.3, s3, 1.18, 0.35, s3 * 1.15, 0.14, o); }
    // local seat offset along the plank (bench local z), then bake bench heading
    const lx = o[0]!, lz = o[2]! + S.off;
    const hc = Math.cos(S.bench.heading), hs = Math.sin(S.bench.heading);
    p.h[0] = lx * hc - lz * hs + S.bench.x;
    p.h[1] = o[1]! + S.bench.y;
    p.h[2] = lx * hs + lz * hc + S.bench.z;
    const b = 0.62 + Math.random() * 0.3;
    p.col[0] = S.tint[0]! * b * 0.75 + PAL.watch[0] * b * 0.25;
    p.col[1] = S.tint[1]! * b * 0.75 + PAL.watch[1] * b * 0.25;
    p.col[2] = S.tint[2]! * b * 0.75 + PAL.watch[2] * b * 0.25;
    p.size = rand(1.0, 1.8);
    p.delay = rand(0.45, 0.7);
  }, { uBreath: { value: 0.20 }, uSize: { value: 1.5 } });
  sys.u.uFogNear.value = 1800;
  sys.u.uFogFar.value = 4600;
  return { benchA, benchB, benchMat, benchSnowMat };
}
