/**
 * THE FAR SHORE — real falling snow.
 *
 * White flakes, falling, wrapped in a box that rides with the camera. They
 * catch the low sun on their sunward side, and the cursor parts them and lights
 * what it passes through. Far flakes are killed hard: a sparse scatter of
 * bright specks at range reads as a STARFIELD, which is the one thing this
 * project has already lost a build to.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";
import { SUN_COL, SUN_DIR, mulberry32 } from "./constants";

/* COUNT IS THE ONLY KNOB THAT MAY MOVE HERE. Raised 150000 -> 190000 for a
   slightly heavier fall. Measured over four frames in the clear sky band above
   every crest (rows 40-330 at 1440x900): 382 -> 425 resolvable flakes, and the
   light they put into that band up 26%, which is the count increase exactly —
   the peak count lags it because flakes start landing on each other.
   The point SIZE must not move. A floor on gl_PointSize is what made this read
   as a starfield rather than as weather, and the far-flake kill in vA is the
   other half of the same fix; neither is a performance knob. */
const SNOW_N = 190000;
const SNOW_BOX = new THREE.Vector3(30, 12, 30);

export type SnowLayer = {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  /**
   * Narrow the column to the frame, keeping the fall exactly as dense.
   *
   * THE BOX IS 30 METRES WIDE BECAUSE THE FRAME IS. A flake is dead at 20 m
   * (`vA`'s smoothstep), and at 20 m the authored 1440x900 frame is 22.0 m
   * across — the box is that, and a third again for the wrap. On an iPhone SE
   * the same frame is 7.7 m across, so nineteen flakes in twenty were being
   * transformed, swayed, ray-tested and lit for a place two frame-widths
   * outside the picture.
   *
   * `k` is framing.ts's lateral scale, so the box tracks the frame's width and
   * keeps exactly the authored safety margin on every viewport. The count comes
   * down with it — density is count over volume, and both are multiplied by the
   * same k, so the number of flakes per cubic metre, their sizes, their speeds
   * and their phases are the authored ones. THE FALL IS NOT THINNED; the part
   * of the column nobody can see is not built.
   *
   * It is live rather than decided at mount because a phone can be turned on
   * its side: k goes back to 1, the box opens to its full 30 m and the whole
   * 190,000 are drawn again, with no seam and nothing rebuilt.
   */
  setSpan: (k: number) => void;
};

