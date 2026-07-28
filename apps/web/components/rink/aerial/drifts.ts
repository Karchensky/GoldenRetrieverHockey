/**
 * AERIAL OPEN — BIG SNOW DRIFTS: a sculpted, vertex-coloured ring mesh around
 * the shore. Ported verbatim from docs/aerial-tournament/final.html.
 *
 * Hard-won artifact fixes baked in — do not "improve":
 *  - driftH uses big smooth lobes only; fine ripples read as artifacts at this
 *    grazing camera angle.
 *  - the material is transparent + depthWrite:false with a per-vertex alpha
 *    fade (aAlp) across the outer half of the ring, so the ring melts into the
 *    snowfield with no hard seam.
 *  - vertex colours blend to the surrounding field tone toward the outer rim
 *    and to the shore rim on the inner edge (no seam either side).
 */
import * as THREE from "three";
import { DRIFT_W, PAL, driftH, pondR, sunDir3 } from "./constants";
import { clamp, lerp, smooth } from "./math";

export type Drift = {
  mesh: THREE.Mesh;
  u: { uOp: { value: number } };
};

export function buildDrift(parent: THREE.Object3D): Drift {
  const driftU = { uOp: { value: 0 } };
  const AS = 144, RS = 22;
  const count = (AS + 1) * (RS + 1);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), alp = new Float32Array(count);
  const idx: number[] = [];
  for (let j = 0; j <= RS; j++) {
    for (let i = 0; i <= AS; i++) {
      const a = (i / AS) * Math.PI * 2;
      const t = j / RS;
      const r = pondR(a) + 2 + t * DRIFT_W;
      const y = driftH(a, t);
      const vi = j * (AS + 1) + i;
      pos[vi * 3] = Math.cos(a) * r; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = Math.sin(a) * r;
      alp[vi] = 1 - smooth(0.50, 0.80, t);
    }
  }
  // shade: numeric normal vs the low sun + sky ambient
  const sunV = sunDir3;
  for (let j2 = 0; j2 <= RS; j2++) {
    for (let i2 = 0; i2 <= AS; i2++) {
      const vi2 = j2 * (AS + 1) + i2;
      const iL = i2 === 0 ? AS : i2 - 1, iR = i2 === AS ? 0 : i2 + 1;
      const jD = Math.max(0, j2 - 1), jU = Math.min(RS, j2 + 1);
      const vA = jD * (AS + 1) + i2, vB = jU * (AS + 1) + i2;
      const vL = j2 * (AS + 1) + iL, vR = j2 * (AS + 1) + iR;
      const dx1 = pos[vR * 3]! - pos[vL * 3]!, dy1 = pos[vR * 3 + 1]! - pos[vL * 3 + 1]!, dz1 = pos[vR * 3 + 2]! - pos[vL * 3 + 2]!;
      const dx2 = pos[vB * 3]! - pos[vA * 3]!, dy2 = pos[vB * 3 + 1]! - pos[vA * 3 + 1]!, dz2 = pos[vB * 3 + 2]! - pos[vA * 3 + 2]!;
      let nx = dy1 * dz2 - dz1 * dy2, ny = dz1 * dx2 - dx1 * dz2, nz = dx1 * dy2 - dy1 * dx2;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const sunD = Math.max(0, nx * sunV.x + ny * sunV.y + nz * sunV.z);
      let sAmt = 0.30 + 0.32 * Math.max(0, ny) + 0.40 * sunD;
      sAmt = clamp(sAmt, 0, 1.1);
      let r0 = lerp(0.075, 0.55, sAmt), g0 = lerp(0.12, 0.63, sAmt), b0 = lerp(0.20, 0.80, sAmt);
      r0 += PAL.dawn[0] * 0.10 * sunD; g0 += PAL.dawn[1] * 0.085 * sunD; b0 += PAL.dawn[2] * 0.05 * sunD;
      const hh = pos[vi2 * 3 + 1]!;
      const crest = clamp(hh / 12, 0, 1) * 0.09;
      r0 += crest; g0 += crest; b0 += crest;
      // blend to the surrounding field tone toward the outer rim (no seam)
      const tt = j2 / RS;
      const fB = smooth(0.40, 0.72, tt);
      r0 = lerp(r0, 0.16, fB); g0 = lerp(g0, 0.27, fB); b0 = lerp(b0, 0.37, fB);
      // and to the shore rim on the inner edge
      const fI = smooth(0.10, 0.0, tt);
      r0 = lerp(r0, 0.30, fI); g0 = lerp(g0, 0.38, fI); b0 = lerp(b0, 0.50, fI);
      col[vi2 * 3] = r0; col[vi2 * 3 + 1] = g0; col[vi2 * 3 + 2] = b0;
    }
  }
  for (let j3 = 0; j3 < RS; j3++) {
    for (let i3 = 0; i3 < AS; i3++) {
      const a0 = j3 * (AS + 1) + i3, b0i = a0 + 1, c0 = a0 + (AS + 1), d0 = c0 + 1;
      idx.push(a0, c0, b0i, b0i, c0, d0);
    }
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g2.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  g2.setAttribute("aAlp", new THREE.BufferAttribute(alp, 1));
  g2.setIndex(idx);
  g2.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
  const mat = new THREE.ShaderMaterial({
    uniforms: driftU as unknown as Record<string, THREE.IUniform>,
    transparent: true, depthWrite: false,
    vertexShader: [
      "attribute vec3 aCol; attribute float aAlp;",
      "varying vec3 vC; varying float vA;",
      "void main(){ vC=aCol; vA=aAlp; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    ].join("\n"),
    fragmentShader: [
      "uniform float uOp; varying vec3 vC; varying float vA;",
      "void main(){ float a=vA*uOp; if(a<0.003) discard; gl_FragColor=vec4(vC,a);}",
    ].join("\n"),
  });
  const mesh = new THREE.Mesh(g2, mat);
  mesh.frustumCulled = false;
  parent.add(mesh);

  // ---- outer hummocks: sparse low wind-piled mounds beyond the drift ring ----
  (() => {
    const AS2 = 120, RS2 = 8;
    const n2 = (AS2 + 1) * (RS2 + 1);
    const pos2 = new Float32Array(n2 * 3), col2 = new Float32Array(n2 * 3), alp2 = new Float32Array(n2);
    const idx2: number[] = [];
    for (let j = 0; j <= RS2; j++) {
      for (let i = 0; i <= AS2; i++) {
        const a = (i / AS2) * Math.PI * 2;
        const t = j / RS2;
        const r = pondR(a) + 92 + t * 58;
        const prof = Math.pow(Math.sin(Math.PI * t), 1.4);
        const cl = Math.pow(Math.max(0, 0.5 + 0.5 * Math.sin(a * 4.6 + 0.9)), 1.6)
          + 0.7 * Math.pow(Math.max(0, 0.5 + 0.5 * Math.sin(a * 7.9 + 3.8)), 2.0);
        const backB = 0.5 - 0.5 * Math.sin(a);
        const h = prof * (0.4 + 2.3 * cl) * (0.5 + 0.5 * backB);
        const vi = j * (AS2 + 1) + i;
        pos2[vi * 3] = Math.cos(a) * r; pos2[vi * 3 + 1] = h; pos2[vi * 3 + 2] = Math.sin(a) * r;
        const sunA = Math.max(0, Math.cos(a) * sunDir3.x + Math.sin(a) * sunDir3.z);
        const lift = clamp(h / 3.0, 0, 1);
        const r0 = 0.125 + lift * (0.16 + 0.05 * sunA), g0 = 0.225 + lift * 0.17, b0 = 0.315 + lift * 0.19;
        col2[vi * 3] = r0; col2[vi * 3 + 1] = g0; col2[vi * 3 + 2] = b0;
        alp2[vi] = Math.sin(Math.PI * t) * clamp(h / 0.5, 0, 1);   // fades at both edges, gone where flat
      }
    }
    for (let j3 = 0; j3 < RS2; j3++) {
      for (let i3 = 0; i3 < AS2; i3++) {
        const a0 = j3 * (AS2 + 1) + i3, b0i = a0 + 1, c0 = a0 + (AS2 + 1), d0 = c0 + 1;
        idx2.push(a0, c0, b0i, b0i, c0, d0);
      }
    }
    const g3 = new THREE.BufferGeometry();
    g3.setAttribute("position", new THREE.BufferAttribute(pos2, 3));
    g3.setAttribute("aCol", new THREE.BufferAttribute(col2, 3));
    g3.setAttribute("aAlp", new THREE.BufferAttribute(alp2, 1));
    g3.setIndex(idx2);
    g3.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
    const m2 = new THREE.Mesh(g3, mat);
    m2.frustumCulled = false;
    parent.add(m2);
  })();
  return { mesh, u: driftU };
}
