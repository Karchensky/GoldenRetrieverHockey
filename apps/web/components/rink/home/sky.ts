/**
 * THE FAR SHORE — the sky.
 *
 * A 16km backside sphere that rides with the camera. The dawn wash is hottest
 * at the horizon and tight on the sun's own bearing; the sun itself is a halo,
 * a tighter halo and then a defined disc. High cloud keeps the upper sky from
 * ever being one flat field, which is what the flat-region metric punishes.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";
import { GLSL_NOISE, SKY_HOR, SKY_WARM, SKY_ZEN, SUN_COL, SUN_DIR } from "./constants";

export type SkyLayer = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
};

export function buildSky(root: THREE.Group): SkyLayer {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZen: { value: SKY_ZEN.clone() },
      uHor: { value: SKY_HOR.clone() },
      uWarm: { value: SKY_WARM.clone() },
      uSun: { value: SUN_COL.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uReveal: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: GLSL_NOISE + /* glsl */ `
      uniform vec3 uZen, uHor, uWarm, uSun, uSunDir;
      uniform float uReveal, uTime;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float el = d.y;
        vec3 c = mix(uHor, uZen, smoothstep(-0.02, 0.58, el));
        // the dawn wash: hottest at the horizon and tight on the sun's own bearing
        float az = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
        float band = exp(-max(0.0, el) * 19.0);
        c += uWarm * pow(az, 24.0) * band * (0.25 + 0.75 * uReveal);
        c += uWarm * 0.10 * pow(az, 5.0) * exp(-max(0.0, el) * 7.0) * uReveal;
        c += uWarm * 0.022 * pow(az, 1.4) * exp(-max(0.0, el) * 3.2) * uReveal;
        // high cloud, so the upper sky is never one flat field
        float cl = fbm(vec2(d.x, d.z) / max(0.10, el + 0.16) * 1.7 + vec2(uTime * 0.004, 0.0), 4);
        c += vec3(0.0030, 0.0040, 0.0062) * smoothstep(0.47, 0.63, cl) * smoothstep(0.02, 0.34, el);
        c -= vec3(0.0008, 0.0011, 0.0018) * smoothstep(0.47, 0.33, cl) * smoothstep(0.02, 0.30, el);
        // sun: halo, then a defined disc
        float ang = acos(clamp(dot(d, normalize(uSunDir)), -1.0, 1.0));
        c += uSun * 0.155 * exp(-ang * 13.0) * uReveal;
        c += uSun * 0.52 * exp(-ang * 62.0) * uReveal;
        c += vec3(1.0, 0.86, 0.68) * (1.0 - smoothstep(0.0098, 0.0126, ang)) * 3.0 * uReveal;
        c *= smoothstep(-0.075, 0.004, el);
        c += (h21(gl_FragCoord.xy * 0.7) - 0.5) * 0.0012;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(16000, 64, 40), material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  root.add(mesh);
  return { mesh, material };
}
