// First-person hands: a gloved hand with your blade and, once you've built it, the Tide Lantern.
// Drawn in its own pass so it never clips into walls. Lots of small animations: breathing, look sway,
// walk/sprint bob, three alternating slashes with a blade trail, prying chests open, swimming strokes,
// landing dips, getting hurt, inspecting the blade (F), drawing it after you respawn.
import * as THREE from 'three';
import { A } from './assets.js';
import { clamp, lerp } from './util.js';

const ease = t => t * t * (3 - 2 * t);
const glove = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.62, metalness: 0.05 });
const gloveDark = new THREE.MeshStandardMaterial({ color: 0x2c1c12, roughness: 0.7 });
const brass = new THREE.MeshStandardMaterial({ color: 0xc8963c, roughness: 0.32, metalness: 0.9 });

function capsule(r, len, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}

// A hand closed around a grip (the grip runs along the hand's local Y axis)
function makeHand(sleeveMat, side = 1) {
  const g = new THREE.Group();
  // Forearm: a tapered sleeve with a rolled cuff
  const prof = [[0.0, -0.42], [0.052, -0.42], [0.058, -0.3], [0.05, -0.16], [0.044, -0.1], [0.0, -0.1]].map(([r, y]) => new THREE.Vector2(r, y));
  const sleeve = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), sleeveMat); sleeve.rotation.x = -Math.PI / 2; g.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.013, 8, 20), gloveDark); cuff.position.z = 0.1; g.add(cuff);
  // Palm and back of the hand
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), glove); palm.scale.set(1.05, 0.75, 1.25); palm.position.set(0, 0, 0.02); g.add(palm);
  // Four fingers wrapped around the grip, a thumb over them
  for (let i = 0; i < 4; i++) {
    const y = 0.026 - i * 0.017;
    capsule(0.0125, 0.03, glove, g, 0.0 * side, y, -0.035, 0, 0, Math.PI / 2).scale.set(1, 1.05 - i * 0.06, 1);
    capsule(0.0115, 0.022, glove, g, -0.027 * side, y, -0.045, 0, 0, Math.PI / 2);
  }
  capsule(0.013, 0.035, glove, g, 0.03 * side, 0.03, -0.02, 0.4, 0, 0.9 * side);
  g.traverse(m => { if (m.isMesh) m.castShadow = false; });
  return g;
}

function makeBlade() {
  // The sword from the Wanderer model, stood up along +Y with the grip at the origin
  let src = null;
  A.models.hooded.scene.traverse(n => { if (n.name === 'Sword') src = n; });
  const holder = new THREE.Group(), mats = [];
  if (!src) return { holder, mats, length: 0.8 };
  const obj = src.clone();
  obj.position.set(0, 0, 0); obj.quaternion.identity(); obj.scale.set(1, 1, 1);
  const seen = new Map();
  obj.traverse(m => { if (!m.isMesh) return; if (!seen.has(m.material)) { const c = m.material.clone(); c.envMapIntensity = 0.9; c.color.multiplyScalar(0.8); if (c.metalness > 0.5) c.roughness = Math.max(c.roughness, 0.32); seen.set(m.material, c); mats.push(c); } m.material = seen.get(m.material); m.frustumCulled = false; });
  const turn = new THREE.Group(), flip = new THREE.Group(); turn.add(obj); flip.add(turn); holder.add(flip);
  const box = new THREE.Box3().setFromObject(obj), s = box.getSize(new THREE.Vector3());
  const axis = s.x > s.y && s.x > s.z ? 'x' : s.y > s.z ? 'y' : 'z', len = s[axis];
  if (axis === 'x') turn.rotation.z = Math.PI / 2; else if (axis === 'z') turn.rotation.x = -Math.PI / 2;
  // The grip is the end nearest the hand bone (the model's own origin)
  if (Math.abs(box.max[axis]) < Math.abs(box.min[axis])) flip.rotation.x = Math.PI;
  flip.scale.setScalar(0.56 / len);
  const b2 = new THREE.Box3().setFromObject(holder), c = b2.getCenter(new THREE.Vector3());
  flip.position.set(-c.x, -b2.min.y - 0.07, -c.z);
  return { holder, mats, length: 0.56 - 0.07 };
}

