// Shader tweaks that make the low-poly props sit in the world:
// carved-stone detail and moss on the ruins, a dark algae line on everything the tide covers,
// plants that sway in the current, and coral that glows at night.
import * as THREE from 'three';
import { A } from './assets.js';
import { GLSL_NOISE } from './util.js';

// Shared by every patched material
export const propUniforms = { uTime: { value: 0 }, uGlow: { value: 0 }, uLevel: { value: 0 } };

const VERT_HEAD = `#include <common>
uniform float uTime;
varying vec3 vPW; varying vec3 vPN;`;
// World position and normal, with instancing
const VERT_WORLD = `
vec4 pw = vec4(transformed, 1.0);
vec3 pn = objectNormal;
#ifdef USE_INSTANCING
pw = instanceMatrix * pw; pn = mat3(instanceMatrix) * pn;
#endif
pw = modelMatrix * pw;
vPW = pw.xyz; vPN = normalize(mat3(modelMatrix) * pn);`;

// kind: 'stone' (triplanar carved detail + moss), 'wood', 'plant' (sway + glow), 'palm' (sway in the wind), 'plain'
export function patchMaterial(src, kind, opts = {}) {
  const mat = src.clone();
  if (mat.map) mat.map.anisotropy = 8;
  const stone = kind === 'stone', sway = kind === 'plant' || kind === 'palm', glow = kind === 'plant' && opts.glow;
  const glowColor = new THREE.Color(opts.glowColor ?? 0x40ffd8);
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, propUniforms);
    if (stone) Object.assign(sh.uniforms, { tStoneD: { value: A.tex[opts.tex || 'stone'].diff }, tStoneN: { value: A.tex[opts.tex || 'stone'].nor }, tMossD: { value: A.tex.moss.diff } });
    sh.uniforms.uGlowColor = { value: glowColor };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD);
    if (sway) {
      // Bend more the higher up the plant; each plant gets its own phase from where it stands
      const amt = kind === 'palm' ? '0.012' : '0.22';
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 base = vec3(0.0);
        #ifdef USE_INSTANCING
        base = instanceMatrix[3].xyz;
        #endif
        float ph = base.x * 0.37 + base.z * 0.21;
        float k = max(position.y, 0.0);
        float bend = k * k * ${amt};
        transformed.x += sin(uTime * 1.3 + ph) * bend;
        transformed.z += cos(uTime * 1.05 + ph * 1.7) * bend * 0.6;
      }`);
    }
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>' + VERT_WORLD);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uTime, uGlow, uLevel;
uniform vec3 uGlowColor;
${stone ? 'uniform sampler2D tStoneD, tStoneN, tMossD;' : ''}
varying vec3 vPW; varying vec3 vPN;
${GLSL_NOISE}`);
    let mapPart = '';
    if (stone) mapPart += `
{
  vec3 tn = normalize(vPN);
  vec3 bw = pow(abs(tn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec3 s = texture2D(tStoneD, vPW.zy / 2.5).rgb * bw.x + texture2D(tStoneD, vPW.xz / 2.5).rgb * bw.y + texture2D(tStoneD, vPW.xy / 2.5).rgb * bw.z;
  float lum = dot(s, vec3(0.299, 0.587, 0.114));
  vec3 hue = mix(vec3(lum), s, ${(opts.hue ?? 0.3).toFixed(2)}) / max(lum, 0.05);   // keep the stone grey-brown, not orange
  diffuseColor.rgb *= mix(vec3(1.0), hue * (0.45 + lum), 0.55) * (0.7 + lum * 1.1);
  // Moss on the tops of things
  float moss = smoothstep(0.55, 0.85, tn.y + (htNoise(vPW.xz * 0.8) - 0.5) * 0.5);
  vec3 m = texture2D(tMossD, vPW.xz / 2.0).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, m * vec3(0.8, 1.0, 0.7), moss * 0.75);
}`;
    // Everything below the high-tide line is darker, greener and speckled with barnacles
    mapPart += `
{
  float under = 1.0 - smoothstep(-0.3, 0.35 + (htNoise(vPW.xz * 3.0) - 0.5) * 0.4, vPW.y);
  float speck = smoothstep(2.05, 2.2, htNoise(vPW.xy * 7.0) + htNoise(vPW.yz * 7.0 + 5.0) + htNoise(vPW.zx * 7.0 + 9.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.66, 0.5) + speck * 0.12, under * ${kind === 'plant' ? '0.0' : '0.8'});
}`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>' + mapPart);
    if (stone) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 tn = normalize(vPN);
  vec3 bw = pow(abs(tn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec3 rX = texture2D(tStoneN, vPW.zy / 2.5).xyz * 2.0 - 1.0, rY = texture2D(tStoneN, vPW.xz / 2.5).xyz * 2.0 - 1.0, rZ = texture2D(tStoneN, vPW.xy / 2.5).xyz * 2.0 - 1.0;
  vec3 nW = normalize(tn + (vec3(0.0, rX.y, rX.x) * bw.x + vec3(rY.x, 0.0, rY.y) * bw.y + vec3(rZ.x, rZ.y, 0.0) * bw.z) * 0.9);
  normal = normalize(mix(normal, (viewMatrix * vec4(nW, 0.0)).xyz, 0.85));
}`);
    if (glow) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uGlowColor * uGlow * (0.55 + 0.45 * sin(uTime * 1.7 + vPW.x * 0.3 + vPW.z * 0.2));`);
  };
  mat.customProgramCacheKey = () => `ht-${kind}-${glow ? 1 : 0}-${opts.hue ?? 0.3}`;
  if (stone) { mat.roughness = Math.max(mat.roughness ?? 1, 0.85); mat.metalness = 0; }
  return mat;
}