export function buildSnowfall(root: THREE.Group): SnowLayer {
  const geometry = new THREE.BufferGeometry();
  {
    const r = mulberry32(91);
    const p = new Float32Array(SNOW_N * 3);
    const q = new Float32Array(SNOW_N * 4);
    for (let i = 0; i < SNOW_N; i++) {
      p[i * 3] = (r() - 0.5) * SNOW_BOX.x;
      p[i * 3 + 1] = r() * SNOW_BOX.y;
      p[i * 3 + 2] = (r() - 0.5) * SNOW_BOX.z;
      q[i * 4] = 0.0032 + Math.pow(r(), 3.4) * 0.030;   // radius
      q[i * 4 + 1] = 0.42 + r() * 0.95;                  // fall speed
      q[i * 4 + 2] = r() * 6.2831;                       // sway phase
      q[i * 4 + 3] = 0.45 + r() * 0.55;                  // sway amplitude / brightness jitter
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(p, 3));
    geometry.setAttribute("aFlake", new THREE.BufferAttribute(q, 4));
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: SNOW_BOX.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: SUN_COL.clone() },
      uCool: { value: new THREE.Color(0.082, 0.104, 0.150) },
      uDpr: { value: 1 },
      uH: { value: 900 },
      uSpan: { value: 1 },
      uReveal: { value: 0 },
      uPO: { value: new THREE.Vector3() },
      uPD: { value: new THREE.Vector3(0, 0, -1) },
      uPtrK: { value: 0 },
      uGain: { value: 1.0 },
      uHot: { value: new THREE.Color(1.0, 0.80, 0.55) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aFlake;
      uniform float uTime, uDpr, uH, uSpan, uReveal, uPtrK;
      uniform vec3 uCam, uBox, uSunDir, uPO, uPD;
      varying float vLight; varying float vSoft; varying float vA; varying float vHot;
      void main(){
        // uSpan squeezes the scatter laterally in step with uBox.x, so the
        // flakes stay uniform inside whatever width the frame needs and the
        // density never moves. 1 on a wide window; see setSpan.
        vec3 p = vec3(position.x * uSpan, position.yz);
        p.y -= uTime * aFlake.y;
        p.x += sin(uTime * 0.38 + aFlake.z) * aFlake.w * 0.85 + uTime * 0.16;
        p.z += cos(uTime * 0.29 + aFlake.z * 1.7) * aFlake.w * 0.55;
        // ride with the camera, wrapped
        vec3 o = uCam - vec3(0.0, uBox.y * 0.42, 0.0);
        p = mod(p - o + uBox * 0.5, uBox) - uBox * 0.5 + o;
        // the cursor is a ray, and it pushes the air aside
        vec3 rel = p - uPO;
        float t = dot(rel, uPD);
        vec3 perp = rel - uPD * t;
        float pl = length(perp);
        // The cursor drags a wake through the falling snow, and the flakes it
        // passes through CATCH THE LIGHT — the same move igloo makes when its
        // marks burn white under the pointer. Both the displacement and the
        // flare are the response; the flare is what makes it visible.
        // The falloff is ANGULAR, not metric: a metre off the ray is the whole
        // screen at two metres' range and a pinprick at thirty, so a metric
        // radius lights the entire field instead of a disc under the cursor.
        float ang = pl / max(t, 0.35);
        float k = uPtrK * exp(-ang * ang / 0.012) * step(0.05, t) * smoothstep(34.0, 2.0, t);
        p += normalize(perp + vec3(1e-4)) * k * 0.085 * clamp(t, 0.5, 7.0);
        p.y += k * 0.16;
        vHot = clamp(k * 1.7, 0.0, 1.0);

        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = clamp(aFlake.x / dist * uH * 1.15 * uDpr, 0.9, 11.0) * (1.0 + vHot * 0.45);
        // forward scatter: a flake between us and the sun lights up
        // FORWARD scatter: a flake is lit when it stands between the lens and the
        // sun, so this is the sun's own bearing, not its opposite.
        vec3 vd = normalize(p - uCam);
        vLight = pow(max(0.0, dot(vd, normalize(uSunDir))), 2.6);
        vSoft = smoothstep(1.4, 5.0, dist);                 // near flakes go soft
        // Far flakes are killed, hard. A sparse scatter of bright specks at range
        // reads as a STARFIELD, which is the one thing this project has already
        // lost a build to; snow has to be a near-field weather event or nothing.
        vA = uReveal * smoothstep(20.0, 2.5, dist) * (0.060 + 0.215 * aFlake.w);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uCool, uHot; uniform float uGain;
      varying float vLight; varying float vSoft; varying float vA; varying float vHot;
      void main(){
        // Soft, gaussian, barely stretched along the fall. Hard-edged sprites at
        // this size are the difference between snowfall and a star chart.
        vec2 d = gl_PointCoord - 0.5;
        d = mat2(0.985, -0.174, 0.174, 0.985) * d;
        d.y *= 0.74;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float core = exp(-r2 * 13.0) - 0.038;
        float soft = mix(core, core * 0.34, 1.0 - vSoft);
        // Dim, and only really lit where it is between the lens and the sun. A
        // flake eight times brighter than the sky behind it is a star.
        vec3 c = mix(uCool, uCool * 1.35 + uSun * 0.20, vLight);
        c = mix(c, uHot * 0.95, vHot);
        gl_FragColor = vec4(c * uGain, soft * vA * (0.80 + 1.0 * vHot));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 20;
  points.frustumCulled = false;
  root.add(points);

  let span = 1;
  const setSpan = (k: number): void => {
    const s = Math.min(1, Math.max(0.08, k));
    if (Math.abs(s - span) < 1e-4) return;
    span = s;
    material.uniforms.uSpan.value = s;
    (material.uniforms.uBox.value as THREE.Vector3).x = SNOW_BOX.x * s;
    // A PREFIX, not a random draw: the scatter is uniform and independent per
    // index, so the first n of it is the same fall over the narrower box.
    geometry.setDrawRange(0, Math.max(1, Math.round(SNOW_N * s)));
  };
  return { points, geometry, material, setSpan };
}
