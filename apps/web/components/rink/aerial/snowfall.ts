/**
 * AERIAL OPEN — persistent falling snow with near-field alpha fade (no bright
 * veil of close flakes). Ported verbatim from docs/aerial-tournament/final.html.
 */
import * as THREE from "three";
import { PAL, SNOW_H, SNOW_R } from "./constants";
import { rand } from "./math";
import type { ScalarUniform } from "./pose";

export type Snowfall = {
  points: THREE.Points;
  u: {
    uTime: ScalarUniform; uSize: ScalarUniform; uScale: ScalarUniform; uDensity: ScalarUniform;
    uIntro: ScalarUniform; uFall: ScalarUniform; uColH: ScalarUniform;
    uFogNear: ScalarUniform; uFogFar: ScalarUniform;
    uColor: { value: THREE.Color };
    uTex: { value: THREE.Texture };
  };
};

export function buildSnowfall(parent: THREE.Object3D, uScale: ScalarUniform, texSoft: THREE.Texture): Snowfall {
  const N = 7000;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N), spd = new Float32Array(N), sz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rand(-SNOW_R, SNOW_R);
    pos[i * 3 + 1] = Math.random() * SNOW_H;
    pos[i * 3 + 2] = rand(-SNOW_R, SNOW_R);
    seed[i] = Math.random(); spd[i] = rand(7, 20); sz[i] = rand(0.8, 2.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  g.setAttribute("aSpeed", new THREE.BufferAttribute(spd, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SNOW_H / 2, 0), 2000);
  const u: Snowfall["u"] = {
    uTime: { value: 0 }, uSize: { value: 1.42 }, uScale, uDensity: { value: 1.0 },
    uIntro: { value: 0 }, uFall: { value: 1.0 }, uColH: { value: SNOW_H },
    uFogNear: { value: 700 }, uFogFar: { value: 1900 },
    uColor: { value: new THREE.Color().setRGB(PAL.snow[0], PAL.snow[1], PAL.snow[2]) },
    uTex: { value: texSoft },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    vertexShader: [
      "uniform float uTime,uSize,uScale,uDensity,uIntro,uFall,uColH,uFogNear,uFogFar;",
      "attribute float aSeed,aSpeed,aSize;",
      "varying float vA;",
      "void main(){",
      "  vec3 p=position;",
      "  float H=uColH;",
      "  p.y=mod(position.y-uTime*aSpeed*uFall,H);",
      "  p.x+=sin(uTime*0.5+aSeed*30.0)*7.0+sin(uTime*0.17+aSeed*11.0)*3.0;",
      "  p.z+=cos(uTime*0.42+aSeed*20.0)*7.0;",
      "  vec4 mv=modelViewMatrix*vec4(p,1.0);",
      "  gl_Position=projectionMatrix*mv;",
      "  float ps=aSize*uSize*(uScale/max(-mv.z,1.0));",
      "  gl_PointSize=min(ps,70.0);",
      "  float edge=smoothstep(0.0,50.0,p.y)*smoothstep(H,H-90.0,p.y);",
      "  float fog=smoothstep(uFogNear,uFogFar,-mv.z);",
      "  float nearF=smoothstep(60.0,170.0,-mv.z);",   // no bright veil of near flakes
      "  vA=edge*uDensity*uIntro*(1.0-fog*0.6)*mix(0.28,1.0,nearF);",
      "}",
    ].join("\n"),
    fragmentShader: [
      "uniform sampler2D uTex; uniform vec3 uColor; varying float vA;",
      "void main(){ float a=texture2D(uTex,gl_PointCoord).a*vA; if(a<0.008) discard; gl_FragColor=vec4(uColor,a); }",
    ].join("\n"),
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  parent.add(pts);
  return { points: pts, u };
}
