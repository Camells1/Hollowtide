// Everything placed on the terrain: the sunken ruin sites, glowing coral and kelp,
// palm trees, and the island camp (campfire, stash, workbench).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD } from './config.js';
import { rng } from './util.js';

const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb9ab8d, roughness: 0.92 });
const mossMat = new THREE.MeshStandardMaterial({ color: 0x6f8f6a, roughness: 0.95 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.85 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9a4a, roughness: 0.8, flatShading: true, side: THREE.DoubleSide });
const brass = new THREE.MeshStandardMaterial({ color: 0xd6a84a, metalness: 0.8, roughness: 0.35 });

export class World {
  constructor(scene, terrain, seed) {
    this.scene = scene; this.terrain = terrain; this.seed = seed;
    this.colliders = [];   // { x, z, r, top } circles the player can't walk through
    this.sites = [];       // ruin sites: { x, z, r, spots: [[x,z],...] } (chest spots)
    this.glow = [];        // materials that light up at night
    this.group = new THREE.Group();
    scene.add(this.group);
    const R = rng(seed * 7 + 1);
    this._sites(R);
    this._kelpAndCoral(R);
    this._palms(R);
    this._camp();
  }

  ground(x, z) { return this.terrain.heightAt(x, z); }

  // ---------------------------------------------------------------- ruins
  _sites(R) {
    const parts = { stone: [], moss: [] };
    const add = (geo, x, y, z, ry = 0, rx = 0, moss = false) => {
      geo.rotateX(rx); geo.rotateY(ry); geo.translate(x, y, z);
      (moss ? parts.moss : parts.stone).push(geo);
    };
    for (let i = 0; i < WORLD.sites; i++) {
      // Spread the sites around the lagoon at different distances
      const a = (i / WORLD.sites) * Math.PI * 2 + R() * 0.5, d = 85 + R() * 115;
      const sx = Math.cos(a) * d, sz = Math.sin(a) * d;
      const site = { x: sx, z: sz, r: 22, spots: [], name: SITE_NAMES[i % SITE_NAMES.length] };
      this.sites.push(site);
      const g = (x, z) => this.ground(x, z);
      // A ring of columns, some broken
      const cols = 6 + Math.floor(R() * 5), cr = 9 + R() * 6;
      for (let k = 0; k < cols; k++) {
        const ca = (k / cols) * Math.PI * 2 + R() * 0.2, x = sx + Math.cos(ca) * cr, z = sz + Math.sin(ca) * cr;
        const h = R() < 0.35 ? 1.5 + R() * 2 : 5 + R() * 3, y = g(x, z);
        add(new THREE.CylinderGeometry(0.65, 0.8, h, 12), x, y + h / 2 - 0.3, z, 0, 0, R() < 0.4);
        add(new THREE.BoxGeometry(1.9, 0.45, 1.9), x, y + 0.1, z);
        if (h > 4) add(new THREE.BoxGeometry(1.7, 0.4, 1.7), x, y + h - 0.1, z);
        this.colliders.push({ x, z, r: 1.0, top: y + h });
      }
      // A fallen column lying on the sand
      { const x = sx + (R() - 0.5) * 10, z = sz + (R() - 0.5) * 10, ry = R() * Math.PI;
        add(new THREE.CylinderGeometry(0.7, 0.7, 7, 12), x, g(x, z) + 0.5, z, ry, Math.PI / 2, true);
        for (let t = -3; t <= 3; t += 1.5) this.colliders.push({ x: x + Math.cos(ry + Math.PI / 2) * 0 + Math.sin(ry) * t, z: z + Math.cos(ry) * t, r: 0.9, top: g(x, z) + 1.2 }); }
      // An arch
      { const ry = R() * Math.PI, ax = sx + Math.cos(ry) * 4, az = sz - Math.sin(ry) * 4, y = g(ax, az);
        const ox = Math.cos(ry) * 2.6, oz = -Math.sin(ry) * 2.6;
        for (const s of [-1, 1]) { add(new THREE.BoxGeometry(1.2, 6, 1.2), ax + ox * s, y + 2.8, az + oz * s, ry); this.colliders.push({ x: ax + ox * s, z: az + oz * s, r: 0.9, top: y + 6 }); }
        add(new THREE.BoxGeometry(6.6, 1.1, 1.5), ax, y + 6.2, az, ry, 0, true); }
      // Broken walls
      for (let k = 0; k < 3; k++) {
        const wa = R() * Math.PI * 2, wd = 6 + R() * 10, x = sx + Math.cos(wa) * wd, z = sz + Math.sin(wa) * wd, ry = R() * Math.PI, len = 4 + R() * 5, h = 1.4 + R() * 2.5;
        add(new THREE.BoxGeometry(len, h, 0.9), x, g(x, z) + h / 2 - 0.2, z, ry, 0, R() < 0.5);
        for (let t = -len / 2 + 0.5; t <= len / 2 - 0.5; t += 1) this.colliders.push({ x: x + Math.cos(ry) * t, z: z - Math.sin(ry) * t, r: 0.7, top: g(x, z) + h });
      }
      // A giant drowned statue head at some sites
      if (R() < 0.6) {
        const x = sx + (R() - 0.5) * 8, z = sz + (R() - 0.5) * 8, y = g(x, z);
        const head = new THREE.IcosahedronGeometry(3.2, 1); head.scale(1, 1.25, 1.05);
        add(head, x, y + 2.2, z, R() * Math.PI, 0.25, true);
        add(new THREE.BoxGeometry(2.6, 0.6, 1.2), x, y + 5.6, z);
        this.colliders.push({ x, z, r: 3.4, top: y + 6 });
      }
      // Chest spots: inside the ring, away from colliders
      for (let k = 0; k < 10; k++) {
        const ca = R() * Math.PI * 2, cd = 2 + R() * 13, x = sx + Math.cos(ca) * cd, z = sz + Math.sin(ca) * cd;
        if (this.colliders.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 1.2)) continue;
        site.spots.push([x, z]);
      }
    }
    for (const [key, mat] of [['stone', stoneMat], ['moss', mossMat]]) {
      if (!parts[key].length) continue;
      const mesh = new THREE.Mesh(mergeGeometries(parts[key].map(g => g.toNonIndexed ? g.index ? g.toNonIndexed() : g : g)), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  // ---------------------------------------------------------------- the glowing Hollow
  _kelpAndCoral(R) {
    const kelpGeo = new THREE.CylinderGeometry(0.02, 0.07, 2.2, 4, 3); kelpGeo.translate(0, 1.1, 0);
    { const p = kelpGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 2.2) * 0.12); } kelpGeo.computeVertexNormals(); } // gentle wave
    const kelpMat = new THREE.MeshStandardMaterial({ color: 0x2f6f4a, emissive: 0x1fbfa0, emissiveIntensity: 0, roughness: 0.8, flatShading: true });
    const coralGeo = new THREE.IcosahedronGeometry(0.6, 0);
    const coralMat = new THREE.MeshStandardMaterial({ color: 0x7a4f8f, emissive: 0xd05cff, emissiveIntensity: 0, roughness: 0.6, flatShading: true });
    this.glow.push({ mat: kelpMat, max: 1.1 }, { mat: coralMat, max: 2.0 });
    const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, 420), coral = new THREE.InstancedMesh(coralGeo, coralMat, 260);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let nk = 0, nc = 0;
    for (let tries = 0; tries < 4000 && (nk < 420 || nc < 260); tries++) {
      const a = R() * Math.PI * 2, d = 55 + R() * 160, x = Math.cos(a) * d, z = Math.sin(a) * d, y = this.ground(x, z);
      if (y > -4) continue;
      if (nk < 420 && R() < 0.65) {
        e.set((R() - 0.5) * 0.3, R() * Math.PI, (R() - 0.5) * 0.3); q.setFromEuler(e); const k = 0.7 + R() * 0.8;
        m.compose(p.set(x, y - 0.1, z), q, s.set(k, k * (0.6 + R() * 0.9), k)); kelp.setMatrixAt(nk++, m);
      } else if (nc < 260) {
        e.set(R(), R() * Math.PI, R()); q.setFromEuler(e); const k = 0.5 + R() * 1.3;
        m.compose(p.set(x, y + 0.2, z), q, s.set(k, k * 0.7, k)); coral.setMatrixAt(nc++, m);
      }
    }
    kelp.count = nk; coral.count = nc;
    kelp.receiveShadow = coral.receiveShadow = true;
    this.group.add(kelp, coral);
  }

  _palms(R) {
    const trunk = new THREE.CylinderGeometry(0.22, 0.32, 1, 7);
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, d = 18 + R() * 26, x = Math.cos(a) * d, z = Math.sin(a) * d, y = this.ground(x, z);
      if (y < 0.8) continue;
      const tree = new THREE.Group(); tree.position.set(x, y, z);
      const h = 5 + R() * 3, lean = (R() - 0.5) * 0.5;
      const t = new THREE.Mesh(trunk, woodMat); t.scale.set(1, h, 1); t.position.y = h / 2; t.rotation.z = lean; t.castShadow = true; tree.add(t);
      const top = new THREE.Vector3(Math.sin(-lean) * h * 0.5, h, 0);
      for (let k = 0; k < 6; k++) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.6, 1, 3), leafMat);
        const pos = leaf.geometry.attributes.position; for (let v = 0; v < pos.count; v++) pos.setZ(v, -Math.pow(pos.getY(v) + 1.8, 2) * 0.12);
        leaf.geometry.translate(0, 1.8, 0);
        leaf.position.copy(top); leaf.rotation.set(-1.1, (k / 6) * Math.PI * 2, 0, 'YXZ'); leaf.castShadow = true;
        tree.add(leaf);
      }
      this.group.add(tree);
      this.colliders.push({ x, z, r: 0.5, top: y + h });
    }
  }

  // ---------------------------------------------------------------- the camp
  _camp() {
    const g = (x, z) => this.ground(x, z);
    const camp = this.camp = { x: 10, z: 12 };
    camp.y = g(camp.x, camp.z);
    // Campfire: stones, logs and a flame
    const fire = new THREE.Group(); fire.position.set(camp.x, camp.y, camp.z);
    for (let k = 0; k < 8; k++) { const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stoneMat); st.position.set(Math.cos(k / 8 * 6.28) * 0.9, 0.12, Math.sin(k / 8 * 6.28) * 0.9); fire.add(st); }
    for (let k = 0; k < 3; k++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 6), darkWood); log.rotation.set(Math.PI / 2, k * 1.05, 0.4); log.position.y = 0.2; fire.add(log); }
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 7), this.flameMat); this.flame.position.y = 0.8; fire.add(this.flame);
    this.fireLight = new THREE.PointLight(0xff9a40, 0, 18, 1.6); this.fireLight.position.y = 1.4; fire.add(this.fireLight);
    this.group.add(fire);
    this.colliders.push({ x: camp.x, z: camp.z, r: 1.1, top: camp.y + 1 });

    // Stash (where you bank your loot) and workbench (upgrades)
    const place = (obj, dx, dz, ry) => { const x = camp.x + dx, z = camp.z + dz; obj.position.set(x, g(x, z), z); obj.rotation.y = ry; this.group.add(obj); return { x, z }; };
    const stash = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1), woodMat); box.position.y = 0.45; box.castShadow = true; stash.add(box);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 10, 1, false, 0, Math.PI), darkWood); lid.rotation.z = Math.PI / 2; lid.position.y = 0.9; stash.add(lid);
    for (const s of [-0.55, 0.55]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.42, 1.04), brass); band.position.set(s, 0.62, 0); stash.add(band); }
    this.stash = place(stash, -4.5, 1.5, 0.4);
    this.colliders.push({ x: this.stash.x, z: this.stash.z, r: 1.0, top: 1.4 });

    const bench = new THREE.Group();
    const topB = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.1), woodMat); topB.position.y = 1.0; topB.castShadow = true; bench.add(topB);
    for (const sx of [-1, 1]) for (const sz of [-0.4, 0.4]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1, 0.14), darkWood); leg.position.set(sx, 0.5, sz); bench.add(leg); }
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.35), brass); anvil.position.set(0.5, 1.25, 0); bench.add(anvil);
    const saw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.25), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.8, roughness: 0.3 })); saw.position.set(-0.5, 1.12, 0); bench.add(saw);
    this.bench = place(bench, 4.5, -2, -0.6);
    this.colliders.push({ x: this.bench.x, z: this.bench.z, r: 1.2, top: 1.4 });

    // A small hut for atmosphere
    const hut = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 2.4, 8), woodMat); walls.position.y = 1.2; walls.castShadow = true; hut.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 1, flatShading: true })); roof.position.y = 3.5; roof.castShadow = true; hut.add(roof);
    const hp = place(hut, -3, -7, 0.3);
    this.colliders.push({ x: hp.x, z: hp.z, r: 2.7, top: 5 });
    camp.spawn = [camp.x + 2.5, camp.z + 3.5];
  }

  update(dt, night, time) {
    for (const gl of this.glow) gl.mat.emissiveIntensity = gl.max * night;
    // Campfire flicker
    const f = 0.85 + Math.sin(time * 13) * 0.08 + Math.sin(time * 29) * 0.05;
    this.flame.scale.set(f, 0.9 + f * 0.2, f);
    this.fireLight.intensity = (10 + f * 6) * (0.3 + night);
  }
}

const SITE_NAMES = ['The Drowned Court', 'Saltglass Ring', 'Pillars of Ebb', 'The Moon Steps', 'Tidewarden Hall', 'Shellgate', 'The Hollow Crown'];
