// The lagoon: four islands, a seabed of dunes and winding trenches, paved plazas under the ruins,
// and the atoll ring that holds the sea back while the Hollow is drained.
// Rendered with real ground textures blended by height and slope, plus caustics under water.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { fbm, ridge, smooth, lerp, clamp, rng, GLSL_NOISE } from './util.js';
import { A } from './assets.js';

// Height in metres before the ruin plazas are levelled. Sea level at high tide is 0.
export function baseHeight(x, z, seed) {
  const r = Math.hypot(x, z);
  // Lagoon floor: broad swells, smaller dunes and long trenches that keep water as tide pools
  let h = -8 + fbm(x * 0.0035, z * 0.0035, seed, 3) * 9 + fbm(x * 0.018, z * 0.018, seed + 5, 3) * 2.2;
  h -= Math.pow(ridge(x * 0.0042 + 3.1, z * 0.0042, seed + 3), 9) * 15;
  // Islands: a hill, a wide beach, then a slope into the lagoon
  for (const is of WORLD.islands) {
    const dx = x - is.x, dz = z - is.z, a = Math.atan2(dz, dx);
    const warp = 1 + fbm(Math.cos(a) * 1.3 + is.x * 0.01, Math.sin(a) * 1.3 + is.z * 0.01, seed + 31, 3) * 0.4;
    const d = Math.hypot(dx, dz) / (is.r * warp);
    if (d > 1.8) continue;
    const land = is.h * Math.pow(Math.max(0, 1 - d * d), 2) + 2.5 * (1 - smooth(0.6, 1.1, d)) - 6 * smooth(0.95, 1.6, d)
      + (fbm(x * 0.03, z * 0.03, seed + 40, 4) * 4.5 + fbm(x * 0.09, z * 0.09, seed + 44, 3) * 1.2) * (1 - smooth(0.45, 0.95, d));
    h = lerp(land, h, smooth(0.95, 1.7, d));
  }
  // The atoll ring, and the open ocean beyond it
  const crest = 4.5 + fbm(x * 0.02, z * 0.02, seed + 11, 4) * 3.5 + ridge(x * 0.05, z * 0.05, seed + 12) * 1.5;
  h = lerp(h, crest, smooth(WORLD.rim - 30, WORLD.rim + 5, r));
  h = lerp(h, -14, smooth(WORLD.rim + 30, WORLD.rim + 65, r));
  return h;
}

const TYPES = ['court', 'wreck', 'ziggurat', 'temple', 'garden', 'amphitheater', 'sentinel', 'henge', 'aqueduct', 'lighthouse'];
const RADIUS = { city: 46, wreck: 20, ziggurat: 21, amphitheater: 22, henge: 15, aqueduct: 31, lighthouse: 14 };
const PAVED = new Set(['city', 'court', 'temple', 'sentinel', 'ziggurat', 'amphitheater', 'lighthouse']);
export const CITY_NAMES = ['Old Vessara', 'The Sunken Quarter', 'Low Marrow'];
export const SITE_NAMES = ['The Drowned Court', 'Gullwing Wreck', 'The Moon Steps', 'Pillars of Ebb', 'Kelpfall Garden', 'The Sunken Choir', 'Stag of the Shallows',
  'The Tide Stones', 'The Long Thirst', 'Lastlight', 'Saltglass Ring', 'The Last Galleon', 'Pearlstair', 'Tidewarden Hall', 'Coral Cloister', 'The Quiet Stage',
  'Foxhollow Shrine', 'Brinewatch Circle', 'The Broken Span', 'Siltspire', 'The Hollow Crown', 'Anchorrest', 'Barnacle Basilica', 'Shellgate', 'Lanternfish Garden',
  'Undertow Theatre', 'The Weeping Stag', 'Driftmoor Stones', "Mariner's Folly", 'The Low Light', 'Seaglass Terrace', 'The Old Harbor', 'The Quiet Altar'];

// Where the ruin sites are (the same for everyone with the same seed): three city districts first, then the rest
export function planSites(seed) {
  const R = rng(seed * 7 + 1), sites = [];
  for (let tries = 0; sites.length < WORLD.sites && tries < 20000; tries++) {
    const city = sites.length < CITY_NAMES.length;
    const type = city ? 'city' : TYPES[(sites.length - CITY_NAMES.length) % TYPES.length], r = RADIUS[type] ?? 17 + R() * 6;
    const a = R() * Math.PI * 2, d = (city ? 190 : 110) + Math.sqrt(R()) * (city ? 380 : 540), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (d + r > WORLD.rim - 45) continue;
    if (WORLD.islands.some(is => Math.hypot(x - is.x, z - is.z) < is.r * 1.7 + r + 8)) continue;
    if (sites.some(s => Math.hypot(s.x - x, s.z - z) < s.r + r + (city ? 90 : 32))) continue;
    const h = baseHeight(x, z, seed);
    if (h < -14.5 || h > -3.5) continue;
    sites.push({ x, z, h, type, r, name: city ? CITY_NAMES[sites.length] : SITE_NAMES[sites.length - CITY_NAMES.length], pave: PAVED.has(type), seed: Math.floor(R() * 1e9) });
  }
  return sites;
}

