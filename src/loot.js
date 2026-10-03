// Chests (barnacled shut until low tide, a new set every tide), hollow crabs that guard the ruins
// at low tide, and dropped packs you can recover after drowning.
import * as THREE from 'three';
import { rng } from './util.js';

const chestWood = new THREE.MeshStandardMaterial({ color: 0x6a4428, roughness: 0.85 });
const chestBrass = new THREE.MeshStandardMaterial({ color: 0xd8aa4c, metalness: 0.8, roughness: 0.35, emissive: 0x6a4a10, emissiveIntensity: 0 });
const barnacle = new THREE.MeshStandardMaterial({ color: 0xa9b3a6, roughness: 1, flatShading: true });
const glowRing = new THREE.MeshBasicMaterial({ color: 0x7ff5e0, transparent: true, opacity: 0, depthWrite: false });
const crabShell = new THREE.MeshStandardMaterial({ color: 0xd2562e, roughness: 0.55, emissive: 0x401006, emissiveIntensity: 0.3 });
const crabLeg = new THREE.MeshStandardMaterial({ color: 0xa13c1e, roughness: 0.6 });
const crabEye = new THREE.MeshBasicMaterial({ color: 0xfff6a0 });
const bagMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 });

// What a chest holds (decided by its id so everyone in co-op agrees)
export function rollChest(seed, id) {
  let h = seed; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761);
  const R = rng(h >>> 0), out = { shell: 2 + Math.floor(R() * 4) };
  if (R() < 0.55) out.pearl = 1 + Math.floor(R() * 2);
  if (R() < 0.45) out.coin = 1 + Math.floor(R() * 2);
  if (R() < 0.16) out.gear = 1;
  if (R() < 0.05) out.idol = 1;
  return out;
}

export class Loot {
  constructor(scene, world, seed) {
    this.scene = scene; this.world = world; this.seed = seed;
    this.chests = new Map(); this.crabs = new Map(); this.bags = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.cycle = -1;
  }

  // ---------------------------------------------------------------- chests
  setCycle(cycle) {
    if (cycle === this.cycle) return;
    this.cycle = cycle;
    for (const c of this.chests.values()) this.group.remove(c.mesh);
    this.chests.clear();
    this.world.sites.forEach((site, si) => {
      const R = rng(this.seed * 31 + cycle * 977 + si * 13);
      const spots = [...site.spots].sort(() => R() - 0.5).slice(0, 3);
      spots.forEach(([x, z], k) => {
        const id = `${cycle}-${si}-${k}`, y = this.world.ground(x, z);
        const mesh = this._chestMesh(); mesh.position.set(x, y, z); mesh.rotation.y = R() * Math.PI * 2;
        this.group.add(mesh);
        this.chests.set(id, { id, x, y, z, site: si, opened: false, mesh, lid: mesh.userData.lid, openT: 0 });
      });
    });
  }

