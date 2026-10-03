// Everything placed on the terrain: 28 ruin sites of five kinds (courts, temples, shipwrecks,
// coral gardens and giant sentinels), the camps on each island, palms, rocks, coral and kelp.
// Props are drawn instanced, in chunks, so a lagoon this size stays fast.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { rng, clamp } from './util.js';
import { A, instance } from './assets.js';
import { patchMaterial, propUniforms } from './materials.js';

// How each model is drawn: kind (see materials.js), size by height or by length, shadows
const PROPS = {
  column1: { kind: 'stone' }, column2: { kind: 'stone' }, column_round: { kind: 'stone' }, arch: { kind: 'stone' }, pedestal: { kind: 'stone' },
  stag_statue: { kind: 'stone' }, fox_statue: { kind: 'stone' },
  rock1: { kind: 'stone' }, rock2: { kind: 'stone' }, rocks: { kind: 'stone' }, rock_large: { kind: 'stone' },
  shipwreck: { kind: 'wood', by: 'long' }, barrel: { kind: 'wood' }, anchor: { kind: 'wood' }, dock: { kind: 'wood', by: 'long' },
  ocean_chest: { kind: 'wood', by: 'long' }, bonfire: { kind: 'plain' }, tent: { kind: 'plain' },
  palm1: { kind: 'palm' }, palm2: { kind: 'palm' }, palm3: { kind: 'palm' },
  seaweed: { kind: 'plant', glow: 0x3fffd0, shadow: false }
};
for (let i = 0; i < 8; i++) PROPS['coral:' + i] = { kind: 'plant', glow: [0xff6ad5, 0x9a7bff, 0xffa24a, 0x52ffd9][i % 4], shadow: false };
const CHUNKS = 4;
const TAU = Math.PI * 2;

const templates = new Map();
// A model flattened into parts, scaled to 1 m tall (or long) and standing on the origin
function template(name) {
  if (templates.has(name)) return templates.get(name);
  const def = PROPS[name] || { kind: 'plain' };
  const [base, idx] = name.split(':');
  const src = A.models[base].scene;
  src.updateMatrixWorld(true);
  let meshes = [];
  src.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (idx !== undefined) meshes = [meshes[+idx % meshes.length]];
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); box.union(tmp); }
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = 1 / (def.by === 'long' ? Math.max(size.x, size.z) : size.y);
  const norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const mats = new Map();
  const parts = meshes.map(m => {
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const patched = list.map(mt => { if (!mats.has(mt)) mats.set(mt, patchMaterial(mt, def.kind, { glow: def.glow != null, glowColor: def.glow })); return mats.get(mt); });
    return { geometry: m.geometry, material: Array.isArray(m.material) ? patched : patched[0], matrix: norm.clone().multiply(m.matrixWorld) };
  });
  const t = { parts, radius: Math.max(size.x, size.z) * k / 2, height: size.y * k, length: Math.max(size.x, size.z) * k, longX: size.x >= size.z, shadow: def.shadow !== false };
  templates.set(name, t);
  return t;
}

export class World {
  constructor(scene, terrain, seed, quality = 'medium') {
    this.scene = scene; this.terrain = terrain; this.seed = seed; this.quality = quality;
    this.sites = terrain.sites;
    this.cells = new Map();   // collider spatial hash (16 m cells)
    this.camps = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.placed = new Map();  // model -> chunk -> [Matrix4]
    this.chunks = [];
    const R = rng(seed * 7 + 3);
    this.density = quality === 'low' ? 0.5 : 1;
    this.sites.forEach((s, i) => this._site(s, i));
    this._camps();
    this._scatter(R);
    this._build();
    // Two campfire lights follow the two nearest camps
    this.fireLights = [0, 1].map(() => { const l = new THREE.PointLight(0xff8a3a, 0, 26, 1.7); this.group.add(l); return l; });
  }

  ground(x, z) { return this.terrain.heightAt(x, z); }

