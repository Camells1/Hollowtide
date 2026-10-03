// Buildings made from stone blocks: the abandoned city districts (ruined houses with stairs and upper
// floors, a plaza with an obelisk, a watchtower, city walls), the stepped temple, the amphitheatre,
// the standing stones, the aqueduct and the lighthouse. Every block is also a collider, so you can
// climb the stairs, walk along wall tops and shelter on high ground when the flood comes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD } from './config.js';
import { patchMaterial } from './materials.js';

const TAU = Math.PI * 2, CHUNKS = 4;
let MATS = null;
function materials() {
  if (MATS) return MATS;
  const base = color => new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.95 });
  MATS = {
    brick: patchMaterial(base(0xcabfa8), 'stone', { tex: 'brick', hue: 0.45 }),
    stone: patchMaterial(base(0xb9b09c), 'stone', { tex: 'stone', hue: 0.3 }),
    dark: patchMaterial(base(0x9a958b), 'stone', { tex: 'rock', hue: 0.2 }),
    wood: patchMaterial(base(0x9a7a58), 'stone', { tex: 'planks', hue: 0.6 })
  };
  return MATS;
}

export class Builder {
  constructor(world) { this.w = world; this.parts = new Map(); this.beacons = []; }

  _add(mat, geo, x, z, tint = 1) {
    const n = geo.attributes.position.count, col = new Float32Array(n * 3).fill(tint);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const h = WORLD.size / 2, st = WORLD.size / CHUNKS;
    const ci = Math.min(CHUNKS - 1, Math.max(0, Math.floor((x + h) / st))), cj = Math.min(CHUNKS - 1, Math.max(0, Math.floor((z + h) / st)));
    const key = mat + '|' + (ci * CHUNKS + cj);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
  }

  // A block standing on height y. o: { ry, walk (default true), collide, under (open underneath: you can walk below it), tint }
  box(mat, x, y, z, sx, sy, sz, o = {}) {
    if (sy <= 0.02) return;
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(o.ry || 0); g.translate(x, y + sy / 2, z);
    this._add(mat, g, x, z, o.tint ?? 0.88 + Math.random() * 0.2);
    if (o.collide !== false) this.w.addBox({ x, z, hx: sx / 2, hz: sz / 2, ry: o.ry || 0, top: y + sy, bottom: o.under ? y : undefined, walk: o.walk !== false });
  }
  // A round or many-sided pillar. o: { seg, walk, collide, tint, ry }
  cyl(mat, x, y, z, rTop, rBot, h, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 14);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y + h / 2, z);
    this._add(mat, g, x, z, o.tint ?? 0.9 + Math.random() * 0.15);
    if (o.collide !== false) this.w.addCollider({ x, z, r: Math.max(rTop, rBot) * (o.seg === 4 ? 0.75 : 0.97), top: y + h, walk: o.walk !== false });
  }

  finish(chunks, shadows) {
    const M = materials();
    for (const [key, list] of this.parts) {
      const [mat, chunk] = key.split('|');
      const mesh = new THREE.Mesh(mergeGeometries(list), M[mat]);
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      chunks[+chunk].add(mesh);
      for (const g of list) g.dispose();
    }
    this.parts.clear();
  }
}