  _chestMesh() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), chestWood); base.position.y = 0.3; base.castShadow = true; g.add(base);
    const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.37); g.add(lid);
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 1.1, 10, 1, false, 0, Math.PI), chestWood);
    lidMesh.rotation.z = Math.PI / 2; lidMesh.position.z = 0.37; lid.add(lidMesh);
    for (const s of [-0.38, 0.38]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.78), chestBrass); b.position.set(s, 0.31, 0); g.add(b); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.06), chestBrass); lock.position.set(0, 0.5, 0.39); g.add(lock);
    for (let k = 0; k < 7; k++) { const bn = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 + Math.random() * 0.06, 0), barnacle); bn.position.set((Math.random() - 0.5) * 1, 0.1 + Math.random() * 0.75, (Math.random() - 0.5) * 0.75); g.add(bn); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 32), glowRing); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    g.userData.lid = lid; g.userData.ring = ring;
    return g;
  }

  markOpened(id) {
    const c = this.chests.get(id);
    if (c && !c.opened) { c.opened = true; c.mesh.userData.ring.visible = false; }
    return c;
  }

  nearestChest(pos, maxD) {
    let best = null, bd = maxD;
    for (const c of this.chests.values()) {
      if (c.opened) continue;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d < bd && Math.abs(c.y - pos.y) < 2.5) { bd = d; best = c; }
    }
    return best;
  }

  // ---------------------------------------------------------------- crabs (simulated by the host)
  spawnCrabs(cycle) {
    this.clearCrabs();
    const R = rng(this.seed * 53 + cycle * 211);
    this.world.sites.forEach((site, si) => {
      for (let k = 0; k < 2 + (R() < 0.5 ? 1 : 0); k++) {
        const a = R() * Math.PI * 2, d = 4 + R() * 12, x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
        this.addCrab({ id: `${cycle}-${si}-${k}`, x, z, yaw: R() * 6.28, hp: 50, site: si });
      }
    });
  }
  addCrab(c) {
    const mesh = this._crabMesh();
    const crab = { ...c, y: this.world.ground(c.x, c.z), mesh, legs: mesh.userData.legs, biteCd: 0, wanderT: 0, tx: c.x, tz: c.z, anim: 0, flash: 0 };
    mesh.position.set(crab.x, crab.y, crab.z);
    this.group.add(mesh); this.crabs.set(c.id, crab);
    return crab;
  }
  clearCrabs() { for (const c of this.crabs.values()) this.group.remove(c.mesh); this.crabs.clear(); }
  removeCrab(id) { const c = this.crabs.get(id); if (c) { this.group.remove(c.mesh); this.crabs.delete(id); } }

  _crabMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 8), crabShell); body.scale.set(1, 0.42, 0.8); body.position.y = 0.42; body.castShadow = true; g.add(body);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), crabEye); eye.position.set(0.14 * s, 0.68, 0.32); g.add(eye);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.35, 3, 6), crabLeg); arm.position.set(0.42 * s, 0.4, 0.38); arm.rotation.set(1.2, 0, -0.5 * s); g.add(arm);
      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), crabShell); claw.scale.set(1, 0.7, 1.4); claw.position.set(0.52 * s, 0.45, 0.66); g.add(claw);
    }
    const legs = [];
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.45, 3, 5), crabLeg);
      leg.position.set(0.5 * s, 0.3, -0.2 + k * 0.2); leg.rotation.z = 0.9 * s; g.add(leg); legs.push({ leg, s, k });
    }
    g.userData.legs = legs;
    return g;
  }

  // players: [{ id, pos, dead }]; onBite(playerId, damage)
  simulateCrabs(dt, players, onBite) {
    for (const c of this.crabs.values()) {
      let target = null, td = 9;
      for (const p of players) { if (p.dead) continue; const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z); if (d < td && Math.abs(p.pos.y - c.y) < 3) { td = d; target = p; } }
      let gx, gz, speed;
      if (target) { gx = target.pos.x; gz = target.pos.z; speed = 3.3; }
      else {
        c.wanderT -= dt;
        if (c.wanderT <= 0) { const s = this.world.sites[c.site], a = Math.random() * 6.28, d = Math.random() * 14; c.tx = s.x + Math.cos(a) * d; c.tz = s.z + Math.sin(a) * d; c.wanderT = 2 + Math.random() * 3; }
        gx = c.tx; gz = c.tz; speed = 1.4;
      }
      const dx = gx - c.x, dz = gz - c.z, d = Math.hypot(dx, dz);
      if (d > (target ? 1.1 : 0.4)) {
        // Crabs walk sideways
        c.x += dx / d * speed * dt; c.z += dz / d * speed * dt;
        const want = Math.atan2(dx, dz) + Math.PI / 2;
        c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * Math.min(1, dt * 6);
        c.anim += dt * speed * 4;
      }
      for (const col of this.world.colliders) { const ex = c.x - col.x, ez = c.z - col.z, ed = Math.hypot(ex, ez), m = col.r + 0.5; if (ed < m && ed > 1e-4) { c.x = col.x + ex / ed * m; c.z = col.z + ez / ed * m; } }
      c.y = this.world.ground(c.x, c.z);
      c.biteCd -= dt;
      if (target && td < 1.4 && c.biteCd <= 0) { c.biteCd = 1.1; onBite(target.id, 9); }
    }
  }

  // Guests receive crab positions from the host
  applyCrabs(list) {
    const seen = new Set();
    for (const [id, x, z, yaw, hp, site] of list) {
      seen.add(id);
      let c = this.crabs.get(id);
      if (!c) c = this.addCrab({ id, x, z, yaw, hp, site });
      c.anim += Math.hypot(x - c.x, z - c.z) * 4;
      c.x = x; c.z = z; c.yaw = yaw; c.hp = hp; c.y = this.world.ground(x, z);
    }
    for (const id of [...this.crabs.keys()]) if (!seen.has(id)) this.removeCrab(id);
  }
  crabList() { return [...this.crabs.values()].map(c => [c.id, +c.x.toFixed(2), +c.z.toFixed(2), +c.yaw.toFixed(2), c.hp, c.site]); }

  // Damage a crab (host). Returns true if it died.
  hitCrab(id, dmg) {
    const c = this.crabs.get(id);
    if (!c) return false;
    c.hp -= dmg; c.flash = 0.2;
    if (c.hp <= 0) { this.removeCrab(id); return true; }
    return false;
  }

  crabInFront(pos, yaw, range) {
    let best = null, bd = range;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const c of this.crabs.values()) {
      const dx = c.x - pos.x, dz = c.z - pos.z, d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(c.y - pos.y) > 2) continue;
      if (d > 0.6 && (dx * fx + dz * fz) / d < 0.2) continue; // must be roughly in front
      bd = d; best = c;
    }
    return best;
  }

  // ---------------------------------------------------------------- dropped packs
  dropBag(pos, items) {
    if (!Object.keys(items).length) return;
    const mesh = new THREE.Group();
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), bagMat); sack.scale.set(1, 0.8, 1); sack.position.y = 0.32; mesh.add(sack);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.6 })); beacon.position.y = 3; mesh.add(beacon);
    const y = this.world.ground(pos.x, pos.z);
    mesh.position.set(pos.x, y, pos.z); this.group.add(mesh);
    this.bags.push({ x: pos.x, y, z: pos.z, items: { ...items }, mesh });
  }
  takeBag(pos) {
    const i = this.bags.findIndex(b => Math.hypot(b.x - pos.x, b.z - pos.z) < 1.6 && Math.abs(b.y - pos.y) < 2);
    if (i < 0) return null;
    const [b] = this.bags.splice(i, 1); this.group.remove(b.mesh);
    return b.items;
  }

  // ---------------------------------------------------------------- visuals
  update(dt, time, open) {
    for (const c of this.chests.values()) {
      const ring = c.mesh.userData.ring;
      if (!c.opened) { ring.material.opacity = open ? 0.35 + Math.sin(time * 3 + c.x) * 0.2 : 0; }
      else if (c.lid.rotation.x > -1.9) c.lid.rotation.x -= dt * 4;
    }
    chestBrass.emissiveIntensity = open ? 0.8 : 0;
    for (const c of this.crabs.values()) {
      c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.y = c.yaw;
      for (const L of c.legs) L.leg.rotation.x = Math.sin(c.anim + L.k * 2 + (L.s > 0 ? 0 : 1.5)) * 0.5;
      c.flash = Math.max(0, c.flash - dt);
      c.mesh.scale.setScalar(c.flash > 0 ? 1.12 : 1);
    }
  }
}