  // Ground under your feet including things you can stand on (fallen columns, plinths, the dock).
  // y: your current height (only surfaces up to a small step above it count)
  standAt(x, z, y = Infinity) {
    let g = this.terrain.heightAt(x, z);
    for (const c of this.collidersAt(x, z)) {
      if (!c.walk || c.top > y + 0.55 || c.top <= g) continue;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) g = c.top;
    }
    return g;
  }

  // ---------------------------------------------------------------- colliders
  _key(i, j) { return i * 4096 + j; }
  addCollider(c) {
    const i0 = Math.floor((c.x - c.r - 1) / 16), i1 = Math.floor((c.x + c.r + 1) / 16), j0 = Math.floor((c.z - c.r - 1) / 16), j1 = Math.floor((c.z + c.r + 1) / 16);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this._key(i, j);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(c);
    }
    return c;
  }
  collidersAt(x, z) { return this.cells.get(this._key(Math.floor(x / 16), Math.floor(z / 16))) || EMPTY; }
  blocked(x, z, pad = 0.5) { return this.collidersAt(x, z).some(c => Math.hypot(c.x - x, c.z - z) < c.r + pad); }

  // ---------------------------------------------------------------- placing props
  // Adds one instance. o: { size, ry, y, sink, tilt, lay, sy, collide (false | radius scale), walk }
  put(name, x, z, o = {}) {
    const t = template(name), size = o.size ?? 1, ry = o.ry ?? 0;
    let y = o.y ?? this.ground(x, z) - (o.sink ?? 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(o.tiltX ?? 0, ry, o.tiltZ ?? 0, 'YXZ');
    let px = x, pz = z;
    if (o.lay) {
      // Lying on its side: the model's up axis points along the ground
      e.set(0, ry, Math.PI / 2, 'YXZ');
      const len = t.height * size, rad = t.radius * size, dx = -Math.cos(ry), dz = Math.sin(ry);
      px = x - dx * len / 2; pz = z - dz * len / 2;
      y = this.ground(x, z) + rad * 0.75;
      for (let s = -len / 2 + rad; s <= len / 2 - rad + 0.01; s += Math.max(0.8, rad)) {
        this.addCollider({ x: x + dx * s, z: z + dz * s, r: rad * 0.95, top: y + rad, walk: true });
      }
    } else if (o.collide !== false) {
      const r = t.radius * size * (o.collide ?? 0.75);
      if (r > 0.25) this.addCollider({ x, z, r, top: y + t.height * size * (o.sy ?? 1), walk: !!o.walk });
    }
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(size, size * (o.sy ?? 1), size));
    const ci = clamp(Math.floor((x + WORLD.size / 2) / (WORLD.size / CHUNKS)), 0, CHUNKS - 1), cj = clamp(Math.floor((z + WORLD.size / 2) / (WORLD.size / CHUNKS)), 0, CHUNKS - 1);
    if (!this.placed.has(name)) this.placed.set(name, new Map());
    const byChunk = this.placed.get(name), key = ci * CHUNKS + cj;
    if (!byChunk.has(key)) byChunk.set(key, []);
    byChunk.get(key).push(m);
    return { y, top: y + t.height * size * (o.sy ?? 1), radius: t.radius * size };
  }

  _build() {
    const step = WORLD.size / CHUNKS;
    for (let ci = 0; ci < CHUNKS; ci++) for (let cj = 0; cj < CHUNKS; cj++) {
      const g = new THREE.Group();
      g.userData.cx = -WORLD.size / 2 + (ci + 0.5) * step; g.userData.cz = -WORLD.size / 2 + (cj + 0.5) * step;
      this.chunks[ci * CHUNKS + cj] = g; this.group.add(g);
    }
    const tmp = new THREE.Matrix4();
    for (const [name, byChunk] of this.placed) {
      const t = template(name);
      for (const [key, list] of byChunk) for (const part of t.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, part.matrix)));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = t.shadow && this.quality !== 'low'; im.receiveShadow = true;
        this.chunks[key].add(im);
      }
    }
  }

  // ---------------------------------------------------------------- ruin sites
  _site(s, si) {
    const R = rng(s.seed), g = (x, z) => this.ground(x, z);
    s.spots = [];
    const at = (a, d) => [s.x + Math.cos(a) * d, s.z + Math.sin(a) * d];
    const column = (x, z, tall) => {
      const model = R() < 0.5 ? 'column1' : 'column2';
      if (R() < 0.33) this.put(model, x, z, { size: (tall ?? 7) * (0.25 + R() * 0.3), ry: R() * TAU, walk: true, collide: 0.8 }); // broken stump
      else this.put(model, x, z, { size: (tall ?? 7) * (0.9 + R() * 0.25), ry: R() * TAU, tiltZ: (R() - 0.5) * 0.08, collide: 0.7 });
    };
    const fallen = () => { const [x, z] = at(R() * TAU, R() * s.r * 0.7); this.put('column_round', x, z, { size: 5 + R() * 3, ry: R() * TAU, lay: true }); };
    const rocks = n => { for (let k = 0; k < n; k++) { const [x, z] = at(R() * TAU, s.r * (0.5 + R() * 0.7)); this.put(['rock1', 'rock2', 'rocks'][k % 3], x, z, { size: 0.8 + R() * 1.8, ry: R() * TAU, sink: 0.2, walk: true }); } };
    const statue = (x, z, big) => {
      const plinth = this.put('pedestal', x, z, { size: big ? 2.4 : 1.4, ry: R() * TAU, walk: true, collide: 0.9 });
      this.put(R() < 0.5 ? 'stag_statue' : 'fox_statue', x, z, { size: big ? 9 + R() * 3 : 3 + R(), ry: R() * TAU, y: plinth.top - 0.05, collide: 0.45 });
    };
    if (s.type === 'court') {
      const n = 6 + Math.floor(R() * 4), cr = s.r * 0.62, a0 = R() * TAU;
      for (let k = 0; k < n; k++) { const [x, z] = at(a0 + k / n * TAU, cr); column(x, z); }
      const [ax, az] = at(a0 + Math.PI / n, cr + 1);
      this.put('arch', ax, az, { size: 7 + R() * 2, ry: -(a0 + Math.PI / n) + Math.PI / 2, collide: 0.3 });
      if (R() < 0.7) statue(s.x, s.z, false);
      fallen(); if (R() < 0.6) fallen();
      rocks(4);
    } else if (s.type === 'temple') {
      const dir = R() * TAU, dx = Math.cos(dir), dz = Math.sin(dir), px = -dz, pz = dx, rows = 5;
      for (let k = 0; k < rows; k++) for (const side of [-1, 1]) {
        const along = (k - (rows - 1) / 2) * 6;
        column(s.x + dx * along + px * side * 5, s.z + dz * along + pz * side * 5, 8);
      }
      statue(s.x + dx * 17, s.z + dz * 17, false);
      this.put('arch', s.x - dx * 16, s.z - dz * 16, { size: 8, ry: -dir + Math.PI / 2, collide: 0.3 });
      fallen(); fallen();
      rocks(3);
    } else if (s.type === 'wreck') {
      const ry = R() * TAU, len = 24 + R() * 6;
      const w = this.put('shipwreck', s.x, s.z, { size: len, ry, sink: 1.2, tiltZ: (R() - 0.5) * 0.3, collide: false });
      const lx = template('shipwreck').longX, ax = lx ? Math.cos(ry) : Math.sin(ry), az = lx ? -Math.sin(ry) : Math.cos(ry); // the hull's long axis
      for (let t = -len * 0.42; t <= len * 0.42; t += 2.6) this.addCollider({ x: s.x + ax * t, z: s.z + az * t, r: len * 0.11, top: w.top });
      for (let k = 0; k < 6; k++) {
        const [x, z] = at(R() * TAU, len * 0.35 + R() * 8);
        if (R() < 0.5) this.put('barrel', x, z, { size: 1.1, ry: R() * TAU, lay: true });
        else this.put('barrel', x, z, { size: 1.1, ry: R() * TAU, walk: true });
      }
      const [x, z] = at(R() * TAU, len * 0.55);
      this.put('anchor', x, z, { size: 3.2, ry: R() * TAU, tiltX: 0.5 + R() * 0.4, sink: 0.4 });
      rocks(5);
      for (let k = 0; k < 18 * this.density; k++) { const [x2, z2] = at(R() * TAU, len * 0.4 + R() * 12); this.put('seaweed', x2, z2, { size: 1.2 + R() * 1.6, ry: R() * TAU, collide: false }); }
    } else if (s.type === 'garden') {
      for (let k = 0; k < 3; k++) { const [x, z] = at(k / 3 * TAU + R(), s.r * (0.45 + R() * 0.3)); this.put('rock_large', x, z, { size: 4 + R() * 5, ry: R() * TAU, sink: 0.6, collide: 0.6 }); }
      const [ax, az] = at(R() * TAU, 3);
      this.put('arch', ax, az, { size: 6.5, ry: R() * TAU, tiltZ: 0.06, collide: 0.3 });
      for (let k = 0; k < 40 * this.density; k++) { const [x, z] = at(R() * TAU, Math.sqrt(R()) * s.r * 1.1); this.put('coral:' + (k % 8), x, z, { size: 0.8 + R() * 1.8, ry: R() * TAU, collide: false }); }
      for (let k = 0; k < 24 * this.density; k++) { const [x, z] = at(R() * TAU, s.r * (0.6 + R() * 0.6)); this.put('seaweed', x, z, { size: 1.4 + R() * 1.8, ry: R() * TAU, collide: false }); }
      rocks(4);
    } else { // sentinel
      statue(s.x, s.z, true);
      for (let k = 0; k < 4; k++) { const [x, z] = at(k / 4 * TAU + 0.4, s.r * 0.7); column(x, z, 6); }
      fallen(); rocks(6);
    }
    // Chest spots: open ground inside the site
    for (let k = 0; k < 40 && s.spots.length < 9; k++) {
      const [x, z] = at(R() * TAU, 2 + R() * s.r * 0.85);
      if (this.blocked(x, z, 1.3) || s.spots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3)) continue;
      s.spots.push([x, z]);
    }
    if (!s.spots.length) s.spots.push([s.x + 2, s.z + 2]);
  }

  // ---------------------------------------------------------------- camps
  _camps() {
    for (const is of WORLD.islands) {
      // The flattest spot on the island a bit up from the beach
      let best = null;
      for (let k = 0; k < 160; k++) {
        const a = k * 2.399, d = is.r * (0.12 + (k % 9) / 9 * 0.38), x = is.x + Math.cos(a) * d, z = is.z + Math.sin(a) * d;
        const h = this.ground(x, z); if (h < 3 || h > 11) continue;
        let slope = 0; for (const [ox, oz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) slope += Math.abs(this.ground(x + ox, z + oz) - h);
        if (!best || slope < best.slope) best = { x, z, slope };
      }
      best ||= { x: is.x, z: is.z };
      const cx = best.x, cz = best.z, face = Math.atan2(-cz, -cx); // face the lagoon centre (or north for Home Isle)
      const camp = { name: is.name, main: !!is.main, x: cx, z: cz, y: this.ground(cx, cz) };
      this.put('bonfire', cx, cz, { size: 0.8, collide: 0.9 });
      const off = (a, d) => [cx + Math.cos(face + a) * d, cz + Math.sin(face + a) * d];
      const [sx, sz] = off(0.9, 4);
      this.put('ocean_chest', sx, sz, { size: 1.5, ry: -(face + 0.9) - Math.PI / 2, collide: 0.8 });
      camp.stash = { x: sx, z: sz };
      const [tx, tz] = off(Math.PI, 6.5);
      this.put('tent', tx, tz, { size: 2.6, ry: -(face + Math.PI) + Math.PI / 2, collide: 0.75 });
      for (let k = 0; k < 3; k++) { const [bx, bz] = off(-1.6 + k * 0.35, 5.5); this.put('barrel', bx, bz, { size: 1.0, ry: k, walk: true }); }
      if (is.main) {
        const [bx, bz] = off(-0.9, 4.2);
        camp.bench = { x: bx, z: bz };
        this._workbench(bx, bz, -(face - 0.9));
        this._dock(is);
      }
      const [px, pz] = off(0.3, 2.6);
      camp.spawn = [px, pz];
      this.camps.push(camp);
    }
    this.camp = this.camps.find(c => c.main);
  }

  _workbench(x, z, ry) {
    const planks = new THREE.MeshStandardMaterial({ map: A.tex.planks.diff, normalMap: A.tex.planks.nor, roughnessMap: A.tex.planks.rough });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5f66, metalness: 0.85, roughness: 0.4 });
    const g = new THREE.Group(); g.position.set(x, this.ground(x, z), z); g.rotation.y = ry;
    const add = (geo, mat, px, py, pz, rx = 0, ryy = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.set(rx, ryy, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(2.4, 0.12, 1.1), planks, 0, 0.98, 0);
    for (const sx of [-1.05, 1.05]) for (const sz of [-0.42, 0.42]) add(new THREE.BoxGeometry(0.14, 0.95, 0.14), dark, sx, 0.47, sz);
    add(new THREE.BoxGeometry(2.2, 0.08, 0.9), planks, 0, 0.32, 0);
    add(new THREE.BoxGeometry(0.55, 0.22, 0.3), iron, 0.65, 1.15, 0.05);             // anvil
    add(new THREE.BoxGeometry(0.3, 0.12, 0.2), iron, 0.65, 1.3, 0.05);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), dark, -0.45, 1.06, 0.25, 0, 0.6, Math.PI / 2); // hammer handle
    add(new THREE.BoxGeometry(0.16, 0.09, 0.09), iron, -0.27, 1.08, 0.38, 0, 0.6, 0);
    add(new THREE.BoxGeometry(0.7, 0.02, 0.22), iron, -0.55, 1.05, -0.2, 0, -0.2, 0);    // saw blade
    // A coil of rope and a lantern hook
    add(new THREE.TorusGeometry(0.18, 0.05, 8, 18), new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 1 }), 0.05, 1.08, -0.3, Math.PI / 2);
    this.group.add(g);
    this.addCollider({ x, z, r: 1.25, top: g.position.y + 1.05, walk: true });
  }

  _dock(is) {
    // Walk out from the island toward the lagoon centre-east until the beach ends
    const a = 0.75;
    let d = is.r * 0.5;
    while (d < is.r * 2 && this.ground(is.x + Math.cos(a) * d, is.z + Math.sin(a) * d) > 0.4) d += 1;
    const len = 16, deck = 1.1;
    const cx = is.x + Math.cos(a) * (d + len / 2 - 3), cz = is.z + Math.sin(a) * (d + len / 2 - 3);
    const t = template('dock');
    // Point the dock's long side out to sea
    const along = m => (template(m).longX ? -a : Math.PI / 2 - a);
    this.put('dock', cx, cz, { size: len, ry: along('dock'), y: deck - t.height * len, collide: false });
    const dirX = Math.cos(a), dirZ = Math.sin(a);
    for (let s = -len / 2 + 1; s <= len / 2 - 1; s += 1.2) this.addCollider({ x: cx + dirX * s, z: cz + dirZ * s, r: 1.3, top: deck, walk: true });
    // A little boat tied at the end; it floats with the tide
    this.boat = instance('ship_small', 9, 'long');
    this.boat.traverse(o => { if (o.isMesh) o.material = patchMaterial(o.material, 'wood'); });
    this.boat.position.set(cx + dirX * (len / 2 + 3) - dirZ * 3, 0, cz + dirZ * (len / 2 + 3) + dirX * 3);
    this.boat.rotation.y = along('ship_small');
    this.group.add(this.boat);
  }

  // ---------------------------------------------------------------- the rest of the lagoon
  _scatter(R) {
    const D = this.density;
    const tryPlace = (n, test, fn) => { for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) { const a = R() * TAU, d = Math.sqrt(R()) * (WORLD.rim + 20), x = Math.cos(a) * d, z = Math.sin(a) * d, y = this.ground(x, z); if (!test(x, z, y)) continue; fn(x, z, y); k++; } };
    // Kelp and coral grow in clumps on the lagoon floor
    tryPlace(650 * D, (x, z, y) => y < -2.5 && y > -30 && Math.sin(x * 0.02) * Math.cos(z * 0.025) > -0.2 && !this.blocked(x, z, 0.3), (x, z) => {
      for (let k = 0; k < 3; k++) this.put('seaweed', x + (R() - 0.5) * 3, z + (R() - 0.5) * 3, { size: 1 + R() * 2.2, ry: R() * TAU, collide: false });
    });
    tryPlace(380 * D, (x, z, y) => y < -3.5 && y > -30 && !this.blocked(x, z, 0.5), (x, z) => this.put('coral:' + Math.floor(R() * 8), x, z, { size: 0.7 + R() * 1.6, ry: R() * TAU, collide: false }));
    // Rocks on the seabed and big boulders along the atoll
    tryPlace(260 * D, (x, z, y) => y < 0 && !this.blocked(x, z, 1), (x, z) => this.put(['rock1', 'rock2', 'rocks'][Math.floor(R() * 3)], x, z, { size: 0.7 + R() * 2.4, ry: R() * TAU, sink: 0.3, walk: true }));
    for (let k = 0; k < 90; k++) {
      const a = k / 90 * TAU + R() * 0.05, d = WORLD.rim + (R() - 0.3) * 30, x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.put('rock_large', x, z, { size: 6 + R() * 10, ry: R() * TAU, sink: 1.5, collide: 0.55 });
    }
    // Islands: palms and rocks
    for (const is of WORLD.islands) {
      const n = is.main ? 34 : 14;
      for (let k = 0, tries = 0; k < n && tries < 600; tries++) {
        const a = R() * TAU, d = Math.sqrt(R()) * is.r * 1.05, x = is.x + Math.cos(a) * d, z = is.z + Math.sin(a) * d, y = this.ground(x, z);
        if (y < 1.2 || y > 14 || this.blocked(x, z, 2.5) || this.camps.some(c => Math.hypot(c.x - x, c.z - z) < 11)) continue;
        this.put('palm' + (1 + Math.floor(R() * 3)), x, z, { size: 7 + R() * 4, ry: R() * TAU, collide: 0.06, sink: 0.2 });
        k++;
      }
      for (let k = 0; k < 10; k++) {
        const a = R() * TAU, d = is.r * (0.7 + R() * 0.5), x = is.x + Math.cos(a) * d, z = is.z + Math.sin(a) * d;
        if (this.blocked(x, z, 1.5)) continue;
        this.put(R() < 0.4 ? 'rock_large' : 'rock1', x, z, { size: 1.5 + R() * 3, ry: R() * TAU, sink: 0.4, walk: true });
      }
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, night, level, camera, fogFar) {
    propUniforms.uTime.value = time; propUniforms.uGlow.value = night * 1.3; propUniforms.uLevel.value = level;
    const far = fogFar + 260, step = WORLD.size / CHUNKS;
    for (const c of this.chunks) {
      const dx = Math.max(Math.abs(camera.position.x - c.userData.cx) - step / 2, 0), dz = Math.max(Math.abs(camera.position.z - c.userData.cz) - step / 2, 0);
      c.visible = Math.hypot(dx, dz) < far;
    }
    // The boat floats, or sits on the sand when the tide is out
    if (this.boat) {
      const b = this.boat, gy = this.ground(b.position.x, b.position.z);
      const fy = Math.max(level - 0.6, gy - 0.2);
      b.position.y += (fy - b.position.y) * Math.min(1, dt * 2);
      const afloat = level - 0.6 > gy;
      b.rotation.z = afloat ? Math.sin(time * 0.9) * 0.05 : 0.12;
      b.rotation.x = afloat ? Math.sin(time * 0.7 + 1) * 0.03 : 0;
    }
    // Campfires: the nearest two get a flickering light
    const near = [...this.camps].sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z));
    this.fireLights.forEach((l, i) => {
      const c = near[i]; if (!c) return;
      const f = 0.85 + Math.sin(time * 13 + i) * 0.08 + Math.sin(time * 29 + i * 3) * 0.05 + Math.sin(time * 4.3) * 0.04;
      l.position.set(c.x, c.y + 1.4, c.z);
      l.intensity = (14 + f * 8) * (0.25 + night);
    });
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
}
const EMPTY = [];
