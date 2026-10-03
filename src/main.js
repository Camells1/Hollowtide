// Hollowtide: the game loop, menus, HUD and co-op glue.
import * as THREE from 'three';
import { VERSION, TIDE, CYCLE, ITEMS, UPGRADES, PLAYER } from './config.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { World } from './world.js';
import { Tide } from './tide.js';
import { Player } from './player.js';
import { Character } from './character.js';
import { Loot, rollChest } from './loot.js';
import { Net } from './net.js';
import { Voice } from './voice.js';
import { Input } from './input.js';
import { sfx, unlock, setVolume, seaMix } from './audio.js';
import { clamp, lerp, esc } from './util.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const IS_ELECTRON = navigator.userAgent.includes('Electron');
if (IS_ELECTRON) document.body.classList.add('electron');
$('#version').textContent = 'v' + VERSION;

// ---------------------------------------------------------------- settings and save
const SETTINGS_KEY = 'hollowtide-settings', SAVE_KEY = 'hollowtide-save';
const weakDevice = /CrOS/.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
const settings = { name: 'Diver', volume: 0.6, sens: 1, quality: weakDevice ? 'low' : 'medium', invertY: false, voice: 'ptt' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (_) {}
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {} };
const save = { seed: Math.floor(Math.random() * 1e9), bank: {}, upgrades: {}, tideT: TIDE.day - 30, cycle: 0 };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (_) {}
const writeSave = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {} };
setVolume(settings.volume);

const COLORS = [0x2f9fb0, 0xe0703a, 0x9a6ad8, 0x5ab04a];
const bankTotal = () => Object.values(save.bank).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- renderer and scene
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(settings.quality === 'low' ? 1 : settings.quality === 'high' ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1500);
scene.fog = new THREE.Fog(0x8fc6e8, 90, 520);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a5a40, 1.1);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
sun.castShadow = renderer.shadowMap.enabled;
sun.shadow.mapSize.set(settings.quality === 'high' ? 2048 : 1024, settings.quality === 'high' ? 2048 : 1024);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
scene.add(hemi, sun, sun.target);
const lantern = new THREE.PointLight(0xffd59a, 0, 22, 1.4); scene.add(lantern);

// Sky dome with a day/night gradient, stars and a moon
const skyUniforms = { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uTop, uBottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(-0.05, 0.6, vP.y)), 1.0); }'
}));
const starGeo = new THREE.BufferGeometry(), sp = [];
for (let i = 0; i < 1400; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.08; sp.push(Math.cos(a) * Math.cos(e) * 850, Math.sin(e) * 850, Math.sin(a) * Math.cos(e) * 850); }
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
const stars = new THREE.Points(starGeo, starMat);
const moon = new THREE.Mesh(new THREE.SphereGeometry(28, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe9f6f3, fog: false, transparent: true, opacity: 0 }));
const skyGroup = new THREE.Group(); skyGroup.add(sky, stars, moon); scene.add(skyGroup);

const input = new Input(canvas);
const DAY = { top: new THREE.Color(0x4f9fd8), bottom: new THREE.Color(0xbfe4f2), fog: new THREE.Color(0xa9d4ea), sun: new THREE.Color(0xfff0d6) };
const NIGHT = { top: new THREE.Color(0x07122a), bottom: new THREE.Color(0x1a4058), fog: new THREE.Color(0x14324a), sun: new THREE.Color(0xa8c4ff) };
const UNDER = new THREE.Color(0x0f4a5a);
const tmpC = new THREE.Color(), tmpV = new THREE.Vector3();

// ---------------------------------------------------------------- the game session
let G = null;

