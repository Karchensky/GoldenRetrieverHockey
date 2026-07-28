"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createAerialWorld, type AerialWorld } from "../aerial/world";
import {
  ambientPlan, liftSubjects, slowSnowfall, thinPointClouds, throttleTextureUploads, type AmbientPlan,
} from "./budget";
import { createAmbientGrade } from "./grade";

/**
 * AMBIENT RINK — the pond, from above, behind the record.
 *
 * The same place the home page stands on, seen from the air: a frozen pond at
 * dawn with a pickup game on it that plays itself, and a golden retriever who
 * every so often is thrown a tennis ball. It is the ONE world this site has, so
 * the archive and the store are not somewhere else.
 *
 * It is also, unambiguously, a background. Everything in this file is in
 * service of the numbers on top of it:
 *
 *   - The grade (grade.ts) takes the dawn scene from ~100/255 mean down to the
 *     home page's near-black, before the page's own scrim adds anything.
 *   - The camera is fixed and drifts about five units over five minutes. There
 *     is no scroll parallax: nothing here is allowed to answer the reader.
 *   - The fetch is rare — one throw a minute or so, and a short one. It is the
 *     warm event, not a loop.
 *   - It is inert. `aria-hidden`, `pointer-events: none` on the wrapper AND the
 *     canvas (which is also what stops R3F's own event manager from ever
 *     raycasting), no pointer handlers, no focusable node. Clicks and text
 *     selection reach the page.
 *   - It renders BELOW device resolution everywhere, and a phone is a tier
 *     rather than a refusal: fewer motes, a slower ledger, and a frame that is
 *     still an upscale. See budget.ts for the prices and for the three budgets
 *     that were cut to get here.
 */

/** Where the reader arrives: the world's own settled framing, backed off. */
const BASE_POS = new THREE.Vector3(0, 150, 298);
const BASE_LOOK = new THREE.Vector3(0, 22, -42);
/** The aspect the aerial shot was composed for; narrower pulls back. */
const FRAMED_ASPECT = 1.6;
/** Sim clock at mount. Past the world's 5s assembly and 6.2s reveal — a reader
 *  opening a page of statistics should never watch a world put itself together. */
const WARM_T = 18;
const FADE_SECONDS = 1.6;
/** Seconds between throws. Rare on purpose; see the note above. */
const FETCH_MIN = 52, FETCH_MAX = 88;
const FIRST_FETCH_MIN = 24, FIRST_FETCH_MAX = 40;

