/**
 * AERIAL OPEN — layered sky dome (gradient + three mountain-ridge bands + toned
 * dawn) and the low warm sun sprites. Ported verbatim from
 * docs/aerial-tournament/final.html.
 */
import * as THREE from "three";
import { PAL, SUN_AZ, sunDir3 } from "./constants";
import { spr, type SpriteKit } from "./sprites";

export type SkyUniforms = {
  uReveal: { value: number };
  uSunI: { value: number };
  uTop: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uWarm: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
};

export type Sky = {
  mesh: THREE.Mesh;
  u: SkyUniforms;
  sunGlow: THREE.Sprite;
  sunCore: THREE.Sprite;
};

export function buildSky(parent: THREE.Object3D, kit: SpriteKit): Sky {
  const skyU: SkyUniforms = {
    uReveal: { value: 0 }, uSunI: { value: 0 },
    uTop: { value: new THREE.Color().setRGB(0.015, 0.026, 0.052) },
    uHorizon: { value: new THREE.Color().setRGB(0.055, 0.11, 0.185) },
    uWarm: { value: new THREE.Color().setRGB(PAL.dawn[0], PAL.dawn[1], PAL.dawn[2]) },
    uSunDir: { value: sunDir3.clone() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 40, 24),
    new THREE.ShaderMaterial({
      uniforms: skyU as unknown as Record<string, THREE.IUniform>,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: [
        "varying vec3 vW;",
        "void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      ].join("\n"),
      fragmentShader: [
        "uniform float uReveal,uSunI; uniform vec3 uTop,uHorizon,uWarm,uSunDir; varying vec3 vW;",
        "void main(){",
        "  vec3 d=normalize(vW);",
        "  float h=clamp(d.y*0.5+0.5,0.0,1.0);",
        "  vec3 col=mix(uHorizon,uTop,smoothstep(0.32,0.94,h));",
        "  float band=smoothstep(0.58,0.28,h);",
        "  col+=uHorizon*band*0.18;",
        "  float sd=max(0.0,dot(d,normalize(uSunDir)));",
        "  float low=smoothstep(0.42,0.0,h);",
        "  col+=uWarm*pow(sd,2.2)*0.15*uSunI*low;",
        "  col+=uWarm*pow(sd,26.0)*0.30*uSunI;",
        "  float el=d.y;",
        "  float az=atan(d.x,-d.z);",
        "  float back=smoothstep(0.44,-0.34,d.z);",
        "  float hor=smoothstep(-0.02,0.03,el);",
        "  float sunAz=max(0.0,dot(normalize(vec3(d.x,0.0,d.z)),normalize(vec3(uSunDir.x,0.0,uSunDir.z))));",
        "  float pkF=0.030*abs(sin(az*1.6+2.0))+0.019*abs(sin(az*3.1+0.5))+0.011*abs(sin(az*5.3+1.4));",
        "  float r1=0.082+pkF;",
        "  float pkN=0.030*abs(sin(az*2.1+0.3))+0.021*abs(sin(az*3.7+1.1))+0.013*abs(sin(az*6.9+2.2))+0.007*abs(sin(az*12.0));",
        "  float r2=0.058+pkN;",
        "  float hlN=0.020*abs(sin(az*2.7+1.9))+0.012*abs(sin(az*4.5+0.2))+0.006*abs(sin(az*9.0+3.0));",
        "  float r3=0.030+hlN;",
        "  r1*=back; r2*=back; r3*=back;",
        "  float mFar=smoothstep(r1,r1-0.014,el)*hor*back;",
        "  vec3 farCol=mix(vec3(0.15,0.21,0.33),vec3(0.30,0.38,0.52),smoothstep(r1-0.06,r1,el));",
        "  farCol+=uWarm*0.14*sunAz*uSunI;",
        "  col=mix(col,farCol,mFar*0.55);",
        "  float mNear=smoothstep(r2,r2-0.010,el)*hor*back;",
        "  vec3 nearCol=mix(vec3(0.09,0.14,0.23),vec3(0.44,0.52,0.66),smoothstep(r2-0.05,r2,el));",
        "  nearCol+=uWarm*0.30*sunAz*uSunI*smoothstep(r2-0.03,r2,el);",
        "  col=mix(col,nearCol,mNear*0.6);",
        "  float mHill=smoothstep(r3,r3-0.010,el)*hor*back;",
        "  vec3 hillCol=mix(vec3(0.10,0.15,0.24),vec3(0.34,0.42,0.56),smoothstep(r3-0.04,r3,el));",
        "  hillCol+=uWarm*0.16*sunAz*uSunI;",
        "  col=mix(col,hillCol,mHill*0.5);",
        "  vec3 dark=vec3(0.012,0.018,0.032);",
        "  col=mix(dark,col,uReveal);",
        "  gl_FragColor=vec4(col,1.0);",
        "}",
      ].join("\n"),
    }),
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  parent.add(sky);

  // the dawn sun — a DEFINED disc sitting just above the ridge crest, with a
  // tight halo (a huge soft glow smears down across the mountains and reads
  // as if the sun were inside them — keep the halo close)
  const sunPos = new THREE.Vector3(SUN_AZ.x, 0, SUN_AZ.y).multiplyScalar(2000);
  sunPos.y = 208;
  const sunGlow = spr(parent, kit.glow, 0xffc286, 0);
  sunGlow.position.copy(sunPos); sunGlow.scale.set(460, 240, 1); sunGlow.renderOrder = -9;
  const sunCore = spr(parent, kit.core, 0xffe4b6, 0);
  sunCore.position.copy(sunPos); sunCore.scale.set(140, 92, 1); sunCore.renderOrder = -8;

  return { mesh: sky, u: skyU, sunGlow, sunCore };
}
