/**
 * AERIAL OPEN — the world: builds every layer (sky, ground, drifts, cut
 * ledger, motes, snow, goals, benches, figures, effects) into one root group
 * and runs the whole simulation — intro choreography, puck pass/shot machine,
 * player behaviour machine (with the stale-carry re-decide fix), dog
 * chase/sit/wag, camera drift. Ported verbatim from
 * docs/aerial-tournament/final.html; only mechanical changes for R3F hosting
 * (scene root instead of global scene, reused scratch vectors instead of
 * per-frame clones). Browser-only: construct from a client component.
 */
import * as THREE from "three";
import {
  ASM_END, ASM_START, GOAL_HW, PAL, SUN_AZ, clampIce, netAx, netBx,
} from "./constants";
import { angDelta, angLerp, clamp, lerp, rand, smooth } from "./math";
import { flatGlow, makeSpriteKit, spr } from "./sprites";
import type { MoteSystem, ScalarUniform } from "./pose";
import { buildGround } from "./ground";
import { buildSky } from "./sky";
import { buildDrift } from "./drifts";
import { buildSnowfall } from "./snowfall";
import { buildCutLedger } from "./cuts";
import { buildGoals, type Goal } from "./goals";
import {
  RAT, buildBenchesAndWatchers, buildDogSystem, buildGoalies, buildPlayers, buildWorldMotes,
  type BuildCtx, type Player,
} from "./figures";
import { makeRings, makeSprayPool, makeTrail, popRing, spray } from "./effects";

export type AerialProbe = {
  started: boolean; prog: number; reveal: number;
  dog: { x: number; z: number; mode: string; sit: number };
  ball: { x: number; z: number; mode: string };
  puck: { x: number; z: number; mode: string; carrier: number };
  players: Array<{ s: string; v: number }>;
};

export type AerialWorld = {
  root: THREE.Group;
  uScale: ScalarUniform;
  probe: AerialProbe;
  /** Layer-isolation hook (final.html's window.__dev) for the render harness. */
  dev: Record<string, THREE.Object3D>;
  /**
   * The internal camera path's pose after the last update() — the approved
   * intro sweep, settled framing and gentle drift, in the root group's LOCAL
   * space. Always maintained, whether or not a camera was passed to update():
   * an external rig (the home journey) omits `camera` and frames the world
   * itself from these.
   */
  cameraPos: THREE.Vector3;
  cameraLook: THREE.Vector3;
  /** Omitting `camera` skips the internal camera write (external rigs). */
  update: (dt: number, t: number, camera?: THREE.Camera) => void;
  onPointerMove: (p: THREE.Vector3 | null) => void;
  onIceClick: (p: THREE.Vector3) => void;
  /**
   * Extra snowfall drive 0..1 from an external choreographer (the journey's
   * whiteout surge). Defaults to 0 — standalone /aerial behaviour unchanged.
   */
  setSnowSurge: (v: number) => void;
  setViewAspect: (a: number) => void;
  /** Reader asked for less movement: still the ambient drift, thin the snowfall. */
  setCalm: (v: boolean) => void;
  dispose: () => void;
};

