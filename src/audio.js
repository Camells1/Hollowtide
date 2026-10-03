// Sound. Real recordings (waves, gulls, splashes, footsteps on sand / grass / stone / wood, bells,
// chests, bites) played in 3D around you, muffled when your head is under water, with a little reverb.
// On top: a soft sea-and-wind bed, a deep horn for the flood, and quiet music that follows the tide.
import { A } from './assets.js';

let ctx = null, master, world, ui, music, lowpass, reverb, reverbSend;
let volume = 0.6, musicVolume = 0.5, started = false;
const loops = {};
const GROUPS = {
  wave: ['wave1', 'wave2', 'wave3', 'wave4'], gull: ['gull1', 'gull2', 'gull3'], splash: [1, 2, 3, 4, 5, 6].map(n => 'splash0' + n),
  bubble: ['bubble01', 'bubble02', 'bubble03'], hit: ['hit000', 'hit001', 'hit002'], bite: ['bite000', 'bite001', 'bite002'],
  bell: ['bell000', 'bell001', 'bell002'], creak: ['creak1', 'creak2'], coins: ['coins1', 'coins2'], swing: ['swing1', 'swing2']
};
for (const s of ['grass', 'sand', 'stone', 'wood']) GROUPS['step_' + s] = [0, 1, 2, 3, 4].map(n => `step_${s}00${n}`);

export function audioContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  // World sounds pass through a filter that closes when you dive
  lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 20000; lowpass.connect(master);
  world = ctx.createGain(); world.connect(lowpass);
  ui = ctx.createGain(); ui.gain.value = 0.7; ui.connect(master);
  music = ctx.createGain(); music.gain.value = musicVolume * 0.5; music.connect(master);
  // A small hall made from decaying noise
  reverb = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  reverb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.5; reverb.connect(wet); wet.connect(master);
  reverbSend = ctx.createGain(); reverbSend.gain.value = 0.18; world.connect(reverbSend); reverbSend.connect(reverb);
  music.connect(reverb);
  return ctx;
}
export function unlock() { audioContext(); if (ctx.state === 'suspended') ctx.resume(); if (!started) { started = true; startBeds(); } }
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }
export function setMusicVolume(v) { musicVolume = v; if (music) music.gain.value = v * 0.5; }

const pick = name => { const g = GROUPS[name]; return A.sounds[g ? g[Math.floor(Math.random() * g.length)] : name]; };

// Play a sound. o: { vol, rate, vary (random pitch spread), pos {x,y,z}, ui, pan, delay, range }
export function play(name, o = {}) {
  if (!ctx || ctx.state !== 'running') return;
  const buf = pick(name); if (!buf) return;
  const src = ctx.createBufferSource(); src.buffer = buf;
  src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * (o.vary ?? 0.12));
  const g = ctx.createGain(); g.gain.value = o.vol ?? 1;
  let node = src; node.connect(g); node = g;
  if (o.pos) {
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = o.ref ?? 2.5; p.maxDistance = o.range ?? 90; p.rolloffFactor = 1.1;
    p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z;
    node.connect(p); node = p;
  } else if (o.pan != null && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; node.connect(p); node = p; }
  node.connect(o.ui ? ui : world);
  src.start(ctx.currentTime + (o.delay ?? 0));
}

function loop(name, gain = 0) {
  const buf = A.sounds[name]; if (!buf) return null;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const g = ctx.createGain(); g.gain.value = gain; src.connect(g); g.connect(master); src.start();
  return g;
}
function noise(sec, brown) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return b;
}

function startBeds() {
  loops.under = loop('underwater'); loops.bubbles = loop('bubbles_loop'); loops.swim = loop('swim_loop');
  // Sea wash: brown noise that swells slowly, under the real wave recordings
  const sea = ctx.createBufferSource(); sea.buffer = noise(5, true); sea.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
  loops.sea = ctx.createGain(); loops.sea.gain.value = 0;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 0.05; lfo.connect(lg); lg.connect(loops.sea.gain); lfo.start();
  sea.connect(lp); lp.connect(loops.sea); loops.sea.connect(world); sea.start();
  // Wind: band-passed noise, stronger on the hilltops and across the drained lagoon
  const wind = ctx.createBufferSource(); wind.buffer = noise(4, false); wind.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
  loops.wind = ctx.createGain(); loops.wind.gain.value = 0; loops.windBp = bp;
  const wl = ctx.createOscillator(), wg = ctx.createGain(); wl.frequency.value = 0.07; wg.gain.value = 140; wl.connect(wg); wg.connect(bp.frequency); wl.start();
  wind.connect(bp); bp.connect(loops.wind); loops.wind.connect(world); wind.start();
}