function AmbientWorld({ plan }: { plan: AmbientPlan }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  const world: AerialWorld = useMemo(() => {
    const w = createAerialWorld();
    thinPointClouds(w.root, plan.keepScatter, plan.keepSnow);
    slowSnowfall(w.root, plan.snowSpeed);
    liftSubjects(w.root, 1.45);
    const ledger = (w.dev.trail as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
    if (ledger?.map) throttleTextureUploads(ledger.map, plan.ledgerHz);
    w.setCalm(true);      // the world's own camera drift is retired; this rig is quieter
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grade = useMemo(() => createAmbientGrade(), []);

  const t = useRef(WARM_T);
  const fade = useRef(0);
  const nextFetch = useRef(WARM_T + FIRST_FETCH_MIN + Math.random() * (FIRST_FETCH_MAX - FIRST_FETCH_MIN));
  const throwAt = useMemo(() => new THREE.Vector3(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);

  // Settle the game before the first frame: skaters spread out, the puck in
  // motion, the dog already sitting. Two seconds of simulation, no rendering.
  useEffect(() => {
    for (let i = 0; i < 60; i++) world.update(1 / 30, WARM_T);
    if (plan.still) { fade.current = 1; grade.setFade(1); }
    invalidate();
    return () => { world.dispose(); grade.dispose(); };
  }, [world, grade, plan.still, invalidate]);

  // Dev-only measurement + tuning hook. Not a HUD and not shipped: the render
  // harness reads the frame cost through it, and the grade was tuned through it
  // against real pages instead of by rebuilding between guesses.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as Record<string, unknown>;
    w.__ambient = () => ({
      frame: gl.info.render.frame,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      points: gl.info.render.points,
      programs: gl.info.programs?.length ?? 0,
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
      drawingBuffer: `${gl.domElement.width}x${gl.domElement.height}`,
      t: +t.current.toFixed(1),
      nextFetch: +nextFetch.current.toFixed(1),
      dog: world.probe.dog.mode,
      plan,
    });
    w.__ambientTune = (patch: Record<string, number | [number, number, number]>) => {
      for (const [k, v] of Object.entries(patch)) {
        const u = grade.uniforms[k];
        if (!u) continue;
        if (!Array.isArray(v)) { u.value = v; continue; }
        const target = u.value as THREE.Color | THREE.Vector3;
        if (target instanceof THREE.Color) target.setRGB(v[0], v[1], v[2]);
        else target.set(v[0], v[1], v[2]);
      }
      invalidate();
    };
    return () => { delete w.__ambient; delete w.__ambientTune; };
  }, [gl, grade, plan, invalidate, world]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    const still = plan.still;

    // Point size is derived from the drawing buffer, so this is not optional
    // even when nothing moves: at the default 1 every mote in the world draws
    // sub-pixel and the frame comes back empty.
    world.uScale.value = gl.domElement.height * 0.5;

    if (!still) {
      t.current += dt;
      world.update(dt, t.current);

      if (fade.current < 1) {
        fade.current = Math.min(1, fade.current + dt / FADE_SECONDS);
        grade.setFade(fade.current * fade.current * (3 - 2 * fade.current));
      }

      // the one warm event
      if (t.current >= nextFetch.current) {
        nextFetch.current = t.current + FETCH_MIN + Math.random() * (FETCH_MAX - FETCH_MIN);
        const a = Math.random() * Math.PI * 2;
        const r = 24 + Math.random() * 32;            // a trot, not a sprint across the pond
        throwAt.set(world.probe.dog.x + Math.cos(a) * r, 0, world.probe.dog.z + Math.sin(a) * r);
        world.onIceClick(throwAt);
      }
    }

    const cam = state.camera as THREE.PerspectiveCamera;
    pos.copy(BASE_POS);
    look.copy(BASE_LOOK);
    if (!still) {
      // Five units over five minutes. Present, and never the thing you noticed.
      const tt = t.current;
      pos.x += Math.sin(tt * 0.0195) * 5.0;
      pos.y += Math.sin(tt * 0.0310 + 1.9) * 2.4;
      pos.z += Math.sin(tt * 0.0142 + 0.7) * 4.2;
      look.x += Math.sin(tt * 0.0113 + 2.4) * 2.2;
      look.y += Math.sin(tt * 0.0087) * 1.0;
    }
    if (cam.isPerspectiveCamera && cam.aspect < FRAMED_ASPECT) {
      // A perspective camera loses horizontal field as the viewport narrows; a
      // laptop in a split window would otherwise crop the pond in half.
      const pull = Math.min(FRAMED_ASPECT / Math.max(cam.aspect, 0.35), 2.2);
      pos.sub(look).multiplyScalar(pull).add(look);
      grade.setAspect(cam.aspect);
    } else if (cam.isPerspectiveCamera) {
      grade.setAspect(cam.aspect);
    }
    camera.position.copy(pos);
    camera.lookAt(look);
  });

  return (
    <>
      <primitive object={world.root} />
      <primitive object={grade.group} />
    </>
  );
}

/** What a device that cannot afford a world gets: the same sky, as one paint. */
const STILL_SKY =
  "radial-gradient(126% 96% at 50% 66%, #14232f 0%, #0b1520 38%, #070c14 72%, #04060b 100%)";

export default function AmbientRink() {
  const plan = useMemo(() => ambientPlan(), []);

  // The masthead widens when there is a world behind it — the same rule the
  // legacy rink set, kept so replacing the world does not silently relayout the
  // top of every page.
  useEffect(() => {
    if (!plan.mount) return;
    const root = document.documentElement;
    root.classList.add("fetch-live");
    return () => { root.classList.remove("fetch-live"); };
  }, [plan.mount]);

  if (!plan.mount) {
    return (
      <div
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: STILL_SKY }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="ambient-rink"
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "#05070a" }}
    >
      <Canvas
        dpr={plan.dpr}
        flat
        frameloop={plan.still ? "demand" : "always"}
        camera={{ fov: 48, near: 0.1, far: 8000, position: [0, 150, 298] }}
        gl={{ antialias: false, alpha: false, powerPreference: "low-power", stencil: false, depth: true }}
        style={{ pointerEvents: "none" }}
        onCreated={({ gl }) => { gl.setClearColor(0x05070a, 1); }}
      >
        <AmbientWorld plan={plan} />
      </Canvas>
    </div>
  );
}
