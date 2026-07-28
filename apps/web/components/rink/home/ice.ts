/**
 * THE FAR SHORE — the frozen lake.
 *
 * One 18km disc carrying the whole surface in a fragment shader: swells, wind
 * ripple and frost grain in the normal; deep body with pale wind-scoured drift;
 * cracks; blown-snow wisps; frost facets; a fresnel sky mirror at range; the
 * granular column of gold on the sun's bearing; the pointer's gust lane; the
 * dog's contact shadow and the warmth he throws back; horizon haze; and the
 * materialisation ring running outward from under the lens.
 *
 * Ported verbatim from docs/openers/o-2.html.
 */
import * as THREE from "three";
import { GLSL_NOISE, HAZE, SKY_HOR, SKY_ZEN, SUN_COL, SUN_DIR } from "./constants";

export type IceLayer = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
};

export function buildIce(root: THREE.Group): IceLayer {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uSun: { value: SUN_COL.clone() },
      uHaze: { value: HAZE.clone() },
      uSkyHor: { value: SKY_HOR.clone() },
      uSkyZen: { value: SKY_ZEN.clone() },
      uDeep: { value: new THREE.Color(0.00115, 0.00185, 0.00335) },
      uPale: { value: new THREE.Color(0.0058, 0.0082, 0.0125) },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uDog: { value: new THREE.Vector3() },
      uPtr: { value: new THREE.Vector3(0, -999, 0) },
      uPtrD: { value: new THREE.Vector3(0, 0, -1) },
      uPtrK: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: GLSL_NOISE + /* glsl */ `
      uniform vec3 uSunDir, uSun, uHaze, uSkyHor, uSkyZen, uDeep, uPale, uCam, uDog, uPtr, uPtrD;
      uniform float uTime, uReveal, uPtrK;
      varying vec3 vW;
      void main(){
        vec3 V = normalize(uCam - vW);
        vec3 L = normalize(uSunDir);
        float d = length(vW.xz - uCam.xz);
        // detail fades with distance or it aliases into a crawling mess
        float f1 = exp(-d * 0.0055);
        float f2 = exp(-d * 0.055);
        float f3 = exp(-d * 0.30);

        // ---- surface normal: swells, wind ripple, frost grain
        vec3 n1 = noised(vW.xz * 0.035);
        vec3 n2 = noised(vW.xz * 0.31 + 7.0);
        vec3 n3 = noised(vW.xz * 2.35 + 19.0);
        float sway = sin(uTime * 0.06);
        vec2 slope = n1.yz * 0.035 * (0.0035 + 0.0 * sway) * 900.0 * f1
                   + n2.yz * 0.31 * 0.0060 * 60.0 * f2
                   + n3.yz * 2.35 * 0.0016 * 26.0 * f3;
        // a slow breath of wind that the cursor leans on
        float pd = length(vW.xz - uPtr.xz);
        float gust = uPtrK * exp(-pd * pd / 26.0);
        slope += vec2(n2.y, n2.z) * gust * 0.55;
        vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

        // ---- body of the ice: deep, with pale wind-scoured drift
        // wind-scoured drift, on a skewed frame so it never bands into stripes
        mat2 skew = mat2(0.86, 0.51, -0.51, 0.86);
        float drift = fbm(skew * vW.xz * vec2(0.030, 0.092) + vec2(uTime * 0.010, 0.0), 4)
                    * 0.66 + fbm(vW.xz * vec2(0.115, 0.052) + 23.0, 3) * 0.34;
        float grain = fbm(vW.xz * 1.9 + 41.0, 3);
        float pale = smoothstep(0.47, 0.63, drift) * (0.30 + 0.70 * f2);
        vec3 c = mix(uDeep, uPale, pale * 0.80);
        c *= 0.84 + 0.32 * mix(0.5, grain, f3);

        // ---- cracks: thin bright seams, only where they can be resolved
        float cr = fbm(vW.xz * 0.055 + 3.0, 3);
        float crack = 1.0 - smoothstep(0.0, 0.020, abs(cr - 0.5));
        float cr2 = fbm(vW.xz * 0.19 + 61.0, 2);
        crack = max(crack, (1.0 - smoothstep(0.0, 0.012, abs(cr2 - 0.5))) * 0.55);
        float cr3 = fbm(vW.xz * 0.62 + 131.0, 3);
        crack = max(crack, (1.0 - smoothstep(0.0, 0.010, abs(cr3 - 0.5))) * 0.42 * f3);
        c += vec3(0.0055, 0.0080, 0.0122) * crack * f2 * (0.35 + 0.65 * (1.0 - pale));
        // blown snow lying in serpentine wisps — the near field is 40% of the
        // frame and without this it is one brown plate
        float wisp = fbm(skew * vW.xz * vec2(0.42, 0.085) + vec2(uTime * 0.05, 0.0), 4);
        float wispM = smoothstep(0.49, 0.62, wisp) * f2 * (0.30 + 0.70 * f3);
        c += (uPale * 4.2 + uSun * 0.030) * wispM;
        // and a scatter of frost facets that catch the low sun
        float glintN = fbm(vW.xz * 6.2 + 7.0, 2);
        float glintT = fbm(vW.xz * 6.2 + vec2(uTime * 0.34, uTime * 0.15) + 53.0, 2);
        float glint = smoothstep(0.545, 0.615, glintN) * f3 * smoothstep(0.44, 0.60, glintT);
        c += uSun * glint * 0.052;

        // ---- fresnel: at range the ice becomes a mirror of the sky. The near
        //      field is nowhere near grazing, so it stays deep and almost black.
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.6);
        vec3 Rv = reflect(-V, N);
        float relEl = clamp(Rv.y, 0.0, 1.0);
        vec3 skyRefl = mix(uSkyHor * 1.05, uSkyZen * 1.25, smoothstep(0.015, 0.34, relEl))
                     + uSun * 0.022 * (1.0 - smoothstep(0.010, 0.10, relEl));
        c = mix(c, skyRefl, clamp(fres, 0.0, 0.94) * 0.88);

        // ---- the column of gold. Micro-roughness rising with distance widens it
        //      into a path rather than a point, which is what a real one does.
        vec3 H = normalize(L + V);
        float rough = mix(52.0, 1600.0, exp(-d * 0.016));
        float spFall = exp(-d * 0.030);
        float sp = pow(max(dot(N, H), 0.0), rough) * spFall;
        float sheen = pow(max(dot(N, H), 0.0), 22.0) * spFall;
        vec3 path = uSun * (sp * 0.62 + sheen * 0.020);
        // the specular alone is too sparse; a corridor carries it, and the
        // corridor is GRANULAR — a real glitter path is ten thousand separate
        // facets, and an airbrushed wedge is the tell that it is not one.
        vec3 toSun = normalize(vec3(L.x, 0.0, L.z));
        vec2 rel = vW.xz - uCam.xz;
        float along = dot(rel, toSun.xz);
        float across = length(rel - toSun.xz * along);
        float corr = exp(-across * across / (1.2 + along * 0.22)) * smoothstep(0.0, 2.5, along);
        corr *= 0.22 + 0.78 * smoothstep(2.0, 46.0, along);   // brightest at the far end
        float gA = fbm(vW.xz * 9.0 + 17.0, 3);
        float gB = fbm(vW.xz * 34.0 + 3.0, 2);
        float tw = fbm(vW.xz * 9.0 + vec2(uTime * 0.26, uTime * 0.11) + 71.0, 2);
        float sparkle = smoothstep(0.505, 0.610, gA) * smoothstep(0.480, 0.600, gB)
                      * (0.62 + 0.62 * smoothstep(0.44, 0.60, tw));
        path += uSun * corr * (0.060 + 0.30 * sparkle * mix(0.30, 1.0, f2));
        c += path * (0.55 + 0.45 * pale) * (0.35 + 0.65 * uReveal);

        // ---- THE GUST. The cursor is a bearing, not a point: a lane of loose
        //      snow lifts and runs out along it, and sweeps across the lake as
        //      you move. This is the page's answer to the pointer, and it is on
        //      the ice because the ice is what fills the lower half of the frame.
        vec3 wdir = normalize(vec3(uPtrD.x, 0.0, uPtrD.z));
        vec2 relc = vW.xz - uCam.xz;
        float alongW = dot(relc, wdir.xz);
        float acrossW = length(relc - wdir.xz * alongW);
        float lane = exp(-acrossW * acrossW / (2.2 + alongW * 0.42))
                   * smoothstep(0.4, 3.0, alongW) * smoothstep(95.0, 16.0, alongW);
        vec2 wc = vec2(dot(relc, vec2(-wdir.z, wdir.x)), alongW);
        // 1.7 against a 0.055 frequency translated this pattern at THIRTY-ONE
        // METRES PER SECOND — a held cursor churned its own lane as completely
        // as a moved one did, which is the whole reason the response read zero.
        float gustN = fbm(wc * vec2(0.62, 0.055) + vec2(0.0, uTime * 0.075), 4);
        lane *= (0.42 + 0.95 * smoothstep(0.42, 0.64, gustN)) * uPtrK;
        c += (uPale * 2.5 + uSun * 0.030) * lane;

        // ---- the dog: contact shadow, and the warmth he throws back on the ice
        float dd = length(vW.xz - uDog.xz);
        c *= 1.0 - 0.66 * exp(-dd * dd / 0.30);
        c += vec3(0.80, 0.47, 0.19) * 0.0055 * exp(-dd * dd / 1.6) * uReveal;

        // ---- horizon haze, converging on the sky's own horizon so the shoreline
        //      never draws itself as a hard bright line across the frame
        float fog = 1.0 - exp(-d * 0.0022);
        c = mix(c, uHaze * 0.42 + uSun * 0.020 * pow(max(0.0, dot(normalize(vW.xz - uCam.xz), toSun.xz)), 5.0),
                clamp(fog, 0.0, 1.0));
        // ---- materialisation: the frost runs outward from under the lens, and
        //      RELEASES the rest of the disc as it finishes. The ring only ever
        //      reaches 2400m; the disc runs to 18000. Without the release every
        //      metre past the ring stays multiplied by zero for good, and since
        //      everything beyond 2400m projects into the single pixel row under
        //      the far shore, the lake drew a hard BLACK rule right across the
        //      frame — the same hairline the haze above is there to prevent,
        //      only in the other direction. The release is over by the time the
        //      materialisation is, and it lands on one row of a 900-row frame.
        float ring = uReveal * uReveal * 2400.0;
        float grown = smoothstep(0.0, 1.0, clamp((ring - d) / max(40.0, ring * 0.34), 0.0, 1.0));
        c *= max(grown, smoothstep(0.86, 1.0, uReveal));
        c += (h21(gl_FragCoord.xy * 0.7 + 7.7) - 0.5) * 0.0013;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }
    `,
  });
  /* The disc runs to the true horizon, not to the shoreline.
     The land is lifted BASE_Y clear of the ice to stop the two z-fighting, which
     means the land's nearest edge sits marginally ABOVE the ice's far edge on
     screen — and any disc that ends short leaves that half-pixel of below-horizon
     sky showing as a bright orange rule ruled across the whole frame. At 18 km
     the ice's own edge is above the land's and the seam closes. */
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(18000, 220), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  root.add(mesh);
  return { mesh, material };
}
