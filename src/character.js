// A low-poly diver/explorer used for you and for co-op friends.
// Procedural animation: walk, sprint, swim (body tilts forward, arms stroke), swing, and fall over.
import * as THREE from 'three';

const skin = new THREE.MeshStandardMaterial({ color: 0xd9a27a, roughness: 0.7 });
const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
const glass = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2a9fc0, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.3 });
const leather = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.85 });
const steel = new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.8, roughness: 0.3 });

const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
const part = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

export class Character {
  constructor(color = 0x2f9fb0) {
    const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const suitDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.7 });
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.hips = new THREE.Group(); this.hips.position.y = 0.95; this.body.add(this.hips);
    part(cap(0.2, 0.18), suitDark, this.hips, 0, 0.02, 0).rotation.z = Math.PI / 2;
    this.chest = new THREE.Group(); this.chest.position.y = 0.12; this.hips.add(this.chest);
    part(cap(0.24, 0.32), suit, this.chest, 0, 0.3, 0);
    part(new THREE.BoxGeometry(0.42, 0.1, 0.32), leather, this.chest, 0, 0.12, 0); // belt
    // Backpack with a small air tank
    part(new THREE.BoxGeometry(0.38, 0.42, 0.2), leather, this.chest, 0, 0.36, -0.24);
    part(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10), steel, this.chest, 0.14, 0.42, -0.36);
    // Head with a round diving mask
    this.head = new THREE.Group(); this.head.position.y = 0.72; this.chest.add(this.head);
    part(new THREE.SphereGeometry(0.19, 14, 10), skin, this.head, 0, 0.06, 0);
    part(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), suitDark, this.head, 0, 0.08, -0.01); // hood
    const mask = part(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), glass, this.head, 0, 0.08, 0.17); mask.rotation.x = Math.PI / 2;
    part(new THREE.TorusGeometry(0.125, 0.02, 6, 16), dark, this.head, 0, 0.08, 0.2);
    // Arms and legs (pivot at the joint)
    this.arms = []; this.legs = [];
    for (const s of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(0.3 * s, 0.52, 0); this.chest.add(sh);
      part(cap(0.075, 0.26), suit, sh, 0, -0.2, 0);
      const el = new THREE.Group(); el.position.y = -0.4; sh.add(el);
      part(cap(0.065, 0.22), suitDark, el, 0, -0.16, 0);
      part(new THREE.SphereGeometry(0.07, 8, 6), dark, el, 0, -0.34, 0);
      this.arms.push({ sh, el, s });
      const hip = new THREE.Group(); hip.position.set(0.12 * s, -0.02, 0); this.hips.add(hip);
      part(cap(0.09, 0.3), suitDark, hip, 0, -0.24, 0);
      const kn = new THREE.Group(); kn.position.y = -0.46; hip.add(kn);
      part(cap(0.08, 0.28), suit, kn, 0, -0.2, 0);
      part(new THREE.BoxGeometry(0.15, 0.08, 0.28), dark, kn, 0, -0.42, 0.06); // boot
      this.legs.push({ hip, kn, s });
    }
    // Blade in the right hand
    this.blade = part(new THREE.BoxGeometry(0.05, 0.05, 0.55), steel, this.arms[1].el, 0, -0.36, 0.25);
    this.phase = 0; this.swingT = 0; this.deadT = 0;
  }

  swing() { this.swingT = 0.35; }

  // s: { speed (m/s), swim (0..1), grounded, dead, yaw }
  update(dt, s) {
    this.root.rotation.y = s.yaw;
    const sp = Math.min(1, s.speed / 6);
    this.phase += dt * (3 + s.speed * 1.6);
    const ph = this.phase, sw = Math.sin(ph), swim = s.swim || 0;
    // Body tilt: upright on land, horizontal when swimming
    this.body.rotation.x = swim * (s.speed > 0.5 ? 1.25 : 0.35);
    this.body.position.y = swim * 0.6;
    this.hips.position.y = 0.95 + Math.abs(Math.cos(ph)) * 0.05 * sp * (1 - swim);
    for (const L of this.legs) {
      const walk = sw * 0.7 * sp * L.s;
      const kick = Math.sin(ph * 2 + (L.s > 0 ? 0 : Math.PI)) * 0.35;
      L.hip.rotation.x = (1 - swim) * walk + swim * kick;
      L.kn.rotation.x = (1 - swim) * Math.max(0, -walk) * 1.2 + swim * 0.2;
    }
    for (const A of this.arms) {
      const walk = -sw * 0.6 * sp * A.s;
      const stroke = Math.sin(ph * 1.2 + (A.s > 0 ? 0 : Math.PI));
      A.sh.rotation.x = (1 - swim) * walk + swim * (-2.2 + stroke * 1.2);
      A.sh.rotation.z = A.s * (0.12 + swim * 0.3);
      A.el.rotation.x = (1 - swim) * -0.3 + swim * -0.4;
    }
    // Swing the blade
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt);
      const k = 1 - this.swingT / 0.35, R = this.arms[1];
      R.sh.rotation.x = -2.4 + k * 2.6; R.sh.rotation.z = -0.5 + k * 0.8;
    }
    // Death: fall over
    if (s.dead) { this.deadT = Math.min(1, this.deadT + dt * 2); this.body.rotation.z = this.deadT * Math.PI / 2; this.body.position.y = -this.deadT * 0.6; }
    else if (this.deadT) { this.deadT = 0; this.body.rotation.z = 0; }
  }
}
