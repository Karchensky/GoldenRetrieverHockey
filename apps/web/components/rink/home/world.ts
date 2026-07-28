/**
 * THE FAR SHORE — the world.
 *
 * Builds every layer (sky, three mountain ranges, the lake, two mist bands,
 * snowfall, the breath, the retriever and his reflection) into one root group,
 * runs the materialisation, the igloo idle drift and the pointer ray, and owns
 * the composite chain. Ported from docs/openers/o-2.html — the opener
 * tournament winner — with only the mechanical changes R3F hosting requires:
 * a scene root instead of a global scene, an injected renderer/camera instead
 * of module-scope ones, and a size driven off the drawing buffer instead of
 * innerWidth * devicePixelRatio (the same number, asked of the renderer).
 *
 * Browser-only: construct from a client component.
 *
 * NOTHING HERE MAY BE RE-TUNED. The grade, the sun bearing, the col, the
 * glitter column, the mist band, the snow and the point sampling are the frame
 * the captain picked, measured at aliveness 57.4%, pointer response 0.305,
 * blown 0.05%, dark placement 0.658, flat region 0.60%.
 */
import * as THREE from "three";
import {
  CAM_PITCH, DOG_POS, EYE_Y, REVEAL_SECONDS, smooth,
} from "./constants";
import { type HomePlan } from "./budget";
import { frameOffsetX, lateralScale } from "./framing";
import { buildSky, type SkyLayer } from "./sky";
import { buildMountains, type MountainLayer } from "./mountains";
import { buildIce, type IceLayer } from "./ice";
import { buildMist, type MistLayer } from "./mist";
import { buildSnowfall, type SnowLayer } from "./snowfall";
import { buildBreath, type BreathLayer } from "./breath";
import { buildDogGeometry, dogMaterial } from "./dog";
import { createPostChain, type PostChain } from "./post";