const state = { waveT: 2, gullT: 6, chordT: 0, chord: 0, mood: 'day', bubT: 0 };
const set = (g, v, t = 0.4) => { if (g) g.gain.setTargetAtTime(v, ctx.currentTime, t); };

// Called every frame. s: { pos, yaw, pitch, under, level01, night, shore (0..1 how near the water's edge),
//   height, swimming, speed, phase, dt, island {x,y,z} }
export function updateAudio(s) {
  if (!ctx || ctx.state !== 'running' || !started) return;
  const L = ctx.listener, fx = -Math.sin(s.yaw) * Math.cos(s.pitch), fy = Math.sin(s.pitch), fz = -Math.cos(s.yaw) * Math.cos(s.pitch);
  if (L.positionX) {
    L.positionX.value = s.pos.x; L.positionY.value = s.pos.y; L.positionZ.value = s.pos.z;
    L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else { L.setPosition(s.pos.x, s.pos.y, s.pos.z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  lowpass.frequency.setTargetAtTime(s.under ? 650 : 20000, ctx.currentTime, 0.08);
  set(loops.under, s.under ? 0.5 : 0, 0.2);
  set(loops.bubbles, s.under && s.speed > 1 ? 0.22 : 0, 0.3);
  set(loops.swim, s.swimming && !s.under && s.speed > 1 ? 0.3 : 0, 0.25);
  set(loops.sea, (0.03 + s.level01 * 0.13) * (0.4 + s.shore * 0.6), 0.8);
  set(loops.wind, s.under ? 0 : 0.012 + (1 - s.level01) * 0.03 + Math.max(0, Math.min(1, s.height / 25)) * 0.03, 1);
  // Waves breaking: more often and louder the closer you are to the water's edge
  state.waveT -= s.dt;
  if (state.waveT <= 0) {
    state.waveT = 2.2 + Math.random() * 3.5;
    const v = (0.12 + s.shore * 0.5) * (0.25 + s.level01 * 0.75);
    if (!s.under) play('wave', { vol: v, pan: Math.random() * 1.6 - 0.8, vary: 0.2 });
  }
  // Gulls by day
  state.gullT -= s.dt;
  if (state.gullT <= 0) {
    state.gullT = 5 + Math.random() * 12;
    if (s.night < 0.5 && s.island) play('gull', { vol: 0.5, range: 250, ref: 14, pos: { x: s.island.x + (Math.random() - 0.5) * 80, y: 30, z: s.island.z + (Math.random() - 0.5) * 80 } });
  }
  // Bubbles from your mouth
  if (s.under) { state.bubT -= s.dt; if (state.bubT <= 0) { state.bubT = 1.5 + Math.random() * 2.5; play('bubble', { vol: 0.35 }); } }
  updateMusic(s);
}

// ---------------------------------------------------------------- music
// Slow chords that change with the tide: warm by day, hollow and minor at low tide, tense in the flood
const N = n => 440 * Math.pow(2, (n - 69) / 12);
const MOODS = {
  day: [[50, 57, 62, 66, 69], [43, 55, 59, 62, 66], [45, 57, 61, 64, 69], [47, 54, 62, 66, 71]],
  ebb: [[50, 57, 60, 65, 69], [46, 53, 58, 62, 65], [48, 55, 60, 64, 67], [45, 52, 57, 60, 64]],
  low: [[38, 50, 57, 60, 65], [34, 46, 53, 58, 62], [41, 48, 55, 60, 64], [36, 48, 55, 58, 63]],
  flood: [[38, 45, 50, 51, 57], [38, 44, 50, 53, 56], [37, 44, 49, 52, 56], [38, 45, 51, 54, 57]]
};
function chord(notes, dur, bright) {
  const t = ctx.currentTime;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = bright; f.Q.value = 0.4; f.connect(music);
  notes.forEach((n, i) => {
    for (const det of [-5, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = N(n); o.detune.value = det + Math.random() * 3;
      const peak = (i === 0 ? 0.11 : 0.05) / (1 + i * 0.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.35); g.gain.setValueAtTime(peak, t + dur * 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.25);
      o.connect(g); g.connect(f); o.start(t); o.stop(t + dur * 1.3);
    }
  });
}
function updateMusic(s) {
  state.chordT -= s.dt;
  if (state.chordT > 0 || musicVolume <= 0.01) return;
  const mood = MOODS[s.phase] || MOODS.day, flood = s.phase === 'flood';
  const dur = flood ? 4 : 9;
  state.chordT = dur * 0.85;
  chord(mood[state.chord++ % mood.length], dur, flood ? 1400 : s.phase === 'low' ? 700 : 1000);
}

// ---------------------------------------------------------------- named effects
function horn(freq, when = 0) {
  const t = ctx.currentTime + when, f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(180, t); f.frequency.linearRampToValueAtTime(760, t + 0.7); f.frequency.linearRampToValueAtTime(320, t + 3.2);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.45); g.gain.setValueAtTime(0.28, t + 2.2); g.gain.linearRampToValueAtTime(0.0001, t + 3.4);
  for (const [mul, type] of [[1, 'sawtooth'], [1.006, 'sawtooth'], [0.5, 'sine'], [2.003, 'triangle']]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq * mul * 0.97, t); o.frequency.linearRampToValueAtTime(freq * mul, t + 0.5);
    o.connect(f); o.start(t); o.stop(t + 3.5);
  }
  f.connect(g); g.connect(master); g.connect(reverb);
}

export const sfx = {
  click: () => play('ui_click', { ui: true, vol: 0.5 }),
  confirm: () => play('ui_confirm', { ui: true, vol: 0.6 }),
  error: () => play('ui_error', { ui: true, vol: 0.5 }),
  step: (surface, vol = 0.5, wet = false) => { play('step_' + surface, { vol, vary: 0.2 }); if (wet) play('splash', { vol: vol * 0.25, rate: 1.5 }); },
  land: (surface, hard) => { play('step_' + surface, { vol: 0.9, rate: 0.8 }); play('cloth', { vol: hard ? 0.7 : 0.35 }); },
  jump: () => play('cloth', { vol: 0.3, rate: 1.2 }),
  mantle: () => play('leather', { vol: 0.5 }),
  splash: (pos, big) => play('splash', { vol: big ? 0.9 : 0.5, pos, rate: big ? 0.85 : 1.1 }),
  swing: () => play('swing', { vol: 0.5, vary: 0.25 }),
  hit: pos => { play('hit', { vol: 0.8, pos }); play('chop', { vol: 0.35, pos, rate: 1.3 }); },
  crabDie: pos => play('chop', { vol: 0.7, pos, rate: 0.8 }),
  bite: () => { play('bite', { vol: 0.8 }); play('hit', { vol: 0.4, rate: 0.6 }); },
  dig: pos => play('step_sand', { vol: 0.5, pos, rate: 0.7 }),
  chest: pos => { play('latch', { vol: 0.7, pos }); play('creak', { vol: 0.7, pos, delay: 0.12 }); play('coins', { vol: 0.7, pos, delay: 0.55 }); play('ui_confirm', { ui: true, vol: 0.35, delay: 0.6 }); },
  pry: pos => play('creak', { vol: 0.3, pos, rate: 1.5 }),
  pickup: () => { play('coins', { vol: 0.5, rate: 1.2 }); play('cloth', { vol: 0.4 }); },
  bank: () => { play('coins', { vol: 0.8 }); play('ui_confirm', { ui: true, vol: 0.5, delay: 0.15 }); },
  build: () => { play('hit', { vol: 0.5, rate: 1.6 }); play('hit', { vol: 0.5, rate: 1.7, delay: 0.22 }); play('ui_confirm', { ui: true, vol: 0.6, delay: 0.4 }); },
  hurt: () => play('hit', { vol: 0.5, rate: 0.7 }),
  phase: () => play('ui_bong', { ui: true, vol: 0.6 }),
  drop: () => play('ui_drop', { ui: true, vol: 0.5 }),
  camp: () => { play('bell', { vol: 0.35, rate: 1.5 }); },
  // Three strokes of the tide bell: the water is about to turn
  bells: () => { for (let i = 0; i < 3; i++) play('bell000', { vol: 0.75, delay: i * 0.9, vary: 0.02 }); },
  // The flood horn: two long low blasts
  horn: () => { if (!ctx || ctx.state !== 'running') return; horn(98); horn(73.4, 3.1); },
  gasp: () => play('bubble', { vol: 0.6, rate: 0.7 })
};