function buildSession(o) {
  $('#loading').classList.add('on');
  // Let the loading screen paint before the heavy world build
  return new Promise(resolve => setTimeout(() => {
    const terrain = new Terrain(o.seed);
    scene.add(terrain.mesh);
    const world = new World(scene, terrain, o.seed);
    const water = new Water(); scene.add(water.mesh);
    const tide = new Tide(o.tideT); tide.cycle = o.cycle;
    const loot = new Loot(scene, world, o.seed);
    loot.setCycle(tide.cycle);
    for (const id of o.opened || []) loot.markOpened(id);
    const player = new Player(world, save.upgrades);
    const me = new Character(COLORS[o.colorIndex || 0]); scene.add(me.root);
    G = {
      mode: o.mode, net: o.net || null, voice: null, myId: o.myId || 'h', seed: o.seed,
      terrain, world, water, tide, loot, player, me,
      remotes: new Map(), // id -> { name, color, char, x,y,z,yaw,sp,sw,dead,under, tx,ty,tz }
      camYaw: Math.PI, camPitch: 0.25, seenPhase: tide.phase, warned: false,
      channel: null, sendT: 0, tideSendT: 0, crabSendT: 0, saveT: 0, time: 0, paused: false, wasDead: false
    };
    for (const [id, p] of Object.entries(o.players || {})) if (id !== G.myId) addRemote(id, p);
    if (o.mode !== 'guest' && tide.phase === 'low') loot.spawnCrabs(tide.cycle);
    $('#loading').classList.remove('on');
    $('#hud').classList.remove('hidden');
    $('#room-code').textContent = G.net ? `Room ${G.net.code}` : '';
    $('#room-code').classList.toggle('hidden', !G.net);
    show(null);
    banner(phaseTitle(tide.phase), phaseSub(tide.phase));
    resolve(G);
  }, 30));
}

function addRemote(id, p) {
  if (G.remotes.has(id)) return;
  const char = new Character(p.color ?? COLORS[1]);
  scene.add(char.root);
  G.remotes.set(id, { name: p.name || 'Diver', color: p.color, peerId: p.peerId, char, x: 0, y: -100, z: 0, yaw: 0, sp: 0, sw: 0, dead: false, under: false, tx: 0, ty: -100, tz: 0 });
  G.voice?.addPlayer(id, p.peerId);
}
function removeRemote(id) {
  const r = G?.remotes.get(id);
  if (!r) return;
  scene.remove(r.char.root); G.remotes.delete(id);
  G.voice?.removePlayer(id);
  toast(`${r.name} left`);
}

// ---------------------------------------------------------------- co-op
async function hostGame() {
  const net = new Net();
  try { await net.host(); } catch (e) { toast(e.message || String(e)); return; }
  const roster = {}; // id -> { name, color, peerId }
  let colorIdx = 1;
  net.onJoin = (id, hello) => {
    if (!G) { setTimeout(() => net.onJoin(id, hello), 250); return; }
    const p = { name: String(hello.name || 'Diver').slice(0, 14), color: COLORS[colorIdx++ % COLORS.length], peerId: hello.peerId };
    roster[id] = p;
    const players = { h: { name: settings.name, color: COLORS[0], peerId: net.peer.id }, ...roster };
    net.sendTo(id, { type: 'welcome', you: id, seed: G.seed, t: G.tide.t, cycle: G.tide.cycle, opened: [...G.loot.chests.values()].filter(c => c.opened).map(c => c.id), players, color: p.color });
    for (const other of net.guests) if (other !== id) net.sendTo(other, { type: 'joined', id, ...p });
    addRemote(id, p);
    toast(`${p.name} joined`, true);
  };
  net.onLeave = id => { delete roster[id]; net.send({ type: 'left', id }); removeRemote(id); };
  bindNet(net);
  await buildSession({ mode: 'host', net, myId: 'h', seed: save.seed, tideT: save.tideT, cycle: save.cycle, colorIndex: 0 });
  startVoice();
  toast(`Room ${net.code}: friends type this code next to Join Co-op`, true, 6000);
}

async function joinGame(code) {
  if (code.length < 5) { toast('Type the 5-letter room code first.'); return; }
  const net = new Net();
  toast('Connecting…', true, 2000);
  let w;
  try { w = await net.join(code, { name: settings.name }); } catch (e) { toast(e.message || String(e)); return; }
  bindNet(net);
  net.onClose = () => { toast('Lost connection to the host'); setTimeout(leaveToTitle, 1500); };
  const colorIndex = Math.max(0, COLORS.indexOf(w.color));
  await buildSession({ mode: 'guest', net, myId: w.you, seed: w.seed, tideT: w.t, cycle: w.cycle, opened: w.opened, players: w.players, colorIndex });
  startVoice();
}

