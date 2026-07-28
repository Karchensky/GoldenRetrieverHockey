/**
 * THE FAR SHORE — the breath.
 *
 * Where the cursor passes, the air itself takes the dawn: a soft warm eddy with
 * the lit snow turning inside it. It is the one thing on this page that answers
 * you, and it is deliberately slow — it lags the pointer and dies away rather
 * than tracking it like a reticle.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";
import { GLSL_NOISE } from "./constants";

export type BreathLayer = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
};

export function buildBreath(root: THREE.Group): BreathLayer {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCol: { value: new THREE.Color(0.470, 0.520, 0.640) },
      uK: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + /* glsl */ `
      uniform vec3 uCol; uniform float uK, uTime; varying vec2 vU;
      void main(){
        vec2 d = (vU - 0.5) * 2.0;
        float r = length(d);
        float a = exp(-r * r * 3.1) - 0.042;
        if (a <= 0.0 || uK <= 0.001) discard;
        // curdled, not a clean lens flare
        a *= 0.18 + 1.85 * fbm(d * 3.4 + vec2(uTime * 0.075, uTime * 0.042), 5);
        a *= 0.55 + 0.75 * fbm(d * 9.0 - vec2(uTime * 0.05, 0.0), 3);
        gl_FragColor = vec4(uCol * a * uK, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.scale.setScalar(2.6);
  mesh.renderOrder = 18;
  mesh.frustumCulled = false;
  root.add(mesh);
  return { mesh, material };
}
