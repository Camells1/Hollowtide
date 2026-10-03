// The local player: walking, sprinting, jumping, swimming and diving, air and stamina,
// and the flood's undertow that drags you down when the tide comes back.
import * as THREE from 'three';
import { PLAYER, PACK_BASE } from './config.js';
import { clamp } from './util.js';

export class Player {
  constructor(world, upgrades) {
    this.world = world;
    this.up = upgrades; // { lungs, fins, pack, blade, ... } levels
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;          // facing (radians)
    this.reset();
  }

  get maxOxygen() { return PLAYER.oxygen + (this.up.lungs || 0) * 15; }
  get packSize() { return PACK_BASE + (this.up.pack || 0) * 10; }
  get packCount() { return Object.values(this.pack).reduce((a, b) => a + b, 0); }
  get damage() { return PLAYER.attackDamage + (this.up.blade || 0) * 15; }

  reset() {
    const [x, z] = this.world.camp.spawn;
    this.pos.set(x, this.world.ground(x, z) + 0.05, z);
    this.vel.set(0, 0, 0);
    this.hp = PLAYER.health; this.oxygen = this.maxOxygen; this.stamina = PLAYER.stamina;
    this.pack = {}; this.dead = false; this.respawnT = 0; this.swim = 0; this.grounded = true; this.attackCd = 0; this.hurtT = 0;
    this.headUnder = false;
  }

  addItem(id, n = 1) {
    const room = this.packSize - this.packCount;
    const take = Math.min(room, n);
    if (take > 0) this.pack[id] = (this.pack[id] || 0) + take;
    return take;
  }

  hurt(dmg) {
    if (this.dead) return;
    this.hp -= dmg; this.hurtT = 0.4;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.respawnT = 4; }
  }

  // input: { mx, mz (-1..1 relative to camera), camYaw, sprint, jump, dive, attack }
  // env:   { level (water height), flood (true while the tide comes back) }
  // Returns events: { died, swung, splashed }
  update(dt, input, env) {
    const ev = {};
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.reset(); ev.respawned = true; }
      return ev;
    }
    const g = this.world.ground(this.pos.x, this.pos.z);
    const level = env.level;
    const wasSwim = this.swim > 0.5;
    const deep = level - g > 1.3;               // too deep to stand
    const inWater = level > this.pos.y + 1.0;   // water above the waist
    this.swim += ((inWater && deep ? 1 : 0) - this.swim) * Math.min(1, dt * 6);
    const swimming = this.swim > 0.5;
    if (swimming !== wasSwim && swimming) ev.splashed = true;

    // Wish direction from the camera
    const fx = -Math.sin(input.camYaw), fz = -Math.cos(input.camYaw);
    let wx = fx * input.mz - fz * input.mx, wz = fz * input.mz + fx * input.mx;
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    const moving = wl > 0.05;
    const sprinting = input.sprint && moving && this.stamina > 2;
    let speed;
    if (swimming) speed = (sprinting ? PLAYER.swimSprint : PLAYER.swim) * (1 + 0.25 * (this.up.fins || 0));
    else speed = sprinting ? PLAYER.sprint : PLAYER.walk;
    if (inWater && !swimming) speed *= 0.7; // wading

    // Stamina: sprinting and treading water at the surface both cost it
    // Open water at high tide wears you out; you only get your breath back on land
    const drain = (sprinting ? 16 : 0) + (swimming && env.highTide ? 3.5 : 0);
    const regen = swimming && env.highTide ? 0 : 22;
    this.stamina = clamp(this.stamina + (drain > 0 ? -drain : regen) * dt, 0, PLAYER.stamina);

    // Horizontal velocity eases toward the wish direction
    const accel = swimming ? 4 : this.grounded ? 14 : 3;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, dt * accel);
    if (moving) this.yaw = Math.atan2(-wx, -wz);

    if (swimming) {
      // Float up to just below the surface unless diving; Space swims up, C dives
      const rest = level - 1.25;
      let vy = clamp((rest - this.pos.y) * 1.8, -3, 2.2); // gentle: surfacing from deep takes time
      if (input.jump) vy = 2.6;
      if (input.dive) vy = -2.6;
      if (this.stamina <= 0 && env.highTide) vy = -0.8;   // exhausted: you start to sink
      if (env.flood) vy -= 0.9;                            // the undertow drags you down
      this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 3);
      this.grounded = false;
    } else {
      this.vel.y -= PLAYER.gravity * dt;
      if (input.jump && this.grounded) { this.vel.y = PLAYER.jump; this.grounded = false; }
    }

    // Move and resolve collisions with ruins, trees and camp props (circles)
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    for (const c of this.world.colliders) {
      if (this.pos.y > c.top - 0.2) continue;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + 0.35;
      if (d < min && d > 1e-4) { this.pos.x = c.x + dx / d * min; this.pos.z = c.z + dz / d * min; }
    }
    // Stay inside the lagoon
    const r = Math.hypot(this.pos.x, this.pos.z), R = 236;
    if (r > R) { this.pos.x *= R / r; this.pos.z *= R / r; }

    this.pos.y += this.vel.y * dt;
    const g2 = this.world.ground(this.pos.x, this.pos.z);
    if (this.pos.y <= g2) {
      if (!swimming && this.vel.y < -16) this.hurt((-this.vel.y - 16) * 4); // long falls hurt
      this.pos.y = g2; this.vel.y = Math.max(0, this.vel.y); this.grounded = !swimming;
    } else if (!swimming && this.pos.y - g2 > 0.15) this.grounded = false;
    else if (!swimming) { this.pos.y = g2; this.grounded = true; }

    // Air: your head is under water
    const head = this.pos.y + (swimming ? 0.95 : 1.6);
    this.headUnder = head < level - 0.1;
    if (this.headUnder) this.oxygen -= dt;
    else this.oxygen = Math.min(this.maxOxygen, this.oxygen + dt * 10);
    if (this.oxygen <= 0) { this.oxygen = 0; this.hurt(14 * dt); }

    // Attack
    this.attackCd -= dt;
    if (input.attack && this.attackCd <= 0) { this.attackCd = 0.55; ev.swung = true; }
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.dead) ev.died = true;
    return ev;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
}
