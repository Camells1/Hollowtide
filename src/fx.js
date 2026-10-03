// Particles and small living things: splashes, bubbles, sand puffs, campfire flames and sparks,
// sparkles from opened chests, fireflies on the islands at night, drifting specks under water,
// schools of fish in the lagoon and gulls circling overhead.
import * as THREE from 'three';
import { A, instance } from './assets.js';
import { WORLD } from './config.js';

class Particles {
  constructor(max, additive) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.rgba = new Float32Array(max * 4); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.top = new Float32Array(max).fill(1e9);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.uniforms = { uScale: { value: 600 } };
    this.mesh = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main() { vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC;
        void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, ${additive ? '0.0' : '0.25'}, d) * vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb${additive ? ' * a' : ''}, a); }`
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
  }
  // p: { x,y,z, vx,vy,vz, life, size, size2, r,g,b, a, grav, drag, top (dies above this height) }
  emit(p) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx || 0; this.vel[i * 3 + 1] = p.vy || 0; this.vel[i * 3 + 2] = p.vz || 0;
    this.life[i] = this.maxLife[i] = p.life || 1;
    this.rgba[i * 4] = p.r ?? 1; this.rgba[i * 4 + 1] = p.g ?? 1; this.rgba[i * 4 + 2] = p.b ?? 1; this.rgba[i * 4 + 3] = p.a ?? 1;
    this.s0[i] = p.size ?? 0.1; this.s1[i] = p.size2 ?? this.s0[i];
    this.grav[i] = p.grav ?? 0; this.drag[i] = p.drag ?? 0; this.top[i] = p.top ?? 1e9;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = 1 - this.life[i] / this.maxLife[i], j = i * 3, d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j + 1] -= this.grav[i] * dt;
      this.vel[j] *= d; this.vel[j + 1] *= d; this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] > this.top[i]) this.life[i] = 0;
      const fade = Math.min(1, k * 8) * Math.min(1, (1 - k) * 2.5);
      this.col[i * 4] = this.rgba[i * 4]; this.col[i * 4 + 1] = this.rgba[i * 4 + 1]; this.col[i * 4 + 2] = this.rgba[i * 4 + 2];
      this.col[i * 4 + 3] = this.life[i] > 0 ? this.rgba[i * 4 + 3] * fade : 0;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }
}

const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;

export class Fx {
  constructor(scene, world, quality) {
    this.scene = scene; this.world = world;
    this.soft = new Particles(quality === 'low' ? 700 : 1600, false);
    this.glow = new Particles(quality === 'low' ? 500 : 1200, true);
    this.group = new THREE.Group(); this.group.add(this.soft.mesh, this.glow.mesh); scene.add(this.group);
    this.t = 0; this.acc = { fire: 0, fly: 0, snow: 0, bub: 0 };
    // Fish: two small schools that stay near you while there's water to swim in
    this.fish = [];
    const nFish = quality === 'low' ? 6 : 14;
    for (let i = 0; i < nFish; i++) {
      const clown = i % 7 === 6, root = instance(clown ? 'clownfish' : 'fish', clown ? 0.3 : 0.45 + Math.random() * 0.25, 'long');
      root.traverse(o => { if (o.isMesh) o.castShadow = false; });
      const mixer = new THREE.AnimationMixer(root), clip = A.models[clown ? 'clownfish' : 'fish'].animations.find(c => /Swim(ming_Normal)?$/.test(c.name));
      if (clip) { const a = mixer.clipAction(clip); a.play(); a.time = Math.random(); a.timeScale = 1.2 + Math.random() * 0.6; }
      root.visible = false; this.group.add(root);
      this.fish.push({ root, mixer, school: i % 2, a: Math.random() * 6.28, r: 1.5 + Math.random() * 3.5, h: rnd(1.2), sp: 0.5 + Math.random() * 0.5 });
    }
    this.schools = [0, 1].map(() => ({ x: 0, y: -100, z: 0, tx: 0, ty: 0, tz: 0, ok: false, t: 0 }));
    // Gulls: simple birds with flapping wings, circling the nearest island by day
    this.gulls = [];
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8, side: THREE.DoubleSide }), grey = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < (quality === 'low' ? 3 : 7); i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), white); body.scale.set(1, 0.8, 2.6); g.add(body);
      const wings = [1, -1].map(s => {
        const shape = new THREE.BufferGeometry();
        shape.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.14, 0.75 * s, 0, 0.02, 0.75 * s, 0, 0.02, 0, 0, -0.14, 1.25 * s, 0, -0.2], 3));
        shape.computeVertexNormals();
        const w = new THREE.Mesh(shape, grey); g.add(w); return w;
      });
      this.group.add(g);
      this.gulls.push({ g, wings, a: Math.random() * 6.28, r: 30 + Math.random() * 45, h: 22 + Math.random() * 18, sp: 0.12 + Math.random() * 0.08, ph: Math.random() * 6 });
    }
  }

  // ---------------------------------------------------------------- one-off effects
  splash(x, y, z, n = 26, power = 1) {
    for (let i = 0; i < n; i++) this.soft.emit({ x: x + rnd(0.4), y, z: z + rnd(0.4), vx: rnd(2.2 * power), vy: 2 + Math.random() * 4 * power, vz: rnd(2.2 * power), life: 0.5 + Math.random() * 0.5, size: 0.1, size2: 0.03, r: 0.9, g: 0.97, b: 1, a: 0.8, grav: 12 });
    for (let i = 0; i < 6; i++) this.soft.emit({ x: x + rnd(0.5), y: y + 0.05, z: z + rnd(0.5), vx: rnd(1.5), vz: rnd(1.5), life: 0.9, size: 0.3, size2: 1.2, r: 1, g: 1, b: 1, a: 0.35, drag: 2 });
  }
  bubbles(x, y, z, n, level, spread = 0.2) {
    for (let i = 0; i < n; i++) this.soft.emit({ x: x + rnd(spread), y: y + rnd(spread), z: z + rnd(spread), vx: rnd(0.3), vy: 0.8 + Math.random() * 1.2, vz: rnd(0.3), life: 1.5 + Math.random() * 2, size: 0.03 + Math.random() * 0.05, r: 0.8, g: 0.95, b: 1, a: 0.55, drag: 0.5, top: level - 0.05 });
  }
  dust(x, y, z, n = 8, tint = [0.8, 0.72, 0.55]) {
    for (let i = 0; i < n; i++) this.soft.emit({ x: x + rnd(0.3), y: y + 0.1, z: z + rnd(0.3), vx: rnd(1.2), vy: 0.4 + Math.random() * 0.8, vz: rnd(1.2), life: 0.7 + Math.random() * 0.5, size: 0.2, size2: 0.8, r: tint[0], g: tint[1], b: tint[2], a: 0.35, drag: 2.5 });
  }
  sparkle(x, y, z, n = 40) {
    for (let i = 0; i < n; i++) this.glow.emit({ x: x + rnd(0.3), y: y + rnd(0.2), z: z + rnd(0.3), vx: rnd(1.6), vy: 1.5 + Math.random() * 3, vz: rnd(1.6), life: 0.8 + Math.random() * 0.9, size: 0.12, size2: 0.02, r: 1, g: 0.8, b: 0.35, a: 0.9, grav: 3.5, drag: 0.8 });
    for (let i = 0; i < 12; i++) this.glow.emit({ x: x + rnd(0.4), y, z: z + rnd(0.4), vy: 0.5 + Math.random(), life: 1.6, size: 0.25, size2: 0.05, r: 0.4, g: 1, b: 0.85, a: 0.5 });
  }
  shellBits(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) this.soft.emit({ x, y, z, vx: rnd(3), vy: 1.5 + Math.random() * 2.5, vz: rnd(3), life: 0.5 + Math.random() * 0.3, size: 0.07, size2: 0.03, r: 0.9, g: 0.4, b: 0.2, a: 1, grav: 12 });
    this.dust(x, y - 0.3, z, 4);
  }

  // ---------------------------------------------------------------- per frame
  // s: { cam (Vector3), level, night, under (camera under water), viewH, fov, playerY, onLand }
  update(dt, s) {
    this.t += dt;
    const scale = s.viewH / (2 * Math.tan(s.fov * Math.PI / 360));
    this.soft.uniforms.uScale.value = this.glow.uniforms.uScale.value = scale;
    const cam = s.cam;
    // Campfires near you: flames, sparks and a little smoke
    this.acc.fire += dt * 40;
    while (this.acc.fire >= 1) {
      this.acc.fire -= 1;
      for (const c of this.world.camps) {
        if (Math.hypot(c.x - cam.x, c.z - cam.z) > 110) continue;
        this.glow.emit({ x: c.x + rnd(0.22), y: c.y + 0.25, z: c.z + rnd(0.22), vx: rnd(0.15), vy: 0.9 + Math.random() * 0.9, vz: rnd(0.15), life: 0.55 + Math.random() * 0.35, size: 0.5, size2: 0.1, r: 1, g: 0.45 + Math.random() * 0.2, b: 0.1, a: 0.5 });
        if (Math.random() < 0.08) this.glow.emit({ x: c.x + rnd(0.2), y: c.y + 0.6, z: c.z + rnd(0.2), vx: rnd(0.6), vy: 1.5 + Math.random() * 2, vz: rnd(0.6), life: 1.2 + Math.random(), size: 0.05, r: 1, g: 0.7, b: 0.3, a: 1, drag: 0.4 });
        if (Math.random() < 0.06) this.soft.emit({ x: c.x + rnd(0.2), y: c.y + 1.2, z: c.z + rnd(0.2), vx: 0.3, vy: 0.9, vz: 0.1, life: 3.5, size: 0.5, size2: 2.2, r: 0.35, g: 0.35, b: 0.38, a: 0.16, drag: 0.2 });
      }
    }
    // Fireflies over the islands at night
    if (s.night > 0.4 && s.onLand && !s.under) {
      this.acc.fly += dt * 10 * s.night;
      while (this.acc.fly >= 1) {
        this.acc.fly -= 1;
        const x = cam.x + rnd(28), z = cam.z + rnd(28), y = this.world.ground(x, z);
        if (y < 1.5) continue;
        this.glow.emit({ x, y: y + 0.4 + Math.random() * 2.5, z, vx: rnd(0.5), vy: rnd(0.25), vz: rnd(0.5), life: 3 + Math.random() * 4, size: 0.09, r: 0.75, g: 1, b: 0.35, a: 0.9 });
      }
    }
    // Under water: drifting specks, and glowing motes in the Hollow at night
    if (s.under) {
      this.acc.snow += dt * 30;
      while (this.acc.snow >= 1) { this.acc.snow -= 1; this.soft.emit({ x: cam.x + rnd(9), y: cam.y + rnd(5), z: cam.z + rnd(9), vx: rnd(0.15), vy: rnd(0.1), vz: rnd(0.15), life: 2.5 + Math.random() * 2, size: 0.025, r: 0.8, g: 0.95, b: 1, a: 0.4, top: s.level }); }
    } else if (s.night > 0.6 && !s.onLand) {
      this.acc.snow += dt * 8;
      while (this.acc.snow >= 1) {
        this.acc.snow -= 1;
        const x = cam.x + rnd(30), z = cam.z + rnd(30), y = this.world.ground(x, z);
        this.glow.emit({ x, y: y + 0.3 + Math.random() * 3, z, vx: rnd(0.2), vy: 0.1 + Math.random() * 0.25, vz: rnd(0.2), life: 4 + Math.random() * 4, size: 0.07, r: 0.3, g: 1, b: 0.85, a: 0.6 });
      }
    }
    this.soft.update(dt); this.glow.update(dt);
    this._fish(dt, s); this._gulls(dt, s);
  }

  _fish(dt, s) {
    const cam = s.cam;
    for (const sc of this.schools) {
      sc.t -= dt;
      const far = Math.hypot(sc.x - cam.x, sc.z - cam.z) > 70;
      if (sc.t <= 0 || far || !sc.ok) {
        // Pick somewhere new with enough water, not too far from you
        sc.t = 4 + Math.random() * 5;
        const a = Math.random() * 6.28, d = 8 + Math.random() * 30, x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d, g = this.world.ground(x, z);
        if (s.level - g > 2.5 && Math.hypot(x, z) < WORLD.rim - 10) {
          sc.tx = x; sc.tz = z; sc.ty = g + 1 + Math.random() * Math.min(4, s.level - g - 1.6);
          if (far || !sc.ok) { sc.x = x; sc.y = sc.ty; sc.z = z; }
          sc.ok = true;
        } else if (far) sc.ok = false;
      }
      const g = this.world.ground(sc.x, sc.z);
      if (s.level - g < 1.6) sc.ok = false;
      sc.x += (sc.tx - sc.x) * dt * 0.25; sc.z += (sc.tz - sc.z) * dt * 0.25;
      sc.y += (Math.min(sc.ty, s.level - 1) - sc.y) * dt * 0.5;
    }
    for (const f of this.fish) {
      const sc = this.schools[f.school];
      f.root.visible = sc.ok;
      if (!sc.ok) continue;
      f.a += dt * f.sp;
      const x = sc.x + Math.cos(f.a) * f.r, z = sc.z + Math.sin(f.a) * f.r, y = Math.max(this.world.ground(x, z) + 0.4, Math.min(sc.y + f.h + Math.sin(f.a * 2.3) * 0.4, s.level - 0.5));
      f.root.position.set(x, y, z);
      f.root.rotation.y = -f.a; // facing along the circle
      f.mixer.update(dt);
    }
  }

  _gulls(dt, s) {
    // Circle the island nearest to you
    let is = WORLD.islands[0], bd = 1e9;
    for (const i of WORLD.islands) { const d = Math.hypot(i.x - s.cam.x, i.z - s.cam.z); if (d < bd) { bd = d; is = i; } }
    for (const b of this.gulls) {
      b.g.visible = s.night < 0.6;
      if (!b.g.visible) continue;
      b.a += dt * b.sp;
      const x = is.x + Math.cos(b.a) * b.r, z = is.z + Math.sin(b.a) * b.r, y = b.h + Math.sin(this.t * 0.3 + b.ph) * 3;
      b.g.position.set(x, y, z);
      b.g.rotation.set(0, -b.a, -0.25, 'YXZ');
      const glide = Math.sin(this.t * 0.4 + b.ph) > 0.3, flap = glide ? 0.12 : Math.sin(this.t * 7 + b.ph) * 0.55;
      b.wings[0].rotation.z = flap; b.wings[1].rotation.z = -flap;
    }
  }

  dispose() { this.scene.remove(this.group); }
}
