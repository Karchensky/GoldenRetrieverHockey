/**
 * AERIAL OPEN — the shared pose-capable additive point shader ("motes") and the
 * point-system builder, ported verbatim from docs/aerial-tournament/final.html.
 *
 * Every figure in the scene (world scatter, dog, players, watchers) is one of
 * these systems: particles fly in from a swirling chaos galaxy (uProgress),
 * then live at aHome, posed in the vertex shader by uStride/uGait/uLean/
 * uCrouch/uSit/uWag/uPitchA/uBob keyed off aPart/aPh.
 */
import * as THREE from "three";
import { CHAOS_C, STAGGER } from "./constants";

export const ASM_VERT = [
  "uniform float uProgress,uTime,uStagger,uSwirl,uSize,uScale,uDissolve,uBreath,uHeading,uIntro,uFogNear,uFogFar;",
  "uniform float uStride,uGait,uLean,uPitchA,uBob,uWag,uSit,uCrouch,uHipY,uLegOut,uFigScale;",
  "uniform vec3 uAnchor,uChaosCenter;",
  "attribute vec3 aHome,aChaos,aColor;",
  "attribute float aDelay,aSize,aSeed,aPart,aPh;",
  "varying vec3 vColor; varying float vAlpha;",
  "vec3 turb(vec3 p,float ph){return vec3(sin(p.y*0.15+ph*1.1),sin(p.z*0.15+ph*1.3+2.1),sin(p.x*0.15+ph*0.9+4.2));}",
  "void main(){",
  "  float local=clamp((uProgress-aDelay*uStagger)/(1.0-uStagger),0.0,1.0);",
  "  float e=local*local*local*(local*(local*6.0-15.0)+10.0);",
  "  vec3 sh=aHome;",
  "  // ---- pose (local space, before heading rotation) ----",
  "  if(aPart>2.5&&aPart<3.5){",                                  // legs (aPh = swing phase)
  "    float w=clamp((uHipY-sh.y)/max(uHipY,0.001),0.0,1.0);",
  "    float s1=sin(uStride+aPh);",
  "    sh.x+=s1*uGait*1.35*w;",
  "    sh.z+=s1*uGait*uLegOut*w*sign(sh.z);",
  "    sh.y+=max(0.0,-cos(uStride+aPh))*uGait*0.5*w;",
  "    sh.y=mix(sh.y,sh.y*0.42+0.12,uSit*step(3.0,aPh));",        // rear legs fold in a sit
  "  } else if(aPart>6.5){",                                      // stick — gentle carry sway
  "    sh.z+=sin(uStride*0.5+1.3)*uGait*0.42;",
  "    sh.x+=sin(uStride*0.5)*uGait*0.26;",
  "  } else if(aPart>1.5){",                                      // tail — wag + rest in sit
  "    float tf=clamp((-sh.x-3.4)*0.5,0.0,1.6);",
  "    sh.z+=sin(uTime*7.0-tf*1.3)*uWag*tf*0.85;",
  "    sh.y=mix(sh.y,sh.y*0.35+0.6,uSit*0.8);",
  "  } else if(aPart>0.5){",                                      // head — alive bob, proud sit
  "    sh.y+=sin(uTime*2.1+aSeed*3.0)*0.09*uWag;",
  "    sh.y+=uSit*0.42;",
  "  }",
  "  float rot=uSit*0.30+uPitchA;",                               // sit / gallop rock (about z)
  "  if(abs(rot)>0.0005){",
  "    float c0=cos(rot),s0=sin(rot);",
  "    float xr=sh.x*c0-(sh.y-2.2)*s0;",
  "    float yr=sh.x*s0+(sh.y-2.2)*c0;",
  "    sh.x=xr; sh.y=yr+2.2;",
  "  }",
  "  sh.y-=uCrouch*sh.y*0.16;",                                   // skater knee-bend
  "  sh.x+=uCrouch*sh.y*0.14;",                                   // ...with forward lean
  "  sh.z+=uLean*sh.y*0.30;",                                     // roll into the turn
  "  sh.y+=uBob;",
  "  sh*=uFigScale;",                                             // whole-figure scale (dog ~2/3 of a man)
  "  // ---- breath / dissolve / heading / assembly ----",
  "  sh+=turb(aHome*2.0,uTime*0.6+aSeed*8.0)*uBreath;",
  "  vec3 outn=normalize(aHome+vec3(0.001));",
  "  sh+=outn*uDissolve*(6.0+aSeed*10.0);",
  "  sh+=turb(aHome*3.0,uTime*3.0+aSeed*30.0)*uDissolve*7.0;",
  "  float hc=cos(uHeading),hs=sin(uHeading);",
  "  vec3 home=vec3(sh.x*hc-sh.z*hs,sh.y,sh.x*hs+sh.z*hc)+uAnchor;",
  "  vec3 c=aChaos;",
  "  float a=uSwirl*uTime+aSeed*6.2831+length(c.xz)*0.004;",
  "  float ca=cos(a),sa=sin(a);",
  "  vec3 chaos=uChaosCenter+vec3(c.x*ca-c.z*sa,c.y,c.x*sa+c.z*ca);",
  "  chaos+=turb(c,uTime*0.5+aSeed*10.0)*6.0;",
  "  vec3 pos=mix(chaos,home,e);",
  "  float mid=sin(e*3.14159265);",
  "  pos+=turb(aHome*1.5+aSeed*20.0,uTime*1.2+aSeed*5.0)*mid*9.0;",
  "  vec4 mv=modelViewMatrix*vec4(pos,1.0);",
  "  gl_Position=projectionMatrix*mv;",
  "  float tw=0.72+0.28*sin(uTime*1.6+aSeed*40.0);",
  "  float appear=mix(0.7,1.0,e)*(1.0+uDissolve*0.5);",
  "  float ps=aSize*uSize*appear*tw*(uScale/max(-mv.z,1.0));",
  "  gl_PointSize=min(ps,110.0);",
  "  float fog=smoothstep(uFogNear,uFogFar,-mv.z);",
  "  vColor=aColor;",
  "  vAlpha=uIntro*(0.5+0.5*tw)*(1.0-fog*0.92)*(1.0-uDissolve*0.22);",
  "}",
].join("\n");