// ---------------------------------------------------------------- a ruined house
// Walls broken off at different heights, a doorway, window holes, and (two-storey houses) inside stairs
// up to what's left of the upper floor. Returns places a chest could stand.
function house(B, R, x, z, w, d, ry, floors) {
  const H = 3, t = 0.45, y0 = B.w.footY(x, z, Math.max(w, d) / 2) - 0.25;
  const c = Math.cos(ry), s = Math.sin(ry), L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const sides = [{ ax: 0, az: -d / 2, len: w, alongX: true, front: true }, { ax: 0, az: d / 2, len: w, alongX: true }, { ax: -w / 2, az: 0, len: d, alongX: false }, { ax: w / 2, az: 0, len: d, alongX: false }];
  for (const sd of sides) {
    const n = Math.max(2, Math.round(sd.len / 2.1)), seg = sd.len / n;
    for (let k = 0; k < n; k++) {
      const off = -sd.len / 2 + seg * (k + 0.5), [px, pz] = sd.alongX ? L(sd.ax + off, sd.az) : L(sd.ax, sd.az + off);
      const sx = sd.alongX ? seg + 0.02 : t, sz = sd.alongX ? t : seg + 0.02;
      const corner = k === 0 || k === n - 1;
      const hgt = floors * H * Math.min(1, (0.35 + R() * 0.65) * (corner ? 1.2 : 1));
      if (sd.front && k === Math.floor(n / 2)) { if (hgt > 2.7) B.box('brick', px, y0 + 2.3, pz, sx, hgt - 2.3, sz, { ry, under: true }); continue; } // doorway
      if (hgt > 2.6 && R() < 0.32) { B.box('brick', px, y0, pz, sx, 1.0, sz, { ry }); B.box('brick', px, y0 + 2.1, pz, sx, hgt - 2.1, sz, { ry, under: true }); } // window
      else B.box('brick', px, y0, pz, sx, hgt, sz, { ry });
    }
  }
  const spots = [[...L(w * 0.15, d * 0.1), undefined]];
  if (floors > 1) {
    // What's left of the upper floor at the back, with stairs up the left wall
    const depth = d * 0.42, zs = d / 2 - t - depth;
    const [sx2, sz2] = L(0, zs + depth / 2);
    B.box('wood', sx2, y0 + H - 0.28, sz2, w - t * 2, 0.28, depth, { ry, under: true });
    for (let j = 0; j < 6; j++) { const [px, pz] = L(-w / 2 + t + 0.65, zs - (5 - j + 0.5) * 0.46); B.box('stone', px, y0, pz, 1.2, (j + 1) * 0.5, 0.48, { ry }); }
    spots.push([...L(w * 0.2, zs + depth / 2), y0 + H]);
  }
  return spots;
}

