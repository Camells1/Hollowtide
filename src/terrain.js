// The lagoon: a green island in the middle, a seabed of sand dunes and trenches,
// and an atoll ring of rock that keeps the sea out of the Hollow.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { fbm, ridge, smooth, lerp, clamp } from './util.js';

// Raw height function (metres). Sea level at high tide is 0.
export function rawHeight(x, z, seed) {
  const r = Math.hypot(x, z);
  // Island: a soft volcanic hill with a beach
  const isl = 15 * Math.pow(Math.max(0, 1 - r / 56), 1.35) + fbm(x * 0.04, z * 0.04, seed) * 2.2 - 1.2;
  // Seabed: slopes away from the island into dunes and ridged trenches
  const dunes = fbm(x * 0.018, z * 0.018, seed + 5) * 4 + fbm(x * 0.07, z * 0.07, seed + 9) * 0.8;
  const trench = Math.pow(ridge(x * 0.011, z * 0.011, seed + 3), 6) * -9;
  const sea = -4.5 - clamp((r - 45) * 0.075, 0, 11) + dunes + trench;
  let h = lerp(isl, sea, smooth(36, 64, r));
  // Atoll ring: rock wall around the lagoon
  const rim = smooth(WORLD.rimStart - 6, WORLD.rimStart + 18, r);
  h = lerp(h, 7 + fbm(x * 0.05, z * 0.05, seed + 11) * 3, rim);
  return h;
}

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    const N = WORLD.segments, S = WORLD.size;
    this.N = N; this.S = S; this.step = S / N;
    // Height grid shared by the mesh and the physics (so feet always match the ground you see)
    this.h = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -S / 2 + i * this.step, z = -S / 2 + j * this.step;
      this.h[j * (N + 1) + i] = rawHeight(x, z, seed);
    }
    this.mesh = this._mesh();
  }

  // Bilinear height at any point
  heightAt(x, z) {
    const N = this.N, S = this.S;
    const fx = clamp((x + S / 2) / this.step, 0, N - 0.001), fz = clamp((z + S / 2) / this.step, 0, N - 0.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * (N + 1) + i;
    const a = this.h[k], b = this.h[k + 1], c = this.h[k + N + 1], d = this.h[k + N + 2];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  normalAt(x, z) {
    const e = 0.6;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z), dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return new THREE.Vector3(-dx, 2 * e, -dz).normalize();
  }

  _mesh() {
    const N = this.N, S = this.S;
    const geo = new THREE.PlaneGeometry(S, S, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grass = new THREE.Color(0x5f9a4a), grassDark = new THREE.Color(0x3f7a3a), sand = new THREE.Color(0xe2cfa0), wetSand = new THREE.Color(0xa8936a);
    const silt = new THREE.Color(0x6f7a68), deep = new THREE.Color(0x3f4f52), rock = new THREE.Color(0x7d7468);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const i = Math.round((x + S / 2) / this.step), j = Math.round((z + S / 2) / this.step);
      const y = this.h[j * (N + 1) + i];
      pos.setY(k, y);
      const r = Math.hypot(x, z);
      const n = fbm(x * 0.15, z * 0.15, this.seed + 21) * 0.5 + 0.5;
      if (r > WORLD.rimStart - 4 && y > -2) c.copy(rock).lerp(silt, clamp(-y * 0.2, 0, 1));
      else if (y > 2.2) c.copy(grassDark).lerp(grass, n);
      else if (y > 0.4) c.copy(sand).lerp(grass, smooth(1.4, 2.2, y) * 0.8);
      else if (y > -3) c.copy(wetSand).lerp(sand, smooth(-3, 0.4, y));
      else c.copy(deep).lerp(silt, smooth(-16, -5, y));
      c.offsetHSL(0, 0, (n - 0.5) * 0.06);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
}