function bindNet(net) {
  net.on('p', (m, from) => {
    const r = G?.remotes.get(from);
    if (!r) return;
    Object.assign(r, { tx: m.x, ty: m.y, tz: m.z, yaw: m.yaw, sp: m.sp, sw: m.sw, dead: m.dead, under: m.under });
    if (r.y < -50) { r.x = m.x; r.y = m.y; r.z = m.z; }
  });
  net.on('joined', m => addRemote(m.id, m));
  // A player's voice chat id (sent once their mic is set up)
  net.on('voice', (m, from) => {
    const r = G?.remotes.get(from); if (!r) return;
    r.peerId = m.peerId; r.voiceReady = true;
    if (!G.voice) return;
    G.voice.addPlayer(from, m.peerId, true);
    if (!m.reply) G.net.sendTo(from, { type: 'voice', peerId: G.net.peer.id, reply: true });
  });
  net.on('left', m => removeRemote(m.id));
  net.on('tide', m => {
    if (!G) return;
    if (m.cycle !== G.tide.cycle || Math.abs(m.t - G.tide.t) > 0.6) { G.tide.t = m.t; G.tide.cycle = m.cycle; }
  });
  net.on('crabs', m => G?.loot.applyCrabs(m.list));
  net.on('opened', m => onOpened(m.id, m.by));
  net.on('crabDead', m => { G?.loot.removeCrab(m.id); if (m.by === G?.myId) rewardCrab(); });
  net.on('bite', m => { if (G) { G.player.hurt(m.dmg); sfx.hurt(); } });
  // Host decides chests and crab hits for everyone
  net.on('open', (m, from) => {
    if (!G || G.mode !== 'host') return;
    const c = G.loot.chests.get(m.id);
    if (!c || c.opened || G.tide.phase !== 'low') return;
    net.send({ type: 'opened', id: m.id, by: from });
    onOpened(m.id, from);
  });
  net.on('hit', (m, from) => {
    if (!G || G.mode !== 'host') return;
    if (G.loot.hitCrab(m.crab, clamp(+m.dmg || 0, 0, 60))) { net.send({ type: 'crabDead', id: m.crab, by: from }); }
  });
}

async function startVoice() {
  if (!G?.net || settings.voice === 'off') return;
  const v = new Voice();
  G.voice = v;
  const ok = await v.start(G.net.peer, G.myId, settings.voice);
  // Tell everyone our PeerJS id so they can call us
  G.net.send({ type: 'voice', peerId: G.net.peer.id });
  for (const [id, r] of G.remotes) if (r.peerId) v.addPlayer(id, r.peerId, !!r.voiceReady);
  toast(ok ? (settings.voice === 'open' ? 'Voice chat on (open mic)' : 'Voice chat on: hold V to talk') : 'No microphone found: you can still hear your friends', true, 4000);
}

// ---------------------------------------------------------------- loot
function onOpened(id, by) {
  if (!G) return;
  const c = G.loot.markOpened(id);
  if (!c) return;
  if (by !== G.myId) return;
  sfx.chest();
  const items = rollChest(G.seed, id), lines = [], left = {};
  for (const [k, n] of Object.entries(items)) {
    const got = G.player.addItem(k, n);
    if (got) lines.push(`+${got} ${ITEMS[k].name}`);
    if (got < n) left[k] = n - got;
  }
  if (Object.keys(left).length) { G.loot.dropBag(c, left); toast('Pack full! The rest is in a sack next to the chest.'); }
  toast(lines.join('   '), true);
}
function rewardCrab() {
  const got = G.player.addItem('shell', 2) + (Math.random() < 0.3 ? G.player.addItem('pearl', 1) : 0);
  sfx.pickup();
  toast(got ? 'Crab defeated! +loot' : 'Crab defeated (pack full)', true);
}

function bankPack() {
  const p = G.player, n = p.packCount;
  if (!n) { toast('Your pack is empty.'); return; }
  for (const [k, v] of Object.entries(p.pack)) save.bank[k] = (save.bank[k] || 0) + v;
  p.pack = {};
  writeSave(); sfx.bank();
  toast(`Stashed ${n} item${n > 1 ? 's' : ''}. They're safe now.`, true);
}