// Old stone roads: every site is linked to its nearest already-linked neighbour, starting from Home Isle
export function planRoads(sites, seed) {
  const R = rng(seed * 11 + 5), home = WORLD.islands[0];
  const nodes = [{ x: home.x + home.r * 1.05, z: home.z + home.r * 0.4, r: 0 }], roads = [], left = [...sites];
  while (left.length) {
    let best = null;
    for (const s of left) for (const n of nodes) { const d = Math.hypot(s.x - n.x, s.z - n.z); if (!best || d < best.d) best = { s, n, d }; }
    left.splice(left.indexOf(best.s), 1); nodes.push(best.s);
    // A gentle bend in the middle so the roads don't look ruled
    const mx = (best.s.x + best.n.x) / 2 + (R() - 0.5) * best.d * 0.22, mz = (best.s.z + best.n.z) / 2 + (R() - 0.5) * best.d * 0.22;
    roads.push([best.n.x, best.n.z, mx, mz], [mx, mz, best.s.x, best.s.z]);
  }
  return roads;
}

export class Terrain {
  constructor(seed, sites, quality = 'medium') {
    this.seed = seed; this.sites = sites;
    this.roads = planRoads(sites, seed);
    const N = WORLD.segments, S = WORLD.size;
    this.N = N; this.S = S; this.step = S / N;
    // One height grid shared by the mesh and the physics, so your feet always match the ground you see
    this.h = new Float32Array((N + 1) * (N + 1));
    this.pave = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -S / 2 + i * this.step, z = -S / 2 + j * this.step;
      let h = baseHeight(x, z, seed), pave = 0;
      for (const s of sites) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d > s.r + 16) continue;
        h = lerp(h, s.h, smooth(s.r + 15, s.r - 2, d) * 0.92);
        if (s.pave) pave = Math.max(pave, smooth(s.r - 1, s.r - 7, d));
      }
      const k = j * (N + 1) + i;
      this.h[k] = h; this.pave[k] = pave;
    }
    // Paint the roads (only where the seabed is walkable at low tide)
    for (const [ax, az, bx, bz] of this.roads) {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 5 + S / 2) / this.step)), i1 = Math.min(N, Math.ceil((Math.max(ax, bx) + 5 + S / 2) / this.step));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - 5 + S / 2) / this.step)), j1 = Math.min(N, Math.ceil((Math.max(az, bz) + 5 + S / 2) / this.step));
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -S / 2 + i * this.step, z = -S / 2 + j * this.step, k = j * (N + 1) + i;
        if (this.h[k] < -17.5 || this.h[k] > 0.5) continue;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        this.pave[k] = Math.max(this.pave[k], smooth(4.2, 1.6, d) * 0.9);
      }
    }
    this.uniforms = { uLevel: { value: 0 }, uTime: { value: 0 }, uCaustic: { value: 1 } };
    this.mesh = this._mesh(quality === 'low' ? 2 : 1);
    this.heightTex = this._heightTexture();
  }

  // Bilinear height at any point
  heightAt(x, z) {
    const N = this.N, S = this.S;
    const fx = clamp((x + S / 2) / this.step, 0, N - 0.001), fz = clamp((z + S / 2) / this.step, 0, N - 0.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * (N + 1) + i;
    return lerp(lerp(this.h[k], this.h[k + 1], u), lerp(this.h[k + N + 1], this.h[k + N + 2], u), v);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.8;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  // What you're standing on (for footstep sounds); mirrors the shader's blend roughly
  surfaceAt(x, z) {
    const y = this.heightAt(x, z), n = this.normalAt(x, z);
    if (1 - n.y > 0.32) return 'stone';
    const N = this.N, S = this.S, i = Math.round(clamp((x + S / 2) / this.step, 0, N)), j = Math.round(clamp((z + S / 2) / this.step, 0, N));
    if (this.pave[j * (N + 1) + i] > 0.5) return 'stone';
    return y > 2.8 ? 'grass' : 'sand';
  }

  _heightTexture() {
    // Seabed height for the water shader (depth colour and shoreline foam), -40..30 m in one byte
    const N = this.N + 1, data = new Uint8Array(N * N);
    for (let k = 0; k < data.length; k++) data[k] = clamp(Math.round((this.h[k] + 40) / 70 * 255), 0, 255);
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    tex.unpackAlignment = 1; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    return tex;
  }

  _mesh(stride) {
    const N = this.N, S = this.S, M = N / stride;
    const geo = new THREE.PlaneGeometry(S, S, M, M);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, pave = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const i = Math.round((pos.getX(k) + S / 2) / this.step), j = Math.round((pos.getZ(k) + S / 2) / this.step);
      pos.setY(k, this.h[j * (N + 1) + i]); pave[k] = this.pave[j * (N + 1) + i];
    }
    geo.setAttribute('aPave', new THREE.BufferAttribute(pave, 1));
    geo.computeVertexNormals();
    const T = A.tex;
    const maps = {
      tSandD: T.sand.diff, tSandN: T.sand.nor, tGrassD: T.grass.diff, tGrassN: T.grass.nor, tRockD: T.rock.diff, tRockN: T.rock.nor,
      tMudD: T.mud.diff, tMudN: T.mud.nor, tPaveD: T.brick.diff, tPaveN: T.brick.nor
    };
    for (const [k, v] of Object.entries(maps)) this.uniforms[k] = { value: v };
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPave;\nvarying vec3 vTW;\nvarying vec3 vTN;\nvarying float vPave;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);\nvPave = aPave;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D ${Object.keys(maps).join(', ')};
uniform float uLevel, uTime, uCaustic;
varying vec3 vTW; varying vec3 vTN; varying float vPave;
${GLSL_NOISE}
float gGrass, gRock, gMud, gPave, gWet;`)
        .replace('#include <map_fragment>', /* glsl */`
vec2 wuv = vTW.xz;
vec3 tn = normalize(vTN);
float slope = 1.0 - tn.y;
float nA = htFbm(wuv * 0.035), nB = htNoise(wuv * 0.25);
float hgt = vTW.y + (nA - 0.5) * 2.5;
gMud = 1.0 - smoothstep(-6.0, -2.0, hgt);
gGrass = smoothstep(2.2, 3.4, hgt + nB - 0.5) * (1.0 - smoothstep(0.16, 0.3, slope));
gRock = smoothstep(0.26, 0.42, slope + (nA - 0.5) * 0.2);
gPave = vPave * smoothstep(0.42, 0.6, htNoise(wuv * 0.13) * 0.55 + vPave * 0.6);
vec2 uvS = wuv / 3.5, uvG = wuv / 4.0, uvM = wuv / 5.0, uvP = wuv / 3.0;
vec3 bw = pow(abs(tn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
vec3 col = texture2D(tSandD, uvS).rgb;
col = mix(col, texture2D(tMudD, uvM).rgb, gMud);
col = mix(col, texture2D(tGrassD, uvG).rgb * vec3(0.74, 1.1, 0.58), gGrass);
col = mix(col, texture2D(tPaveD, uvP).rgb, gPave);
vec3 cR = texture2D(tRockD, vTW.zy / 7.0).rgb * bw.x + texture2D(tRockD, wuv / 7.0).rgb * bw.y + texture2D(tRockD, vTW.xy / 7.0).rgb * bw.z;
col = mix(col, cR, gRock);
col *= 0.82 + 0.36 * htFbm(wuv * 0.008 + 3.0);
gWet = 1.0 - smoothstep(-0.2, 0.6, vTW.y);
col = mix(col, col * vec3(0.6, 0.66, 0.62), gWet * 0.85);
col = mix(col, col * vec3(0.72, 0.88, 0.62), gWet * gRock * 0.7);
col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.8, vTW.y - uLevel));
diffuseColor.rgb *= col;`)
        .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = mix(0.95, 0.55, gWet);
roughnessFactor = mix(roughnessFactor, 0.3, (1.0 - smoothstep(0.0, 0.6, vTW.y - uLevel)) * 0.8);`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
vec3 nT = texture2D(tSandN, uvS).xyz * 2.0 - 1.0;
nT = mix(nT, texture2D(tMudN, uvM).xyz * 2.0 - 1.0, gMud);
nT = mix(nT, texture2D(tGrassN, uvG).xyz * 2.0 - 1.0, gGrass);
nT = mix(nT, texture2D(tPaveN, uvP).xyz * 2.0 - 1.0, gPave);
vec3 nW = normalize(tn * max(nT.z, 0.2) + vec3(nT.x, 0.0, nT.y) * 0.9);
vec3 rX = texture2D(tRockN, vTW.zy / 7.0).xyz * 2.0 - 1.0;
vec3 rY = texture2D(tRockN, wuv / 7.0).xyz * 2.0 - 1.0;
vec3 rZ = texture2D(tRockN, vTW.xy / 7.0).xyz * 2.0 - 1.0;
vec3 nR = normalize(tn + (vec3(0.0, rX.y, rX.x) * bw.x + vec3(rY.x, 0.0, rY.y) * bw.y + vec3(rZ.x, rZ.y, 0.0) * bw.z) * 1.2);
nW = normalize(mix(nW, nR, gRock));
normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
        .replace('#include <emissivemap_fragment>', `
float wd = uLevel - vTW.y;
if (wd > 0.0) {
  float cau = htCaustic(vTW.xz * 0.22, uTime * 1.3);
  totalEmissiveRadiance += vec3(0.6, 0.9, 1.0) * cau * uCaustic * smoothstep(0.0, 1.2, wd) * exp(-wd * 0.07) * diffuseColor.rgb * 1.4;
}`);
    };
    mat.customProgramCacheKey = () => 'ht-terrain';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = true;
    return mesh;
  }

  update(time, level, caustic) {
    this.uniforms.uTime.value = time; this.uniforms.uLevel.value = level; this.uniforms.uCaustic.value = caustic;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.heightTex.dispose(); }
}
