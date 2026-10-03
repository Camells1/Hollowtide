// You: first-person movement with proper acceleration and friction, air control, coyote time and
// buffered jumps, climbing onto ledges (mantling), wading, swimming where you look, air and stamina,
// and the flood's undertow that drags you down when the tide comes back.
import * as THREE from 'three';
import { PLAYER, PACK_BASE, WORLD } from './config.js';
import { clamp } from './util.js';

const ease = t => t * t * (3 - 2 * t);

export class Player {
  constructor(world, upgrades) {
    this.world = world;
    this.up = upgrades; // { lungs, fins, pack, blade, boots... } levels
    this.pos = new THREE.Vector3();   // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.respawn = world.camp;        // the last camp you reached
    this.pack = {};
    this.reset();
  }

  get maxOxygen() { return PLAYER.oxygen + (this.up.lungs || 0) * 15; }
  get packSize() { return PACK_BASE + (this.up.pack || 0) * 10; }
  get packCount() { return Object.values(this.pack).reduce((a, b) => a + b, 0); }
  get damage() { return PLAYER.attackDamage + (this.up.blade || 0) * 15; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get eye() { return PLAYER.eye - this.swim * 0.2; }

  reset() {
    const [x, z] = this.respawn.spawn;
    this.pos.set(x, this.world.standAt(x, z) + 0.05, z);
    this.vel.set(0, 0, 0);
    this.hp = PLAYER.health; this.oxygen = this.maxOxygen; this.stamina = PLAYER.stamina;
    this.pack = {}; this.dead = false; this.respawnT = 0; this.swim = 0; this.swimming = false; this.grounded = true;
    this.attackCd = 0; this.hurtT = 0; this.headUnder = false; this.coyote = 0; this.jumpBuf = 0; this.mantle = null;
    this.stepPhase = 0; this.sprinting = false; this.regenWait = 0; this.wade = 0; this.surface = 'sand';
  }

  addItem(id, n = 1) {
    const take = Math.min(this.packSize - this.packCount, n);
    if (take > 0) this.pack[id] = (this.pack[id] || 0) + take;
    return Math.max(0, take);
  }

  hurt(dmg) {
    if (this.dead) return;
    this.hp -= dmg; this.hurtT = 0.4;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.respawnT = 4.5; }
  }