// ---------------------------------------------------------------- workbench
function openBench() {
  input.unlock();
  renderBench();
  show('bench');
}
function renderBench() {
  $('#bench-bank').innerHTML = Object.entries(ITEMS).map(([k, it]) => `<span class="chip"><i style="background:${it.color}"></i>${it.name} <b>${save.bank[k] || 0}</b></span>`).join(' ');
  $('#bench-list').innerHTML = UPGRADES.map(u => {
    const lvl = save.upgrades[u.id] || 0, maxed = lvl >= u.max;
    const can = !maxed && Object.entries(u.cost).every(([k, n]) => (save.bank[k] || 0) >= n);
    const cost = Object.entries(u.cost).map(([k, n]) => `<span class="${(save.bank[k] || 0) >= n ? '' : 'short'}">${n} ${ITEMS[k].name}</span>`).join(', ');
    return `<div class="up"><div><b>${u.name}</b> <small>${maxed ? 'MAX' : `Level ${lvl}/${u.max}`}</small><p>${u.desc}</p><p class="cost">${maxed ? '' : cost}</p></div><button class="btn ${can ? 'gold' : ''}" data-up="${u.id}" ${can ? '' : 'disabled'}>${maxed ? 'Done' : 'Build'}</button></div>`;
  }).join('');
}
$('#bench-list').addEventListener('click', e => {
  const b = e.target.closest('[data-up]'); if (!b || b.disabled) return;
  const u = UPGRADES.find(x => x.id === b.dataset.up);
  for (const [k, n] of Object.entries(u.cost)) save.bank[k] -= n;
  save.upgrades[u.id] = (save.upgrades[u.id] || 0) + 1;
  if (G) G.player.up = save.upgrades;
  writeSave(); sfx.bank(); renderBench();
  toast(`${u.name} built!`, true);
});

// ---------------------------------------------------------------- HUD helpers
let toastT = 0;
function toast(msg, ok = false, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.className = 'on' + (ok ? ' ok' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, ms);
}
let bannerT = 0;
function banner(title, sub, color = '#e9f6f3') {
  const b = $('#banner'); b.querySelector('b').textContent = title; b.querySelector('b').style.color = color; b.querySelector('span').textContent = sub || '';
  b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 3500);
}
const phaseTitle = p => ({ day: 'HIGH TIDE', ebb: 'THE TIDE IS GOING OUT', low: 'THE HOLLOW IS OPEN', flood: 'FLOOD!' }[p]);
const phaseSub = p => ({ day: 'Bank your loot at the Stash. Build upgrades at the Workbench.', ebb: 'The ruins are rising out of the water…', low: 'Two minutes. Open the glowing chests.', flood: 'The sea is coming back. Swim for the island!' }[p]);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function project(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  if (tmpV.z > 1) return null;
  return { x: (tmpV.x * 0.5 + 0.5) * innerWidth, y: (-tmpV.y * 0.5 + 0.5) * innerHeight };
}

const hudCache = new Map();
function setHTML(sel, html) { if (hudCache.get(sel) === html) return; hudCache.set(sel, html); $(sel).innerHTML = html; }
function setText(sel, text) { if (hudCache.get(sel) === text) return; hudCache.set(sel, text); $(sel).textContent = text; }

function updateHud() {
  const p = G.player, t = G.tide, ph = t.phase;
  const total = { day: TIDE.day, ebb: TIDE.ebb, low: TIDE.low, flood: TIDE.flood }[ph];
  const ring = $('#tide-ring'), C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - t.left / total);
  ring.style.stroke = { day: '#8fd3ff', ebb: '#5fd4c6', low: '#ffd166', flood: '#ff6b6b' }[ph];
  setText('#tide-phase', { day: 'HIGH TIDE', ebb: 'EBBING', low: 'LOW TIDE', flood: 'FLOOD' }[ph]);
  setText('#tide-left', mmss(t.left));
  $('#bar-hp').style.width = (p.hp / PLAYER.health * 100) + '%';
  $('#bar-air').style.width = (p.oxygen / p.maxOxygen * 100) + '%';
  $('#bar-st').style.width = (p.stamina / PLAYER.stamina * 100) + '%';
  $('.bar.air').classList.toggle('low', p.oxygen < p.maxOxygen * 0.3);
  setText('#pack-count', `${p.packCount}/${p.packSize}`);
  setHTML('#pack-items', Object.entries(p.pack).filter(([, n]) => n).map(([k, n]) => `<div class="it"><i style="background:${ITEMS[k].color}"></i>${ITEMS[k].name}<b>${n}</b></div>`).join('') || '<div class="it empty">Empty</div>');
  setText('#bank-total', String(bankTotal()));
  // Markers: the camp, ruin sites (while the tide is out), your dropped packs, friends' names
  const marks = [];
  const add = (x, y, z, label, cls) => { const s = project(x, y, z); if (s && s.x > -50 && s.x < innerWidth + 50) marks.push(`<div class="mk ${cls}" style="left:${s.x}px;top:${s.y}px">${label}</div>`); };
  const dist = (x, z) => Math.round(Math.hypot(x - p.pos.x, z - p.pos.z));
  if (dist(G.world.camp.x, G.world.camp.z) > 12) add(G.world.camp.x, G.world.camp.y + 4, G.world.camp.z, `⌂ Camp ${dist(G.world.camp.x, G.world.camp.z)}m`, 'camp');
  if (ph === 'ebb' || ph === 'low') for (const s of G.world.sites) { const d = dist(s.x, s.z); if (d > 20) add(s.x, G.world.ground(s.x, s.z) + 8, s.z, `${s.name} ${d}m`, 'site'); }
  for (const b of G.loot.bags) add(b.x, b.y + 2, b.z, `Your pack ${dist(b.x, b.z)}m`, 'bag');
  for (const [id, r] of G.remotes) if (!r.dead) add(r.x, r.y + 2.3, r.z, `${G.voice?.speaking(id) ? '🔊 ' : ''}${esc(r.name)}`, 'friend');
  setHTML('#markers', marks.join(''));
  // Co-op player list
  setHTML('#players', G.net ? [`<div class="pl me">${G.voice?.localLevel > 0.03 ? '🎙️ ' : ''}${esc(settings.name)} (you)</div>`, ...[...G.remotes].map(([id, r]) => `<div class="pl">${G.voice?.speaking(id) ? '🔊 ' : ''}${esc(r.name)}${r.dead ? ' ✝' : ''}</div>`)].join('') : '');
  // Underwater tint and the "low air" vignette
  const camUnder = camera.position.y < G.water.level;
  $('#underwater').classList.toggle('on', camUnder);
  $('#vignette').style.opacity = clamp((1 - p.hp / PLAYER.health) * 0.8 + (p.hurtT > 0 ? 0.4 : 0) + (p.oxygen < 6 ? 0.4 : 0), 0, 1);
}

