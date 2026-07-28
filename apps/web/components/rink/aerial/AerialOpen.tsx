"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createAerialWorld, type AerialWorld } from "./world";

/**
 * AERIAL OPEN — the settled aerial-open mini-game (pond hockey at dawn, one
 * golden retriever) ported from docs/aerial-tournament/final.html into R3F.
 * Heavy snow -> mote assembly -> reveal, timed from mount. Click the ice ->
 * the ball is thrown there and only the dog reacts.
 *
 * `flat` on the Canvas is load-bearing: final.html rendered with vanilla
 * three's default NoToneMapping; R3F would otherwise apply ACES filmic and
 * shift the whole approved palette.
 */

function WorldMount() {
  const { gl, camera } = useThree();
  const world: AerialWorld = useMemo(() => createAerialWorld(), []);
  const tRef = useRef(0);
  const okFlagged = useRef(false);

  // pointer -> ice plane (y = 0), exactly like final.html
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const icePlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const el = gl.domElement;
    const toIce = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const b = el.getBoundingClientRect();
      ndc.set(((clientX - b.left) / b.width) * 2 - 1, -((clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(icePlane, hit) ? hit : null;
    };
    // final.html has no pointerleave handler: the last cursor spot persists
    // when the pointer leaves, and a miss above the horizon clears it.
    const onMove = (e: PointerEvent) => { world.onPointerMove(toIce(e.clientX, e.clientY)); };
    const onDown = (e: PointerEvent) => {
      const p = toIce(e.clientX, e.clientY);
      if (p) world.onIceClick(p);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [gl, camera, world, ray, icePlane, ndc, hit]);

  useEffect(() => {
    // harness hooks, mirroring final.html: __probe (sim state), __dev (layers)
    const w = window as unknown as Record<string, unknown>;
    w.__probe = world.probe;
    w.__dev = world.dev;
    return () => { world.dispose(); };
  }, [world]);

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta);
    tRef.current += delta;           // real elapsed time from mount (final.html: clock.elapsedTime)
    world.uScale.value = state.gl.domElement.height * 0.5;
    const cam = state.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) world.setViewAspect(cam.aspect); // narrow viewports pull back
    const w = window as unknown as Record<string, unknown>;
    try {
      world.update(dt, tRef.current, state.camera);
    } catch (e) {
      // keep rendering; record the first sim error (final.html's __uerr)
      if (!w.__uerr) w.__uerr = String((e as Error | undefined)?.stack || e);
    }
    if (!okFlagged.current) { okFlagged.current = true; if (w.__ok === undefined) w.__ok = true; }
  });

  return <primitive object={world.root} />;
}

export default function AerialOpen() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // boot-fail signal for the screenshot harness (mirrors final.html)
    const onErr = (e: ErrorEvent) => {
      const w = window as unknown as Record<string, unknown>;
      w.__ok = false;
      w.__err = String(e.message || e.error || e);
    };
    window.addEventListener("error", onErr);
    setReady(true);
    return () => window.removeEventListener("error", onErr);
  }, []);
  if (!ready) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#05070a", overflow: "hidden", cursor: "crosshair" }}>
      <Canvas
        dpr={[1, 2]}
        flat
        camera={{ fov: 48, near: 0.1, far: 8000, position: [0, 96, 205] }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x05070a, 1);
          camera.lookAt(0, 46, 0);
        }}
      >
        <WorldMount />
      </Canvas>
      {/* the DOM vignette from final.html, replicated on the route wrapper */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 2,
          background: "radial-gradient(126% 104% at 50% 42%, rgba(0,0,0,0) 40%, rgba(3,6,12,0.34) 76%, rgba(2,4,9,0.72) 100%)",
        }}
      />
    </div>
  );
}
