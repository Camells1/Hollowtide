// Chests (sealed until low tide, a new set every tide, each with a light beam you can see from far off),
// hollow crabs that dig out of the sand to guard the ruins, and the sack you drop when you drown.
// Only the chests and crabs near you get a real animated model; the rest are just records.
import * as THREE from 'three';
import { rng, clamp } from './util.js';
import { A, instance } from './assets.js';

const NEAR = 150, CRAB_NEAR = 110;

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

const clipOf = (model, name) => A.models[model].animations.find(c => c.name.split('|').pop() === name);
const beamMaterial = color => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying float vY; varying vec3 vP;
    void main() { vY = uv.y; vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      #endif
      vP = (modelMatrix * p).xyz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * p; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uK, uTime; varying float vY; varying vec3 vP;
    void main() { float a = pow(clamp(1.0 - vY, 0.0, 1.0), 1.6) * (0.75 + 0.25 * sin(uTime * 2.4 + vP.x * 0.4 + vP.z * 0.3 - vY * 6.0)); gl_FragColor = vec4(uColor * a * uK, a * uK); }`
});

export class Loot {
  constructor(scene, world, seed) {
    this.scene = scene; this.world = world; this.seed = seed;
    this.chests = new Map(); this.crabs = new Map(); this.bags = []; this.corpses = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.cycle = -1;
    this.chestPool = []; this.crabPool = [];
    // One instanced light beam per chest
    const geo = new THREE.CylinderGeometry(0.22, 0.42, 18, 14, 1, true); geo.translate(0, 9, 0);
    this.beamMat = beamMaterial(0x7ff5e0);
    this.beams = new THREE.InstancedMesh(geo, this.beamMat, 220);
    this.beams.frustumCulled = false; this.beams.renderOrder = 3; this.beams.count = 0;
    this.group.add(this.beams);
    this.bagBeamMat = beamMaterial(0xffd166); this.bagBeamMat.uniforms.uK.value = 0.8;
    this.goldMats = [];
    A.models.chest.scene.traverse(o => { if (o.isMesh && /Gold/.test(o.material.name) && !this.goldMats.includes(o.material)) this.goldMats.push(o.material); });
    for (const m of this.goldMats) m.emissive = new THREE.Color(0xffb030);
    this.onFx = null; // (kind, x, y, z) for particles and sounds
  }

  // ---------------------------------------------------------------- chests
  setCycle(cycle) {
    if (cycle === this.cycle) return;
    this.cycle = cycle;
    for (const c of this.chests.values()) this._releaseChest(c);
    this.chests.clear();
    this.world.sites.forEach((site, si) => {
      const R = rng(this.seed * 31 + cycle * 977 + si * 13);
      const spots = [...site.spots].sort(() => R() - 0.5).slice(0, site.chests || 3);
      spots.forEach(([x, z, sy], k) => {
        const id = `${cycle}-${si}-${k}`;
        this.chests.set(id, { id, x, y: sy ?? this.world.footY(x, z, 0.5), z, ry: R() * Math.PI * 2, site: si, opened: false, obj: null });
      });
    });
    this._beams();
  }

  _beams() {
    const m = new THREE.Matrix4(); let n = 0;
    for (const c of this.chests.values()) { if (c.opened) continue; m.makeTranslation(c.x, c.y + 0.5, c.z); this.beams.setMatrixAt(n++, m); }
    this.beams.count = n; this.beams.instanceMatrix.needsUpdate = true;
  }

  _acquireChest(c) {
    let o = this.chestPool.pop();
    if (!o) {
      const root = instance('chest', 0.8);
      const mixer = new THREE.AnimationMixer(root);
      const open = mixer.clipAction(clipOf('chest', 'Chest_Open'));
      open.setLoop(THREE.LoopOnce, 1); open.clampWhenFinished = true;
      o = { root, mixer, open };
    }
    o.root.position.set(c.x, c.y - 0.04, c.z); o.root.rotation.y = c.ry;
    o.mixer.stopAllAction();
    if (c.opened) { o.open.reset().play(); o.open.time = o.open.getClip().duration; o.mixer.update(0); o.open.paused = true; }
    this.group.add(o.root); c.obj = o; c.animT = 0;
  }
  _releaseChest(c) { if (!c.obj) return; this.group.remove(c.obj.root); this.chestPool.push(c.obj); c.obj = null; }

  markOpened(id) {
    const c = this.chests.get(id);
    if (!c || c.opened) return c;
    c.opened = true;
    if (c.obj) { c.obj.open.paused = false; c.obj.open.reset().play(); c.animT = 1.5; }
    this._beams();
    this.onFx?.('chest', c.x, c.y + 0.6, c.z);
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
        const a = R() * Math.PI * 2, d = 4 + R() * (site.r * 0.7);
        let x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
        if (this.world.blocked(x, z, 0.8)) { x = site.spots[k % site.spots.length][0] + 1.5; z = site.spots[k % site.spots.length][1] + 1.5; }
        this.addCrab({ id: `${cycle}-${si}-${k}`, x, z, yaw: R() * 6.28, hp: 50, site: si }, true);
      }
    });
  }
  addCrab(c, fresh = false) {
    const crab = { ...c, y: this.world.ground(c.x, c.z), biteCd: 0, wanderT: Math.random() * 3, tx: c.x, tz: c.z, st: 0, flash: 0, rise: fresh ? 0 : 1, obj: null, awake: false, biteAnim: 0 };
    this.crabs.set(c.id, crab);
    return crab;
  }
  clearCrabs() { for (const c of this.crabs.values()) this._releaseCrab(c); this.crabs.clear(); }
  removeCrab(id, died = false) {
    const c = this.crabs.get(id); if (!c) return;
    this.crabs.delete(id);
    if (died && c.obj) {
      // Leave the body to play its death animation, then let it sink into the sand
      const o = c.obj; c.obj = null;
      o.mixer.stopAllAction(); o.death.reset().play();
      this.corpses.push({ o, t: 0, y: c.y });
      this.onFx?.('crabDead', c.x, c.y + 0.4, c.z);
    } else this._releaseCrab(c);
  }

  _acquireCrab(c) {
    let o = this.crabPool.pop();
    if (!o) {
      const root = instance('crab', 0.95);
      const mixer = new THREE.AnimationMixer(root);
      const act = (n, once) => { const a = mixer.clipAction(clipOf('crab', n)); if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } return a; };
      o = { root, mixer, idle: act('Idle'), walk: act('Walk'), bite: act('Bite_Front', true), hit: act('HitRecieve', true), death: act('Death', true), walkW: 0 };
    }
    o.mixer.stopAllAction(); o.walkW = 0; o.idle.reset().play(); o.walk.reset().play(); o.root.scale.setScalar(1);
    this.group.add(o.root); c.obj = o;
  }
  _releaseCrab(c) { if (!c.obj) return; this.group.remove(c.obj.root); this.crabPool.push(c.obj); c.obj = null; }

  // players: [{ id, pos, dead }]; onBite(playerId, damage)
  simulateCrabs(dt, players, onBite) {
    for (const c of this.crabs.values()) {
      let target = null, td = 12, nearest = 1e9;
      for (const p of players) {
        const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z); nearest = Math.min(nearest, d);
        if (!p.dead && d < td && Math.abs(p.pos.y - c.y) < 3) { td = d; target = p; }
      }
      c.awake = nearest < 75;
      if (!c.awake) { c.st = 0; continue; }
      if (c.rise < 1) continue; // still digging out
      let gx, gz, speed;
      if (target) { gx = target.pos.x; gz = target.pos.z; speed = 3.7; }
      else {
        c.wanderT -= dt;
        if (c.wanderT <= 0) { const s = this.world.sites[c.site], a = Math.random() * 6.28, d = Math.random() * s.r * 0.8; c.tx = s.x + Math.cos(a) * d; c.tz = s.z + Math.sin(a) * d; c.wanderT = 3 + Math.random() * 4; }
        gx = c.tx; gz = c.tz; speed = 1.3;
      }
      const dx = gx - c.x, dz = gz - c.z, d = Math.hypot(dx, dz);
      c.st = 0;
      if (d > (target ? 1.2 : 0.5)) {
        c.x += dx / d * speed * dt; c.z += dz / d * speed * dt; c.st = 1;
      }
      if (d > 0.3) { const want = Math.atan2(dx, dz); c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * Math.min(1, dt * 7); }
      this.world.push(c, c.y, 0.5);
      c.y = this.world.ground(c.x, c.z);
      c.biteCd -= dt;
      if (target && td < 1.6 && c.biteCd <= 0) { c.biteCd = 1.25; c.st = 2; c.biteAnim = 0.5; onBite(target.id, 9); }
      else if (c.biteAnim > 0) { c.biteAnim -= dt; c.st = 2; }
    }
  }

  // Guests receive crabs from the host. full: the list has every crab, so drop any that aren't in it
  applyCrabs(list, full) {
    const seen = new Set();
    for (const [id, x, z, yaw, hp, site, st] of list) {
      seen.add(id);
      let c = this.crabs.get(id);
      if (!c) c = this.addCrab({ id, x, z, yaw, hp, site }, true);
      c.x += (x - c.x) * 0.6; c.z += (z - c.z) * 0.6; c.yaw = yaw; c.hp = hp; c.y = this.world.ground(c.x, c.z);
      if (st === 2 && c.st !== 2) c.biteNow = true;
      c.st = st; c.awake = true;
    }
    if (full) for (const id of [...this.crabs.keys()]) if (!seen.has(id)) this.removeCrab(id);
  }
  crabList(all) {
    const out = [];
    for (const c of this.crabs.values()) if (all || c.awake) out.push([c.id, +c.x.toFixed(2), +c.z.toFixed(2), +c.yaw.toFixed(2), c.hp, c.site, c.st]);
    return out;
  }

  // Damage a crab (host). Returns true if it died.
  hitCrab(id, dmg, from) {
    const c = this.crabs.get(id);
    if (!c) return false;
    c.hp -= dmg; this.flashCrab(id, from);
    if (c.hp <= 0) { this.removeCrab(id, true); return true; }
    return false;
  }
  // The flinch everyone sees (also called on guests for their own hits)
  flashCrab(id, from) {
    const c = this.crabs.get(id); if (!c) return;
    c.flash = 0.25;
    if (from) { const dx = c.x - from.x, dz = c.z - from.z, d = Math.hypot(dx, dz) || 1; c.x += dx / d * 0.5; c.z += dz / d * 0.5; }
    if (c.obj) { c.obj.hit.reset().play(); c.hitT = 0.4; }
    this.onFx?.('crabHit', c.x, c.y + 0.5, c.z);
  }

  crabInFront(pos, yaw, range) {
    let best = null, bd = range;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const c of this.crabs.values()) {
      const dx = c.x - pos.x, dz = c.z - pos.z, d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(c.y - pos.y) > 2.2 || c.rise < 0.6) continue;
      if (d > 0.7 && (dx * fx + dz * fz) / d < 0.35) continue; // must be roughly in front
      bd = d; best = c;
    }
    return best;
  }

  // ---------------------------------------------------------------- dropped packs
  dropBag(pos, items) {
    if (!Object.keys(items).length) return;
    const mesh = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.95, normalMap: A.tex.sand.nor });
    const prof = [[0, 0], [0.26, 0.02], [0.34, 0.18], [0.3, 0.38], [0.14, 0.52], [0.09, 0.56], [0.13, 0.66], [0, 0.64]].map(([r, y]) => new THREE.Vector2(r, y));
    const sack = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), cloth); sack.castShadow = true; sack.rotation.z = 0.12; mesh.add(sack);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14), new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 1 })); rope.rotation.x = Math.PI / 2; rope.position.y = 0.55; mesh.add(rope);
    const geo = new THREE.CylinderGeometry(0.2, 0.4, 14, 12, 1, true); geo.translate(0, 7, 0);
    const beam = new THREE.Mesh(geo, this.bagBeamMat); beam.renderOrder = 3; mesh.add(beam);
    const y = this.world.footY(pos.x, pos.z, 0.3) - 0.03;
    mesh.position.set(pos.x, y, pos.z); this.group.add(mesh);
    this.bags.push({ x: pos.x, y, z: pos.z, items: { ...items }, mesh });
  }
  takeBag(pos) {
    const i = this.bags.findIndex(b => Math.hypot(b.x - pos.x, b.z - pos.z) < 1.8 && Math.abs(b.y - pos.y) < 2.5);
    if (i < 0) return null;
    const [b] = this.bags.splice(i, 1); this.group.remove(b.mesh);
    return b.items;
  }

  // ---------------------------------------------------------------- visuals
  update(dt, time, phase, cam) {
    const open = phase === 'low';
    this.beamMat.uniforms.uTime.value = this.bagBeamMat.uniforms.uTime.value = time;
    const bk = this.beamMat.uniforms.uK; bk.value += ((open ? 0.32 : 0) - bk.value) * Math.min(1, dt * 1.5);
    this.beams.visible = bk.value > 0.01;
    for (const m of this.goldMats) m.emissiveIntensity = bk.value * (0.5 + Math.sin(time * 3) * 0.15);
    for (const c of this.chests.values()) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (!c.obj && d < NEAR) this._acquireChest(c);
      else if (c.obj && d > NEAR + 20) this._releaseChest(c);
      if (c.obj && c.animT > 0) { c.animT -= dt; c.obj.mixer.update(dt); }
    }
    for (const c of this.crabs.values()) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (!c.obj && d < CRAB_NEAR) this._acquireCrab(c);
      else if (c.obj && d > CRAB_NEAR + 15) this._releaseCrab(c);
      // Dig out of the sand when the tide goes out; dig back in when the flood comes
      const wasUnder = c.rise < 1;
      c.rise = clamp(c.rise + dt * (phase === 'flood' ? -0.5 : 0.7), 0, 1);
      if (wasUnder && c.rise > 0.05 && c.rise < 0.9 && d < 60 && Math.random() < dt * 8) this.onFx?.('dig', c.x, c.y, c.z);
      c.flash = Math.max(0, c.flash - dt);
      const o = c.obj; if (!o) continue;
      o.root.position.set(c.x, c.y - (1 - c.rise) * 1.1, c.z);
      o.root.rotation.y = c.yaw;
      o.root.scale.setScalar(c.flash > 0 ? 1.1 : 1);
      if (c.biteNow || (c.st === 2 && c.biteAnim > 0.45)) { c.biteNow = false; o.bite.reset().play(); c.biteT = 0.7; }
      c.biteT = Math.max(0, (c.biteT || 0) - dt); c.hitT = Math.max(0, (c.hitT || 0) - dt);
      // Idle and walk always run and are mixed by weight; bites and flinches play over the top
      o.walkW += ((c.st === 1 ? 1 : 0) - o.walkW) * Math.min(1, dt * 8);
      const over = c.biteT > 0 || c.hitT > 0 ? 0.15 : 1;
      o.walk.timeScale = 1.6;
      o.walk.setEffectiveWeight(o.walkW * over); o.idle.setEffectiveWeight((1 - o.walkW) * over);
      o.bite.setEffectiveWeight(c.biteT > 0 ? 1 : 0); o.hit.setEffectiveWeight(c.hitT > 0 ? 1 : 0);
      o.mixer.update(dt);
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const k = this.corpses[i]; k.t += dt; k.o.mixer.update(dt);
      if (k.t > 1.6) k.o.root.position.y = k.y - (k.t - 1.6) * 0.7;
      if (k.t > 3) { this.group.remove(k.o.root); this.crabPool.push(k.o); this.corpses.splice(i, 1); }
    }
  }

  dispose() { this.scene.remove(this.group); this.beams.dispose(); }
}
