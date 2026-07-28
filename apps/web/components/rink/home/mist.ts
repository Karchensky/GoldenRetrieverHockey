/**
 * THE FAR SHORE — two standing bands of air.
 *
 * The far one lies along the shoreline and is what separates a near-black range
 * from a near-black lake; the near one is a thin veil of blown snow a couple of
 * hundred metres out. Without them the frame is three flat plates stacked on
 * each other.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";
import { GLSL_NOISE, SUN_AZ, SUN_COL, SUN_DIR } from "./constants";

type BandSpec = {
  radius: number;
  height: number;
  y: number;
  col: [number, number, number];
  gain: number;
  softTop: number;
  seed: number;
};

function mistBand({ radius, height, y, col, gain, softTop, seed }: BandSpec): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radius, radius, height, 128, 1, true, SUN_AZ - 1.35, 2.70);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uCol: { value: new THREE.Color(...col) },
      uSun: { value: SUN_COL.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uGain: { value: gain },
      uSoftTop: { value: softTop },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: GLSL_NOISE + /* glsl */ `
      uniform vec3 uCol, uSun, uSunDir; uniform float uGain, uSoftTop, uTime, uReveal, uSeed;
      varying vec3 vW; varying vec2 vUv;
      void main(){
        float body = smoothstep(1.0, uSoftTop, vUv.y) * smoothstep(0.0, 0.18, vUv.y);
        float n = fbm(vec2(vUv.x * 26.0 + uTime * 0.020 + uSeed, vUv.y * 3.2), 4);
        body *= 0.30 + 1.15 * smoothstep(0.40, 0.62, n);
        float az = max(0.0, dot(normalize(vec3(vW.x, 0.0, vW.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
        vec3 c = uCol + uSun * 0.14 * pow(az, 6.0);
        gl_FragColor = vec4(c * body * uGain * uReveal, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = y;
  mesh.frustumCulled = false;
  return mesh;
}

export type MistLayer = {
  bands: THREE.Mesh[];
  materials: THREE.ShaderMaterial[];
};

export function buildMist(root: THREE.Group): MistLayer {
  const mistFar = mistBand({ radius: 1330, height: 230, y: 96, col: [0.020, 0.028, 0.043], gain: 1.7, softTop: 0.36, seed: 0 });
  const mistMid = mistBand({ radius: 300, height: 16, y: 6.8, col: [0.011, 0.016, 0.026], gain: 1.5, softTop: 0.30, seed: 5 });
  mistFar.renderOrder = -6;
  mistMid.renderOrder = -5;
  root.add(mistFar);
  root.add(mistMid);
  const bands = [mistFar, mistMid];
  return { bands, materials: bands.map((b) => b.material as THREE.ShaderMaterial) };
}