export type HomeWorld = {
  root: THREE.Group;
  /** 0..1 materialisation, read by the component to time the doors. */
  reveal: number;
  /** Drawing-buffer pixels; sizes the render targets and the point-size uniforms. */
  setSize: (w: number, h: number) => void;
  /** Client-space pointer as a fraction of the viewport, 0..1. */
  onPointerMove: (fx: number, fy: number) => void;
  onPointerLeave: () => void;
  update: (dt: number, t: number, camera: THREE.PerspectiveCamera) => void;
  render: (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
  dispose: () => void;
};

export function createHomeWorld(plan: HomePlan): HomeWorld {
  const root = new THREE.Group();   // identity, at the origin: world space IS root space

  const sky: SkyLayer = buildSky(root);
  const mountains: MountainLayer = buildMountains(root);
  const ice: IceLayer = buildIce(root);
  const mist: MistLayer = buildMist(root);
  const snow: SnowLayer = buildSnowfall(root);
  const breath: BreathLayer = buildBreath(root);
  const post: PostChain = createPostChain();

  /* ============================================================= THE DOG */
  const dogMat = dogMaterial();
  dogMat.depthWrite = true;                    // solid, not see-through
  /* The reflection is additive, so its brightness is the SUM of its points and
     a thinner cloud is a dimmer smear. The gain is the authored count over the
     built one, which puts back exactly what the thinning took. */
  const reflMat = dogMaterial({
    uMirror: { value: 1 },
    uGain: { value: plan.reflectionGain },
  });
  reflMat.depthWrite = false;
  reflMat.depthTest = false;
  reflMat.blending = THREE.AdditiveBlending;

  let dog: THREE.Points | null = null;
  let dogRefl: THREE.Points | null = null;
  let dogGeo: THREE.BufferGeometry | null = null;
  let dogT0: number | null = null;
  let disposed = false;
  let lastT = 0;

  /* The loop starts NOW, not after the GLB lands. Awaiting the dog left the page
     black for the best part of two seconds — and on a page whose whole opening
     move is a materialisation that begins at t=0, that is the worst two seconds
     in it to lose. The world assembles while he decodes; he gets his own reveal
     clock, started the moment his geometry is in the graph. */
  buildDogGeometry(plan.dogPoints)
    .then((g) => {
      if (disposed) { g.dispose(); return; }
      dogGeo = g;
      dog = new THREE.Points(g, dogMat);
      dog.position.copy(DOG_POS);
      dog.renderOrder = 4;
      dog.frustumCulled = false;
      root.add(dog);
      dogRefl = new THREE.Points(g, reflMat);
      dogRefl.position.copy(DOG_POS);
      dogRefl.renderOrder = 3;
      dogRefl.frustumCulled = false;
      root.add(dogRefl);
      dogT0 = lastT;
    })
    .catch((e) => { console.error("dog:", e); });

  /* ================================================================ POINTER */
  const ptr = { x: 0.5, y: 0.5, has: false, k: 0 };
  const rayO = new THREE.Vector3();
  const rayD = new THREE.Vector3(0, 0, -1);
  const smA = { o: new THREE.Vector3(0, -99, 0), d: new THREE.Vector3(0, 0, -1) };
  const smB = { o: new THREE.Vector3(0, -99, 0), d: new THREE.Vector3(0, 0, -1) };
  const icePt = new THREE.Vector3(0, -999, 0);
  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const camTarget = new THREE.Vector3();

  const world: HomeWorld = {
    root,
    reveal: 0,

    setSize(w, h) {
      post.setSize(w, h);
      snow.material.uniforms.uH.value = post.height;
      snow.material.uniforms.uDpr.value = 1;
      // The snow column is a LATERAL extent, so it takes the same scale the
      // camera's lateral terms take: it is built 30 m wide because the authored
      // frame is 22 m across where the flakes die, and a narrow frame has no
      // use for the rest of it. Live, so turning a phone on its side opens it
      // straight back up. See snowfall.setSpan.
      snow.setSpan(lateralScale(w / Math.max(1, h)));
      dogMat.uniforms.uH.value = post.height;
      reflMat.uniforms.uH.value = post.height;
    },

    onPointerMove(fx, fy) { ptr.x = fx; ptr.y = fy; ptr.has = true; },
    onPointerLeave() { ptr.has = false; },

    update(dt, t, camera) {
      lastT = t;

      // materialisation: 3.4s, eased
      const revealed = smooth(0, 1, Math.min(1, t / REVEAL_SECONDS));
      world.reveal = revealed;

      // --- camera: the igloo idle drift. Under a degree of swing on an 18-second
      //     period — never a tour, but fast enough that the frame is genuinely
      //     moving rather than a still with weather painted on it.
      //
      //     Every LATERAL term is scaled by the frame's width against the width
      //     it was composed at, and the lens is left alone: see framing.ts. On a
      //     wide window k is 1 and all four numbers below are the authored ones.
      //     On a phone the camera stands closer to the dog's line so he is in
      //     the picture at all, and swings by the same SHARE of a narrower frame
      //     rather than by three times it. Nothing vertical is scaled — the eye
      //     height, its bob and the pitch are the same on every device, which is
      //     what keeps the horizon at 0.58 and the doors where they were put.
      const k = lateralScale(camera.aspect);
      const dx = (Math.sin(t * 0.131) * 0.115 + Math.sin(t * 0.077 + 1.1) * 0.062) * k;
      const dy = Math.sin(t * 0.098 + 0.4) * 0.038;
      camera.position.set(frameOffsetX(camera.aspect) + dx, EYE_Y + dy, Math.sin(t * 0.083) * 0.140);
      const yaw = (Math.sin(t * 0.360) * 0.0135 + Math.sin(t * 0.213 + 2.2) * 0.0072) * k;
      const pit = CAM_PITCH + Math.sin(t * 0.310 + 1.7) * 0.0085;
      camTarget.set(
        camera.position.x + Math.sin(yaw) * 100,
        camera.position.y + Math.tan(pit) * 100,
        camera.position.z - Math.cos(yaw) * 100,
      );
      camera.lookAt(camTarget);
      camera.updateMatrixWorld();

      // --- pointer ray, and two smoothed copies for a weighted recovery
      ptr.k += ((ptr.has ? 1 : 0) - ptr.k) * Math.min(1, dt * 3.0);
      if (ptr.has) {
        ndc.set(ptr.x * 2 - 1, -(ptr.y * 2 - 1));
        rc.setFromCamera(ndc, camera);
        rayO.copy(rc.ray.origin);
        rayD.copy(rc.ray.direction);
        const denom = rayD.y;
        if (denom < -1e-5) {
          const s = -rayO.y / denom;
          if (s > 0 && s < 400) icePt.set(rayO.x + rayD.x * s, 0, rayO.z + rayD.z * s);
        }
      }
      const ka = Math.min(1, dt * 7.0);
      const kb = Math.min(1, dt * 1.35);
      smA.o.lerp(rayO, ka); smA.d.lerp(rayD, ka).normalize();
      smB.o.lerp(rayO, kb); smB.d.lerp(rayD, kb).normalize();

      // --- uniforms
      sky.material.uniforms.uReveal.value = revealed;
      sky.material.uniforms.uTime.value = t;
      for (const m of mountains.materials) {
        m.uniforms.uReveal.value = revealed;
        (m.uniforms.uCam.value as THREE.Vector3).copy(camera.position);
      }
      for (const m of mist.bands) {
        const u = (m.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = t;
        u.uReveal.value = revealed;
        m.position.x = camera.position.x;
        m.position.z = camera.position.z;
      }
      const iu = ice.material.uniforms;
      (iu.uCam.value as THREE.Vector3).copy(camera.position);
      iu.uTime.value = t;
      iu.uReveal.value = revealed;
      (iu.uDog.value as THREE.Vector3).copy(DOG_POS);
      (iu.uPtr.value as THREE.Vector3).copy(icePt);
      (iu.uPtrD.value as THREE.Vector3).copy(smB.d);
      iu.uPtrK.value = ptr.k;
      const su = snow.material.uniforms;
      su.uTime.value = t;
      (su.uCam.value as THREE.Vector3).copy(camera.position);
      su.uReveal.value = revealed;
      (su.uPO.value as THREE.Vector3).copy(smA.o);
      (su.uPD.value as THREE.Vector3).copy(smA.d);
      su.uPtrK.value = ptr.k;
      const dogReveal = dogT0 === null ? 0 : smooth(0, 1, Math.min(1, (t - dogT0) / 2.6));
      for (const m of [dogMat, reflMat]) {
        const u = m.uniforms;
        u.uTime.value = t;
        u.uReveal.value = dogReveal;
        (u.uCam.value as THREE.Vector3).copy(camera.position);
        // The cloud tests the ray in its OWN space, and its own space is offset by
        // DOG_POS. Handing it the world-space origin put the needle several metres
        // from where the cursor actually was, and the coat never once moved.
        (u.uPOa.value as THREE.Vector3).copy(smA.o).sub(DOG_POS);
        (u.uPDa.value as THREE.Vector3).copy(smA.d);
        (u.uPOb.value as THREE.Vector3).copy(smB.o).sub(DOG_POS);
        (u.uPDb.value as THREE.Vector3).copy(smB.d);
        u.uPtrK.value = ptr.k * 1.0;
      }
      sky.mesh.position.copy(camera.position);
      breath.mesh.position.copy(smB.o).addScaledVector(smB.d, 5.6);
      breath.mesh.quaternion.copy(camera.quaternion);
      breath.material.uniforms.uK.value = ptr.k * 0.070;
      breath.material.uniforms.uTime.value = t;
    },

    render(gl, scene, camera) {
      post.render(gl, scene, camera, lastT, world.reveal);
    },

    dispose() {
      disposed = true;
      root.traverse((o) => {
        const m = o as THREE.Mesh | THREE.Points;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      dogGeo?.dispose();
      dogMat.dispose();
      reflMat.dispose();
      root.clear();
      post.dispose();
      dog = null;
      dogRefl = null;
    },
  };
  return world;
}
