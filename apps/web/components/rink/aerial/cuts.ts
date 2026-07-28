/**
 * AERIAL OPEN — LIVE SKATE-CUT LEDGER: thin real blade lines carved into a
 * 1024^2 canvas that lies on the pond as a CanvasTexture plane. Paired weaving
 * blade segments, hockey-stop shave marks, dog paw dots, and a slow
 * destination-out fade so the ice slowly forgets. Ported verbatim from
 * docs/aerial-tournament/final.html. Browser-only (canvas 2D).
 */
import * as THREE from "three";

export type CutLedger = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  tex: THREE.CanvasTexture;
  seg: (x0: number, z0: number, x1: number, z1: number, w: number, a: number) => void;
  dot: (x: number, z: number, r: number, a: number) => void;
  stopMark: (x: number, z: number, heading: number) => void;
  fade: (dt: number) => void;
  flush: () => void;
};

export function buildCutLedger(parent: THREE.Object3D): CutLedger {
  const S = 1024, P = 178;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(P * 2, P * 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.09;
  parent.add(mesh);
  const px = (w: number) => (w / P) * (S / 2);
  const X = (wx: number) => S / 2 + px(wx);
  const Y = (wz: number) => S / 2 - px(wz);
  let dirty = false;
  return {
    mesh, tex,
    seg(x0, z0, x1, z1, w, a) {
      if (Math.hypot(x1 - x0, z1 - z0) > 6) return;      // ignore teleports
      g.strokeStyle = "rgba(226,240,255," + a.toFixed(3) + ")";
      g.lineWidth = w; g.lineCap = "round";
      g.beginPath(); g.moveTo(X(x0), Y(z0)); g.lineTo(X(x1), Y(z1)); g.stroke();
      dirty = true;
    },
    dot(x, z, r, a) {
      g.fillStyle = "rgba(226,240,255," + a.toFixed(3) + ")";
      g.fillRect(X(x) - r * 0.5, Y(z) - r * 0.5, r, r);
      dirty = true;
    },
    stopMark(x, z, heading) {
      // a hockey stop: short broad shave marks perpendicular to travel
      const pxd = -Math.sin(heading), pzd = Math.cos(heading);
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.9;
        const cxw = x + pxd * off, czw = z + pzd * off;
        g.strokeStyle = "rgba(232,244,255,0.16)";
        g.lineWidth = 2.4; g.lineCap = "round";
        g.beginPath();
        g.moveTo(X(cxw - pxd * 1.6), Y(czw - pzd * 1.6));
        g.lineTo(X(cxw + pxd * 1.6), Y(czw + pzd * 1.6));
        g.stroke();
      }
      dirty = true;
    },
    fade(dt) {
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "rgba(0,0,0," + Math.min(0.06, dt * 0.08).toFixed(4) + ")";
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = "source-over";
      dirty = true;
    },
    flush() { if (dirty) { tex.needsUpdate = true; dirty = false; } },
  };
}
