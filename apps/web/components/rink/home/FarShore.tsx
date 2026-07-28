"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createHomeWorld, type HomeWorld } from "./world";
import { homePlan, type HomePlan } from "./budget";
import { CAM_FAR, CAM_FOV, CAM_NEAR, DOORS_AT, EYE_Y } from "./constants";
import styles from "./home.module.css";

/**
 * THE FAR SHORE — the home page.
 *
 * A frozen lake at dawn under three ranges of mountains; the sun crests a col
 * and lays a column of gold down the ice to the lens; a golden retriever, a
 * point cloud sampled off the real rigged mesh, stands out on the ice with his
 * reflection under him. Falling snow, a shoreline mist band, and the igloo idle
 * drift — a few degrees of camera and nothing else. NO SCROLL JOURNEY.
 *
 * Ported from docs/openers/o-2.html, the opener tournament winner.
 *
 * THREE THINGS ON THIS COMPONENT ARE LOAD-BEARING.
 *
 *  1. `flat` on the Canvas. The composite in post.ts tone-maps ONCE, with its
 *     own ACES curve after a 1.24 exposure. R3F would otherwise set the
 *     renderer to ACESFilmic and the frame would be mapped twice, which lifts
 *     the blacks to grey and costs exactly the near-black background this
 *     grade exists to produce. `linear` and `legacy` match the standalone's
 *     LinearSRGB output and its disabled colour management for the same reason.
 *
 *  2. `renderPriority` 1 on useFrame. It takes the render loop away from R3F,
 *     which is the only way the scene can go through the six-pass composite
 *     instead of straight to the default framebuffer.
 *
 *  3. The pointer listeners are on `window`, in viewport fractions, exactly as
 *     the standalone had them. The cursor is a RAY through the scene — it
 *     parts the coat, lifts a lane of loose snow off the ice and lights a warm
 *     eddy in the falling flakes — and that response is the page's measured
 *     pointer score. Routing it through R3F's canvas-local events would change
 *     both the origin and the units.
 */

/* The scene clock has to EXIST from the moment this module evaluates, not from
   the first rendered frame. The screenshot harnesses ask for it ONCE, early,
   and if it is undefined at that instant they fall back to performance.now()
   for the whole run — which is the wall clock, not what the scene has actually
   simulated, and the two diverge by however long the bundle took to boot. The
   standalone got this for free; a React page has to say it out loud. */
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.__sceneClock !== "number") w.__sceneClock = 0;
}

function WorldMount({ doorsRef, plan }: { doorsRef: RefObject<HTMLElement | null>; plan: HomePlan }) {
  const { gl } = useThree();
  const world: HomeWorld = useMemo(() => createHomeWorld(plan), [plan]);
  const tRef = useRef(0);
  const doorsIn = useRef(false);
  const bufSize = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      world.onPointerMove(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    };
    const onLeave = () => world.onPointerLeave();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [world]);

  useEffect(() => () => { world.dispose(); }, [world]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    tRef.current += delta;                       // elapsed from mount (standalone: clock.elapsedTime)
    const t = tRef.current;
    // The harnesses read the page's own clock rather than trusting a screenshot
    // timestamp; see docs/opener/SHARED-KNOWLEDGE.md, "screenshot cost".
    (window as unknown as Record<string, unknown>).__sceneClock = t;

    state.gl.getDrawingBufferSize(bufSize);
    world.setSize(bufSize.x, bufSize.y);
    world.update(dt, t, state.camera as THREE.PerspectiveCamera);
    world.render(state.gl, state.scene, state.camera);

    // the doors arrive once the world has assembled, not with it
    if (!doorsIn.current && t > DOORS_AT) {
      doorsIn.current = true;
      doorsRef.current?.classList.add(styles.in);
    }
  }, 1);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if (w.__ok === undefined) w.__ok = true;
  }, [gl]);

  return <primitive object={world.root} />;
}

export default function FarShore() {
  const doorsRef = useRef<HTMLElement | null>(null);
  /* What this device is asked to pay, decided ONCE — the counts are geometry
     and the dpr sizes the whole composite chain, so neither may change under a
     running world. It is read after mount for the same reason the ambient world
     reads its own: on the server there is no device to ask. It doubles as the
     mount gate the boolean used to be. */
  const [plan, setPlan] = useState<HomePlan | null>(null);

  useEffect(() => {
    // boot-fail signal for the screenshot harnesses
    const onErr = (e: ErrorEvent) => {
      const w = window as unknown as Record<string, unknown>;
      w.__ok = false;
      w.__err = String(e.message || e.error || e);
    };
    window.addEventListener("error", onErr);
    // The standalone owned html/body; here the world locks the document to one
    // viewport for as long as it is mounted and hands it back on the way out.
    document.documentElement.classList.add(styles.lock);
    setPlan(homePlan());
    return () => {
      window.removeEventListener("error", onErr);
      document.documentElement.classList.remove(styles.lock);
    };
  }, []);

  return (
    <div className={styles.stage}>
      {plan && (
        <Canvas
          dpr={plan.dpr}
          flat
          linear
          legacy
          camera={{ fov: CAM_FOV, near: CAM_NEAR, far: CAM_FAR, position: [0, EYE_Y, 0] }}
          gl={{ antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 1);
            gl.autoClear = true;
          }}
        >
          <WorldMount doorsRef={doorsRef} plan={plan} />
        </Canvas>
      )}
      {/* The only navigation on this page, and the whole copy budget: two doors,
          two strings. Store is the shop; Team Archive is the record. They sit
          HIGH, in the sky — on a composition whose horizon is at 0.58 of frame
          the eye lands in the upper field first, and down in the bottom margin
          they were reading as a footer. They are also set as a HEADLINE, not as
          microcopy: a visitor missed them at .74rem after they had already been
          moved up here once, so the size, the weight, the contrast and a
          standing hairline all now say "way out" before anything is pointed at.
          Both are real anchors, outside the Canvas: in the tab order straight
          after the skip link, with a focus-visible state, and rendered even when
          the world is not. */}
      <nav ref={doorsRef} className={styles.doors} aria-label="Primary">
        <Link href="/store">Store</Link>
        <Link href="/seasons">Team Archive</Link>
      </nav>
    </div>
  );
}