  // input: { mx, mz (-1..1), yaw, pitch, sprint, jump (held), jumpHit (pressed this frame), dive, attack }
  // env:   { level (water height), flood, highTide }
  // Returns what happened: { step, jumped, landed, splashed, surfaced, mantled, swung, died, respawned }
  update(dt, input, env) {
    const ev = {};
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.reset(); ev.respawned = true; }
      return ev;
    }
    this.yaw = input.yaw; this.pitch = input.pitch;
    const P = PLAYER, w = this.world, level = env.level;
    // Climbing onto a ledge takes over until it's done
    if (this.mantle) {
      const m = this.mantle; m.t += dt / 0.42;
      const k = Math.min(1, m.t), up = ease(Math.min(1, k * 1.6)), fwd = ease(clamp((k - 0.35) / 0.65, 0, 1));
      this.pos.set(m.fx + (m.tx - m.fx) * fwd, m.fy + (m.ty - m.fy) * up, m.fz + (m.tz - m.fz) * fwd);
      this.vel.set(0, 0, 0);
      if (k >= 1) { this.mantle = null; this.grounded = true; }
      return ev;
    }

    const g = w.standAt(this.pos.x, this.pos.z, this.pos.y);
    const depth = level - this.pos.y;                      // water above your feet
    const wasSwimming = this.swimming;
    // Swim when the water is over your chest and too deep to stand in (a little slack so it doesn't flicker)
    if (this.swimming) this.swimming = depth > 1.0 && level - g > 1.15;
    else this.swimming = depth > 1.25 && level - g > 1.35;
    this.swim += ((this.swimming ? 1 : 0) - this.swim) * Math.min(1, dt * 6);
    this.wade = this.swimming ? 0 : clamp(depth / 1.25, 0, 1);
    if (this.swimming && !wasSwimming && this.vel.y < -1) ev.splashed = Math.min(1, -this.vel.y / 8);

    // Where you want to go
    const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    let wx = fx * input.mz + rx * input.mx, wz = fz * input.mz + rz * input.mx;
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    const moving = wl > 0.05;
    this.sprinting = input.sprint && moving && this.stamina > 1 && (this.swimming || input.mz > 0);

    // Stamina: sprinting costs it; in open water at high tide you tire and can't rest until you reach land
    const tiring = this.swimming && env.highTide;
    const drain = (this.sprinting ? 12 : 0) + (tiring ? 3 : 0);
    if (drain > 0) { this.stamina -= drain * dt; this.regenWait = 0.7; }
    else if ((this.regenWait -= dt) <= 0) this.stamina += 20 * dt;
    this.stamina = clamp(this.stamina, 0, P.stamina);

    this.coyote = this.grounded ? P.coyote : this.coyote - dt;
    this.jumpBuf = input.jumpHit ? P.jumpBuffer : this.jumpBuf - dt;

    if (this.swimming) {
      // Swim where you look. Space rises, C dives; do nothing and you float slowly up
      const cp = Math.cos(input.pitch), sp = Math.sin(input.pitch);
      const under = this.headUnder || sp < -0.3;
      const max = (this.sprinting ? P.swimSprint : P.swim) * (1 + 0.25 * (this.up.fins || 0));
      let tx = (fx * cp * input.mz + rx * input.mx) * max, tz = (fz * cp * input.mz + rz * input.mx) * max;
      let ty = under ? sp * input.mz * max : 0;
      if (!under) { tx = wx * max; tz = wz * max; }
      if (input.jump) ty += max * 0.8;
      if (input.dive) ty -= max * 0.8;
      const rest = level - 1.32;
      if (Math.abs(ty) < 0.1) ty = clamp((rest - this.pos.y) * 1.6, -0.5, 1.1);          // buoyancy
      else if (this.pos.y > rest && ty > 0) ty = clamp((rest - this.pos.y) * 3, -1, 0);  // can't swim out of the water
      if (this.stamina <= 0 && env.highTide) ty = Math.min(ty, -0.9);                    // exhausted: you sink
      if (env.flood) ty -= 1.0;                                                          // the undertow
      const k = Math.min(1, dt * P.waterAccel);
      this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k; this.vel.y += (ty - this.vel.y) * Math.min(1, dt * 4);
      this.grounded = false;
    } else {
      let max = (this.sprinting ? P.sprint : P.walk) * (1 + 0.12 * (this.up.boots || 0));
      max *= 1 - this.wade * 0.5;
      if (input.mz < 0) max *= 0.75;                       // backing up is slower
      if (this.grounded) {
        // Friction, then push toward the wish direction
        const sp = this.speed;
        if (sp > 0.001) { const drop = Math.max(sp, 2.2) * P.friction * dt, k = Math.max(0, sp - drop) / sp; this.vel.x *= k; this.vel.z *= k; }
        this._accel(wx, wz, max, P.accel * dt);
      } else this._accel(wx, wz, Math.min(max, 3.2), P.airAccel * dt);
      this.vel.y -= P.gravity * dt;
      // Short hops: let go of jump early and you fall sooner
      if (this.vel.y > 0 && !input.jump) this.vel.y -= P.gravity * dt * 0.9;
      if (this.jumpBuf > 0 && this.coyote > 0) {
        this.vel.y = P.jump * (1 - this.wade * 0.35); this.grounded = false; this.coyote = 0; this.jumpBuf = 0; ev.jumped = true;
      }
      // Grab a ledge in front of you
      if ((input.jumpHit || (input.jump && !this.grounded)) && input.mz > 0) {
        const ax = this.pos.x + fx * 0.85, az = this.pos.z + fz * 0.85;
        const top = w.standAt(ax, az, this.pos.y + 1.6), rise = top - this.pos.y;
        if (rise > 0.6 && rise < 2.2 && top > w.ground(ax, az) + 0.3) {
          this.mantle = { t: 0, fx: this.pos.x, fy: this.pos.y, fz: this.pos.z, tx: ax, ty: top + 0.02, tz: az };
          ev.mantled = true; return ev;
        }
      }
    }

    // Move, then get pushed out of ruins, trees and props
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    w.push(this.pos, this.pos.y, 0.35, this.vel);
    const r = Math.hypot(this.pos.x, this.pos.z), R = WORLD.rim + 22;
    if (r > R) { this.pos.x *= R / r; this.pos.z *= R / r; }

    this.pos.y += this.vel.y * dt;
    const g2 = w.standAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g2) {
      if (!this.grounded && !this.swimming && this.vel.y < -3.5) {
        ev.landed = -this.vel.y;
        if (this.vel.y < -17 && depth < 0.8) this.hurt((-this.vel.y - 17) * 4);   // long falls hurt
        if (depth > 0.25) ev.splashed = Math.min(1, -this.vel.y / 10);
      }
      this.pos.y = g2; this.vel.y = Math.max(0, this.vel.y); this.grounded = !this.swimming;
    } else if (!this.swimming && this.grounded && this.pos.y - g2 < 0.45 && this.vel.y <= 0) { this.pos.y = g2; this.vel.y = 0; }  // stick to slopes going down
    else if (!this.swimming) this.grounded = false;

    // Footsteps
    if (this.grounded && this.speed > 1) {
      const before = Math.floor(this.stepPhase / Math.PI);
      this.stepPhase += this.speed * dt * (this.sprinting ? 1.25 : 1.6);
      if (Math.floor(this.stepPhase / Math.PI) !== before) { ev.step = true; this.surface = this._surface(g2); }
    }

    // Air: your head is under water
    const wasUnder = this.headUnder;
    this.headUnder = this.pos.y + this.eye < level - 0.05;
    if (this.headUnder) this.oxygen -= dt;
    else this.oxygen = Math.min(this.maxOxygen, this.oxygen + dt * 12);
    if (wasUnder && !this.headUnder) ev.surfaced = this.oxygen < this.maxOxygen * 0.5 ? 'gasp' : true;
    if (this.oxygen <= 0) { this.oxygen = 0; this.hurt(14 * dt); }

    this.attackCd -= dt;
    if (input.attack && this.attackCd <= 0 && !this.swimming) { this.attackCd = PLAYER.attackCooldown; ev.swung = true; }
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.dead) ev.died = true;
    return ev;
  }

  _accel(wx, wz, max, amount) {
    const cur = this.vel.x * wx + this.vel.z * wz, add = max - cur;
    if (add <= 0) return;
    const a = Math.min(amount, add);
    this.vel.x += wx * a; this.vel.z += wz * a;
  }

  _surface(g) {
    // Standing on a prop (the dock, a barrel, a column) rather than the ground?
    const tg = this.world.ground(this.pos.x, this.pos.z);
    if (g > tg + 0.15) return this.world.camps.some(c => Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 60) && g < 1.5 && g > 0.9 ? 'wood' : 'stone';
    return this.world.terrain.surfaceAt(this.pos.x, this.pos.z);
  }
}
