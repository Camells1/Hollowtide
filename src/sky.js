// The sky: a day that turns to a red sunset as the tide drains, a starry night with a big moon
// while the Hollow is open, and a pink dawn when the flood comes. Drifting clouds all the way.
import * as THREE from 'three';
import { GLSL_NOISE, smooth, lerp } from './util.js';

const PAL = {
  day: { zenith: new THREE.Color(0x2f7fd0), horizon: new THREE.Color(0xb9dcef), sun: new THREE.Color(0xfff1d8) },
  dusk: { zenith: new THREE.Color(0x2a3f78), horizon: new THREE.Color(0xf09a5a), sun: new THREE.Color(0xff9a50) },
  night: { zenith: new THREE.Color(0x030a1c), horizon: new THREE.Color(0x0f2a44), sun: new THREE.Color(0x9db8ff) },
  dawn: { zenith: new THREE.Color(0x34508a), horizon: new THREE.Color(0xf2a8a0), sun: new THREE.Color(0xffc0a0) }
};

export class Sky {
  constructor() {
    this.state = {
      sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), sunColor: new THREE.Color(), zenith: new THREE.Color(), horizon: new THREE.Color(),
      night: 0, keyDir: new THREE.Vector3(), keyColor: new THREE.Color(), keyIntensity: 3, fog: new THREE.Color()
    };
    this.uniforms = {
      uTime: { value: 0 }, uNight: { value: 0 },
      uSunDir: { value: this.state.sunDir }, uMoonDir: { value: this.state.moonDir }, uSunColor: { value: this.state.sunColor },
      uZenith: { value: this.state.zenith }, uHorizon: { value: this.state.horizon }
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uNight;
        uniform vec3 uSunDir, uMoonDir, uSunColor, uZenith, uHorizon;
        varying vec3 vDir;
        ${GLSL_NOISE}
        float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.65, h), 0.75));
          col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
          // Sun: a soft halo and a bright disc
          float sd = max(dot(d, uSunDir), 0.0), sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
          col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 90.0) * 0.6) * sunUp;
          col += uSunColor * smoothstep(0.99935, 0.99965, sd) * 12.0 * sunUp;
          // Stars, twinkling, fading near the horizon
          if (uNight > 0.01) {
            vec3 sp = d * 220.0, cell = floor(sp);
            float r = hash3(cell);
            float star = step(0.9965, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
            star *= 0.6 + 0.4 * sin(uTime * (2.0 + r * 9.0) + r * 60.0);
            col += vec3(0.85, 0.9, 1.0) * star * uNight * smoothstep(0.02, 0.25, h) * 2.2;
            // A faint band of the galaxy
            float bd = dot(d, normalize(vec3(0.3, 0.5, 0.8))) * 3.2;
            float band = exp(-bd * bd);
            col += vec3(0.25, 0.3, 0.5) * band * htFbm(d.xz * 9.0 + d.y * 4.0) * 0.18 * uNight * smoothstep(0.0, 0.3, h);
          }
          // Moon with a little surface detail
          float md = dot(d, uMoonDir);
          float disc = smoothstep(0.99905, 0.99925, md);
          if (disc > 0.0) {
            vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), b = cross(t, uMoonDir);
            vec2 mp = vec2(dot(d, t), dot(d, b)) * 400.0;
            float craters = htFbm(mp * 0.9 + 4.0);
            col = mix(col, vec3(0.95, 0.96, 0.9) * (0.75 + craters * 0.4), disc * smoothstep(0.0, 0.3, uNight + 0.1));
          }
          col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 180.0) * 0.45 * uNight;
          // Clouds on a flat layer, lit from the sun's side
          if (h > 0.0) {
            vec2 cuv = d.xz / (h + 0.08) * 0.55 + uTime * vec2(0.006, 0.002);
            float c = htFbm(cuv * 1.4) * 0.65 + htFbm(cuv * 3.7 + 9.0) * 0.35;
            float cover = smoothstep(0.5, 0.78, c) * smoothstep(0.0, 0.18, h);
            float lit = 0.55 + 0.45 * pow(sd, 3.0);
            vec3 cloudDay = mix(vec3(0.62, 0.66, 0.72), vec3(1.0), lit) * mix(vec3(1.0), uSunColor, 0.45);
            vec3 cloudNight = vec3(0.07, 0.09, 0.14) + vec3(0.2, 0.24, 0.3) * pow(max(md, 0.0), 6.0);
            vec3 cc = mix(cloudDay * (0.35 + 0.65 * sunUp), cloudNight, uNight);
            col = mix(col, cc, cover * 0.88);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
  }

  // night: 0..1 from the tide; phase picks sunset (ebb) or dawn (flood) colours
  update(time, night, phase, camera) {
    const s = this.state;
    s.night = night;
    this.uniforms.uTime.value = time; this.uniforms.uNight.value = night;
    // Colours: day -> dusk/dawn -> night
    const twi = phase === 'flood' || (phase === 'day' && night < 0.05) ? PAL.dawn : PAL.dusk;
    const k1 = smooth(0, 0.5, night), k2 = smooth(0.45, 0.85, night);
    for (const key of ['zenith', 'horizon']) s[key].copy(PAL.day[key]).lerp(twi[key], k1).lerp(PAL.night[key], k2);
    s.sunColor.copy(PAL.day.sun).lerp(twi.sun, k1);
    // The sun sets as the tide drains; the moon rises over the Hollow
    const sunEl = lerp(0.95, -0.3, smooth(0, 0.8, night)), sunAz = phase === 'flood' ? -2.2 : 2.3;
    s.sunDir.set(Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.sin(sunAz) * Math.cos(sunEl));
    const moonEl = lerp(-0.25, 0.85, smooth(0.45, 1, night)), moonAz = -0.9;
    s.moonDir.set(Math.cos(moonAz) * Math.cos(moonEl), Math.sin(moonEl), Math.sin(moonAz) * Math.cos(moonEl));
    // One light does both jobs: the sun by day, the moon by night
    const sunK = 1 - smooth(0.35, 0.66, night), moonK = smooth(0.66, 0.9, night);
    if (sunK > 0.001) { s.keyDir.copy(s.sunDir); s.keyColor.copy(s.sunColor); s.keyIntensity = 3.2 * sunK; s.keyDir.y = Math.max(s.keyDir.y, 0.12); }
    else { s.keyDir.copy(s.moonDir); s.keyColor.setRGB(0.55, 0.68, 1.0); s.keyIntensity = 0.75 * moonK; }
    s.keyDir.normalize();
    s.fog.copy(s.horizon);
    this.mesh.position.copy(camera.position);
    return s;
  }
}
