/**
 * THE TENNIS BALL — kept deliberately, and currently unused.
 *
 * This is the one object from the whole creative exploration the captain judged
 * good on its own: "almost the only thing that looks good". It is the reason the
 * home page's retriever is drawn as a point cloud at all, and it is kept here,
 * live in the tree rather than buried in git history, because the ball is the
 * Store's natural door and will most likely end up on the home page beside him.
 *
 * Nothing imports it yet. That is intentional; delete it only if the ball is
 * decided against, not because a dead-code sweep found it.
 *
 * The technique it encodes, which home/dog.ts also uses: even angular spread via
 * a Fibonacci sphere with jitter so the points never lattice, radius biased
 * outward so the mass sits in a shell rather than filling a volume, and a
 * deterministic seed so the cloud is identical on every reload. Draw it with
 * depthWrite ON and NormalBlending — additive blending is what turns a point
 * cloud into a nebula, which is a look this project has explicitly killed.
 */
const TAU = Math.PI * 2;
const GOLDEN = 0.6180339887498949;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BallCloud = {
  pos: Float32Array;
  rim: Float32Array;
  seam: Float32Array;
  n: number;
  radius: number;
};

/**
 * The real tennis-ball seam (Ferréol / mathcurve): an order-4 hypotrochoid in the
 * xy-plane plus a sinusoid in z. With a=0.75, b=a/3=0.25 it lies EXACTLY on the
 * unit sphere (x²+y²+z² = (a+b)² = 1) and matches a real ball. Returns m unit
 * points sampled along the curve.
 */
function seamCurve(m: number): Float32Array {
  const a = 0.75, b = 0.25, zc = 2 * Math.sqrt(a * b); // 0.8660…
  const pts = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) {
    const t = (i / m) * TAU;
    const x = a * Math.cos(t) + b * Math.cos(3 * t);
    const y = a * Math.sin(t) - b * Math.sin(3 * t);
    const z = zc * Math.sin(2 * t);
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    pts[i*3] = x * inv; pts[i*3+1] = y * inv; pts[i*3+2] = z * inv;
  }
  return pts;
}

export function sampleBall(n: number, radius = 1, shell = 0.12, seed = 1, seamWidth = 0.085): BallCloud {
  const rand = mulberry32(seed);
  const pos = new Float32Array(n * 3);
  const rim = new Float32Array(n);
  const seam = new Float32Array(n);
  const curve = seamCurve(256);
  const M = curve.length / 3;

  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const phi = Math.acos(1 - 2 * u);              // even in cos(phi)
    const theta = TAU * ((i * GOLDEN) % 1) + (rand() - 0.5) * 0.35;
    // Bias radius toward the surface: pow>1 pushes the mass outward into a shell.
    const shellT = Math.pow(rand(), 1.6);          // 0 at surface .. 1 at inner
    const rr = radius * (1 - shell * shellT);
    const sinP = Math.sin(phi);
    const nx = sinP * Math.cos(theta);             // unit-sphere direction
    const ny = Math.cos(phi);
    const nz = sinP * Math.sin(theta);
    pos[i * 3] = rr * nx;
    pos[i * 3 + 1] = rr * ny;
    pos[i * 3 + 2] = rr * nz;
    rim[i] = 1 - shellT;                            // 1 at surface, 0 at inner shell

    // proximity to the seam curve: nearest sampled point, as an angular distance.
    let best = -1;
    for (let j = 0; j < M; j++) {
      const dot = nx * curve[j*3] + ny * curve[j*3+1] + nz * curve[j*3+2];
      if (dot > best) best = dot;
    }
    const ang = Math.acos(Math.min(1, Math.max(-1, best)));
    seam[i] = 1 - Math.min(1, ang / seamWidth);    // 1 on the seam, 0 beyond seamWidth
  }
  return { pos, rim, seam, n, radius };
}
