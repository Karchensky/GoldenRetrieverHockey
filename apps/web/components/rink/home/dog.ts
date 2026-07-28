/**
 * THE FAR SHORE — the retriever, as a point cloud.
 *
 * Sampled off the real rigged mesh: area-weighted points on the posed
 * triangles, pulled inward on a pow(rand,1.6) shell so the mass has a near and
 * a far side. Baked AO and the baked face come along, so the cloud has eye and
 * nose accents and real occlusion in the armpits — the anatomy is the mesh's,
 * not a guess.
 *
 * Rendered in the tennis ball's technique: round sprites, NormalBlending,
 * depthWrite ON so near points occlude far ones and the mass reads solid rather
 * than as a nebula. The soft sprite fringe is DISCARDED rather than drawn,
 * because a barely-visible fringe still writes depth and carves dark veins
 * right through the mass.
 *
 * Ported verbatim from docs/openers/o-2.html; only the asset URLs change
 * (Next serves apps/web/public at the site root, and the Draco decoder is
 * copied into public/draco/ rather than read out of node_modules).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { DOG_H, DOG_YAW, SUN_COL, SUN_DIR, clamp01, mulberry32 } from "./constants";

type TexData = { d: Uint8ClampedArray; w: number; h: number };

async function imageData(url: string): Promise<TexData> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const w = bmp.width;
  const h = bmp.height; // read BEFORE close(): it zeroes them
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  bmp.close();
  return { d: d.data, w, h };
}

const sampleTex = (t: TexData, u: number, v: number): number => {
  const x = Math.min(t.w - 1, Math.max(0, Math.round(u * (t.w - 1))));
  const y = Math.min(t.h - 1, Math.max(0, Math.round((1 - v) * (t.h - 1))));
  const i = (y * t.w + x) * 4;
  return (t.d[i] + t.d[i + 1] + t.d[i + 2]) / 765;
};

export async function buildDogGeometry(n: number): Promise<THREE.BufferGeometry> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  try {
    const [gltf, ao, face] = await Promise.all([
      new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/retriever.glb"),
      imageData("/textures/retriever-ao.webp"),
      imageData("/textures/retriever-face.webp"),
    ]);
    let sk: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) sk = o as THREE.SkinnedMesh; });
    if (!sk) throw new Error("retriever.glb carries no skinned mesh");
    const mesh: THREE.SkinnedMesh = sk;
    gltf.scene.updateMatrixWorld(true);
    mesh.skeleton.update();

    const geo = mesh.geometry;
    const pa = geo.attributes.position as THREE.BufferAttribute;
    const ua = geo.attributes.uv as THREE.BufferAttribute;
    const V = pa.count;
    const tmp = new THREE.Vector3();
    const P = new Float32Array(V * 3);
    for (let i = 0; i < V; i++) {
      tmp.fromBufferAttribute(pa, i);
      mesh.applyBoneTransform(i, tmp);
      tmp.applyMatrix4(mesh.matrixWorld);
      P[i * 3] = tmp.x; P[i * 3 + 1] = tmp.y; P[i * 3 + 2] = tmp.z;
    }
    // canonical frame: feet on y=0, centred, scaled to DOG_H, then yawed
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < V; i++) {
      x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]);
      y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1]);
      z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]);
    }
    const s = DOG_H / (y1 - y0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const ca = Math.cos(DOG_YAW);
    const sa = Math.sin(DOG_YAW);
    for (let i = 0; i < V; i++) {
      const px = (P[i * 3] - cx) * s;
      const py = (P[i * 3 + 1] - y0) * s;
      const pz = (P[i * 3 + 2] - cz) * s;
      P[i * 3] = px * ca + pz * sa; P[i * 3 + 1] = py; P[i * 3 + 2] = -px * sa + pz * ca;
    }

    const index = geo.index;
    if (!index) throw new Error("retriever.glb geometry is not indexed");
    const idx = index.array;
    const T = idx.length / 3;
    const area = new Float32Array(T);
    const vn = new Float32Array(V * 3);
    let total = 0;
    for (let t = 0; t < T; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
      const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area[t] = Math.hypot(nx, ny, nz) * 0.5; total += area[t];
      vn[a * 3] += nx; vn[a * 3 + 1] += ny; vn[a * 3 + 2] += nz;
      vn[b * 3] += nx; vn[b * 3 + 1] += ny; vn[b * 3 + 2] += nz;
      vn[c * 3] += nx; vn[c * 3 + 1] += ny; vn[c * 3 + 2] += nz;
    }
    for (let i = 0; i < V; i++) {
      const l = Math.hypot(vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]) || 1;
      vn[i * 3] /= l; vn[i * 3 + 1] /= l; vn[i * 3 + 2] /= l;
    }
    const cum = new Float64Array(T);
    { let a = 0; for (let t = 0; t < T; t++) { a += area[t]; cum[t] = a; } }
    const pick = (u: number): number => {
      let lo = 0, hi = T - 1;
      const x = u * total;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
      return lo;
    };

    const rnd = mulberry32(1337);
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const att = new Float32Array(n * 4);       // rim, ao, dark, cream
    const sct = new Float32Array(n * 4);       // scatter offset xyz, delay
    const shellDepth = DOG_H * 0.052;
    for (let i = 0; i < n; i++) {
      const t = pick(rnd());
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      let px = P[a * 3] * w + P[b * 3] * u + P[c * 3] * v;
      let py = P[a * 3 + 1] * w + P[b * 3 + 1] * u + P[c * 3 + 1] * v;
      let pz = P[a * 3 + 2] * w + P[b * 3 + 2] * u + P[c * 3 + 2] * v;
      let nx = vn[a * 3] * w + vn[b * 3] * u + vn[c * 3] * v;
      let ny = vn[a * 3 + 1] * w + vn[b * 3 + 1] * u + vn[c * 3 + 1] * v;
      let nz = vn[a * 3 + 2] * w + vn[b * 3 + 2] * u + vn[c * 3 + 2] * v;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const shellT = Math.pow(rnd(), 1.6);
      const depth = shellT * shellDepth;
      px -= nx * depth; py -= ny * depth; pz -= nz * depth;
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
      nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
      const tu = ua.getX(a) * w + ua.getX(b) * u + ua.getX(c) * v;
      const tv = ua.getY(a) * w + ua.getY(b) * u + ua.getY(c) * v;
      const aoV = sampleTex(ao, tu, tv);
      const faceV = sampleTex(face, tu, tv);
      att[i * 4] = 1 - shellT;                                 // rim: 1 at the coat's surface
      att[i * 4 + 1] = 0.30 + 0.70 * Math.pow(aoV, 0.85);      // baked occlusion
      // The face bake carries a dozen dark blobs scattered across the atlas, only
      // one cluster of which is the face; taking all of them speckled the coat.
      const onFace = tu > 0.44 && tu < 0.76 && tv > 0.28 && tv < 0.44;
      att[i * 4 + 2] = onFace ? clamp01(1 - faceV * 1.30) : 0; // eyes + nose, from the bake
      // The cream front — chest, throat, belly, the feathering behind the legs.
      // A golden's light is on the underside and the deep honey is over the back,
      // which is what makes the breed read at a hundred metres.
      const under = clamp01((0.60 - py / DOG_H) * 2.1);
      att[i * 4 + 3] = clamp01(under * (0.45 - 0.55 * ny) * 1.35);
      const dx = rnd() - 0.5, dy = rnd() - 0.5, dz = rnd() - 0.5;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const spread = 0.55 + rnd() * 1.65;
      sct[i * 4] = (dx / dl) * spread;
      sct[i * 4 + 1] = (dy / dl) * spread * 0.7 + 0.45;
      sct[i * 4 + 2] = (dz / dl) * spread;
      sct[i * 4 + 3] = rnd() * 0.55;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aNrm", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("aAtt", new THREE.BufferAttribute(att, 4));
    g.setAttribute("aSct", new THREE.BufferAttribute(sct, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, DOG_H * 0.5, 0), DOG_H * 2.2);
    return g;
  } finally {
    draco.dispose();
  }
}

const DOG_VERT = /* glsl */ `
  attribute vec3 aNrm; attribute vec4 aAtt; attribute vec4 aSct;
  uniform float uTime, uDpr, uH, uSize, uReveal, uPtrK, uMirror;
  uniform vec3 uPOa, uPDa, uPOb, uPDb;
  varying vec3 vN; varying vec4 vA; varying vec3 vW; varying float vHeat; varying float vForm;
  void main(){
    vec3 home = position;
    // idle: a coherent flow field, so the coat ROLLS instead of fizzing
    float w = uTime * 0.17;
    vec3 fl = vec3(
      sin(home.y * 5.1 + w) + 0.5 * sin(home.z * 9.7 - w * 1.7),
      cos(home.z * 5.6 + w * 0.8) + 0.5 * cos(home.x * 8.9 + w * 1.4),
      sin(home.x * 4.9 - w * 0.9) + 0.5 * cos(home.y * 9.2 + w));
    vec3 p = home + fl * 0.0042 * (0.45 + 0.55 * aAtt.x);
    p.y += sin(uTime * 0.55 + home.z * 2.0) * 0.0022;              // breath

    // the cursor is a ray. Two smoothed copies, one fast one slow, blended per
    // particle: the cloud parts at once and drifts home at its own rates.
    float lag = fract(aSct.w * 7.31);
    vec3 PO = mix(uPOa, uPOb, lag), PD = normalize(mix(uPDa, uPDb, lag));
    vec3 rel = p - PO;
    float t = dot(rel, PD);
    vec3 perp = rel - PD * t;
    float pl = length(perp);
    float push = uPtrK * exp(-pl * pl / 1.30) * step(0.0, t);
    p += normalize(perp + vec3(1e-5)) * push * 0.105 * (0.30 + 0.70 * aAtt.x);
    vHeat = clamp(push * 0.85, 0.0, 1.0);

    // materialisation
    float form = clamp((uReveal - aSct.w) / 0.42, 0.0, 1.0);
    form = form * form * (3.0 - 2.0 * form);
    vForm = form;
    p = mix(p + aSct.xyz, p, form);

    vec4 wp = modelMatrix * vec4(p, 1.0);
    if (uMirror > 0.5) wp.y = -wp.y;
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * aNrm) * (uMirror > 0.5 ? vec3(1.0, -1.0, 1.0) : vec3(1.0));
    vA = aAtt;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(0.8, uSize / max(0.4, -mv.z) * uH * uDpr * (0.42 + 0.58 * form) * (1.0 + vHeat * 0.5));
  }
`;

