/**
 * AMBIENT RINK — the grade.
 *
 * The aerial world is a DAWN scene and it is bright: a pale blue pond filling
 * the middle of the frame under a lit snowfield, mean luminance around 100/255.
 * That is right for /aerial, where the scene is the page. It is wrong under a
 * statistics table twice over — a bright field behind small type is the
 * definition of unreadable, and the home page this has to belong to is
 * near-black.
 *
 * So the world is darkened to the home page's register before anything else
 * touches it. Two fullscreen quads drawn last, inside the same render pass:
 *
 *   1. a MULTIPLY veil — exposure down and a cold cast, with the vignette and
 *      an extra fall across the top baked into the same shader, because all of
 *      it is one spatially-varying multiplier and there is no reason to pay for
 *      it twice;
 *   2. an ADDITIVE floor — a whisper of blue lift and a STATIC dither.
 *
 * NO RENDER TARGET, deliberately. A grade in a separate pass would have to
 * resolve a colour-space split that only appears off-screen: three picks the
 * output encoding from the render target, and for an ordinary target that is
 * the linear working space (three.module.js, `outputColorSpace:` in the
 * program parameters). The world's own layers are raw ShaderMaterials writing
 * DISPLAY values straight to `gl_FragColor` with no `<colorspace_fragment>`,
 * while its ground, drifts, goals and benches are MeshBasicMaterials that do
 * get one — so off-screen those two halves would land in different encodings
 * and the ground would drop out from under the ice. Blending into the frame
 * the world already rendered correctly has no such split, costs one buffer and
 * one blit less, and needs no resize handling.
 *
 * The dither is static, not animated. Near-black gradients band on an 8-bit
 * buffer and banding is the one artifact a reader WILL catch behind a table;
 * animated noise would fix it and add exactly the shimmer this background
 * exists not to have.
 */
import * as THREE from "three";

export type AmbientGrade = {
  group: THREE.Group;
  /** 0..1. The world arrives instead of appearing. */
  setFade: (v: number) => void;
  setAspect: (a: number) => void;
  /** Live handles, for the dev-only tuning hook in AmbientRink. */
  uniforms: Record<string, THREE.IUniform>;
  dispose: () => void;
};

const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const VEIL_FRAG = /* glsl */`
  precision mediump float;
  uniform vec3 uTint;
  uniform float uVig, uTopFall, uFade, uAspect, uReach;
  varying vec2 vUv;
  void main(){
    // uAspect gives the vignette the SHAPE of the frame; uReach makes it arrive
    // at the corners. See setAspect for why the second one has to exist.
    vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0) * uReach;
    vec3 m = uTint * mix(1.0 - uVig, 1.0, smoothstep(0.98, 0.22, length(d)));
    // the masthead and the first lines of every page live across the top, and
    // the sky is the lightest thing in the frame
    m *= 1.0 - uTopFall * smoothstep(0.66, 1.0, vUv.y);
    gl_FragColor = vec4(mix(vec3(0.0), m, uFade), 1.0);
  }
`;

const FLOOR_FRAG = /* glsl */`
  precision mediump float;
  uniform vec3 uLift;
  uniform float uDither, uFade;
  varying vec2 vUv;
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 34.56); return fract(p.x * p.y); }
  void main(){
    float n = h21(gl_FragCoord.xy) - 0.5;
    gl_FragColor = vec4(max(uLift + n * uDither, 0.0) * uFade, 1.0);
  }
`;

/**
 * The numbers, tuned against real /seasons and /store captures rather than a
 * blank div. They take the frame from a mean of ~100/255 to ~21, against 13 for
 * the same page with no world behind it at all — so the world is worth about
 * eight levels of light, and everything else on the page is unchanged.
 */
/** Half-diagonal of the aspect this grade was tuned in. See setAspect. */
const FRAMED_CORNER = 0.5 * Math.hypot(1.6, 1);

export function createAmbientGrade(): AmbientGrade {
  const geometry = new THREE.PlaneGeometry(2, 2);

  const veilMat = new THREE.ShaderMaterial({
    uniforms: {
      // Per-channel exposure. Only a slight cool bias: the world is ALREADY
      // blue, and a hard blue multiplier takes the red out of the retriever
      // and the yellow out of the tennis ball, which is most of the brand.
      uTint: { value: new THREE.Color(0.300, 0.330, 0.400) },
      uVig: { value: 0.48 },
      uTopFall: { value: 0.22 },
      uAspect: { value: 1.6 },
      uReach: { value: 1 },
      uFade: { value: 0 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: VEIL_FRAG,
    blending: THREE.MultiplyBlending,
    // three refuses MultiplyBlending without this and falls back to writing the
    // multiplier straight into the frame — which paints the veil over the world
    // instead of through it, and looks exactly like a working dark background
    // until you notice the pond is gone.
    premultipliedAlpha: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });

  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uLift: { value: new THREE.Vector3(0.0022, 0.0042, 0.0090) },
      uDither: { value: 1.5 / 255 },
      uFade: { value: 0 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: FLOOR_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });

  const group = new THREE.Group();
  const veil = new THREE.Mesh(geometry, veilMat);
  veil.frustumCulled = false;
  veil.renderOrder = 9998;
  const floor = new THREE.Mesh(geometry, floorMat);
  floor.frustumCulled = false;
  floor.renderOrder = 9999;                        // after the multiply, never before
  group.add(veil, floor);

  return {
    group,
    setFade(v: number) {
      veilMat.uniforms.uFade!.value = v;
      floorMat.uniforms.uFade!.value = v;
    },
    setAspect(a: number) {
      veilMat.uniforms.uAspect!.value = a;
      // THE VIGNETTE WAS TUNED IN A 1.6 FRAME AND ONLY REACHES A 1.6 FRAME.
      // `(vUv-0.5)*vec2(aspect,1)` puts the corner at 0.5*hypot(aspect,1), and
      // the falloff is over 0.22..0.98 — so at 1.6 the corner lands at 0.943 and
      // takes the full 0.52 multiplier, while a phone in portrait at 0.46 puts
      // its own corner at 0.55 and takes 0.81. The frame the site was written to
      // darken at the edges does not darken at the edges on a phone, and it is
      // measurably brighter behind the type for it.
      //
      // So the falloff is rescaled to ARRIVE at whatever frame it is given.
      // Clamped at 1 in the widening direction on purpose: every desktop frame
      // this has ever shipped in is at or above the framed aspect, they are all
      // at or past full vignette already, and the one thing this must not do is
      // take darkness away from a page that is already approved.
      const corner = 0.5 * Math.hypot(a, 1);
      veilMat.uniforms.uReach!.value = Math.max(1, FRAMED_CORNER / corner);
    },
    uniforms: { ...veilMat.uniforms, ...floorMat.uniforms },
    dispose() { geometry.dispose(); veilMat.dispose(); floorMat.dispose(); },
  };
}
