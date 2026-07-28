/**
 * THE FAR SHORE — three ranges of mountains.
 *
 * Three annular heightfields. Ridged multifractal for sharp crests, an envelope
 * in radius so peaks stagger in depth instead of forming one wall, and a col
 * carved on the sun's bearing in the near range for the light to come through.
 * Normals are computed here, on the CPU, once.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";
import { GLSL_NOISE, HAZE, SUN_AZ, SUN_COL, SUN_DIR, clamp01, ridged, vnoise } from "./constants";

/** Lifts the whole land clear of the ice plane; see the note in buildRange. */
const BASE_Y = 1.45;

/** The outermost ring of every range dives this far BELOW the ice plane, over
 *  this fraction of the radial run. See THE SEAM in buildRange — it is what
 *  closes the flashing gold hairline along the horizon. */
const SKIRT_Y = 90;
const SKIRT_U = 0.06;

type RangeSpec = {
  rIn: number;
  rOut: number;
  peak: number;
  hMax: number;
  freqA: number;
  freqR: number;
  seed: number;
  colGap: number;
  colDepth: number;
  shore?: number;
};

function buildRange({
  rIn, rOut, peak, hMax, freqA, freqR, seed, colGap, colDepth, shore = 0,
}: RangeSpec): THREE.BufferGeometry {
  const AN = 620;
  const RN = 34;
  const SEC = (150 * Math.PI) / 180; // only the visible sector is built
  const verts = (AN + 1) * (RN + 1);
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const ext = new Float32Array(verts * 2); // (height fraction, radial u)
  const hgt = new Float32Array(verts);
  const idx = new Uint32Array(AN * RN * 6);
  const H = (a: number, u: number): number => {
    const r = rIn + (rOut - rIn) * u;
    const env =
      Math.pow(Math.sin(Math.PI * clamp01((r - rIn) / (rOut - rIn))), 1.25) *
      Math.exp(-Math.pow((r - peak) / (0.62 * (rOut - rIn)), 2));
    let k = ridged(a * freqA + seed * 7.3, u * freqR + seed * 3.1, 5);
    k = Math.pow(clamp01(k * 1.18 - 0.06), 1.35);
    // the col: a smooth notch on the sun's bearing, so the light has a way out
    if (colDepth > 0) {
      let da = a - SUN_AZ;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      k *= 1 - colDepth * Math.exp(-Math.pow(da / colGap, 2));
    }
    // The far shore: a low wind-piled bank right at the waterline. Without it
    // the ice's own outer edge draws a hard bright hairline across the frame.
    const bank =
      shore * (0.55 + 0.45 * vnoise(a * 9.0 + seed, 4.2)) *
      Math.exp(-Math.pow((r - rIn - 44) / 130, 2));
    // BASE_Y lifts the whole land clear of the ice plane. Without it the two
    // surfaces meet at y=0 across a kilometre of shoreline and z-fight into a
    // dashed white rule along the horizon.
    //
    // ---- THE SEAM, and why the land finishes UNDER the ice ----------------
    //
    // That same lift is what opened the flashing gold hairline along the
    // horizon, and it is NOT z-fighting: a flat disc of radius R has its far
    // edge at elevation -eye/R, always below the horizon, while a range whose
    // outer ring sits at BASE_Y has its edge at (BASE_Y - eye)/rOut — for
    // BASE_Y < eye a SMALLER negative number, i.e. HIGHER on screen. So the
    // land's lower edge finishes above the ice's far edge whatever the disc's
    // radius, and the horizon sky shows between them.
    //
    // MEASURED at 1440x900, eye 1.62m: the near range's outer ring (r=5400,
    // y=BASE_Y) lands at -3.15e-5 rad and the 18km disc's edge at -9.0e-5 rad.
    // The gap is 0.077 of ONE PIXEL, and it runs the full width of the frame.
    // The idle drift walks the horizon across pixel centres, so about one frame
    // in thirteen samples that sliver on a row and the frame gets a hard rule
    // of the sun's own colour — 229,194,137 on the sun's bearing, against
    // neighbours at 20. That is the flash. A longer disc cannot close it: the
    // ice would have to run past 51km, well beyond CAM_FAR.
    //
    // So the outer ring dives under the ice instead. The land's visible lower
    // edge becomes the curve where the terrain crosses y=0, which is BY
    // CONSTRUCTION a point ON the ice plane and therefore covered by the disc
    // (every range ends inside 14.5km, the disc runs to 18km). There is no
    // number to keep in sync with the disc, the eye height or BASE_Y, and it is
    // what a real far shore does anyway — the ground goes under the water. The
    // crossing is steep, ~0.25 of a metre of fall per metre of radius against a
    // depth gradient of some 3.8km per pixel, so the two surfaces are within a
    // depth quantum of each other over about a thousandth of a pixel.
    const dive = clamp01((u - (1 - SKIRT_U)) / SKIRT_U);
    return hMax * env * k + bank + BASE_Y - SKIRT_Y * dive * dive * dive;
  };
  let p = 0;
  for (let j = 0; j <= RN; j++) {
    const u = j / RN;
    const r = rIn + (rOut - rIn) * u;
    for (let i = 0; i <= AN; i++, p++) {
      const a = SUN_AZ + (i / AN - 0.5) * SEC;
      const y = H(a, u);
      pos[p * 3] = Math.sin(a) * r;
      pos[p * 3 + 1] = y;
      pos[p * 3 + 2] = -Math.cos(a) * r;
      ext[p * 2] = (y - BASE_Y) / hMax;
      ext[p * 2 + 1] = u;
      hgt[p] = y;
    }
  }
  // Normals from central differences over the height grid we just built.
  // Calling H() four more times per vertex cost a full second of synchronous
  // work at page load, which is a second of black screen on a page whose
  // opening move is a materialisation.
  p = 0;
  const da = SEC / AN;
  const du = 1 / RN;
  const at = (i: number, j: number): number =>
    hgt[Math.min(RN, Math.max(0, j)) * (AN + 1) + Math.min(AN, Math.max(0, i))];
  for (let j = 0; j <= RN; j++) {
    const u = j / RN;
    for (let i = 0; i <= AN; i++, p++) {
      const a = SUN_AZ + (i / AN - 0.5) * SEC;
      const r = rIn + (rOut - rIn) * u;
      const hA = (at(i + 1, j) - at(i - 1, j)) / (2 * da * r); // d(height)/d(arc)
      const hR = (at(i, j + 1) - at(i, j - 1)) / (2 * du * (rOut - rIn));
      // tangent frame: eA along +angle, eR outward
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const eRx = sa;
      const eRz = -ca;
      const eAx = ca;
      const eAz = sa;
      const nx = -(hR * eRx + hA * eAx);
      const ny = 1;
      const nz = -(hR * eRz + hA * eAz);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[p * 3] = nx / l;
      nrm[p * 3 + 1] = ny / l;
      nrm[p * 3 + 2] = nz / l;
    }
  }
  let q = 0;
  for (let j = 0; j < RN; j++) {
    for (let i = 0; i < AN; i++) {
      const a0 = j * (AN + 1) + i;
      const b0 = a0 + 1;
      const c0 = a0 + (AN + 1);
      const d0 = c0 + 1;
      idx[q++] = a0; idx[q++] = c0; idx[q++] = b0;
      idx[q++] = b0; idx[q++] = c0; idx[q++] = d0;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("aExt", new THREE.BufferAttribute(ext, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

type MtnOpts = {
  rock: [number, number, number];
  snow: [number, number, number];
  hazeK: number;
  hazeMax: number;
  snowLine: number;
  delay: number;
};

const mtnMat = (opts: MtnOpts): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: SUN_COL.clone() },
      uHaze: { value: HAZE.clone() },
      uRock: { value: new THREE.Color(...opts.rock) },
      uSnow: { value: new THREE.Color(...opts.snow) },
      uHazeK: { value: opts.hazeK },
      uHazeMax: { value: opts.hazeMax },
      uSnowLine: { value: opts.snowLine },
      uReveal: { value: 0 },
      uDelay: { value: opts.delay },
      uCam: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aExt;
      varying vec3 vN; varying vec3 vW; varying vec2 vE;
      void main(){
        vE = aExt; vN = normal;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: GLSL_NOISE + /* glsl */ `
      uniform vec3 uSunDir, uSun, uHaze, uRock, uSnow, uCam;
      uniform float uHazeK, uHazeMax, uSnowLine, uReveal, uDelay;
      varying vec3 vN; varying vec3 vW; varying vec2 vE;
      void main(){
        vec3 N = normalize(vN);
        vec3 L = normalize(uSunDir);
        float dist = length(vW - uCam);
        // relief: the silhouette is near-black, so the interior needs its own grain
        float g = fbm(vW.xz * 0.0042, 4);
        float g2 = fbm(vW.xz * 0.021 + 11.0, 3);
        // snow holds on the shallow, high ground
        float snowM = smoothstep(uSnowLine, uSnowLine + 0.30, vE.x) * smoothstep(0.42, 0.86, N.y);
        snowM *= 0.55 + 0.45 * smoothstep(0.44, 0.60, g);
        vec3 base = mix(uRock, uSnow, snowM);
        base *= 0.80 + 0.40 * g2;
        // sky fill only — the sun is behind the range, so the faces we see are shadowed
        float sky = 0.32 + 0.68 * clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = base * sky;
        // ...except the crest, where the light comes over the top as a hairline
        float az = max(0.0, dot(normalize(vec3(N.x, 0.0, N.z)), normalize(vec3(L.x, 0.0, L.z))));
        float crest = smoothstep(0.55, 0.99, vE.x) * pow(az, 1.6) * smoothstep(0.10, 0.70, N.y);
        c += uSun * crest * 0.135 * (0.42 + 0.58 * snowM);
        // aerial perspective, warmer on the sun's bearing
        vec3 V = normalize(vW - uCam);
        float vaz = max(0.0, dot(normalize(vec3(V.x, 0.0, V.z)), normalize(vec3(L.x, 0.0, L.z))));
        vec3 haze = uHaze + uSun * 0.052 * pow(vaz, 5.0);
        float f = min(uHazeMax, 1.0 - exp(-dist * uHazeK));
        c = mix(c, haze, f);
        float rv = clamp((uReveal - uDelay) / max(0.001, 1.0 - uDelay), 0.0, 1.0);
        c *= rv * rv;
        c += (h21(gl_FragCoord.xy * 0.7 + 3.1) - 0.5) * 0.0022;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }
    `,
  });

export type MountainLayer = {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  geometries: THREE.BufferGeometry[];
};

export function buildMountains(root: THREE.Group): MountainLayer {
  const ranges = [
    {
      g: buildRange({ rIn: 1180, rOut: 5400, peak: 2900, hMax: 560, freqA: 3.4, freqR: 2.1, seed: 3, colGap: 0.10, colDepth: 0.70, shore: 13 }),
      m: mtnMat({ rock: [0.0020, 0.0029, 0.0046], snow: [0.0072, 0.0096, 0.0140], hazeK: 0.000045, hazeMax: 0.45, snowLine: 0.30, delay: 0.00 }),
    },
    {
      g: buildRange({ rIn: 3700, rOut: 8600, peak: 5700, hMax: 1010, freqA: 2.6, freqR: 1.7, seed: 11, colGap: 0.13, colDepth: 0.34 }),
      m: mtnMat({ rock: [0.0038, 0.0052, 0.0078], snow: [0.0132, 0.0168, 0.0232], hazeK: 0.000060, hazeMax: 0.72, snowLine: 0.26, delay: 0.18 }),
    },
    {
      g: buildRange({ rIn: 7000, rOut: 14500, peak: 10000, hMax: 1620, freqA: 2.0, freqR: 1.3, seed: 23, colGap: 0.17, colDepth: 0.18 }),
      m: mtnMat({ rock: [0.0068, 0.0090, 0.0125], snow: [0.0200, 0.0245, 0.0330], hazeK: 0.000058, hazeMax: 0.90, snowLine: 0.22, delay: 0.34 }),
    },
  ];
  const group = new THREE.Group();
  ranges.forEach((r, i) => {
    const m = new THREE.Mesh(r.g, r.m);
    m.renderOrder = -50 + i;
    m.frustumCulled = false;
    group.add(m);
  });
  root.add(group);
  return { group, materials: ranges.map((r) => r.m), geometries: ranges.map((r) => r.g) };
}
