/**
 * AERIAL OPEN — procedural sprite textures (soft dot / hot core / wide glow /
 * contact ring), ported verbatim from docs/aerial-tournament/final.html.
 * Browser-only (canvas 2D): call from client-side construction paths only.
 */
import * as THREE from "three";

export type SpriteStops = Array<[number, string]>;

export function makeSprite(stops?: SpriteStops): THREE.CanvasTexture {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  (stops || [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]])
    .forEach((st) => { grad.addColorStop(st[0], st[1]); });
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export function makeRing(): THREE.CanvasTexture {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
  g.stroke();
  g.globalCompositeOperation = "destination-in";
  const grad = g.createRadialGradient(s / 2, s / 2, s / 2 - 22, s / 2, s / 2, s / 2 - 4);
  grad.addColorStop(0, "rgba(255,255,255,0.15)");
  grad.addColorStop(0.6, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export type SpriteKit = {
  soft: THREE.CanvasTexture;
  core: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  ring: THREE.CanvasTexture;
};

export function makeSpriteKit(): SpriteKit {
  return {
    soft: makeSprite(),
    core: makeSprite([[0, "rgba(255,255,255,1)"], [0.22, "rgba(255,255,255,0.92)"], [0.55, "rgba(255,255,255,0.28)"], [1, "rgba(255,255,255,0)"]]),
    glow: makeSprite([[0, "rgba(255,255,255,0.9)"], [0.28, "rgba(255,255,255,0.32)"], [1, "rgba(255,255,255,0)"]]),
    ring: makeRing(),
  };
}

/** Additive screen-facing sprite (final.html's `spr`), added to `parent`. */
export function spr(parent: THREE.Object3D, tex: THREE.Texture, colorHex: number, opacity?: number): THREE.Sprite {
  const m = new THREE.SpriteMaterial({
    map: tex, color: colorHex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: opacity || 0, fog: false,
  });
  const s = new THREE.Sprite(m);
  parent.add(s);
  return s;
}

/** Ground-plane additive glow disc (final.html's `flatGlow`), added to `parent`. */
export function flatGlow(parent: THREE.Object3D, tex: THREE.Texture, color: number, size: number, op: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: op }),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(size, size, 1);
  m.position.y = 0.25;
  parent.add(m);
  return m;
}
