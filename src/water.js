// The sea. The lagoon surface rises and falls with the tide; the open ocean outside the atoll stays put.
// Colour comes from the real depth under each pixel (clear in the shallows, deep blue in the trenches),
// with foam where it meets the shore, sun glints, sky reflections, and a different look from below.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { GLSL_NOISE } from './util.js';

const WAVES = /* glsl */`
// Long swell (direction, wavelength, amplitude, speed)
vec3 swell(vec2 p, float t) {
  vec3 r = vec3(0.0);
  vec4 W[4];
  W[0] = vec4(normalize(vec2(1.0, 0.35)), 38.0, 0.30);
  W[1] = vec4(normalize(vec2(-0.45, 1.0)), 23.0, 0.16);
  W[2] = vec4(normalize(vec2(0.7, -0.7)), 13.0, 0.08);
  W[3] = vec4(normalize(vec2(-0.9, -0.3)), 7.5, 0.045);
  for (int i = 0; i < 4; i++) {
    float k = 6.2832 / W[i].z, f = k * dot(W[i].xy, p) + t * sqrt(9.8 * k);
    r.x += W[i].w * sin(f);
    r.yz += W[i].w * k * W[i].xy * cos(f);
  }
  return r; // height, d/dx, d/dz
}
// Small ripples, only for the lighting
vec2 ripples(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i), a = fi * 2.39996 + 0.7;
    vec2 d = vec2(cos(a), sin(a));
    float k = 6.2832 / (2.6 - fi * 0.38), f = k * dot(d, p) + t * sqrt(9.8 * k) * 0.9;
    g += 0.018 * k * d * cos(f) / (1.0 + fi * 0.3);
  }
  return g;
}`;