export const ASM_FRAG = [
  "uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;",
  "void main(){",
  "  float a=texture2D(uTex,gl_PointCoord).a*vAlpha;",
  "  if(a<0.008) discard;",
  "  gl_FragColor=vec4(vColor,a);",
  "}",
].join("\n");

export type ScalarUniform = { value: number };

export type MoteUniforms = {
  uProgress: ScalarUniform; uTime: ScalarUniform; uStagger: ScalarUniform;
  uSwirl: ScalarUniform; uSize: ScalarUniform; uScale: ScalarUniform;
  uDissolve: ScalarUniform; uBreath: ScalarUniform; uHeading: ScalarUniform;
  uIntro: ScalarUniform; uFogNear: ScalarUniform; uFogFar: ScalarUniform;
  uStride: ScalarUniform; uGait: ScalarUniform; uLean: ScalarUniform; uPitchA: ScalarUniform;
  uBob: ScalarUniform; uWag: ScalarUniform; uSit: ScalarUniform; uCrouch: ScalarUniform;
  uHipY: ScalarUniform; uLegOut: ScalarUniform; uFigScale: ScalarUniform;
  uAnchor: { value: THREE.Vector3 };
  uChaosCenter: { value: THREE.Vector3 };
  uTex: { value: THREE.Texture };
};

/** Per-system overrides: fresh `{ value }` wrappers, exactly like final.html. */
export type MoteOverrides = Partial<Record<
  "uSwirl" | "uSize" | "uBreath" | "uHipY" | "uLegOut" | "uFigScale" | "uStagger",
  ScalarUniform
>>;