// ---------------------------------------------------------------- per frame
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G) tick(dt);
  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(frame);

function tick(dt) {
  const { player: p, tide, loot, world, water } = G;
  const paused = G.paused && G.mode === 'solo';
  if (!paused) { tide.update(dt); G.time += dt; }
  const ph = tide.phase;

  // New tide: a fresh set of chests
  if (loot.cycle !== tide.cycle) loot.setCycle(tide.cycle);
  if (ph !== G.seenPhase) {
    G.seenPhase = ph;
    banner(phaseTitle(ph), phaseSub(ph), ph === 'flood' ? '#ff8a8a' : ph === 'low' ? '#ffd166' : '#e9f6f3');
    if (ph === 'low') { sfx.chime(); if (G.mode !== 'guest') loot.spawnCrabs(tide.cycle); }
    if (ph === 'flood') sfx.horn();
    if (ph === 'day') { if (G.mode !== 'guest') loot.clearCrabs(); G.warned = false; sfx.chime(); }
    if (ph === 'ebb') G.warned = false;
  }
  // Warning before the flood (earlier with the Tide Charm)
  const warnAt = 20 + (save.upgrades.charm ? 15 : 0);
  if (ph === 'low' && !G.warned && tide.untilFlood <= warnAt) { G.warned = true; sfx.horn(); banner('THE TIDE IS TURNING', `${Math.ceil(tide.untilFlood)} seconds. Get back to the island!`, '#ffb36b'); }

  // Look around
  const menuOpen = !!currentScreen;
  if (input.locked && !menuOpen) {
    const k = 0.0024 * settings.sens;
    G.camYaw -= input.dx * k;
    G.camPitch = clamp(G.camPitch + input.dy * k * (settings.invertY ? -1 : 1), -0.9, 1.2);
  }
  const play = input.locked && !menuOpen && !paused;
  const kd = c => play && !!input.keys[c];
  const mx = (kd('KeyD') ? 1 : 0) - (kd('KeyA') ? 1 : 0), mz = (kd('KeyW') ? 1 : 0) - (kd('KeyS') ? 1 : 0);
  const ev = paused ? {} : p.update(dt, { mx, mz, camYaw: G.camYaw, sprint: kd('ShiftLeft') || kd('ShiftRight'), jump: kd('Space'), dive: kd('KeyC') || kd('ControlLeft'), attack: play && input.mouse.left }, { level: tide.level, flood: ph === 'flood', highTide: ph === 'day' });
  if (ev.splashed) sfx.splash();
  if (ev.respawned) { toast('You wake up by the campfire.', true); }

  // Death: drop the pack where you fell
  if (p.dead && !G.wasDead) {
    loot.dropBag(p.pos, p.pack); const lost = p.packCount; p.pack = {};
    banner('YOU DROWNED', lost ? 'Your pack sank where you fell. Find it next low tide.' : 'Back to camp…', '#ff8a8a');
  }
  G.wasDead = p.dead;

  // Swing at crabs
  if (ev.swung) {
    G.me.swing(); sfx.swing();
    const crab = loot.crabInFront(p.pos, p.yaw, PLAYER.attackRange);
    if (crab) {
      sfx.hit();
      if (G.mode === 'guest') G.net.sendTo('h', { type: 'hit', crab: crab.id, dmg: p.damage });
      else if (loot.hitCrab(crab.id, p.damage)) { G.net?.send({ type: 'crabDead', id: crab.id, by: G.myId }); rewardCrab(); }
    }
  }

  // Interactions (E)
  interact(dt, play);

  // Host: crabs hunt everyone
  if (G.mode !== 'guest' && !paused && loot.crabs.size) {
    const players = [{ id: G.myId, pos: p.pos, dead: p.dead }, ...[...G.remotes].map(([id, r]) => ({ id, pos: { x: r.x, y: r.y, z: r.z }, dead: r.dead }))];
    loot.simulateCrabs(dt, players, (id, dmg) => {
      if (id === G.myId) { p.hurt(dmg); sfx.hurt(); }
      else G.net?.sendTo(id, { type: 'bite', dmg });
    });
  }

  // Network: my diver 15x a second; the host also shares the tide and the crabs
  if (G.net) {
    G.sendT -= dt;
    if (G.sendT <= 0) {
      G.sendT = 1 / 15;
      G.net.send({ type: 'p', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(2), sp: +p.speed.toFixed(1), sw: +p.swim.toFixed(2), dead: p.dead, under: p.headUnder });
    }
    if (G.mode === 'host') {
      G.tideSendT -= dt; if (G.tideSendT <= 0) { G.tideSendT = 2; G.net.send({ type: 'tide', t: tide.t, cycle: tide.cycle }); }
      G.crabSendT -= dt; if (G.crabSendT <= 0) { G.crabSendT = 0.1; if (loot.crabs.size || G.hadCrabs) G.net.send({ type: 'crabs', list: loot.crabList() }); G.hadCrabs = loot.crabs.size > 0; }
    }
  }

  // Friends: smooth toward their latest position
  for (const r of G.remotes.values()) {
    const k = Math.min(1, dt * 12);
    r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
    r.char.root.position.set(r.x, r.y, r.z);
    r.char.update(dt, { speed: r.sp, swim: r.sw, dead: r.dead, yaw: r.yaw });
  }

  // My diver
  G.me.root.position.copy(p.pos);
  G.me.update(dt, { speed: p.speed, swim: p.swim, dead: p.dead, yaw: p.yaw });

  // Third-person camera with a little terrain avoidance
  const head = tmpV.set(p.pos.x, p.pos.y + (p.swim > 0.5 ? 1.1 : 1.7), p.pos.z);
  const dist = 6.2, cp = Math.cos(G.camPitch);
  let cx = head.x + Math.sin(G.camYaw) * cp * dist, cz = head.z + Math.cos(G.camYaw) * cp * dist, cy = head.y + Math.sin(G.camPitch) * dist;
  for (let i = 1; i <= 8; i++) {
    const f = i / 8, x = lerp(head.x, cx, f), y = lerp(head.y, cy, f), z = lerp(head.z, cz, f);
    if (world.ground(x, z) + 0.4 > y) { cx = lerp(head.x, cx, (i - 1) / 8); cy = lerp(head.y, cy, (i - 1) / 8); cz = lerp(head.z, cz, (i - 1) / 8); break; }
  }
  camera.position.set(cx, Math.max(cy, world.ground(cx, cz) + 0.4), cz);
  camera.lookAt(head.x, head.y, head.z);

  // Sky, light, fog: night falls while the tide is out
  const night = tide.night;
  skyUniforms.uTop.value.copy(DAY.top).lerp(NIGHT.top, night);
  skyUniforms.uBottom.value.copy(DAY.bottom).lerp(NIGHT.bottom, night);
  starMat.opacity = night; moon.material.opacity = night;
  skyGroup.position.copy(camera.position);
  moon.position.set(-300, 360 + night * 60, -500);
  const sunA = (tide.t / CYCLE) * Math.PI * 2;
  sun.position.set(p.pos.x + Math.cos(sunA) * 80, p.pos.y + 90, p.pos.z + Math.sin(sunA) * 60);
  sun.target.position.copy(p.pos);
  sun.color.copy(DAY.sun).lerp(NIGHT.sun, night);
  sun.intensity = lerp(2.6, 1.0, night);
  hemi.intensity = lerp(1.1, 0.75, night);
  hemi.color.set(night > 0.5 ? 0x9fbcff : 0xcfe8ff);
  renderer.toneMappingExposure = lerp(1, 1.45, night);
  const camUnder = camera.position.y < tide.level;
  if (camUnder) { scene.fog.color.copy(UNDER).lerp(NIGHT.fog, night * 0.6); scene.fog.near = 1; scene.fog.far = 45; }
  else { scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, night); scene.fog.near = 90; scene.fog.far = lerp(520, 260, night); }
  water.uniforms.uNight.value = night;
  water.uniforms.uSunDir.value.copy(sun.position).sub(p.pos).normalize();
  water.uniforms.uSky.value.copy(skyUniforms.uBottom.value);
  water.uniforms.uFogColor.value.copy(scene.fog.color); water.uniforms.uFogNear.value = scene.fog.near; water.uniforms.uFogFar.value = scene.fog.far;
  water.update(dt, tide.level, camera);
  // The Tide Lantern lights your way at night
  lantern.position.set(p.pos.x, p.pos.y + 2.2, p.pos.z);
  lantern.intensity = save.upgrades.lantern && !p.dead ? 40 * night : 0;
  world.update(dt, night, G.time);
  loot.update(dt, G.time, ph === 'low');
  seaMix(clamp((tide.level - TIDE.lowLevel) / (TIDE.high - TIDE.lowLevel), 0, 1), camUnder);

  // Voice: positions for proximity chat, push-to-talk on V
  if (G.voice) {
    G.voice.setTalking(play && !!input.keys.KeyV);
    const players = new Map([...G.remotes].map(([id, r]) => [id, { x: r.x, y: r.y + 1.6, z: r.z, under: r.under }]));
    G.voice.update({ x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: G.camYaw, under: p.headUnder }, players, settings.volume);
  }

  // Autosave (single player keeps the tide; everyone keeps their stash and upgrades)
  G.saveT -= dt;
  if (G.saveT <= 0) { G.saveT = 10; if (G.mode !== 'guest') { save.tideT = tide.t; save.cycle = tide.cycle; } writeSave(); }

  updateHud();
}