export class Water {
  constructor(heightTex) {
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uAmp: { value: 1 }, uOuter: { value: 0 },
      tHeight: { value: null },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() }, uSunColor: { value: new THREE.Color(0xfff2d6) },
      uMoonDir: { value: new THREE.Vector3(-0.4, 0.6, -0.5).normalize() },
      uZenith: { value: new THREE.Color(0x3d8fd6) }, uHorizon: { value: new THREE.Color(0xb7dcef) },
      uDeep: { value: new THREE.Color(0x0a3550) }, uShallow: { value: new THREE.Color(0x3fb8b0) },
      uNight: { value: 0 }, uHalf: { value: WORLD.size / 2 }, uSize: { value: WORLD.size }, uRim: { value: WORLD.rim + 15 }
    }]);
    this.uniforms.tHeight.value = heightTex;
    const material = (outer) => {
      const u = { ...this.uniforms, uOuter: { value: outer ? 1 : 0 }, uAmp: outer ? { value: 1.3 } : this.uniforms.uAmp };
      return new THREE.ShaderMaterial({
        uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
        vertexShader: /* glsl */`
          #include <common>
          #include <fog_pars_vertex>
          uniform float uTime, uAmp;
          varying vec3 vW; varying float vH;
          ${WAVES}
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vec3 s = swell(w.xz, uTime);
            w.y += s.x * uAmp;
            vW = w.xyz; vH = s.x;
            vec4 mvPosition = viewMatrix * w;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */`
          #include <common>
          #include <fog_pars_fragment>
          uniform float uTime, uAmp, uOuter, uNight, uHalf, uSize, uRim;
          uniform sampler2D tHeight;
          uniform vec3 uSunDir, uSunColor, uMoonDir, uZenith, uHorizon, uDeep, uShallow;
          varying vec3 vW; varying float vH;
          ${WAVES}
          ${GLSL_NOISE}
          void main() {
            vec2 p = vW.xz;
            if (uOuter < 0.5 && length(p) > uRim) discard;
            vec2 g = swell(p, uTime).yz * uAmp + ripples(p, uTime);
            vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
            vec3 V = normalize(cameraPosition - vW);
            float ground = texture2D(tHeight, (p + uHalf) / uSize).r * 70.0 - 40.0;
            float depth = max(vW.y - ground, 0.0);
            vec3 col; float alpha;
            if (gl_FrontFacing) {
              float fres = 0.02 + 0.98 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
              vec3 R = reflect(-V, N);
              vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, R.y));
              float absorb = 1.0 - exp(-depth * 0.17);
              vec3 body = mix(uShallow, uDeep, absorb);
              body += uShallow * 0.35 * clamp(vH * 2.0, 0.0, 1.0) * (1.0 - uNight); // light through the crests
              col = mix(body, sky, fres * 0.85);
              float sd = max(dot(R, uSunDir), 0.0);
              col += uSunColor * (pow(sd, 700.0) * 7.0 + pow(sd, 50.0) * 0.18) * (1.0 - uNight) * step(0.0, uSunDir.y);
              col += vec3(0.75, 0.85, 1.0) * pow(max(dot(R, uMoonDir), 0.0), 400.0) * 2.5 * uNight;
              // Foam: a band along every shore, plus little lines rolling in
              float fn = htNoise(p * 0.9 + uTime * vec2(0.3, 0.2)) * 0.6 + htNoise(p * 2.7 - uTime * 0.5) * 0.4;
              float shore = 1.0 - smoothstep(0.0, 1.3, depth);
              float lines = smoothstep(0.6, 0.95, sin(depth * 4.5 - uTime * 2.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.3, 2.6, depth));
              float crest = smoothstep(0.4, 0.56, vH * uAmp) * 0.35 * step(0.5, htNoise(p * 0.35 + uTime * 0.1));
              float foam = clamp(shore * 0.85 + lines * 0.55 + crest, 0.0, 1.0) * smoothstep(0.25, 0.55, fn + shore * 0.35);
              col = mix(col, vec3(0.93, 0.97, 1.0) * mix(1.0, 0.25, uNight), foam);
              alpha = clamp(mix(0.25, 0.94, absorb) + fres * 0.4 + foam, 0.0, 1.0) * smoothstep(0.0, 0.3, depth);
            } else {
              // From under the surface: the sky only shows straight up (Snell's window)
              float up = smoothstep(0.55, 0.85, -V.y);
              vec3 sky = mix(uHorizon, uZenith, 0.4);
              col = mix(uDeep * 1.6, sky * 0.9 + uSunColor * 0.15 * (1.0 - uNight), up);
              col += vec3(0.5, 0.8, 0.9) * htCaustic(p * 0.3, uTime) * 0.12 * up * (1.0 - uNight);
              alpha = 0.92;
            }
            gl_FragColor = vec4(col, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`
      });
    };
    const lagoonGeo = new THREE.PlaneGeometry(WORLD.rim * 2 + 40, WORLD.rim * 2 + 40, 220, 220); lagoonGeo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(lagoonGeo, material(false));
    this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
    const oceanGeo = new THREE.RingGeometry(WORLD.rim + 10, 3200, 180, 10); oceanGeo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(oceanGeo, material(true));
    this.ocean.renderOrder = 2; this.ocean.frustumCulled = false;
    this.level = 0;
  }

  // level: lagoon water height. sky: { sunDir, sunColor, moonDir, zenith, horizon, night }
  update(time, level, levelK, sky) {
    const u = this.uniforms;
    u.uTime.value = time;
    // The tide pools at low tide are calm; the full lagoon has a proper swell
    u.uAmp.value = 0.3 + levelK * 0.7;
    u.uSunDir.value.copy(sky.sunDir); u.uSunColor.value.copy(sky.sunColor); u.uMoonDir.value.copy(sky.moonDir);
    u.uZenith.value.copy(sky.zenith); u.uHorizon.value.copy(sky.horizon); u.uNight.value = sky.night;
    const dim = 1 - sky.night * 0.78;
    u.uDeep.value.setRGB(0.008 * dim, 0.05 * dim, 0.09 * dim);
    u.uShallow.value.setRGB(0.07 * dim, 0.42 * dim, 0.42 * dim);
    this.level = level;
    this.mesh.position.y = level;
  }

  dispose() { for (const m of [this.mesh, this.ocean]) { m.geometry.dispose(); m.material.dispose(); } }
}
