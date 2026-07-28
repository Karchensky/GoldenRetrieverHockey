/**
 * AERIAL OPEN — GOALS: crimson frame bars + sagging mesh netting (frosted
 * membrane base under a netting grid so it reads at aerial distance), plus a
 * faint mouth glow and a shot "shiver". Ported verbatim from
 * docs/aerial-tournament/final.html. Browser-only (canvas 2D net texture).
 */
import * as THREE from "three";
import { GOAL_D, GOAL_H, GOAL_HW, netAx, netBx } from "./constants";
import { spr, type SpriteKit } from "./sprites";

export type Goal = {
  group: THREE.Group;
  x: number;
  shiver: number;
  dir: number;
  glow: THREE.Sprite;
};

export type Goals = {
  goalA: Goal;
  goalB: Goal;
  goals: Goal[];
  frameMat: THREE.MeshBasicMaterial;
  frameLitMat: THREE.MeshBasicMaterial;
  netMats: THREE.MeshBasicMaterial[];
};

function makeNetTexture(pitch: number): THREE.CanvasTexture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  // frosted membrane base so the mesh reads at aerial distance...
  g.fillStyle = "rgba(220,236,255,0.10)";
  g.fillRect(0, 0, s, s);
  // ...with the actual netting grid over it
  g.strokeStyle = "rgba(232,244,255,0.9)";
  g.lineWidth = 1;
  for (let i = 0; i <= s; i += pitch) {
    g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, s); g.stroke();
    g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(s, i + 0.5); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function meshBar(
  group: THREE.Group, mat: THREE.MeshBasicMaterial,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number,
): THREE.Mesh {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  group.add(m);
  return m;
}

export function buildGoals(parent: THREE.Object3D, kit: SpriteKit): Goals {
  const frameMat = new THREE.MeshBasicMaterial({ color: 0xc85848, transparent: true, opacity: 0, fog: false });
  const frameLitMat = new THREE.MeshBasicMaterial({ color: 0xe87a5e, transparent: true, opacity: 0, fog: false });
  const netMats: THREE.MeshBasicMaterial[] = [];

  function buildGoal(x: number, rotY: number): Goal {
    const gp = new THREE.Group();
    const HW = GOAL_HW, H = GOAL_H, D = GOAL_D, BW = HW * 0.70;
    meshBar(gp, frameLitMat, 0, 0.1, -HW, 0, H, -HW, 0.26);          // front posts (lit side)
    meshBar(gp, frameLitMat, 0, 0.1, HW, 0, H, HW, 0.26);
    meshBar(gp, frameLitMat, 0, H, -HW, 0, H, HW, 0.23);             // crossbar
    meshBar(gp, frameMat, 0, 0.18, -HW, -D, 0.18, -BW, 0.16);        // base side rails
    meshBar(gp, frameMat, 0, 0.18, HW, -D, 0.18, BW, 0.16);
    meshBar(gp, frameMat, -D, 0.18, -BW, -D, 0.18, BW, 0.16);        // back base rail
    meshBar(gp, frameMat, 0, H, -HW, -D, 0.55, -BW, 0.14);           // top slant supports
    meshBar(gp, frameMat, 0, H, HW, -D, 0.55, BW, 0.14);
    const mouthGlow = spr(parent, kit.glow, 0xd97a62, 0);
    mouthGlow.scale.set(10, 6, 1);
    // netting: back-slope panel + two side triangles
    const slLen = Math.hypot(D, H - 0.55);
    const t1 = makeNetTexture(5);
    t1.repeat.set((HW * 2) / 1.05, slLen / 1.05);
    const m1 = new THREE.MeshBasicMaterial({ map: t1, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
    netMats.push(m1);
    const slope = new THREE.PlaneGeometry(HW * 2 * 0.86, slLen, 1, 4);
    // gentle sag toward the middle of the panel
    (() => {
      const pa = slope.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const yy = pa.getY(i), xx = pa.getX(i);
        const sag = Math.cos((xx / (HW * 2 * 0.86)) * Math.PI) * 0.0 + (1 - Math.abs(yy / (slLen / 2))) * 0.28;
        pa.setZ(i, -sag);
      }
      pa.needsUpdate = true;
      slope.computeVertexNormals();
    })();
    slope.rotateY(Math.PI / 2);
    slope.rotateZ(Math.atan2(D, H - 0.55));
    const slopeMesh = new THREE.Mesh(slope, m1);
    slopeMesh.position.set(-D / 2, (H + 0.55) / 2, 0);
    gp.add(slopeMesh);
    const t2 = makeNetTexture(5);
    t2.repeat.set(D / 1.05, H / 1.05);
    const m2 = new THREE.MeshBasicMaterial({ map: t2, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
    netMats.push(m2);
    const sideShape = new THREE.Shape();
    sideShape.moveTo(0, 0.15); sideShape.lineTo(0, H * 0.96); sideShape.lineTo(-D, 0.5); sideShape.lineTo(-D, 0.15); sideShape.closePath();
    const sideGeo = new THREE.ShapeGeometry(sideShape);
    const sL = new THREE.Mesh(sideGeo, m2); sL.position.set(0, 0, -HW * 0.86); gp.add(sL);
    const sR = new THREE.Mesh(sideGeo, m2); sR.position.set(0, 0, HW * 0.86); gp.add(sR);
    gp.position.set(x, 0, 0);
    gp.rotation.y = rotY;
    parent.add(gp);
    const dir = rotY === 0 ? 1 : -1;
    mouthGlow.position.set(x + dir * 0.6, 1.9, 0);
    return { group: gp, x, shiver: 0, dir, glow: mouthGlow };
  }

  const goalA = buildGoal(netAx, 0);          // mouth opens +X toward centre
  const goalB = buildGoal(netBx, Math.PI);    // mouth opens -X toward centre
  return { goalA, goalB, goals: [goalA, goalB], frameMat, frameLitMat, netMats };
}
