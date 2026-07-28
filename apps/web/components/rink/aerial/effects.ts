/**
 * AERIAL OPEN — small shared effects: faint motion wakes (the cuts carry the
 * story now), contact-ring pops, and the snow-spray puff pool used by hockey
 * stops and the dog's skid. Ported verbatim from
 * docs/aerial-tournament/final.html.
 */
import * as THREE from "three";
import { rand } from "./math";
import { spr, type SpriteKit } from "./sprites";

// ---- subtle wakes (kept faint) ---------------------------------------------
export type Trail = {
  n: number;
  pos: Float32Array;
  col: Float32Array;
  intn: Float32Array;
  geom: THREE.BufferGeometry;
  points: THREE.Points;
  push: (x: number, y: number, z: number, intensity: number) => void;
  update: (vis: number) => void;
};

export function makeTrail(parent: THREE.Object3D, texSoft: THREE.Texture, n: number, size: number, baseCol: readonly number[]): Trail {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), intn = new Float32Array(n);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4000);
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size, map: texSoft, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  pts.frustumCulled = false;
  parent.add(pts);
  return {
    n, pos, col, intn, geom: g, points: pts,
    push(x, y, z, intensity) {
      for (let i = n - 1; i > 0; i--) {
        this.pos[i * 3] = this.pos[(i - 1) * 3]!; this.pos[i * 3 + 1] = this.pos[(i - 1) * 3 + 1]!; this.pos[i * 3 + 2] = this.pos[(i - 1) * 3 + 2]!;
        this.intn[i] = this.intn[i - 1]!;
      }
      this.pos[0] = x; this.pos[1] = y; this.pos[2] = z; this.intn[0] = intensity;
    },
    update(vis) {
      for (let j = 0; j < n; j++) {
        let age = 1 - j / n; age = age * age;
        const f = this.intn[j]! * age * vis;
        this.col[j * 3] = baseCol[0]! * f; this.col[j * 3 + 1] = baseCol[1]! * f; this.col[j * 3 + 2] = baseCol[2]! * f;
      }
      (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}

// ---- contact rings ---------------------------------------------------------
export type Ring = { s: THREE.Sprite; t: number; x: number; z: number };

export function makeRings(parent: THREE.Object3D, kit: SpriteKit): Ring[] {
  const rings: Ring[] = [];
  for (let ri = 0; ri < 5; ri++) {
    const rs = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.ring, color: 0xbfe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    rs.scale.set(1, 1, 1);
    parent.add(rs);
    rings.push({ s: rs, t: 999, x: 0, z: 0 });
  }
  return rings;
}

export function popRing(rings: Ring[], x: number, z: number, color: number): void {
  for (let i = 0; i < rings.length; i++) {
    const R = rings[i]!;
    if (R.t > 1.2) { R.t = 0; R.x = x; R.z = z; R.s.material.color.set(color); return; }
  }
}

// ---- snow spray puffs (hockey stops, the dog's skid) -----------------------
export type SprayPuff = { s: THREE.Sprite; t: number; vx: number; vy: number; vz: number; x: number; y: number; z: number };

export function makeSprayPool(parent: THREE.Object3D, kit: SpriteKit): SprayPuff[] {
  const pool: SprayPuff[] = [];
  for (let si2 = 0; si2 < 26; si2++) {
    const sp = spr(parent, kit.soft, 0xe8f2ff, 0);
    sp.scale.set(3, 3, 1);
    pool.push({ s: sp, t: 999, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 });
  }
  return pool;
}

export function spray(pool: SprayPuff[], x: number, z: number, heading: number, n: number, power?: number): void {
  let used = 0;
  for (let i = 0; i < pool.length && used < n; i++) {
    const P = pool[i]!;
    if (P.t < 0.55) continue;
    P.t = 0; used++;
    const a = heading + Math.PI + rand(-0.9, 0.9);
    const v = rand(6, 16) * (power || 1);
    P.x = x; P.y = 0.6; P.z = z;
    P.vx = Math.cos(a) * v; P.vz = Math.sin(a) * v; P.vy = rand(6, 14) * (power || 1);
  }
}
