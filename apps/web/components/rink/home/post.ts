/**
 * THE FAR SHORE — the composite.
 *
 * Its own post chain: a two-scale bloom, one filmic curve, a vignette, grain
 * and an ordered dither. The renderer is NoToneMapping and LinearSRGB precisely
 * so the curve is applied exactly ONCE, here. Mapping twice lifts the blacks to
 * grey and costs the near-black background this page is built on — the trap is
 * recorded in docs/opener/SHARED-KNOWLEDGE.md and it has been paid for already.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";

const rtOpts: THREE.RenderTargetOptions = {
  type: THREE.HalfFloatType,
  colorSpace: THREE.LinearSRGBColorSpace,
  depthBuffer: true,
  stencilBuffer: false,
};

export type PostChain = {
  /** Drawing-buffer pixels. Cheap no-op when the size has not changed. */
  setSize: (w: number, h: number) => void;
  /** Full-frame height in drawing-buffer pixels, for the point-size uniforms. */
  height: number;
  render: (
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    t: number,
    reveal: number,
  ) => void;
  dispose: () => void;
};

export function createPostChain(): PostChain {
  let sceneRT: THREE.WebGLRenderTarget | null = null;
  let brightRT: THREE.WebGLRenderTarget | null = null;
  let blurA: THREE.WebGLRenderTarget | null = null;
  let blurB: THREE.WebGLRenderTarget | null = null;
  let blur2A: THREE.WebGLRenderTarget | null = null;
  let blur2B: THREE.WebGLRenderTarget | null = null;

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const fallbackMat = new THREE.MeshBasicMaterial();
  const quadMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(quadGeo, fallbackMat);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  function blit(gl: THREE.WebGLRenderer, mat: THREE.Material, target: THREE.WebGLRenderTarget) {
    quadMesh.material = mat;
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(quadScene, quadCam);
  }

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tS: { value: null }, uThr: { value: 0.42 }, uSoft: { value: 0.30 } },
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tS; uniform float uThr, uSoft; varying vec2 vU;
      void main(){
        vec3 c = texture2D(tS, vU).rgb;
        float l = max(c.r, max(c.g, c.b));
        float k = smoothstep(uThr, uThr + uSoft, l);
        gl_FragColor = vec4(c * k, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tS: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tS; uniform vec2 uDir, uTexel; varying vec2 vU;
      void main(){
        vec2 o = uDir * uTexel;
        vec3 c = texture2D(tS, vU).rgb * 0.2270270270;
        c += (texture2D(tS, vU + o * 1.3846153846).rgb + texture2D(tS, vU - o * 1.3846153846).rgb) * 0.3162162162;
        c += (texture2D(tS, vU + o * 3.2307692308).rgb + texture2D(tS, vU - o * 3.2307692308).rgb) * 0.0702702703;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const downMat = new THREE.ShaderMaterial({
    uniforms: { tS: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tS; uniform vec2 uTexel; varying vec2 vU;
      void main(){
        vec3 c = texture2D(tS, vU + uTexel * vec2(-1.0, -1.0)).rgb;
        c += texture2D(tS, vU + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture2D(tS, vU + uTexel * vec2(-1.0, 1.0)).rgb;
        c += texture2D(tS, vU + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c * 0.25, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tS: { value: null }, tB1: { value: null }, tB2: { value: null },
      uBloom: { value: 0.62 }, uExp: { value: 1.24 }, uTime: { value: 0 },
      uGrain: { value: 0.0260 }, uVig: { value: 0.34 }, uRes: { value: new THREE.Vector2() },
      uReveal: { value: 0 },
    },
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tS, tB1, tB2;
      uniform float uBloom, uExp, uTime, uGrain, uVig, uReveal;
      uniform vec2 uRes;
      varying vec2 vU;
      float h3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      vec3 aces(vec3 x){
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      void main(){
        vec3 c = texture2D(tS, vU).rgb;
        c += (texture2D(tB1, vU).rgb * 0.72 + texture2D(tB2, vU).rgb * 1.05) * uBloom;
        c *= uExp;
        c = aces(c);
        vec2 q = vU - 0.5;
        c *= 1.0 - uVig * dot(q, q) * 1.85;
        c = pow(max(c, 0.0), vec3(1.0 / 2.2));
        // grain, and an ordered dither so smooth fields never band into one flat plate
        float g = h3(vec3(gl_FragCoord.xy, floor(uTime * 24.0)));
        c += (g - 0.5) * uGrain;
        float dith = h3(vec3(gl_FragCoord.xy * 1.7, 11.0)) - 0.5;
        c += dith * (1.4 / 255.0);
        c *= smoothstep(0.0, 0.16, uReveal);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  let sizeW = 0;
  let sizeH = 0;

  const chain: PostChain = {
    height: 900,
    setSize(w, h) {
      const W = Math.max(2, Math.floor(w));
      const H = Math.max(2, Math.floor(h));
      if (W === sizeW && H === sizeH) return;
      sizeW = W; sizeH = H;
      const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
      const qw = Math.max(2, W >> 2), qh = Math.max(2, H >> 2);
      [sceneRT, brightRT, blurA, blurB, blur2A, blur2B].forEach((t) => t && t.dispose());
      sceneRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
      sceneRT.depthTexture = null;
      brightRT = new THREE.WebGLRenderTarget(hw, hh, { ...rtOpts, depthBuffer: false });
      blurA = new THREE.WebGLRenderTarget(hw, hh, { ...rtOpts, depthBuffer: false });
      blurB = new THREE.WebGLRenderTarget(hw, hh, { ...rtOpts, depthBuffer: false });
      blur2A = new THREE.WebGLRenderTarget(qw, qh, { ...rtOpts, depthBuffer: false });
      blur2B = new THREE.WebGLRenderTarget(qw, qh, { ...rtOpts, depthBuffer: false });
      for (const t of [sceneRT, brightRT, blurA, blurB, blur2A, blur2B]) {
        t.texture.minFilter = THREE.LinearFilter;
        t.texture.magFilter = THREE.LinearFilter;
        t.texture.generateMipmaps = false;
      }
      (compMat.uniforms.uRes.value as THREE.Vector2).set(W, H);
      chain.height = H;
    },
    render(gl, scene, camera, t, reveal) {
      if (!sceneRT || !brightRT || !blurA || !blurB || !blur2A || !blur2B) return;
      gl.setRenderTarget(sceneRT);
      gl.clear();
      gl.render(scene, camera);

      brightMat.uniforms.tS.value = sceneRT.texture;
      blit(gl, brightMat, brightRT);
      (blurMat.uniforms.uTexel.value as THREE.Vector2).set(1 / brightRT.width, 1 / brightRT.height);
      blurMat.uniforms.tS.value = brightRT.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(1, 0);
      blit(gl, blurMat, blurA);
      blurMat.uniforms.tS.value = blurA.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 1);
      blit(gl, blurMat, blurB);
      downMat.uniforms.tS.value = blurB.texture;
      (downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / blurB.width, 1 / blurB.height);
      blit(gl, downMat, blur2A);
      (blurMat.uniforms.uTexel.value as THREE.Vector2).set(1 / blur2A.width, 1 / blur2A.height);
      blurMat.uniforms.tS.value = blur2A.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(1, 0);
      blit(gl, blurMat, blur2B);
      blurMat.uniforms.tS.value = blur2B.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 1);
      blit(gl, blurMat, blur2A);

      compMat.uniforms.tS.value = sceneRT.texture;
      compMat.uniforms.tB1.value = blurB.texture;
      compMat.uniforms.tB2.value = blur2A.texture;
      compMat.uniforms.uTime.value = t;
      compMat.uniforms.uReveal.value = reveal;
      quadMesh.material = compMat;
      gl.setRenderTarget(null);
      gl.render(quadScene, quadCam);
    },
    dispose() {
      [sceneRT, brightRT, blurA, blurB, blur2A, blur2B].forEach((t) => t && t.dispose());
      sceneRT = brightRT = blurA = blurB = blur2A = blur2B = null;
      quadGeo.dispose();
      fallbackMat.dispose();
      brightMat.dispose();
      blurMat.dispose();
      downMat.dispose();
      compMat.dispose();
    },
  };
  return chain;
}
