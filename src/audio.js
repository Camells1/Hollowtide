// All sound is synthesized: ocean waves, a warning horn when the flood comes, splashes, chests, pickups.
let ctx = null, master = null, sea = null, seaGain = null, volume = 0.6;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  return ctx;
}
export function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); startSea(); }
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

function noiseBuffer(sec = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown noise
  return b;
}

// Ocean: brown noise through a low-pass filter, swelling slowly like waves
function startSea() {
  if (!ctx || sea) return;
  sea = ctx.createBufferSource(); sea.buffer = noiseBuffer(4); sea.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
  seaGain = ctx.createGain(); seaGain.gain.value = 0.25;
  const lfo = ctx.createOscillator(), lfoGain = ctx.createGain(); lfo.frequency.value = 0.12; lfoGain.gain.value = 0.12;
  lfo.connect(lfoGain); lfoGain.connect(seaGain.gain); lfo.start();
  sea.connect(lp); lp.connect(seaGain); seaGain.connect(master); sea.start();
}
// Quieter when the lagoon is drained, muffled when you're under water
export function seaMix(level01, under) { if (seaGain) seaGain.gain.setTargetAtTime((0.08 + level01 * 0.22) * (under ? 0.5 : 1), ctx.currentTime, 0.5); }

function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function burst(dur, freq, vol = 0.3, type = 'bandpass') {
  if (!ctx) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(1);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
  const g = ctx.createGain(), t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}

export const sfx = {
  splash: () => { burst(0.5, 900, 0.35); burst(0.3, 2400, 0.12, 'highpass'); },
  pickup: () => { tone(880, 0.12, 'triangle', 0.18); setTimeout(() => tone(1320, 0.18, 'triangle', 0.15), 70); },
  chest: () => { tone(140, 0.35, 'sawtooth', 0.12, -60); setTimeout(() => { tone(660, 0.15, 'triangle', 0.18); tone(990, 0.3, 'triangle', 0.14); }, 250); },
  bank: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.14), i * 70)); },
  swing: () => burst(0.18, 1400, 0.15, 'highpass'),
  hit: () => { burst(0.12, 600, 0.3); tone(180, 0.12, 'square', 0.12, -80); },
  hurt: () => tone(220, 0.25, 'sawtooth', 0.18, -120),
  horn: () => { tone(98, 1.8, 'sawtooth', 0.22); tone(147, 1.8, 'sawtooth', 0.12); },
  chime: () => { [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 0.6, 'sine', 0.14), i * 160)); },
  click: () => tone(1200, 0.05, 'square', 0.05)
};