const DOG_FRAG = /* glsl */ `
  uniform vec3 uSunDir, uSun, uSky, uCoat, uCream, uCam;
  uniform float uGain, uMirror, uReveal;
  varying vec3 vN; varying vec4 vA; varying vec3 vW; varying float vHeat; varying float vForm;
  void main(){
    if (vForm < 0.02) discard;
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    // A flat-cored sprite. A soft gaussian leaves the mass full of pinholes at
    // any density that still reads as points rather than as paint.
    float soft = smoothstep(0.25, 0.080, r2);
    // The soft fringe still WRITES DEPTH, so a barely-visible sprite edge
    // depth-rejects the solid sprites behind it and carves dark veins right
    // through the mass. Discard the fringe instead of drawing it.
    if (soft < 0.34) discard;
    vec3 N = normalize(vN);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(uCam - vW);
    // A backlit animal: the sun is beyond him, so the coat is mostly skylight,
    // and the read comes from the gold that wraps his edge.
    float lam = max(0.0, dot(N, L));
    float wrap = max(0.0, dot(N, L) * 0.5 + 0.5);
    float rim = pow(1.0 - abs(dot(N, V)), 2.1);
    float back = pow(max(0.0, dot(-V, L)), 1.6);
    vec3 coat = mix(uCoat, uCream, vA.w * 0.75);
    vec3 c = coat * (uSky * (0.30 + 0.70 * wrap) + uSun * lam * 0.34);
    c += uSun * rim * (0.42 + 0.95 * back) * 0.92 * mix(0.45, 1.0, vA.x);
    c += coat * uSun * 0.20 * back;                       // translucency through the coat
    c *= mix(0.55, 1.0, vA.y);                            // baked occlusion
    c = mix(c, c * 0.13, vA.z);                           // eye and nose
    c = mix(c, vec3(1.0, 0.82, 0.58) * 0.85, vHeat * 0.30);
    // the reflection: dimmer, and it dies away within a metre of the contact
    float mFade = uMirror > 0.5 ? exp(vW.y * 2.6) : 1.0;
    if (uMirror > 0.5) c *= vec3(0.50, 0.47, 0.52);
    gl_FragColor = vec4(c * uGain, soft * (0.72 + 0.28 * vA.x) * vForm * (uMirror > 0.5 ? 0.26 * mFade : 1.0));
  }
`;

export function dogMaterial(over?: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uDpr: { value: 1 }, uH: { value: 900 }, uSize: { value: 0.0245 },
      uReveal: { value: 0 }, uPtrK: { value: 0 }, uMirror: { value: 0 },
      uPOa: { value: new THREE.Vector3(0, -99, 0) }, uPDa: { value: new THREE.Vector3(0, 0, -1) },
      uPOb: { value: new THREE.Vector3(0, -99, 0) }, uPDb: { value: new THREE.Vector3(0, 0, -1) },
      uSunDir: { value: SUN_DIR.clone() }, uSun: { value: SUN_COL.clone() },
      uSky: { value: new THREE.Color(0.185, 0.235, 0.335) },
      uCoat: { value: new THREE.Color(0.86, 0.505, 0.185) },
      uCream: { value: new THREE.Color(0.97, 0.80, 0.545) },
      uCam: { value: new THREE.Vector3() }, uGain: { value: 1.0 },
      ...over,
    },
    vertexShader: DOG_VERT,
    fragmentShader: DOG_FRAG,
    transparent: true,
    depthTest: true,
    blending: THREE.NormalBlending,
  });
}