function interact(dt, play) {
  const { player: p, loot, world, tide } = G;
  let prompt = '';
  const near = (o, r) => Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < r;
  const ePressed = play && input.hit('KeyE');
  const eHeld = play && !!input.keys.KeyE;
  if (!p.dead) {
    const bagNear = loot.bags.some(b => Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < 1.6 && Math.abs(b.y - p.pos.y) < 2);
    if (bagNear) {
      prompt = '<kbd>E</kbd> Pick up your pack';
      if (ePressed) { const items = loot.takeBag(p.pos), left = {}; if (items) { for (const [k, n] of Object.entries(items)) { const got = p.addItem(k, n); if (got < n) left[k] = n - got; } if (Object.keys(left).length) loot.dropBag(p.pos, left); sfx.pickup(); toast('Got your pack back!', true); } }
    } else if (near(world.stash, 2.6)) {
      prompt = `<kbd>E</kbd> Stash your loot (${p.packCount})`;
      if (ePressed) bankPack();
    } else if (near(world.bench, 2.8)) {
      prompt = '<kbd>E</kbd> Workbench: build upgrades';
      if (ePressed) openBench();
    } else {
      const c = loot.nearestChest(p.pos, 2.2);
      if (c) {
        if (tide.phase !== 'low') prompt = 'The chest is sealed with barnacles. It opens at low tide.';
        else if (p.packCount >= p.packSize) prompt = 'Your pack is full. Stash your loot first.';
        else {
          prompt = '<kbd>E</kbd> Hold to pry open';
          if (eHeld) {
            if (!G.channel || G.channel.id !== c.id) G.channel = { id: c.id, t: 0 };
            G.channel.t += dt;
            if (G.channel.t >= 1.2) {
              G.channel = null;
              if (G.mode === 'guest') G.net.sendTo('h', { type: 'open', id: c.id });
              else { G.net?.send({ type: 'opened', id: c.id, by: G.myId }); onOpened(c.id, G.myId); }
            }
          } else G.channel = null;
        }
      } else G.channel = null;
    }
  }
  setHTML('#prompt', prompt);
  $('#prompt').classList.toggle('on', !!prompt);
  $('#channel').classList.toggle('on', !!G.channel);
  if (G.channel) $('#channel i').style.width = (G.channel.t / 1.2 * 100) + '%';
}

