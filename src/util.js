// Small helpers: seeded random numbers, value noise, maths.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// Deterministic random numbers (same seed = same world for everyone in co-op)
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise with smooth interpolation, plus fractal sums
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function fbm(x, y, seed = 0, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { sum += noise2(x * f, y * f, seed + i * 17) * amp; f *= 2; amp *= 0.5; }
  return sum;
}
// Ridged noise: sharp valleys (trenches)
export const ridge = (x, y, seed = 0) => 1 - Math.abs(noise2(x, y, seed));

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The same kind of noise on the GPU (used by the terrain, water, sky and props)
export const GLSL_NOISE = /* glsl */`
float htHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float htNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(htHash(i), htHash(i + vec2(1.0, 0.0)), u.x), mix(htHash(i + vec2(0.0, 1.0)), htHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float htFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += htNoise(p) * a; p = p * 2.03 + 17.1; a *= 0.5; } return s; }
// Bright wavy lines like sunlight focused by ripples on the sea floor
float htCaustic(vec2 p, float t) {
  vec2 q = p + vec2(sin(p.y * 1.3 + t * 0.7), cos(p.x * 1.1 - t * 0.6)) * 0.6;
  float a = abs(sin(q.x * 2.1 + t) + sin(q.y * 2.3 - t * 0.8) + sin((q.x + q.y) * 1.7 + t * 1.3));
  vec2 r = p * 1.7 + vec2(cos(p.y * 0.9 - t * 0.5), sin(p.x * 1.2 + t * 0.4)) * 0.8;
  float b = abs(sin(r.x * 2.0 - t * 1.1) + sin(r.y * 1.9 + t * 0.9) + sin((r.x - r.y) * 1.5 - t));
  return pow(max(0.0, 1.0 - a * 0.5), 5.0) + pow(max(0.0, 1.0 - b * 0.5), 6.0) * 0.6;
}
`;