export function makeMoteMaterial(
  uScale: ScalarUniform,
  texSoft: THREE.Texture,
  over?: MoteOverrides,
): THREE.ShaderMaterial {
  const u: MoteUniforms = {
    uProgress: { value: 0 }, uTime: { value: 0 }, uStagger: { value: STAGGER },
    uSwirl: { value: 0.16 }, uSize: { value: 1.55 }, uScale,
    uDissolve: { value: 0 }, uBreath: { value: 0.0 }, uHeading: { value: 0 },
    uIntro: { value: 0 }, uFogNear: { value: 620 }, uFogFar: { value: 1750 },
    uStride: { value: 0 }, uGait: { value: 0 }, uLean: { value: 0 }, uPitchA: { value: 0 },
    uBob: { value: 0 }, uWag: { value: 0 }, uSit: { value: 0 }, uCrouch: { value: 0 },
    uHipY: { value: 2.6 }, uLegOut: { value: 0.5 }, uFigScale: { value: 1 },
    uAnchor: { value: new THREE.Vector3(0, 0, 0) },
    uChaosCenter: { value: CHAOS_C.clone() },
    uTex: { value: texSoft },
  };
  if (over) Object.assign(u, over);
  return new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: ASM_VERT, fragmentShader: ASM_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  });
}

export function galaxyPoint(out: number[]): void {
  const r = 34 + Math.pow(Math.random(), 0.65) * 158;
  const ang = Math.random() * Math.PI * 2;
  out[0] = Math.cos(ang) * r;
  out[1] = (Math.random() - 0.5) * 150 * 0.62;
  out[2] = Math.sin(ang) * r;
}

/** Mutable per-particle scratch handed to a system's fill function. */
export type MoteFillTmp = {
  h: number[]; c: number[]; col: number[];
  delay: number; size: number; seed: number; part: number; ph: number;
};
export type MoteFill = (i: number, p: MoteFillTmp) => void;

export type MoteSystem = {
  points: THREE.Points;
  geom: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  u: MoteUniforms;
};

export function buildSystem(
  parent: THREE.Object3D,
  registry: MoteSystem[],
  uScale: ScalarUniform,
  texSoft: THREE.Texture,
  count: number,
  fill: MoteFill,
  over?: MoteOverrides,
): MoteSystem {
  const home = new Float32Array(count * 3), chaos = new Float32Array(count * 3),
    col = new Float32Array(count * 3), delay = new Float32Array(count),
    size = new Float32Array(count), seed = new Float32Array(count),
    part = new Float32Array(count), ph = new Float32Array(count);
  const h = [0, 0, 0], c = [0, 0, 0], k = [0, 0, 0];
  const tmp: MoteFillTmp = { h, c, col: k, delay: 0, size: 1, seed: 0, part: 0, ph: 0 };
  for (let i = 0; i < count; i++) {
    h[0] = h[1] = h[2] = 0; galaxyPoint(c); k[0] = k[1] = k[2] = 1;
    tmp.delay = Math.random(); tmp.size = 1; tmp.seed = Math.random(); tmp.part = 0; tmp.ph = 0;
    fill(i, tmp);
    home[i * 3] = h[0]!; home[i * 3 + 1] = h[1]!; home[i * 3 + 2] = h[2]!;
    chaos[i * 3] = c[0]!; chaos[i * 3 + 1] = c[1]!; chaos[i * 3 + 2] = c[2]!;
    col[i * 3] = k[0]!; col[i * 3 + 1] = k[1]!; col[i * 3 + 2] = k[2]!;
    delay[i] = tmp.delay; size[i] = tmp.size; seed[i] = tmp.seed;
    part[i] = tmp.part; ph[i] = tmp.ph;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(home.slice(), 3));
  g.setAttribute("aHome", new THREE.BufferAttribute(home, 3));
  g.setAttribute("aChaos", new THREE.BufferAttribute(chaos, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  g.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
  g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4000);
  const mat = makeMoteMaterial(uScale, texSoft, over);
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  parent.add(pts);
  const sysObj: MoteSystem = { points: pts, geom: g, mat, u: mat.uniforms as unknown as MoteUniforms };
  registry.push(sysObj);
  return sysObj;
}