export function createAerialWorld(): AerialWorld {
  const root = new THREE.Group();
  const uScale: ScalarUniform = { value: 1 };
  const kit = makeSpriteKit();
  const moteSystems: MoteSystem[] = [];
  const ctx: BuildCtx = { root, motes: moteSystems, uScale, texSoft: kit.soft };

  // ---- layers (construction order matches final.html) ----------------------
  const sky = buildSky(root, kit);
  const ground = buildGround(root);
  const pondGlow = flatGlow(root, kit.glow, 0x2b5a80, 190, 0);
  const rakeGlow = flatGlow(root, kit.glow, 0xffc98a, 210, 0);
  rakeGlow.position.set(SUN_AZ.x * 60, 0.3, SUN_AZ.y * 60);
  const dogFloor = flatGlow(root, kit.glow, 0xffa24a, 17, 0);
  const ballFloor = flatGlow(root, kit.glow, 0xbaf03c, 14, 0);
  const drift = buildDrift(root);
  const TR = buildCutLedger(root);
  const worldMotes = buildWorldMotes(ctx);
  const snow = buildSnowfall(root, uScale, kit.soft);
  const dog = buildDogSystem(ctx);
  const dogGlow = spr(root, kit.glow, 0xffb35a, 0);
  dogGlow.scale.set(17, 17, 1);
  const players: Player[] = buildPlayers(ctx);
  const { goalA, goalB, goals, frameMat, frameLitMat, netMats } = buildGoals(root, kit);
  const goalies = buildGoalies(ctx, goalA, goalB);
  const { benchMat, benchSnowMat } = buildBenchesAndWatchers(ctx);

  // ---- BALL / PUCK sprites -------------------------------------------------
  const ballCore = spr(root, kit.core, 0xdcff6a, 0); ballCore.scale.set(6.0, 6.0, 1);
  const ballGlow = spr(root, kit.glow, 0xbaf03c, 0); ballGlow.scale.set(20, 20, 1);
  const puckCore = spr(root, kit.core, 0xeaf4ff, 0); puckCore.scale.set(3.2, 3.2, 1);
  const puckGlow = spr(root, kit.glow, 0x9fd0ff, 0); puckGlow.scale.set(9, 9, 1);

  const dogWake = makeTrail(root, kit.soft, 46, 4.5, [PAL.dogGold[0], PAL.dogGold[1] * 0.9, PAL.dogGold[2] * 0.7]);
  const puckWake = makeTrail(root, kit.soft, 22, 3.2, PAL.puck);
  const rings = makeRings(root, kit);
  const sprayPool = makeSprayPool(root, kit);

  // ---------------- state ---------------------------------------------------
  const DOG = {
    pos: new THREE.Vector3(30, 0, 44), vel: new THREE.Vector3(), heading: Math.PI,
    target: new THREE.Vector3(30, 0, 44), mode: "idle" as "idle" | "chase", dissolve: 0,
    idleHome: new THREE.Vector3(30, 0, 44), pounce: 0,
    stride: 0, sit: 0, idleT: 0, wag: 0.7, pawAcc: 0,
  };
  const BALL = {
    pos: new THREE.Vector3(22, 0, 38), from: new THREE.Vector3(), to: new THREE.Vector3(),
    mode: "rest" as "rest" | "fly", t: 0, dur: 0.55, arc: 10, restT: 0,
  };
  const PUCK = {
    pos: new THREE.Vector3(0, 0.5, 6), from: new THREE.Vector3(), to: new THREE.Vector3(),
    mode: "rest" as "rest" | "pass", t: 0, dur: 0.5, arc: 0, carrier: 0, receiver: -1, timer: 1.6, shot: false,
  };
  const cursorIce = new THREE.Vector3();
  let hasCursor = false;
  let started = false;
  let dogVis = 0, playerVis = 0, ballVis = 0;
  let snowSurge = 0;                       // external whiteout drive (journey); 0 = final.html
  const SNOW_SIZE0 = snow.u.uSize.value;   // base flake size — surge scales from here

  // reused scratch (never allocate in the frame loop)
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _perp = new THREE.Vector3();
  const _cp = new THREE.Vector3(), _clk = new THREE.Vector3();

  // ---------------- hooks ---------------------------------------------------
  function onPointerMove(point: THREE.Vector3 | null): void {
    if (point) { cursorIce.copy(point); hasCursor = true; }
    else hasCursor = false;
  }
  function setSnowSurge(v: number): void { snowSurge = clamp(v, 0, 1); }
  /** Viewport aspect (w/h). Narrow viewports pull the camera back so the pond still fits. */
  function setViewAspect(a: number): void { if (a > 0.05 && Number.isFinite(a)) viewAspect = a; }
  function setCalm(v: boolean): void { calm = v; }
  function onIceClick(point: THREE.Vector3): void {
    if (!started) return;
    const c = clampIce(point.x, point.z, 8);
    BALL.from.copy(BALL.pos); BALL.to.set(c.x, 0, c.z);
    BALL.t = 0; BALL.dur = clamp(BALL.from.distanceTo(BALL.to) / 160, 0.45, 1.0);
    BALL.arc = clamp(BALL.from.distanceTo(BALL.to) * 0.22, 8, 34);
    BALL.mode = "fly";
    DOG.target.set(c.x, 0, c.z);
    DOG.mode = "chase";
    DOG.sit = 0; DOG.idleT = 0;
    popRing(rings, BALL.from.x, BALL.from.z, 0xcaf24a);
  }

  // ---------------- subjects ------------------------------------------------
  function updateBall(dt: number, t: number): void {
    if (BALL.mode === "fly") {
      BALL.t += dt;
      const u = clamp(BALL.t / BALL.dur, 0, 1);
      const ee = 1 - Math.pow(1 - u, 2.2);
      BALL.pos.x = lerp(BALL.from.x, BALL.to.x, ee);
      BALL.pos.z = lerp(BALL.from.z, BALL.to.z, ee);
      BALL.pos.y = 2.0 + BALL.arc * 4 * u * (1 - u);
      if (u >= 1) { BALL.mode = "rest"; BALL.restT = 0; popRing(rings, BALL.pos.x, BALL.pos.z, 0xcaf24a); }
    } else {
      BALL.restT += dt;
      const b = Math.exp(-6.0 * BALL.restT) * Math.abs(Math.sin(BALL.restT * 22.0)) * 5.0;
      BALL.pos.y = 2.0 + b;
    }
    ballCore.position.copy(BALL.pos); ballGlow.position.copy(BALL.pos);
    ballFloor.position.set(BALL.pos.x, 0.25, BALL.pos.z);
  }

  function updateDog(dt: number, t: number): void {
    let spd: number;
    if (DOG.mode === "chase") {
      _v.copy(DOG.target).sub(DOG.pos); _v.y = 0;
      const dist = _v.length();
      _dir.copy(_v).normalize();
      const desired = clamp(dist * 2.2, 10, 92);
      _perp.set(-_dir.z, 0, _dir.x).multiplyScalar(Math.sin(t * 3.0) * clamp(dist * 0.10, 0, 10) * 0.35);
      _v2.copy(_dir).multiplyScalar(desired).add(_perp);
      DOG.vel.lerp(_v2, clamp(7 * dt, 0, 1));
      DOG.pos.addScaledVector(DOG.vel, dt);
      spd = DOG.vel.length();
      if (spd > 0.5) DOG.heading = angLerp(DOG.heading, Math.atan2(DOG.vel.z, DOG.vel.x), clamp(9 * dt, 0, 1));
      DOG.dissolve = lerp(DOG.dissolve, clamp((spd - 30) / 90, 0, 1) * 0.35, clamp(6 * dt, 0, 1));
      if (dist < 4.5) {
        DOG.mode = "idle"; DOG.idleHome.copy(DOG.target); DOG.pounce = 1.0; DOG.idleT = 0;
        popRing(rings, DOG.pos.x, DOG.pos.z, 0xffbf6a);
        spray(sprayPool, DOG.pos.x, DOG.pos.z, DOG.heading, 6, 1.0);
        TR.stopMark(DOG.pos.x, DOG.pos.z, DOG.heading);
        _v.copy(DOG.pos).sub(BALL.pos); _v.y = 0; _v.normalize();
        BALL.pos.addScaledVector(_v, -2);
      }
    } else {
      const home = DOG.idleHome;
      _v.copy(home).sub(DOG.pos); _v.y = 0;
      DOG.vel.lerp(_v.multiplyScalar(1.6), clamp(3 * dt, 0, 1));
      DOG.pos.addScaledVector(DOG.vel, dt);
      spd = DOG.vel.length();
      DOG.idleT += dt;
      const cursorNear = hasCursor && cursorIce.distanceTo(DOG.pos) < 30;
      let faceAng: number;
      if (hasCursor) faceAng = Math.atan2(cursorIce.z - DOG.pos.z, cursorIce.x - DOG.pos.x);
      else faceAng = Math.atan2(BALL.pos.z - DOG.pos.z, BALL.pos.x - DOG.pos.x);
      DOG.heading = angLerp(DOG.heading, faceAng, clamp(2.6 * dt, 0, 1));
      if (cursorNear) {
        DOG.idleT = 0;
        _v.copy(cursorIce).sub(DOG.pos); _v.y = 0;
        const cd = _v.length();
        if (cd > 2) { _v.normalize(); DOG.pos.addScaledVector(_v, Math.min(cd, 14) * 0.10 * dt); }
      }
      DOG.dissolve = lerp(DOG.dissolve, 0.0, clamp(3 * dt, 0, 1));
      DOG.pounce = Math.max(0, DOG.pounce - dt * 2.2);
    }
    // sit after a quiet moment; wag always, harder when engaged
    const sitTgt = DOG.mode === "idle" && DOG.idleT > 2.4 ? 1 : 0;
    DOG.sit += clamp(sitTgt - DOG.sit, -dt * 2.8, dt * 1.7);
    const wagTgt = DOG.mode === "chase" ? 0.35 : (hasCursor && cursorIce.distanceTo(DOG.pos) < 30) ? 1.2 : DOG.sit > 0.5 ? 1.0 : 0.65;
    DOG.wag = lerp(DOG.wag, wagTgt, clamp(3 * dt, 0, 1));

    const c = clampIce(DOG.pos.x, DOG.pos.z, 4); DOG.pos.x = c.x; DOG.pos.z = c.z;

    // gait
    const gallop = clamp((spd - 5) / 50, 0, 1);
    const walk = clamp(spd / 6, 0, 1) * 0.45;
    dog.u.uIntro.value *= 1 - gallop * 0.34;   // keep the coat golden at full sprint
    DOG.stride += dt * (5.5 + spd * 0.42);
    const bounce = Math.abs(Math.sin(DOG.stride + 0.5)) * 1.05 * gallop;
    const leap = Math.sin(clamp(DOG.pounce, 0, 1) * Math.PI) * 2.2;

    const u = dog.u;
    u.uAnchor.value.set(DOG.pos.x, 0.9 + (bounce + leap) * 0.66, DOG.pos.z);
    u.uHeading.value = DOG.heading;
    u.uDissolve.value = DOG.dissolve * 0.5 + DOG.pounce * 0.18;
    u.uBreath.value = DOG.mode === "chase" ? 0.22 : 0.5 + Math.sin(t * 1.4) * 0.12;
    u.uStride.value = DOG.stride;
    u.uGait.value = Math.max(walk, gallop);
    u.uPitchA.value = Math.sin(DOG.stride + 1.1) * 0.13 * gallop - clamp(DOG.pounce, 0, 1) * 0.22;
    u.uWag.value = DOG.wag;
    u.uSit.value = DOG.sit;

    dogGlow.position.set(DOG.pos.x, 2.2, DOG.pos.z);
    dogGlow.material.opacity = (0.20 + DOG.dissolve * 0.30) * dogVis;
    dogFloor.position.set(DOG.pos.x, 0.25, DOG.pos.z);
    dogFloor.material.opacity = 0.42 * dogVis;

    // paw scuffs — dotted gallop track, not a glow ribbon
    if (spd > 8) {
      DOG.pawAcc += spd * dt;
      if (DOG.pawAcc > 0.85) {
        DOG.pawAcc = 0;
        const pxd = -Math.sin(DOG.heading), pzd = Math.cos(DOG.heading);
        const side = (Math.sin(DOG.stride) > 0 ? 1 : -1) * 0.4;
        TR.dot(DOG.pos.x + pxd * side, DOG.pos.z + pzd * side, 1.2, 0.05);
      }
    }
    dogWake.push(DOG.pos.x, 0.8, DOG.pos.z, DOG.mode === "chase" ? 0.15 : 0.02);
    dogWake.update(dogVis * 0.7);
  }

  // ---- players: organic pickup hockey --------------------------------------
  function pickOpenSpot(out: THREE.Vector3): void {
    // half the time near the flow, half anywhere — a pickup game breathes
    const a = rand(-Math.PI, Math.PI), r = rand(30, 85);
    const bias = Math.random() < 0.5 ? 0.22 : 0.0;
    const x = PUCK.pos.x * bias + Math.cos(a) * r;
    const z = PUCK.pos.z * bias + Math.sin(a) * r;
    const c = clampIce(x, z, 16);
    out.set(c.x, 0, c.z);
  }
  function decide(P: Player, i: number): void {
    if (i === RAT) { P.state = "free"; return; }
    if (PUCK.carrier === i) {
      P.state = "carry"; P.timer = rand(1.3, 2.6);
      const side = players[i]!.team === 0 ? 1 : -1;      // team 0 attacks +X, team 1 attacks -X
      const gx = side > 0 ? netBx - 22 : netAx + 22;
      P.target.set(lerp(P.pos.x, gx, 0.45) + rand(-14, 14), 0, P.pos.z * 0.6 + rand(-18, 18));
      P.targetSpeed = rand(13, 19);
      return;
    }
    const r = Math.random();
    if (r < 0.30) { P.state = "coast"; pickOpenSpot(P.target); P.targetSpeed = rand(6, 11); P.timer = rand(2.0, 4.0); }
    else if (r < 0.52) { P.state = "skate"; pickOpenSpot(P.target); P.targetSpeed = rand(14, 21); P.timer = rand(1.6, 3.2); }
    else if (r < 0.70) {
      P.state = "support"; P.timer = rand(1.2, 2.4); P.targetSpeed = rand(12, 17);
    }
    else if (r < 0.86) { P.state = "stop"; P.timer = rand(1.4, 3.6); P.targetSpeed = 0; if (P.speed > 9) { TR.stopMark(P.pos.x, P.pos.z, P.heading); spray(sprayPool, P.pos.x, P.pos.z, P.heading, 4, 0.8); } }
    else { P.state = "drift"; pickOpenSpot(P.target); P.targetSpeed = rand(4, 7); P.timer = rand(2.5, 4.5); }
  }
  function updatePlayers(dt: number, t: number): void {
    for (let i = 0; i < players.length; i++) {
      const P = players[i]!;
      P.timer -= dt;
      const holdsPuck = PUCK.carrier === i && PUCK.mode === "rest";
      if (P.state === "carry" && !holdsPuck) { decide(P, i); if (P.timer <= 0) P.timer = 2; }  // passed it — move on
      else if (P.timer <= 0 && !holdsPuck) { decide(P, i); if (P.timer <= 0) P.timer = 2; }

      // steering target per state
      if (i === RAT) {
        // lazy figure-eights, all glide
        P.ratPh += dt * 0.16;
        const A = 26;
        P.target.set(-58 + A * Math.sin(P.ratPh) * 1.6, 0, -58 + A * Math.sin(P.ratPh) * Math.cos(P.ratPh) * 1.8);
        P.targetSpeed = 10.5;
      } else if (P.state === "carry") {
        P.timer -= 0; // pass timing handled by PUCK
      } else if (P.state === "support") {
        const C = players[PUCK.carrier]!;
        const ahead = 26;
        P.target.set(C.pos.x + Math.cos(C.heading) * ahead + rand(-1, 1), 0,
          C.pos.z + Math.sin(C.heading) * ahead + (P.team === C.team ? 14 : -14));
      } else if (P.state === "chasePass") {
        P.target.copy(PUCK.to);
      }

      // integrate: heading turns toward target with a rate limit; speed eases
      _v.copy(P.target).sub(P.pos); _v.y = 0;
      const dist = _v.length();
      const wantHeading = dist > 1.5 ? Math.atan2(_v.z, _v.x) : P.heading;
      const maxTurn = (1.1 + 10 / (P.speed + 4)) * dt;
      const dh = angDelta(P.heading, wantHeading);
      const applied = clamp(dh, -maxTurn, maxTurn);
      P.heading += applied;
      let wantSpeed = P.state === "stop" ? 0 : P.targetSpeed;
      if (dist < 8 && P.state !== "carry" && i !== RAT) wantSpeed *= dist / 8;
      const accel = wantSpeed > P.speed ? 10 : 22;
      P.speed += clamp(wantSpeed - P.speed, -accel * dt, accel * dt);
      P.vel.set(Math.cos(P.heading) * P.speed, 0, Math.sin(P.heading) * P.speed);
      P.pos.addScaledVector(P.vel, dt);

      // spacing: skaters respect each other and the dog
      for (let k2 = 0; k2 < players.length; k2++) {
        if (k2 === i) continue;
        _v2.copy(P.pos).sub(players[k2]!.pos); _v2.y = 0;
        const dd = _v2.length();
        if (dd < 9 && dd > 0.01) P.pos.addScaledVector(_v2.normalize(), (9 - dd) * 0.5 * dt * 6);
      }
      _v2.copy(P.pos).sub(DOG.pos); _v2.y = 0;
      const ddg = _v2.length();
      if (ddg < 9 && ddg > 0.01) P.pos.addScaledVector(_v2.normalize(), (9 - ddg) * 0.5 * dt * 5);

      // keep off the goals and on the ice
      for (let gi = 0; gi < goals.length; gi++) {
        const G = goals[gi]!;
        if (Math.abs(P.pos.x - G.x) < 9 && Math.abs(P.pos.z) < 7) P.pos.z += (P.pos.z >= 0 ? 1 : -1) * 14 * dt;
      }
      const c = clampIce(P.pos.x, P.pos.z, 11); P.pos.x = c.x; P.pos.z = c.z;

      // gait / pose
      const turnRate = applied / Math.max(dt, 0.001);
      P.stride += dt * (2.1 + P.speed * 0.28);
      P.gait = lerp(P.gait, clamp((P.speed - 1.5) / 13, 0, 1), clamp(6 * dt, 0, 1));
      P.lean = lerp(P.lean, clamp(-turnRate * 0.16, -0.42, 0.42), clamp(5 * dt, 0, 1));
      P.crouch = lerp(P.crouch, clamp(P.speed / 24, 0, 0.85), clamp(4 * dt, 0, 1));
      const u = P.sys.u;
      u.uAnchor.value.set(P.pos.x, 0, P.pos.z);
      u.uHeading.value = P.heading;
      u.uStride.value = P.stride;
      u.uGait.value = P.gait;
      u.uLean.value = P.lean;
      u.uCrouch.value = P.crouch;
      u.uBob.value = P.state === "stop" ? Math.sin(t * 1.3 + i) * 0.06 : 0;

      // blade cuts — thin, paired, weaving with the stride
      if (playerVis > 0.25 && P.speed > 2.2) {
        const fx = Math.cos(P.heading), fz = Math.sin(P.heading);
        const pxd = -fz, pzd = fx;
        for (let b2 = 0; b2 < 2; b2++) {
          const sideSign = b2 === 0 ? 1 : -1;
          const pushT = Math.sin(P.stride + (b2 === 0 ? 0 : Math.PI));
          const lat = sideSign * 0.55 + pushT * 0.55 * P.gait * sideSign;
          const bx2 = P.pos.x + pxd * lat, bz2 = P.pos.z + pzd * lat;
          const prev = P.blPrev[b2]!;
          const pushing = pushT * sideSign > 0.35;
          TR.seg(prev.x, prev.z, bx2, bz2, pushing ? 1.3 : 0.9, (pushing ? 0.075 : 0.04) * clamp(P.speed / 14, 0.4, 1));
          prev.set(bx2, 0, bz2);
        }
      } else {
        const fx3 = Math.cos(P.heading), fz3 = Math.sin(P.heading);
        P.blPrev[0].set(P.pos.x - fz3 * 0.55, 0, P.pos.z + fx3 * 0.55);
        P.blPrev[1].set(P.pos.x + fz3 * 0.55, 0, P.pos.z - fx3 * 0.55);
      }
    }
  }

  function updateGoalies(dt: number, t: number): void {
    for (let i = 0; i < goalies.length; i++) {
      const GL = goalies[i]!, G = GL.goal;
      // shuffle across the crease, always square to the puck
      const wantZ = clamp(PUCK.pos.z * 0.55, -2.4, 2.4);
      GL.z += clamp(wantZ - GL.z, -5.5 * dt, 5.5 * dt);
      GL.lunge = Math.max(0, GL.lunge - dt * 2.4);
      const gx = G.x + G.dir * 2.4;
      const u = GL.sys.u;
      u.uAnchor.value.set(gx, 0, GL.z);
      u.uHeading.value = Math.atan2(PUCK.pos.z - GL.z, PUCK.pos.x - gx);
      u.uCrouch.value = 0.30 + GL.lunge * 0.5;
      u.uBob.value = Math.sin(t * 1.8 + GL.ph) * 0.05 - GL.lunge * 0.3;
    }
  }

  function updatePuck(dt: number, t: number): void {
    if (PUCK.mode === "rest") {
      const C = players[PUCK.carrier]!;
      const fx = Math.cos(C.heading), fz = Math.sin(C.heading);
      PUCK.pos.x = C.pos.x + fx * 3.4 - fz * 0.6;
      PUCK.pos.z = C.pos.z + fz * 3.4 + fx * 0.6;
      PUCK.pos.y = 0.5;
      PUCK.timer -= dt;
      if (PUCK.timer <= 0) {
        const mates: number[] = [], opp: number[] = [];
        for (let i2 = 0; i2 < players.length; i2++) {
          if (i2 === PUCK.carrier || i2 === RAT) continue;
          (players[i2]!.team === C.team ? mates : opp).push(i2);
        }
        const side = C.team === 0 ? 1 : -1;
        const gx = side > 0 ? netBx : netAx;
        const nearGoal = Math.abs(C.pos.x - gx) < 60;
        const shot = nearGoal && Math.random() < 0.30;
        PUCK.from.copy(PUCK.pos);
        if (shot) {
          PUCK.to.set(gx - side * 1.2, 0, rand(-GOAL_HW * 0.8, GOAL_HW * 0.8));
          PUCK.receiver = -1; PUCK.shot = true;
        } else {
          const pool = Math.random() < 0.75 && mates.length ? mates : opp;
          let pick = pool.length ? pool[(Math.random() * pool.length) | 0]! : (PUCK.carrier + 1) % players.length;
          if (pick === RAT) pick = (pick + 1) % players.length;
          const R = players[pick]!;
          // lead the receiver: aim where they'll be
          const lead = clamp(PUCK.from.distanceTo(R.pos) / 95, 0.2, 0.9);
          PUCK.to.set(R.pos.x + R.vel.x * lead + Math.cos(R.heading) * 3.0, 0,
            R.pos.z + R.vel.z * lead + Math.sin(R.heading) * 3.0);
          const cc2 = clampIce(PUCK.to.x, PUCK.to.z, 10); PUCK.to.set(cc2.x, 0, cc2.z);
          PUCK.receiver = pick; PUCK.shot = false;
          players[pick]!.state = "chasePass"; players[pick]!.targetSpeed = rand(15, 21); players[pick]!.timer = 2.5;
        }
        PUCK.t = 0;
        PUCK.dur = clamp(PUCK.from.distanceTo(PUCK.to) / (PUCK.shot ? 150 : 95), 0.22, 1.1);
        PUCK.arc = !PUCK.shot && Math.random() < 0.25 ? 2.0 : 0;   // the odd saucer pass
        PUCK.mode = "pass";
      }
    } else {
      PUCK.t += dt;
      const uu = clamp(PUCK.t / PUCK.dur, 0, 1);
      const ee = 1 - Math.pow(1 - uu, 1.6);
      PUCK.pos.x = lerp(PUCK.from.x, PUCK.to.x, ee);
      PUCK.pos.z = lerp(PUCK.from.z, PUCK.to.z, ee);
      PUCK.pos.y = 0.5 + PUCK.arc * 4 * uu * (1 - uu);
      if (uu >= 1) {
        if (PUCK.receiver >= 0) { PUCK.carrier = PUCK.receiver; players[PUCK.carrier]!.state = "carry"; decide(players[PUCK.carrier]!, PUCK.carrier); }
        else {
          // a shot rings the goal frame; nearest skater collects the rebound
          const G: Goal = Math.abs(PUCK.to.x - netAx) < Math.abs(PUCK.to.x - netBx) ? goalA : goalB;
          G.shiver = 1;
          const GL2 = goalies[G === goalA ? 0 : 1]!;
          GL2.lunge = 1;
          spray(sprayPool, G.x + G.dir * 2.4, GL2.z, Math.atan2(PUCK.from.z - GL2.z, PUCK.from.x - G.x), 4, 0.9);
          popRing(rings, PUCK.pos.x, PUCK.pos.z, 0xd98a7a);
          spray(sprayPool, PUCK.pos.x, PUCK.pos.z, Math.atan2(PUCK.to.z - PUCK.from.z, PUCK.to.x - PUCK.from.x), 3, 0.7);
          PUCK.pos.x += G.dir * rand(4, 9); PUCK.pos.z += rand(-5, 5);
          let best = 0, bd = 1e9;
          for (let i3 = 0; i3 < players.length; i3++) {
            if (i3 === RAT) continue;
            const dd2 = players[i3]!.pos.distanceTo(PUCK.pos);
            if (dd2 < bd) { bd = dd2; best = i3; }
          }
          PUCK.carrier = best; players[best]!.state = "chasePass"; players[best]!.timer = 1.2; players[best]!.target.copy(PUCK.pos);
        }
        PUCK.mode = "rest"; PUCK.timer = rand(1.2, 2.6);
      }
    }
    const vis = playerVis;
    puckCore.position.copy(PUCK.pos); puckCore.material.opacity = vis * (0.7 + 0.15 * Math.sin(t * 5.0));
    puckGlow.position.copy(PUCK.pos); puckGlow.material.opacity = vis * 0.35;
    puckWake.push(PUCK.pos.x, 0.5, PUCK.pos.z, PUCK.mode === "pass" ? 0.55 : 0.04);
    puckWake.update(vis);
    // the puck scores the ice too — one thin line
    if (PUCK.mode === "pass" && vis > 0.25) {
      TR.seg(PUCK.from.x + (PUCK.pos.x - PUCK.from.x) * 0.985, PUCK.from.z + (PUCK.pos.z - PUCK.from.z) * 0.985, PUCK.pos.x, PUCK.pos.z, 0.8, 0.045);
    }
    // goal shivers decay
    for (let g3 = 0; g3 < goals.length; g3++) {
      const GG = goals[g3]!;
      if (GG.shiver > 0.01) {
        GG.shiver *= Math.exp(-6 * dt);
        GG.group.rotation.z = Math.sin(t * 55) * 0.012 * GG.shiver;
        GG.group.scale.setScalar(1 + Math.sin(t * 62) * 0.012 * GG.shiver);
      } else { GG.group.rotation.z = 0; GG.group.scale.setScalar(1); }
    }
  }

  // ---------------- camera --------------------------------------------------
  const camStartPos = new THREE.Vector3(0, 112, 232), camEndPos = new THREE.Vector3(0, 146, 292);
  const camStartLook = new THREE.Vector3(0, 42, -4), camEndLook = new THREE.Vector3(0, 24, -46);
  const FRAMED_ASPECT = 1.6;      // the aspect this shot was composed for
  let viewAspect = FRAMED_ASPECT; // callers report the real viewport (see setViewAspect)
  let calm = false;               // prefers-reduced-motion
  // last computed pose, exposed for external rigs (updated every update())
  const cameraPos = camStartPos.clone(), cameraLook = camStartLook.clone();

  // ---------------- probe (mutated in place — no per-frame allocation) ------
  const probe: AerialProbe = {
    started: false, prog: 0, reveal: 0,
    dog: { x: 0, z: 0, mode: "idle", sit: 0 },
    ball: { x: 0, z: 0, mode: "rest" },
    puck: { x: 0, z: 0, mode: "rest", carrier: 0 },
    players: players.map(() => ({ s: "coast", v: 0 })),
  };

  function update(dt: number, t: number, camera?: THREE.Camera): void {
    const intro = smooth(0.0, 0.45, t);
    const prog = clamp((t - ASM_START) / (ASM_END - ASM_START), 0, 1);
    const reveal = smooth(2.2, 6.2, t);

    for (let s = 0; s < moteSystems.length; s++) {
      const mu = moteSystems[s]!.u;
      mu.uProgress.value = prog; mu.uTime.value = t; mu.uIntro.value = intro;
    }

    snow.u.uTime.value = t; snow.u.uIntro.value = intro;
    // at surge 0 both lines reduce to the approved final.html values
    snow.u.uDensity.value = lerp(1.05, 0.44, smooth(0.8, 4.5, t)) + snowSurge * 1.9;
    snow.u.uSize.value = SNOW_SIZE0 * (1 + snowSurge * 0.9);

    sky.u.uReveal.value = reveal; sky.u.uSunI.value = reveal;
    sky.sunGlow.material.opacity = reveal * 0.40; sky.sunCore.material.opacity = reveal * 0.58;
    ground.mesh.material.opacity = smooth(0.30, 1.0, prog);
    pondGlow.material.opacity = reveal * 0.09;
    rakeGlow.material.opacity = reveal * 0.07 * (0.85 + 0.15 * Math.sin(t * 0.4));
    drift.u.uOp.value = smooth(0.35, 0.85, prog);
    TR.mesh.material.opacity = smooth(0.55, 0.95, prog) * 0.85;

    const hardVis = smooth(0.45, 0.9, prog);
    frameMat.opacity = hardVis * 0.9; frameLitMat.opacity = hardVis;
    for (let nm = 0; nm < netMats.length; nm++) netMats[nm]!.opacity = hardVis * 0.62;
    benchMat.opacity = hardVis * 0.85; benchSnowMat.opacity = hardVis * 0.95;
    goalA.glow.material.opacity = hardVis * 0.09; goalB.glow.material.opacity = hardVis * 0.09;

    dogVis = smooth(0.55, 0.95, prog);
    playerVis = smooth(0.5, 0.9, prog);
    ballVis = smooth(0.55, 0.95, prog);
    if (!started && prog > 0.9) started = true;

    const camP = smooth(0.6, 5.2, t);
    _cp.lerpVectors(camStartPos, camEndPos, camP);
    _clk.lerpVectors(camStartLook, camEndLook, camP);
    const drift2 = smooth(4.8, 6.5, t) * (calm ? 0 : 1);
    _cp.x += Math.sin(t * 0.06) * 10 * drift2;
    _cp.y += Math.sin(t * 0.18) * 3.0 * drift2;
    _clk.x += Math.sin(t * 0.05) * 3 * drift2;
    // The framing was composed wide. A perspective camera loses horizontal field
    // as the viewport narrows, so a phone in portrait would crop the pond in half
    // — back the camera off along its own sightline until the shot fits again.
    if (viewAspect < FRAMED_ASPECT) {
      const pull = Math.min(FRAMED_ASPECT / Math.max(viewAspect, 0.35), 2.4);
      _cp.sub(_clk).multiplyScalar(pull).add(_clk);
    }
    cameraPos.copy(_cp); cameraLook.copy(_clk);
    if (camera) { camera.position.copy(_cp); camera.lookAt(_clk); }

    updateBall(dt, t);
    updateDog(dt, t);
    updatePlayers(dt, t);
    updateGoalies(dt, t);
    updatePuck(dt, t);

    ballCore.material.opacity = ballVis * (0.85 + 0.15 * Math.sin(t * 3.0));
    ballGlow.material.opacity = ballVis * 0.55;
    ballFloor.material.opacity = ballVis * 0.45;

    for (let r = 0; r < rings.length; r++) {
      const R = rings[r]!;
      if (R.t <= 1.2) {
        R.t += dt;
        const u2 = clamp(R.t / 1.1, 0, 1);
        R.s.position.set(R.x, 0.4, R.z);
        const scl = 4 + u2 * 34; R.s.scale.set(scl, scl, 1);
        R.s.material.opacity = (1 - u2) * 0.7 * Math.max(dogVis, playerVis);
      } else R.s.material.opacity = 0;
    }

    // spray puffs
    for (let sp2 = 0; sp2 < sprayPool.length; sp2++) {
      const SP = sprayPool[sp2]!;
      if (SP.t < 0.55) {
        SP.t += dt;
        SP.vy -= 40 * dt;
        SP.x += SP.vx * dt; SP.y += SP.vy * dt; SP.z += SP.vz * dt;
        if (SP.y < 0.4) SP.y = 0.4;
        SP.s.position.set(SP.x, SP.y, SP.z);
        const lf = 1 - SP.t / 0.55;
        SP.s.material.opacity = lf * 0.5 * playerVis;
        const sc2 = 2.2 + (1 - lf) * 4;
        SP.s.scale.set(sc2, sc2, 1);
      } else SP.s.material.opacity = 0;
    }

    // the live cut ledger breathes out slowly
    TR.fade(dt);
    TR.flush();

    // debug probe (mirrors final.html's window.__probe)
    probe.started = started; probe.prog = prog; probe.reveal = reveal;
    probe.dog.x = DOG.pos.x; probe.dog.z = DOG.pos.z; probe.dog.mode = DOG.mode; probe.dog.sit = DOG.sit;
    probe.ball.x = BALL.pos.x; probe.ball.z = BALL.pos.z; probe.ball.mode = BALL.mode;
    probe.puck.x = PUCK.pos.x; probe.puck.z = PUCK.pos.z; probe.puck.mode = PUCK.mode; probe.puck.carrier = PUCK.carrier;
    for (let pi = 0; pi < players.length; pi++) {
      const pr = probe.players[pi]!;
      pr.s = players[pi]!.state; pr.v = +players[pi]!.speed.toFixed(1);
    }
  }

  function dispose(): void {
    root.traverse((obj) => {
      const anyObj = obj as THREE.Mesh | THREE.Points | THREE.Sprite;
      const geom = (anyObj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (geom) geom.dispose();
      const mat = (anyObj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) {
        const map = (mat as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        mat.dispose();
      }
    });
    kit.soft.dispose(); kit.core.dispose(); kit.glow.dispose(); kit.ring.dispose();
  }

  // verification hook (no visual impact; lets the render harness isolate layers)
  const dev: Record<string, THREE.Object3D> = {
    sky: sky.mesh, ground: ground.mesh, drift: drift.mesh,
    trail: TR.mesh, snowPts: snow.points, worldPts: worldMotes.points,
  };

  return { root, uScale, probe, dev, cameraPos, cameraLook, update, onPointerMove, onIceClick, setSnowSurge, setViewAspect, setCalm, dispose };
}
