// The sea: a large animated surface whose height follows the tide.
import * as THREE from 'three';

export class Water {
  constructor() {
    const geo = new THREE.PlaneGeometry(1600, 1600, 180, 180);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0xfff2d6) },
      uSky: { value: new THREE.Color(0x8fc6e8) },
      uDeep: { value: new THREE.Color(0x0b3a52) },
      uShallow: { value: new THREE.Color(0x2fa6a4) },
      uNight: { value: 0 },
      uFogColor: { value: new THREE.Color(0x8fc6e8) },
      uFogNear: { value: 80 }, uFogFar: { value: 600 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
        float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + uTime * s); }
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vec2 p = w.xz;
          float h = wave(p, vec2(1.0, 0.3), 0.08, 1.1) * 0.35 + wave(p, vec2(-0.4, 1.0), 0.13, 1.7) * 0.2 + wave(p, vec2(0.7, -0.7), 0.31, 2.6) * 0.07;
          // Analytic normal from the same waves
          float e = 0.5;
          float hx = wave(p + vec2(e, 0.0), vec2(1.0, 0.3), 0.08, 1.1) * 0.35 + wave(p + vec2(e, 0.0), vec2(-0.4, 1.0), 0.13, 1.7) * 0.2;
          float hz = wave(p + vec2(0.0, e), vec2(1.0, 0.3), 0.08, 1.1) * 0.35 + wave(p + vec2(0.0, e), vec2(-0.4, 1.0), 0.13, 1.7) * 0.2;
          vNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
          w.y += h; vCrest = h;
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir, uSunColor, uSky, uDeep, uShallow, uFogColor;
        uniform float uNight, uFogNear, uFogFar;
        varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNormal);
          if (!gl_FrontFacing) N = -N;
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 base = mix(uDeep, uShallow, clamp(0.45 + vCrest * 0.6, 0.0, 1.0));
          vec3 col = mix(base, uSky, fres * 0.6);
          vec3 H = normalize(uSunDir + V);
          col += uSunColor * pow(max(dot(N, H), 0.0), 140.0) * (1.0 - uNight * 0.7) * 1.4;
          col *= mix(1.0, 0.35, uNight);
          float d = length(cameraPosition - vWorld);
          col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));
          gl_FragColor = vec4(col, mix(0.78, 0.95, fres));
        }`
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.level = 0;
  }

  update(dt, level, camera) {
    this.uniforms.uTime.value += dt;
    this.level = level;
    // Keep the big plane centred under the camera so the sea never ends
    this.mesh.position.set(Math.round(camera.position.x / 50) * 50, level, Math.round(camera.position.z / 50) * 50);
  }
}
