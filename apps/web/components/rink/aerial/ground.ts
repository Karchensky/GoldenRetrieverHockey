/**
 * AERIAL OPEN — ground: snowfield + irregular frozen pond, painted once into a
 * 1024^2 canvas texture. Ported verbatim from docs/aerial-tournament/final.html.
 * Browser-only (canvas 2D).
 */
import * as THREE from "three";
import { GROUND_R, POND_R, SUN_AZ, pondR } from "./constants";

export function buildGroundTexture(): THREE.CanvasTexture {
  const s = 1024, cx = s / 2, cy = s / 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  const px = (world: number) => (world / GROUND_R) * (s / 2);
  const CX = (wx: number) => cx + px(wx);
  const CY = (wz: number) => cy - px(wz);
  function pondPath(expand?: number): Path2D {
    const p = new Path2D(), N = 260;
    for (let kk = 0; kk <= N; kk++) {
      const a = (kk / N) * Math.PI * 2, rr = pondR(a) + (expand || 0);
      const xx = CX(Math.cos(a) * rr), yy = CY(Math.sin(a) * rr);
      if (kk === 0) p.moveTo(xx, yy); else p.lineTo(xx, yy);
    }
    p.closePath();
    return p;
  }
  const fadePx = px(430);

  const sn = g.createRadialGradient(cx, cy, px(POND_R) * 0.5, cx, cy, s / 2);
  sn.addColorStop(0, "#2c4864"); sn.addColorStop(0.4, "#1f374f"); sn.addColorStop(1, "#0a1624");
  g.fillStyle = sn; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4200; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.pow(Math.random(), 0.6) * (s / 2);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    const al = 0.02 + Math.random() * 0.07;
    g.fillStyle = "rgba(200,222,255," + al.toFixed(3) + ")";
    const d = Math.random() * 2.2 + 0.4;
    g.fillRect(x, y, d, d);
  }
  g.globalCompositeOperation = "source-over";
  g.save(); g.shadowColor = "rgba(10,22,36,0.55)"; g.shadowBlur = 34;
  g.fillStyle = "rgba(14,32,50,0.5)"; g.fill(pondPath(6)); g.restore();

  g.save(); g.clip(pondPath(2));
  const pond = g.createRadialGradient(cx, cy, 4, cx, cy, px(POND_R) + 18);
  pond.addColorStop(0, "#060f19"); pond.addColorStop(0.55, "#0a1a29"); pond.addColorStop(0.85, "#0d2336"); pond.addColorStop(1, "#0c2439");
  g.fillStyle = pond; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = "lighter";
  const sh = g.createLinearGradient(cx - px(POND_R), cy - px(POND_R) * 0.6, cx + px(POND_R), cy + px(POND_R) * 0.4);
  sh.addColorStop(0, "rgba(120,170,220,0)"); sh.addColorStop(0.5, "rgba(150,195,240,0.10)"); sh.addColorStop(1, "rgba(120,170,220,0)");
  g.fillStyle = sh; g.fillRect(0, 0, s, s);
  const rk = g.createLinearGradient(CX(-SUN_AZ.x * POND_R), CY(-SUN_AZ.y * POND_R), CX(SUN_AZ.x * POND_R), CY(SUN_AZ.y * POND_R));
  rk.addColorStop(0.0, "rgba(255,205,140,0.12)"); rk.addColorStop(0.5, "rgba(255,255,255,0)"); rk.addColorStop(1.0, "rgba(40,74,112,0.16)");
  g.fillStyle = rk; g.fillRect(0, 0, s, s);
  // no pre-baked cracks or scuffs — the ice starts pristine and the game
  // writes on it (all linework comes from the live cut ledger)
  g.globalCompositeOperation = "source-over";
  g.restore();

  g.save(); g.globalCompositeOperation = "lighter"; g.shadowColor = "rgba(210,230,255,0.45)"; g.shadowBlur = 8;
  g.strokeStyle = "rgba(206,226,250,0.22)"; g.lineWidth = 4; g.stroke(pondPath(3)); g.restore();

  g.globalCompositeOperation = "destination-in";
  const fade = g.createRadialGradient(cx, cy, fadePx * 0.74, cx, cy, fadePx);
  fade.addColorStop(0, "rgba(255,255,255,1)"); fade.addColorStop(0.8, "rgba(255,255,255,0.5)"); fade.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = fade; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = "source-over";
  const t = new THREE.CanvasTexture(cv);
  t.needsUpdate = true;
  return t;
}

export type Ground = {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
};

export function buildGround(parent: THREE.Object3D): Ground {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(GROUND_R, 128),
    new THREE.MeshBasicMaterial({ map: buildGroundTexture(), transparent: true, opacity: 0, depthWrite: true, fog: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.6;
  parent.add(mesh);
  return { mesh };
}