function makeLantern() {
  const g = new THREE.Group();
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 16), brass, -0.11);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffa030, emissiveIntensity: 1.2, transparent: true, opacity: 0.38, roughness: 0.1, side: THREE.DoubleSide });
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.15, 16, 1, true), glassMat, -0.02);
  for (let i = 0; i < 4; i++) { const bar = add(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), brass, -0.02); const a = i / 4 * Math.PI * 2; bar.position.x = Math.cos(a) * 0.052; bar.position.z = Math.sin(a) * 0.052; }
  add(new THREE.ConeGeometry(0.065, 0.06, 16), brass, 0.085);
  const ring = add(new THREE.TorusGeometry(0.025, 0.005, 8, 16), brass, 0.135);
  const flame = add(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), -0.03);
  flame.scale.set(1, 1.7, 1);
  ring.rotation.y = Math.PI / 2;
  return { group: g, glass: glassMat, flame };
}

export class ViewModel {
  constructor(sleeveColor = 0x2f8f9f) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a4a38, 1.0);
    this.key = new THREE.DirectionalLight(0xffffff, 2.2); this.key.position.set(0.4, 1, 0.3);
    this.scene.add(this.hemi, this.key);
    this.scene.environment = A.env;
    const sleeve = new THREE.MeshStandardMaterial({ color: sleeveColor, roughness: 0.85 });
    // Right hand with the blade
    this.right = new THREE.Group(); this.scene.add(this.right);
    this.rHand = makeHand(sleeve, 1); this.right.add(this.rHand);
    const blade = makeBlade(); this.blade = blade.holder; this.bladeMats = blade.mats; this.bladeLen = blade.length;
    this.blade.position.set(0, -0.005, -0.035); this.blade.rotation.x = -1.1; this.rHand.add(this.blade);
    this.tip = new THREE.Object3D(); this.tip.position.y = blade.length; this.blade.add(this.tip);
    this.mid = new THREE.Object3D(); this.mid.position.y = blade.length * 0.35; this.blade.add(this.mid);
    // Left hand with the lantern
    this.left = new THREE.Group(); this.scene.add(this.left);
    this.lHand = makeHand(sleeve, -1); this.left.add(this.lHand);
    this.lantern = makeLantern(); this.lantern.group.scale.setScalar(0.62); this.lantern.group.position.set(0, -0.1, -0.035); this.lHand.add(this.lantern.group);
    // Blade trail
    this.trailN = 14;
    this.trailPts = [];
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 2 * 3), 3));
    tg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(this.trailN * 2), 1));
    const idx = []; for (let i = 0; i < this.trailN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xbfefff) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }'
    }));
    this.trail.frustumCulled = false; this.scene.add(this.trail);
    // Animation state
    this.t = 0; this.sway = new THREE.Vector2(); this.land = 0; this.landV = 0; this.hurtK = 0; this.hurtDir = 1;
    this.swingT = -1; this.swingVar = 0; this.inspectT = -1; this.drawT = 0; this.swimK = 0; this.sprintK = 0; this.deadK = 0;
    this.interactK = 0; this.lanternK = 0; this.stroke = 0;
    this.v = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
    this.setBlade(0);
  }

  setSleeve(color) { this.rHand.children[0].material.color.set(color); }
  // Coral Blade upgrade levels tint the blade
  setBlade(level) {
    const col = [null, 0x2fd8c0, 0xb57bff][level] ?? null;
    this.trail.material.uniforms.uColor.value.set(col ?? 0xbfefff);
    for (const m of this.bladeMats) { if (!m.emissive) continue; m.emissive.set(col ?? 0x000000); m.emissiveIntensity = col ? 0.35 : 0; }
  }
  swing() { this.swingT = 0; this.swingVar = (this.swingVar + 1) % 3; this.trailPts.length = 0; }
  hurt() { this.hurtK = 1; this.hurtDir = Math.random() < 0.5 ? -1 : 1; }
  landed(v) { this.landV -= Math.min(0.12, v * 0.012); }
  inspect() { if (this.swingT < 0) this.inspectT = 0; }
  draw() { this.drawT = 0; }
  get swinging() { return this.swingT >= 0 && this.swingT < 0.42; }

  // s: { dt, look: {dx, dy}, speed01, step (bob phase), sprint, grounded, swim, interact, dead, lantern, night, aspect }
  update(dt, s) {
    this.t += dt;
    const t = this.t, k = n => Math.min(1, dt * n);
    this.camera.aspect = s.aspect; this.camera.updateProjectionMatrix();
    // Springs and blends
    this.sway.x += (clamp(-s.look.dx * 0.0009, -0.06, 0.06) - this.sway.x) * k(8);
    this.sway.y += (clamp(s.look.dy * 0.0009, -0.06, 0.06) - this.sway.y) * k(8);
    this.landV += (-this.land * 160 - this.landV * 16) * dt; this.land += this.landV * dt;
    this.swimK += ((s.swim ? 1 : 0) - this.swimK) * k(5);
    this.sprintK += ((s.sprint && !s.swim ? 1 : 0) - this.sprintK) * k(7);
    this.interactK += ((s.interact ? 1 : 0) - this.interactK) * k(10);
    this.deadK += ((s.dead ? 1 : 0) - this.deadK) * k(3);
    this.hurtK = Math.max(0, this.hurtK - dt * 4);
    this.lanternK += ((s.lantern && !s.swim ? 1 : 0) - this.lanternK) * k(5);
    if (this.drawT >= 0) { this.drawT += dt; if (this.drawT > 0.6) this.drawT = -1; }
    const draw = this.drawT >= 0 ? 1 - ease(clamp(this.drawT / 0.6, 0, 1)) : 0;
    const bob = s.speed01 * (1 + this.sprintK * 0.8), ph = s.step;

    // ---- right hand
    const p = this.v.pos.set(0.27, -0.25, -0.46), r = this.v.rot.set(0.35, 0.3, 0.5);
    p.y += Math.sin(t * 1.6) * 0.004; r.x += Math.sin(t * 1.6) * 0.01;                    // breathing
    p.x += Math.cos(ph) * 0.014 * bob; p.y -= Math.abs(Math.sin(ph)) * 0.016 * bob;     // walk bob
    r.z += Math.cos(ph) * 0.03 * bob;
    p.x += this.sway.x; p.y += this.sway.y; r.y += this.sway.x * 2; r.x += this.sway.y * 1.5;
    p.y += this.land;
    // Sprint: blade held low and back
    p.y -= 0.07 * this.sprintK; p.x += 0.03 * this.sprintK; r.x += 0.25 * this.sprintK; r.z += 0.75 * this.sprintK; r.y += 0.2 * this.sprintK;
    // Prying a chest: both arms forward and down, straining
    p.y -= 0.1 * this.interactK; p.z -= 0.06 * this.interactK; p.x -= 0.08 * this.interactK;
    r.x -= 0.9 * this.interactK + Math.sin(t * 34) * 0.03 * this.interactK; r.z += 0.4 * this.interactK;
    // Swing: three alternating cuts (right-to-left, backhand, overhead)
    let trailOn = false;
    if (this.swingT >= 0) {
      this.swingT += dt;
      const u = this.swingT / 0.42;
      if (u >= 1) this.swingT = -1;
      else {
        const env = u < 0.12 ? ease(u / 0.12) : u < 0.55 ? 1 : 1 - ease((u - 0.55) / 0.45);
        const a = ease(clamp((u - 0.1) / 0.32, 0, 1)); // the cut itself
        trailOn = u > 0.12 && u < 0.5;
        if (this.swingVar === 0) { p.x += lerp(0.18, -0.32, a) * env; p.y += lerp(0.08, -0.06, a) * env; r.y += lerp(0.9, -1.2, a) * env; r.z += lerp(-0.6, 0.9, a) * env; r.x += lerp(0.3, -0.4, a) * env; }
        else if (this.swingVar === 1) { p.x += lerp(-0.28, 0.2, a) * env; p.y += lerp(-0.02, 0.06, a) * env; r.y += lerp(-1.0, 1.0, a) * env; r.z += lerp(0.9, -0.7, a) * env; r.x += lerp(-0.3, -0.2, a) * env; }
        else { p.y += lerp(0.2, -0.16, a) * env; p.x += lerp(0.04, -0.06, a) * env; r.x += lerp(1.1, -1.25, a) * env; r.z += lerp(0.2, 0.1, a) * env; }
      }
    }
    // Inspect: turn the blade over in the light
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      const u = this.inspectT / 2.4;
      if (u >= 1 || this.swingT >= 0 || s.sprint) this.inspectT = -1;
      else { const env = Math.sin(Math.PI * clamp(u, 0, 1)); p.x -= 0.12 * env; p.y += 0.06 * env; r.y += Math.sin(u * Math.PI * 2) * 1.4 * env; r.z += 1.2 * env; r.x -= 0.4 * env; }
    }
    // Hurt jolt
    r.z += this.hurtK * 0.3 * this.hurtDir; p.y -= this.hurtK * 0.04;
    // Swimming: the blade goes away and both hands do a breaststroke
    const sw = this.swimK;
    this.stroke += dt * (0.8 + s.speed01 * 1.4) * sw;
    const sp = (this.stroke % 1), out = Math.sin(sp * Math.PI), back = ease(clamp(sp * 1.4, 0, 1));
    // Forearms reach forward from below; hands sweep out and back, palms down
    p.lerp(new THREE.Vector3(0.09 + out * 0.24, -0.2 - out * 0.03, -0.52 + back * 0.2), sw);
    r.x = lerp(r.x, 0.32, sw); r.y = lerp(r.y, 0.3 + out * 0.55, sw); r.z = lerp(r.z, 1.35, sw);
    // Death and drawing: drop out of view
    p.y -= (this.deadK * 0.6 + draw * 0.45); r.x -= draw * 0.8;
    this.right.position.copy(p); this.right.rotation.copy(r);
    this.blade.visible = sw < 0.6;
    this.blade.scale.setScalar(1 - clamp((sw - 0.3) * 3, 0, 1) * 0.9);

    // ---- left hand: lantern, or the other half of the swim stroke
    const lp = new THREE.Vector3(-0.27, -0.07, -0.5), lr = new THREE.Euler(0.15, -0.1, 0.1);
    lp.y += Math.sin(t * 1.6 + 1) * 0.004 + this.land * 0.8 + this.sway.y; lp.x += this.sway.x - Math.cos(ph) * 0.012 * bob;
    lp.y -= Math.abs(Math.sin(ph + 0.6)) * 0.014 * bob;
    lp.y -= (1 - this.lanternK) * 0.35 * (1 - sw);
    lp.y -= this.interactK * 0.05;
    lp.lerp(new THREE.Vector3(-0.09 - out * 0.24, -0.2 - out * 0.03, -0.52 + back * 0.2), sw);
    lr.x = lerp(lr.x, 0.32, sw); lr.y = lerp(lr.y, -0.3 - out * 0.55, sw); lr.z = lerp(lr.z, -1.35, sw);
    lp.y -= (this.deadK * 0.6 + draw * 0.45);
    this.left.position.copy(lp); this.left.rotation.copy(lr);
    this.left.visible = this.lanternK > 0.02 || sw > 0.02;
    this.lantern.group.visible = sw < 0.5;
    // The lantern swings on its ring and flickers
    this.lantern.group.rotation.z = Math.sin(t * 2.1) * 0.08 - this.sway.x * 2;
    this.lantern.group.rotation.x = Math.cos(ph) * 0.06 * bob;
    const fl = 0.85 + Math.sin(t * 17) * 0.08 + Math.sin(t * 31) * 0.05;
    this.lantern.flame.scale.set(fl, 1.7 * fl, fl);
    this.lantern.glass.emissiveIntensity = (0.4 + s.night * 1.4) * fl;

    // ---- blade trail
    this.scene.updateMatrixWorld(true);
    if (trailOn) {
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      this.tip.getWorldPosition(a); this.mid.getWorldPosition(b);
      this.trailPts.unshift([a, b]);
      if (this.trailPts.length > this.trailN) this.trailPts.pop();
    } else if (this.trailPts.length) this.trailPts.pop();
    const pos = this.trail.geometry.attributes.position, al = this.trail.geometry.attributes.alpha;
    for (let i = 0; i < this.trailN; i++) {
      const e = this.trailPts[Math.min(i, this.trailPts.length - 1)];
      if (!e) { pos.setXYZ(i * 2, 0, 0, 0); pos.setXYZ(i * 2 + 1, 0, 0, 0); al.setX(i * 2, 0); al.setX(i * 2 + 1, 0); continue; }
      pos.setXYZ(i * 2, e[0].x, e[0].y, e[0].z); pos.setXYZ(i * 2 + 1, e[1].x, e[1].y, e[1].z);
      const f = i < this.trailPts.length ? (1 - i / this.trailN) * 0.55 : 0;
      al.setX(i * 2, f); al.setX(i * 2 + 1, 0);
    }
    pos.needsUpdate = true; al.needsUpdate = true;
  }

  // Match the world's lighting
  light(keyColor, keyIntensity, hemiIntensity, envIntensity, under) {
    this.key.color.copy(keyColor); this.key.intensity = Math.max(0.4, keyIntensity * 0.7);
    this.hemi.intensity = hemiIntensity * (under ? 0.6 : 1);
    this.hemi.color.set(under ? 0x5fb8c0 : 0xcfe8ff);
    this.scene.environmentIntensity = envIntensity;
  }
}