// ---------------------------------------------------------------- menus
let currentScreen = 'title';
function show(id) {
  $$('.screen').forEach(s => s.classList.remove('on'));
  if (id) $('#s-' + id).classList.add('on');
  currentScreen = id;
  $('#clickplay').style.display = G && !id && !input.locked ? 'flex' : 'none';
}
input.onLockChange = locked => {
  if (!G) return;
  if (!locked && !currentScreen) { G.paused = true; $('#pause-note').textContent = G.net ? `Room ${G.net.code} · the game keeps running for your friends` : ''; show('pause'); }
  if (locked) { G.paused = false; if (currentScreen === 'pause') show(null); }
  $('#clickplay').style.display = !locked && !currentScreen ? 'flex' : 'none';
};
$('#clickplay').addEventListener('click', () => { unlock(); input.lock(); });
canvas.addEventListener('click', () => { if (G && !currentScreen) { unlock(); input.lock(); } });

let settingsReturn = 'title';
const actions = {
  async solo() { unlock(); saveName(); input.lock(); await buildSession({ mode: 'solo', seed: save.seed, tideT: save.tideT, cycle: save.cycle, colorIndex: 0 }); input.lock(); },
  async host() { unlock(); saveName(); await hostGame(); input.lock(); },
  async join() { unlock(); saveName(); await joinGame($('#join-code').value.trim().toUpperCase()); input.lock(); },
  settings() { settingsReturn = currentScreen || 'title'; openSettings(); },
  'settings-back'() { show(settingsReturn); },
  howto() { show('howto'); },
  back() { show('title'); },
  resume() { show(null); input.lock(); },
  leave() { leaveToTitle(); },
  quit() { window.electronAPI?.quit?.() ?? window.close(); },
  start() { show(null); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && actions[b.dataset.act]) { sfx.click(); actions[b.dataset.act](); } });
addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (currentScreen === 'bench' || currentScreen === 'settings' || currentScreen === 'howto') { e.preventDefault(); currentScreen === 'settings' ? actions['settings-back']() : currentScreen === 'howto' ? actions.back() : actions.resume(); }
  else if (currentScreen === 'pause') actions.resume();
});

function saveName() {
  settings.name = String($('#name').value || 'Diver').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Diver';
  saveSettings();
}
$('#name').value = settings.name;
$('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') actions.join(); });

function openSettings() {
  $('#set-vol').value = settings.volume; $('#set-sens').value = settings.sens; $('#set-quality').value = settings.quality; $('#set-invert').checked = settings.invertY;
  $('#set-voice').value = settings.voice;
  show('settings');
}
$('#set-vol').addEventListener('input', e => { settings.volume = +e.target.value; setVolume(settings.volume); saveSettings(); });
$('#set-sens').addEventListener('input', e => { settings.sens = +e.target.value; saveSettings(); });
$('#set-quality').addEventListener('change', e => { settings.quality = e.target.value; saveSettings(); toast('Graphics change applies next time the game starts.', true); });
$('#set-invert').addEventListener('change', e => { settings.invertY = e.target.checked; saveSettings(); });
$('#set-voice').addEventListener('change', e => { settings.voice = e.target.value; saveSettings(); if (G?.voice && settings.voice !== 'off') G.voice.setMode(settings.voice); else if (G?.voice) { G.voice.stop(); G.voice = null; } else if (G?.net && settings.voice !== 'off') startVoice(); });

function leaveToTitle() {
  if (G) { if (G.mode !== 'guest') { save.tideT = G.tide.t; save.cycle = G.tide.cycle; } writeSave(); G.voice?.stop(); G.net?.destroy(); }
  // Simplest clean slate: reload the page
  location.reload();
}
addEventListener('beforeunload', () => { if (G) { if (G.mode !== 'guest') { save.tideT = G.tide.t; save.cycle = G.tide.cycle; } writeSave(); } });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// Title screen backdrop: a slow flyover of the empty lagoon
show('title');
window.__ht = { get G() { return G; }, settings, save, actions, input };
