// Animated divers for co-op friends (and your own shadow): real rigged models with blended
// idle / walk / run / strafe / swim / jump, plus slash, interact, hit, wave and death.
import * as THREE from 'three';
import { A, instance } from './assets.js';
import { clamp } from './util.js';

export const OUTFITS = [
  { model: 'adventurer', name: 'Explorer', tint: { Green: 0x2f8f9f, LightGreen: 0x7fd6cc }, sword: true },
  { model: 'hooded', name: 'Wanderer' },
  { model: 'matt', name: 'Scout' },
  { model: 'adventurer', name: 'Salvager', tint: { Green: 0xb8582a, LightGreen: 0xf0a060 }, sword: true }
];
// Our names for each animation, and what each model calls it
const CLIPS = {
  idle: ['Idle_Sword', 'Idle'], walk: ['Walk'], run: ['Run'], back: ['Run_Back', 'Walk'], left: ['Run_Left', 'Run'], right: ['Run_Right', 'Run'],
  jump: ['Jump_Idle', 'Jump'], slash: ['Sword_Slash', 'Slash'], interact: ['Interact', 'Punch'], hit: ['HitRecieve', 'HitReact'],
  death: ['Death'], wave: ['Wave'], yes: ['Yes', 'Interact'], tread: ['Idle_Neutral', 'Idle']
};
const ONCE = new Set(['slash', 'interact', 'hit', 'death', 'wave', 'yes']);

export class Character {
  constructor(outfit = 0, { shadowOnly = false } = {}) {
    const o = OUTFITS[((outfit % OUTFITS.length) + OUTFITS.length) % OUTFITS.length];
    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); this.pivot.position.y = 0.95; this.root.add(this.pivot); // swimming tilts around the hips
    this.model = instance(o.model, 1.78);
    this.model.position.y = -0.95; this.pivot.add(this.model);
    const mats = new Map();
    this.model.traverse(m => {
      if (!m.isMesh) return;
      if (!mats.has(m.material)) {
        const c = m.material.clone();
        if (o.tint?.[c.name]) c.color.set(o.tint[c.name]);
        if (shadowOnly) { c.colorWrite = false; c.depthWrite = false; }
        mats.set(m.material, c);
      }
      m.material = mats.get(m.material);
    });
    // The Explorer borrows the Wanderer's sword (same skeleton, same hand bone)
    if (o.sword) {
      let sword = null, hand = null;
      A.models.hooded.scene.traverse(n => { if (n.name === 'Sword') sword = n; });
      this.model.traverse(n => { if (n.name === 'Middle1.R') hand = n; });
      if (sword && hand) { const s = sword.clone(); s.traverse(m => { if (m.isMesh) { m.castShadow = true; if (shadowOnly) { m.material = m.material.clone(); m.material.colorWrite = false; m.material.depthWrite = false; } } }); hand.add(s); }
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = A.models[o.model].animations;
    this.actions = {};
    for (const [key, names] of Object.entries(CLIPS)) {
      const clip = names.map(n => clips.find(c => c.name.split('|').pop() === n)).find(Boolean);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (ONCE.has(key)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[key] = a;
    }
    this.cur = null; this.oneShot = null; this.pending = null; this.dead = false;
    this.mixer.addEventListener('finished', e => {
      if (e.action !== this.oneShot || this.dead) return;
      this.oneShot = null;
      this._to(this.pending || this.actions.idle, 0.25);
    });
    this._to(this.actions.idle, 0);
    this.swimK = 0;
  }

  _to(a, fade) {
    if (!a || a === this.cur) return;
    a.reset().play();
    if (this.cur && fade > 0) this.cur.crossFadeTo(a, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = a;
  }

  // One-off animations: 'slash', 'interact', 'hit', 'wave', 'yes'
  play(key) {
    const a = this.actions[key];
    if (!a || this.dead) return;
    if (key === 'hit' && this.oneShot && this.oneShot !== this.actions.hit) return; // don't interrupt a swing
    a.reset().play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, 0.1, false);
    this.cur = a; this.oneShot = a;
  }

  // s: { speed, fwd, side (m/s relative to facing), swim (0..1), grounded, dead, yaw }
  update(dt, s) {
    this.root.rotation.y = s.yaw + Math.PI; // the models face +Z; our yaw faces -Z
    if (s.dead && !this.dead) { this.dead = true; this.oneShot = null; this._to(this.actions.death, 0.15); }
    else if (!s.dead && this.dead) { this.dead = false; this.cur?.stop(); this.cur = null; this._to(this.actions.idle, 0); }
    // Swimming: lean forward and kick, tread water when still
    this.swimK += ((s.swim > 0.5 ? 1 : 0) - this.swimK) * Math.min(1, dt * 4);
    const moving = s.speed > 0.4;
    this.pivot.rotation.x = this.swimK * (moving ? 1.25 : 0.25);
    this.pivot.position.y = 0.95 + this.swimK * 0.35 * Math.sin(performance.now() / 600);
    if (!this.dead) {
      let base, ts = 1;
      if (this.swimK > 0.5) { base = moving ? 'run' : 'tread'; ts = moving ? 0.45 + s.speed * 0.06 : 0.6; }
      else if (!s.grounded && this.actions.jump) base = 'jump';
      else if (!moving) base = 'idle';
      else {
        const f = s.fwd ?? s.speed, r = s.side ?? 0;
        if (f < -0.4 * Math.abs(r)) { base = 'back'; ts = clamp(s.speed / 4.5, 0.6, 1.5); }
        else if (Math.abs(r) > Math.abs(f) * 1.2) { base = r > 0 ? 'right' : 'left'; ts = clamp(s.speed / 5, 0.6, 1.5); }
        else if (s.speed > 6) { base = 'run'; ts = clamp(s.speed / 6.5, 0.8, 1.5); }
        else { base = 'walk'; ts = clamp(s.speed / 2.2, 0.6, 2.2); }
      }
      const a = this.actions[base] || this.actions.idle;
      if (this.oneShot) this.pending = a;
      else this._to(a, 0.22);
      a.timeScale = ts;
    }
    this.mixer.update(dt);
  }

  dispose() { this.root.removeFromParent(); this.mixer.stopAllAction(); }
}