// ---------------------------------------------------------------- site kinds
export const BUILDERS = {
  // An abandoned city district: streets of ruined houses around a plaza with an obelisk
  city(B, s, R) {
    const w = B.w, base = R() * TAU, c = Math.cos(base), sn = Math.sin(base), L = (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
    s.spots = [];
    for (let i = -1.5; i <= 1.5; i++) for (let j = -1.5; j <= 1.5; j++) {
      if (Math.abs(i) < 1 && Math.abs(j) < 1) continue;                         // the plaza
      const [x, z] = L(i * 17 + (R() - 0.5) * 3, j * 17 + (R() - 0.5) * 3);
      if (R() < 0.14) { for (let k = 0; k < 4; k++) w.put(['rock1', 'rock2', 'rocks'][k % 3], x + (R() - 0.5) * 6, z + (R() - 0.5) * 6, { size: 0.8 + R() * 1.6, ry: R() * TAU, bury: 0.3, walk: true }); continue; }
      const two = R() < 0.5;
      s.spots.push(...house(B, R, x, z, 7 + R() * 3.5, two ? 7.2 + R() * 2 : 6 + R() * 3, base + (R() < 0.5 ? 0 : Math.PI / 2), two ? 2 : 1));
    }
    // Plaza: three steps, an obelisk and four columns
    const y0 = w.footY(s.x, s.z, 5) - 0.2;
    for (let k = 0; k < 3; k++) B.box('stone', s.x, y0, s.z, 9 - k * 2, (k + 1) * 0.4, 9 - k * 2, { ry: base });
    B.cyl('stone', s.x, y0 + 1.2, s.z, 0.45, 0.95, 11, { seg: 4, ry: base + Math.PI / 4, walk: false });
    B.cyl('stone', s.x, y0 + 12.2, s.z, 0.02, 0.45, 1.1, { seg: 4, ry: base + Math.PI / 4, collide: false });
    for (let k = 0; k < 4; k++) { const [x, z] = L(Math.cos(k * TAU / 4 + 0.78) * 9.5, Math.sin(k * TAU / 4 + 0.78) * 9.5); w.put('column_round', x, z, { size: 4.5 + R() * 2, collide: 0.9 }); }
    // A watchtower on one corner and a stretch of city wall with a gate
    const [tx, tz] = L(-36, -36), ty = w.footY(tx, tz, 3) - 0.3;
    B.cyl('stone', tx, ty, tz, 3.0, 3.5, 13, { seg: 12, walk: true });
    for (let k = 0; k < 8; k += 2) B.box('stone', tx + Math.cos(k / 8 * TAU) * 2.6, ty + 13, tz + Math.sin(k / 8 * TAU) * 2.6, 1.1, 1, 0.6, { ry: -k / 8 * TAU + Math.PI / 2 });
    for (let k = -3; k <= 3; k++) {
      if (k === 0) { const [gx, gz] = L(0, -40); w.put('arch', gx, gz, { size: 8.5, ry: base, collide: 0.3 }); continue; }
      const [x, z] = L(k * 6.4, -40), hh = 2.5 + R() * 3;
      B.box('brick', x, w.footY(x, z, 2.5) - 0.3, z, 6.3, hh, 1.3, { ry: base });
    }
    s.chests = 6;
  },

  // A stepped temple with a stair up the front. The top stays dry at high tide.
  ziggurat(B, s, R) {
    const w = B.w, ry = R() * TAU, c = Math.cos(ry), sn = Math.sin(ry), L = (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
    const y0 = w.footY(s.x, s.z, 13) - 0.3, N = 6, TH = 1.4, IN = 2.2, half0 = 13;
    for (let k = 0; k < N; k++) {
      const half = half0 - k * IN;
      B.box(k % 2 ? 'brick' : 'stone', s.x, y0, s.z, half * 2, (k + 1) * TH, half * 2, { ry });
      for (let j = 0; j < 4; j++) { const [x, z] = L(0, -half - IN + (j + 0.5) * 0.55); B.box('stone', x, y0 + k * TH, z, 3.2, (j + 1) * 0.35, 0.56, { ry }); }
    }
    const top = y0 + N * TH, halfT = half0 - (N - 1) * IN;
    B.box('stone', s.x, top, s.z, 2.2, 0.9, 1.3, { ry });
    for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [x, z] = L(ax * (halfT - 0.5), az * (halfT - 0.5)); B.cyl('stone', x, top, z, 0.28, 0.34, 2.6 + R() * 1.4, { seg: 10 }); }
    s.spots = [[...L(1.9, 0.4), top], [...L(-1.9, -0.3), top], [...L(half0 + 3, 4), undefined], [...L(-half0 - 3, -5), undefined]];
  },

  // Curved rows of stone seats facing a stage
  amphitheater(B, s, R) {
    const w = B.w, a0 = R() * TAU, y0 = w.footY(s.x, s.z, 14) - 0.25;
    for (let k = 0; k < 6; k++) {
      const r = 8.5 + k * 1.5, n = 12 + k * 2;
      for (let i = 0; i < n; i++) {
        if (R() < 0.07) continue; // missing blocks
        const th = a0 - 1.75 + (i + 0.5) / n * 3.5, x = s.x + Math.cos(th) * r, z = s.z + Math.sin(th) * r;
        B.box(k % 2 ? 'stone' : 'brick', x, y0, z, r * 3.5 / n + 0.12, (k + 1) * 0.45, 1.52, { ry: Math.atan2(-Math.cos(th), -Math.sin(th)) });
      }
    }
    const bx = s.x - Math.cos(a0) * 3, bz = s.z - Math.sin(a0) * 3;
    B.box('stone', bx, y0, bz, 5, 0.5, 11, { ry: -a0 });
    w.put('arch', s.x - Math.cos(a0) * 5.2, s.z - Math.sin(a0) * 5.2, { size: 7, ry: -a0 + Math.PI / 2, y: y0 + 0.4, collide: 0.3 });
    for (const sd of [-1, 1]) w.put('column2', bx - Math.sin(a0) * 4.6 * sd - Math.cos(a0) * 1.5, bz + Math.cos(a0) * 4.6 * sd - Math.sin(a0) * 1.5, { size: 6, y: y0 + 0.4, collide: 0.7 });
    s.spots = [[bx, bz, y0 + 0.5], [s.x + Math.cos(a0) * 4, s.z + Math.sin(a0) * 4, undefined], [s.x + Math.cos(a0 + 0.9) * 16.5, s.z + Math.sin(a0 + 0.9) * 16.5, y0 + 6 * 0.45]];
  },

  // A ring of standing stones around an altar
  henge(B, s, R) {
    const w = B.w, n = 10, r = 10.5, a0 = R() * TAU;
    let prev = null;
    for (let k = 0; k < n; k++) {
      const th = a0 + k / n * TAU, x = s.x + Math.cos(th) * r, z = s.z + Math.sin(th) * r, y = w.footY(x, z, 1) - 0.5;
      const gone = R() < 0.15, hh = gone ? 1 + R() : 4.6 + R() * 1.2, ry = Math.atan2(-Math.cos(th), -Math.sin(th));
      B.box('dark', x, y, z, 1.7, hh, 1.0, { ry });
      if (prev && !gone && !prev.gone && R() < 0.6) {
        const mx = (x + prev.x) / 2, mz = (z + prev.z) / 2, len = Math.hypot(x - prev.x, z - prev.z) + 1.4, top = Math.min(y + hh, prev.y + prev.hh);
        B.box('dark', mx, top, mz, len, 0.8, 1.1, { ry: Math.atan2(-(z - prev.z), x - prev.x), under: true });
      }
      prev = { x, z, y, hh, gone };
    }
    const y0 = w.footY(s.x, s.z, 2) - 0.2;
    B.box('dark', s.x, y0, s.z, 2.8, 1.0, 1.5, { ry: a0 });
    s.spots = [[s.x + Math.cos(a0) * 2.6, s.z + Math.sin(a0) * 2.6, undefined], [s.x - Math.cos(a0) * 3, s.z - Math.sin(a0) * 3, undefined], [s.x + Math.cos(a0 + 2) * 6, s.z + Math.sin(a0 + 2) * 6, undefined]];
  },

  // A broken aqueduct: tall piers, a walkway along the top (dry at high tide) and stairs at one end
  aqueduct(B, s, R) {
    const w = B.w, dir = R() * TAU, dx = Math.cos(dir), dz = Math.sin(dir), ry = -dir, span = 7, n = 8;
    const deck = Math.max(s.h + 9.5, 1.6);
    for (let k = 0; k <= n; k++) {
      const t = (k - n / 2) * span, x = s.x + dx * t, z = s.z + dz * t, y = w.footY(x, z, 1.5) - 0.5;
      B.box('brick', x, y, z, 2.1, deck - 0.35 - y, 2.6, { ry });
      B.box('stone', x, deck - 0.35, z, 2.8, 0.35, 3.1, { ry });
      if (k < n) {
        const broken = k === 2 || k === 5, len = broken ? span - 2.3 : span - 2.1, mid = t + (broken ? span / 2 - 1.15 : span / 2);
        B.box('brick', s.x + dx * mid, deck - 0.9, s.z + dz * mid, len, 0.9, 2.6, { ry, under: true });
      }
    }
    // Stairs up from the seabed at the first pier
    const t0 = -n / 2 * span - 1.2, steps = Math.ceil((deck - s.h) / 0.45);
    for (let j = 0; j < steps; j++) {
      const t = t0 - (steps - j - 0.5) * 0.5, x = s.x + dx * t, z = s.z + dz * t, y = w.footY(x, z, 1) - 0.4, top = deck - (steps - j - 1) * 0.45;
      if (top > y + 0.1) B.box('stone', x, y, z, 0.52, top - y, 2.2, { ry });
    }
    s.spots = [[s.x + dx * 3.5, s.z + dz * 3.5, deck], [s.x - dx * 17.5 + dz * 4, s.z - dz * 17.5 - dx * 4, undefined], [s.x + dx * 21 - dz * 4, s.z + dz * 21 + dx * 4, undefined]];
  },

  // A lighthouse on a stepped base. Its lamp turns at night; you can see it from across the lagoon.
  lighthouse(B, s, R) {
    const w = B.w, y0 = w.footY(s.x, s.z, 8) - 0.4, hgt = Math.max(30, 22 - s.h);
    B.cyl('stone', s.x, y0, s.z, 8, 8.4, 1.0, { seg: 20 });
    B.cyl('brick', s.x, y0 + 1, s.z, 6, 6.2, 1.0, { seg: 20 });
    B.cyl('brick', s.x, y0 + 2, s.z, 2.9, 4.2, hgt, { seg: 16, walk: false });
    B.cyl('stone', s.x, y0 + 2 + hgt, s.z, 3.8, 3.4, 0.6, { seg: 16, collide: false });
    B.cyl('dark', s.x, y0 + 5.6 + hgt, s.z, 0.2, 2.6, 2.2, { seg: 12, collide: false });
    B.beacons.push({ x: s.x, y: y0 + 2.6 + hgt + 1.5, z: s.z });
    for (let k = 0; k < 5; k++) { const a = R() * TAU; w.put('rock_large', s.x + Math.cos(a) * (9 + R() * 4), s.z + Math.sin(a) * (9 + R() * 4), { size: 2 + R() * 3, ry: R() * TAU, bury: 0.3, collide: 0.6 }); }
    s.spots = [[s.x + 7, s.z, y0 + 1], [s.x - 4.9, s.z + 4.9, y0 + 2], [s.x, s.z - 11, undefined]];
  }
};
