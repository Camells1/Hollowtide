// Hollowtide: the game loop, first-person camera, menus, HUD and co-op glue.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VERSION, TIDE, ITEMS, UPGRADES, PLAYER } from './config.js';
import { loadAll, A } from './assets.js';
import { Terrain, planSites } from './terrain.js';
import { Water } from './water.js';
import { Sky } from './sky.js';
import { World } from './world.js';
import { Tide } from './tide.js';
import { Player } from './player.js';
import { Character, OUTFITS } from './character.js';
import { ViewModel } from './viewmodel.js';
import { Loot, rollChest } from './loot.js';
import { Fx } from './fx.js';
import { Net } from './net.js';
import { Voice } from './voice.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { sfx, unlock, setVolume, setMusicVolume, audioContext, updateAudio } from './audio.js';
import { clamp, lerp, esc } from './util.js';
import { clean, ok } from './filter.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const IS_ELECTRON = navigator.userAgent.includes('Electron');
if (IS_ELECTRON) document.body.classList.add('electron');
$('#version').textContent = 'v' + VERSION;

// ---------------------------------------------------------------- settings and save
const SETTINGS_KEY = 'hollowtide-settings', SAVE_KEY = 'hollowtide-save';
const weakDevice = /CrOS/.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
const settings = { name: 'Diver', outfit: 0, volume: 0.6, music: 0.5, sens: 1, fov: 78, quality: weakDevice ? 'low' : 'medium', invertY: false, bob: true, voice: 'ptt' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (_) {}
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {} };
const save = { seed: Math.floor(Math.random() * 1e9), bank: {}, upgrades: {}, tideT: TIDE.day - 40, cycle: 0, camp: '' };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (_) {}
const writeSave = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {} };
setVolume(settings.volume); setMusicVolume(settings.music);
const Q = settings.quality;
const bankTotal = () => Object.values(save.bank).reduce((a, b) => a + b, 0);
const hud = new Hud();
const toast = (m, ok, ms) => hud.toast(m, ok, ms);

// ---------------------------------------------------------------- renderer and scene
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q === 'low', powerPreference: 'high-performance' });
const pixelRatio = Q === 'low' ? Math.min(devicePixelRatio, 1) : Q === 'high' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 1);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = Q !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 2200);
camera.rotation.order = 'YXZ';
scene.fog = new THREE.Fog(0xb9dcef, 140, 1000);
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a5a40, 0.45);
const sun = new THREE.DirectionalLight(0xfff0d6, 3);
sun.castShadow = renderer.shadowMap.enabled;
const SM = Q === 'high' ? 4096 : 2048;
sun.shadow.mapSize.set(SM, SM);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 420 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(hemi, sun, sun.target);
const lantern = new THREE.PointLight(0xffd09a, 0, 30, 1.5); scene.add(lantern);
const sky = new Sky(); scene.add(sky.mesh);
const input = new Input(canvas);

let composer = null, vmPass = null, bloom = null;
let W = null;   // the world: { seed, terrain, world, water, fx }
let vm = null;  // first-person hands
let G = null;   // the game session
const tmpV = new THREE.Vector3();

function setupComposer() {
  if (Q === 'low') return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  vmPass = new RenderPass(vm.scene, vm.camera); vmPass.clear = false; vmPass.clearDepth = true; vmPass.enabled = false;
  composer.addPass(vmPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.7, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

function buildWorld(seed) {
  if (W) { scene.remove(W.terrain.mesh, W.water.mesh, W.water.ocean); W.world.dispose(); W.fx.dispose(); W.terrain.dispose(); W.water.dispose(); }
  const terrain = new Terrain(seed, planSites(seed), Q);
  scene.add(terrain.mesh);
  const world = new World(scene, terrain, seed, Q);
  const water = new Water(terrain.heightTex); scene.add(water.mesh, water.ocean);
  const fx = new Fx(scene, world, Q);
  hud.buildMap(terrain);
  W = { seed, terrain, world, water, fx };
}

// Sky, light, fog and water for this moment of the tide (used by the title screen and the game)
const UNDER_DAY = new THREE.Color(0x0e5566), UNDER_NIGHT = new THREE.Color(0x041a26);
function atmosphere(dt, time, tide, focus, under) {
  const night = tide.night, level = tide.level, level01 = clamp((level - TIDE.lowLevel) / (TIDE.high - TIDE.lowLevel), 0, 1);
  const st = sky.update(time, night, tide.phase, camera);
  if (under) { scene.fog.color.copy(UNDER_DAY).lerp(UNDER_NIGHT, night); scene.fog.near = 0.5; scene.fog.far = lerp(36, 22, night); }
  else { scene.fog.color.copy(st.fog); scene.fog.near = lerp(140, 25, night); scene.fog.far = lerp(1000, 460, night); }
  const fx = Math.round(focus.x / 2) * 2, fz = Math.round(focus.z / 2) * 2;
  sun.position.set(fx + st.keyDir.x * 200, focus.y + st.keyDir.y * 200, fz + st.keyDir.z * 200);
  sun.target.position.set(fx, focus.y, fz);
  sun.color.copy(st.keyColor); sun.intensity = st.keyIntensity * (under ? 0.6 : 1);
  hemi.intensity = lerp(0.45, 0.34, night); hemi.color.setRGB(lerp(0.8, 0.45, night), lerp(0.9, 0.6, night), 1);
  scene.environmentIntensity = lerp(0.85, 0.16, night) * (under ? 0.6 : 1);
  renderer.toneMappingExposure = lerp(1.0, 1.35, night);
  W.water.update(time, level, level01, st);
  W.terrain.update(time, level, (1 - night * 0.85) * (under ? 1.4 : 1));
  W.world.update(dt, time, night, level, camera, scene.fog.far);
  return { st, night, level, level01 };
}

// ---------------------------------------------------------------- the game session
function buildSession(o) {
  $('#loading').classList.add('on'); $('#load-text').textContent = 'Draining the lagoon…';
  // Let the loading screen paint before any heavy world build
  return new Promise(resolve => setTimeout(() => {
    if (!W || W.seed !== o.seed) buildWorld(o.seed);
    const { world } = W;
    const tide = new Tide(o.tideT); tide.cycle = o.cycle;
    const loot = new Loot(scene, world, o.seed);
    loot.onFx = lootFx;
    loot.setCycle(tide.cycle);
    for (const id of o.opened || []) { const c = loot.chests.get(id); if (c) c.opened = true; }
    loot._beams();
    const player = new Player(world, save.upgrades);
    const camp = world.camps.find(c => c.name === save.camp);
    if (camp && o.mode !== 'guest') { player.respawn = camp; player.reset(); }
    const body = new Character(settings.outfit, { shadowOnly: true }); scene.add(body.root);
    vm.setSleeve(OUTFITS[settings.outfit % OUTFITS.length].tint?.Green ?? 0x5a4a3a); vm.setBlade(save.upgrades.blade || 0); vm.draw();
    if (vmPass) vmPass.enabled = true;
    G = {
      mode: o.mode, net: o.net || null, voice: null, myId: o.myId || 'h', seed: o.seed,
      tide, loot, player, body, remotes: new Map(),
      yaw: Math.atan2(player.pos.x - player.respawn.x, player.pos.z - player.respawn.z), pitch: 0, seenPhase: tide.phase, warned: false,
      channel: null, sendT: 0, tideSendT: 0, crabSendT: 0, crabFullT: 0, saveT: 0, time: 0, paused: false, wasDead: false,
      cam: { land: 0, landV: 0, roll: 0, shake: 0, fov: settings.fov, bob: 0 }, swingHit: -1, mapOpen: false, place: '', pryT: 0, lookDX: 0, lookDY: 0
    };
    for (const [id, p] of Object.entries(o.players || {})) if (id !== G.myId) addRemote(id, p);
    if (o.mode !== 'guest' && tide.phase === 'low') loot.spawnCrabs(tide.cycle);
    $('#loading').classList.remove('on');
    $('#hud').classList.remove('hidden');
    $('#room-code').textContent = G.net ? `ROOM ${G.net.code}` : '';
    $('#room-code').classList.toggle('hidden', !G.net);
    show(null);
    hud.banner(phaseTitle(tide.phase), phaseSub(tide.phase));
    resolve(G);
  }, 40));
}

function lootFx(kind, x, y, z) {
  const pos = { x, y, z }, fx = W.fx;
  if (kind === 'chest') { fx.sparkle(x, y, z); sfx.chest(pos); }
  else if (kind === 'crabHit') fx.shellBits(x, y, z, 8);
  else if (kind === 'crabDead') { fx.shellBits(x, y, z, 22); sfx.crabDie(pos); }
  else if (kind === 'dig') { fx.dust(x, y, z, 3); if (Math.random() < 0.15) sfx.dig(pos); }
}

function addRemote(id, p) {
  if (G.remotes.has(id)) return;
  const char = new Character(p.outfit ?? 1);
  scene.add(char.root);
  G.remotes.set(id, { name: clean(p.name || 'Diver'), outfit: p.outfit, peerId: p.peerId, char, x: 0, y: -100, z: 0, yaw: 0, sp: 0, f: 0, s: 0, sw: 0, gr: true, dead: false, under: false, tx: 0, ty: -100, tz: 0 });
  G.voice?.addPlayer(id, p.peerId);
}
function removeRemote(id) {
  const r = G?.remotes.get(id);
  if (!r) return;
  r.char.dispose(); G.remotes.delete(id);
  G.voice?.removePlayer(id);
  hud.feed(`${esc(r.name)} left`, 'bad');
}

// ---------------------------------------------------------------- co-op
async function hostGame() {
  const net = new Net();
  try { await net.host(); } catch (e) { toast(e.message || String(e)); return false; }
  const roster = {}; // id -> { name, outfit, peerId }
  net.onJoin = (id, hello) => {
    if (!G) { setTimeout(() => net.onJoin(id, hello), 250); return; }
    const p = { name: clean(String(hello.name || 'Diver').slice(0, 14)), outfit: clamp(hello.outfit | 0, 0, OUTFITS.length - 1), peerId: hello.peerId };
    roster[id] = p;
    const players = { h: { name: settings.name, outfit: settings.outfit, peerId: net.peer.id }, ...roster };
    net.sendTo(id, { type: 'welcome', you: id, seed: G.seed, t: G.tide.t, cycle: G.tide.cycle, opened: [...G.loot.chests.values()].filter(c => c.opened).map(c => c.id), players });
    for (const other of net.guests) if (other !== id) net.sendTo(other, { type: 'joined', id, ...p });
    addRemote(id, p);
    G.crabFullT = 0;
    hud.feed(`${esc(p.name)} joined`, 'gold');
  };
  net.onLeave = id => { delete roster[id]; net.send({ type: 'left', id }); removeRemote(id); };
  bindNet(net);
  await buildSession({ mode: 'host', net, myId: 'h', seed: save.seed, tideT: save.tideT, cycle: save.cycle });
  startVoice();
  toast(`Room ${net.code}: friends type this code next to Join Co-op`, true, 7000);
  return true;
}

async function joinGame(code) {
  if (code.length < 5) { toast('Type the 5-letter room code first.'); return false; }
  const net = new Net();
  toast('Connecting…', true, 2500);
  let w;
  try { w = await net.join(code, { name: settings.name, outfit: settings.outfit }); } catch (e) { toast(e.message || String(e)); return false; }
  bindNet(net);
  net.onClose = () => { toast('Lost connection to the host'); setTimeout(leaveToTitle, 1500); };
  await buildSession({ mode: 'guest', net, myId: w.you, seed: w.seed, tideT: w.t, cycle: w.cycle, opened: w.opened, players: w.players });
  startVoice();
  return true;
}

function bindNet(net) {
  net.on('p', (m, from) => {
    const r = G?.remotes.get(from);
    if (!r) return;
    Object.assign(r, { tx: m.x, ty: m.y, tz: m.z, yaw: m.yaw, sp: m.sp, f: m.f, s: m.s, sw: m.sw, gr: m.g, dead: m.dead, under: m.under });
    if (r.y < -50) { r.x = m.x; r.y = m.y; r.z = m.z; }
  });
  net.on('anim', (m, from) => { G?.remotes.get(from)?.char.play(String(m.a)); });
  net.on('joined', m => { if (G) { addRemote(m.id, m); hud.feed(`${esc(m.name || 'Diver')} joined`, 'gold'); } });
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
  net.on('crabs', m => G?.loot.applyCrabs(m.list, m.full));
  net.on('opened', m => onOpened(m.id, m.by));
  net.on('crabHit', m => G?.loot.flashCrab(m.id));
  net.on('crabDead', m => { if (!G) return; G.loot.removeCrab(m.id, true); if (m.by === G.myId) rewardCrab(); });
  net.on('bite', m => { if (G) bitten(m.dmg); });
  // The host decides chests and crab hits for everyone
  net.on('open', (m, from) => {
    if (!G || G.mode !== 'host') return;
    const c = G.loot.chests.get(m.id);
    if (!c || c.opened || G.tide.phase !== 'low') return;
    net.send({ type: 'opened', id: m.id, by: from });
    onOpened(m.id, from);
  });
  net.on('hit', (m, from) => {
    if (!G || G.mode !== 'host') return;
    const r = G.remotes.get(from);
    if (G.loot.hitCrab(m.crab, clamp(+m.dmg || 0, 0, 60), r)) net.send({ type: 'crabDead', id: m.crab, by: from });
    else net.send({ type: 'crabHit', id: m.crab });
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
  hud.feed(ok ? (settings.voice === 'open' ? 'Voice chat on (open mic)' : 'Voice chat on: hold <kbd>V</kbd> to talk') : 'No microphone found: you can still hear your friends');
}

// ---------------------------------------------------------------- loot
const itemLine = (k, n) => `${ITEMS[k].icon} +${n} ${ITEMS[k].name}`;
function onOpened(id, by) {
  if (!G) return;
  const c = G.loot.markOpened(id);
  if (!c || by !== G.myId) return;
  const items = rollChest(G.seed, id), left = {};
  for (const [k, n] of Object.entries(items)) {
    const got = G.player.addItem(k, n);
    if (got) hud.feed(itemLine(k, got), k === 'idol' || k === 'gear' ? 'gold' : '');
    if (got < n) left[k] = n - got;
  }
  if (Object.keys(left).length) { G.loot.dropBag(c, left); toast('Pack full! The rest is in a sack next to the chest.'); }
}
function rewardCrab() {
  const a = G.player.addItem('shell', 2), b = Math.random() < 0.3 ? G.player.addItem('pearl', 1) : 0;
  sfx.pickup();
  if (a) hud.feed(itemLine('shell', a)); if (b) hud.feed(itemLine('pearl', b));
  if (!a && !b) hud.feed('Crab defeated (pack full)', 'bad');
  hitMark(true);
}
function bitten(dmg) {
  G.player.hurt(dmg); sfx.bite(); vm.hurt(); G.cam.shake = 0.5;
  G.body.play('hit'); G.net?.send({ type: 'anim', a: 'hit' });
}
function hitMark(kill) {
  const h = $('#hitmarker'); h.className = ''; void h.offsetWidth; h.className = 'on' + (kill ? ' kill' : '');
}

function bankPack() {
  const p = G.player, n = p.packCount;
  if (!n) { toast('Your pack is empty.'); sfx.error(); return; }
  for (const [k, v] of Object.entries(p.pack)) save.bank[k] = (save.bank[k] || 0) + v;
  p.pack = {};
  writeSave(); sfx.bank(); G.body.play('interact'); G.net?.send({ type: 'anim', a: 'interact' });
  hud.feed(`Stashed ${n} item${n > 1 ? 's' : ''}. They're safe now.`, 'gold');
}

// ---------------------------------------------------------------- workbench
function openBench() { input.unlock(); renderBench(); show('bench'); }
function renderBench() {
  $('#bench-bank').innerHTML = Object.entries(ITEMS).map(([k, it]) => `<span class="chip">${it.icon} ${it.name} <b>${save.bank[k] || 0}</b></span>`).join('');
  $('#bench-list').innerHTML = UPGRADES.map(u => {
    const lvl = save.upgrades[u.id] || 0, maxed = lvl >= u.max;
    const can = !maxed && Object.entries(u.cost).every(([k, n]) => (save.bank[k] || 0) >= n);
    const cost = Object.entries(u.cost).map(([k, n]) => `<span class="${(save.bank[k] || 0) >= n ? '' : 'short'}">${ITEMS[k].icon} ${n}</span>`).join('&nbsp;&nbsp;');
    const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    return `<div class="up ${can ? 'can' : ''} ${maxed ? 'max' : ''}"><div class="ico">${u.icon}</div><div><b>${u.name}</b><span class="pips">${pips}</span><p>${u.desc}</p><p class="cost">${maxed ? 'Fully built' : cost}</p></div><button class="btn ${can ? 'gold' : ''}" data-up="${u.id}" ${can ? '' : 'disabled'}>${maxed ? 'Done' : 'Build'}</button></div>`;
  }).join('');
}
$('#bench-list').addEventListener('click', e => {
  const b = e.target.closest('[data-up]'); if (!b || b.disabled) return;
  const u = UPGRADES.find(x => x.id === b.dataset.up);
  for (const [k, n] of Object.entries(u.cost)) save.bank[k] -= n;
  save.upgrades[u.id] = (save.upgrades[u.id] || 0) + 1;
  if (G) { G.player.up = save.upgrades; vm.setBlade(save.upgrades.blade || 0); }
  writeSave(); sfx.build(); renderBench();
  toast(`${u.name} built!`, true);
});

// ---------------------------------------------------------------- HUD
const phaseTitle = p => ({ day: 'HIGH TIDE', ebb: 'THE TIDE IS GOING OUT', low: 'THE HOLLOW IS OPEN', flood: 'FLOOD' }[p]);
const phaseSub = p => ({ day: 'Stash your loot and build upgrades.', ebb: 'The ruins are rising out of the water…', low: 'Follow the beams of light. Pry the chests open.', flood: 'The sea is coming back. Get to an island!' }[p]);
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const RING = 2 * Math.PI * 24;
$('#ch-ring').style.strokeDasharray = RING;

function project(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  if (tmpV.z > 1) return null;
  return { x: (tmpV.x * 0.5 + 0.5) * innerWidth, y: (-tmpV.y * 0.5 + 0.5) * innerHeight };
}

function updateHud() {
  const p = G.player, t = G.tide, ph = t.phase, world = W.world;
  hud.text('#tide-phase', { day: 'HIGH TIDE', ebb: 'EBBING', low: 'LOW TIDE', flood: 'FLOOD' }[ph]);
  hud.text('#tide-left', mmss(t.left));
  hud.text('#tide-next', { day: 'Next: the tide goes out', ebb: 'Next: the Hollow opens', low: `Flood in ${mmss(t.untilFlood)}`, flood: 'Get to high ground' }[ph]);
  hud.cls('.tide', 'low', ph === 'low'); hud.cls('.tide', 'flood', ph === 'flood');
  hud.tide(t);
  hud.style('#bar-hp', 'width', (p.hp / PLAYER.health * 100).toFixed(1) + '%');
  hud.style('#bar-air', 'width', (p.oxygen / p.maxOxygen * 100).toFixed(1) + '%');
  hud.style('#bar-st', 'width', (p.stamina / PLAYER.stamina * 100).toFixed(1) + '%');
  hud.cls('.vital.air', 'on', p.headUnder || p.oxygen < p.maxOxygen - 0.5);
  hud.cls('.vital.air', 'low', p.oxygen < p.maxOxygen * 0.3);
  hud.cls('.vital.st', 'out', p.stamina < 3);
  hud.text('#air-secs', String(Math.ceil(p.oxygen)));
  hud.text('#pack-count', `${p.packCount}/${p.packSize}`);
  hud.style('#pack-fill', 'width', (p.packCount / p.packSize * 100) + '%');
  hud.cls('.pack-bar', 'full', p.packCount >= p.packSize);
  hud.html('#pack-items', Object.keys(ITEMS).map(k => `<div class="it ${p.pack[k] ? '' : 'empty'}" title="${ITEMS[k].name}">${ITEMS[k].icon}${p.pack[k] ? `<b>${p.pack[k]}</b>` : ''}</div>`).join(''));
  hud.text('#bank-total', String(bankTotal()));
  // Compass: the nearest camp, the nearest ruins with chests left (while the tide is out), your pack, friends
  const marks = [], d2 = o => (o.x - p.pos.x) ** 2 + (o.z - p.pos.z) ** 2;
  const camp = [...world.camps].sort((a, b) => d2(a) - d2(b))[0];
  if (d2(camp) > 400) marks.push({ x: camp.x, z: camp.z, color: '#ff9d5c' });
  if (ph === 'ebb' || ph === 'low') {
    const live = new Set(); for (const c of G.loot.chests.values()) if (!c.opened) live.add(c.site);
    world.sites.filter((s, i) => live.has(i)).sort((a, b) => d2(a) - d2(b)).slice(0, 2).forEach(s => marks.push({ x: s.x, z: s.z, color: '#ffd27a' }));
  }
  for (const b of G.loot.bags) marks.push({ x: b.x, z: b.z, color: '#fff3c4' });
  for (const r of G.remotes.values()) if (!r.dead) marks.push({ x: r.x, z: r.z, color: '#6fe0d0' });
  hud.compass(-G.yaw, marks, p.pos);
  // Where you are
  const site = world.sites.find(s => d2(s) < (s.r + 6) ** 2), near = d2(camp) < 30 * 30 ? camp.name : site ? site.name : '';
  if (near !== G.place) { G.place = near; hud.place(near); }
  // Labels in the world: friends, your pack
  const out = [];
  const add = (x, y, z, label, cls) => { const s = project(x, y, z); if (s && s.x > -50 && s.x < innerWidth + 50) out.push(`<div class="mk ${cls}" style="left:${s.x.toFixed(0)}px;top:${s.y.toFixed(0)}px">${label}</div>`); };
  for (const b of G.loot.bags) add(b.x, b.y + 1.6, b.z, `Your pack ${Math.round(Math.sqrt(d2(b)))}m`, 'bag');
  for (const [id, r] of G.remotes) if (!r.dead) add(r.x, r.y + 2.1, r.z, `${G.voice?.speaking(id) ? '🔊 ' : ''}${esc(r.name)}`, 'friend');
  hud.html('#markers', out.join(''));
  hud.html('#players', G.net ? [`<div class="pl me ${G.voice?.localLevel > 0.03 ? 'talk' : ''}">${esc(settings.name)}</div>`, ...[...G.remotes].map(([id, r]) => `<div class="pl ${G.voice?.speaking(id) ? 'talk' : ''}">${esc(r.name)}${r.dead ? ' ✝' : ''}</div>`)].join('') : '');
  $('#vignette').style.opacity = clamp((1 - p.hp / PLAYER.health) * 0.7 + (p.hurtT > 0 ? 0.45 : 0) + (p.oxygen < 6 ? 0.4 * (0.6 + 0.4 * Math.sin(G.time * 6)) : 0), 0, 1);
  if (G.mapOpen) hud.drawMap({ level01: clamp((t.level - TIDE.lowLevel) / (TIDE.high - TIDE.lowLevel), 0, 1), sites: world.sites, camps: world.camps, bags: G.loot.bags, friends: [...G.remotes.values()].filter(r => !r.dead), me: { x: p.pos.x, z: p.pos.z, yaw: G.yaw }, phase: ph, respawn: p.respawn });
}

// ---------------------------------------------------------------- per frame
let last = performance.now(), titleT = 0;
const titleTide = new Tide(TIDE.day - 14);
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G) tick(dt);
  else if (W) titleTick(dt);
  if (W) {
    if (composer) composer.render(dt);
    else {
      renderer.render(scene, camera);
      if (G) { renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = true; }
    }
  }
  input.endFrame();
}

// Title screen: a slow flight around Home Isle at golden hour
function titleTick(dt) {
  titleT += dt;
  const a = titleT * 0.035 + 0.6, r = 190;
  camera.position.set(Math.cos(a) * r, 34 + Math.sin(titleT * 0.11) * 6, Math.sin(a) * r);
  camera.lookAt(0, 9, 0);
  camera.fov = 55; camera.updateProjectionMatrix();
  const at = atmosphere(dt, titleT, titleTide, tmpV.set(0, 6, 0), false);
  W.fx.update(dt, { cam: camera.position, level: at.level, night: at.night, under: false, viewH: renderer.domElement.height, fov: camera.fov, onLand: false });
}

function tick(dt) {
  const { player: p, tide, loot, cam } = G, { world, fx } = W;
  const paused = G.paused && G.mode === 'solo';
  if (!paused) { tide.update(dt); G.time += dt; }
  const ph = tide.phase;

  // New tide: a fresh set of chests
  if (loot.cycle !== tide.cycle) loot.setCycle(tide.cycle);
  if (ph !== G.seenPhase) {
    G.seenPhase = ph;
    hud.banner(phaseTitle(ph), phaseSub(ph), ph === 'flood' ? '#ff9a9a' : ph === 'low' ? '#ffd27a' : '#eef7f4');
    if (ph === 'low') { sfx.phase(); if (G.mode !== 'guest') loot.spawnCrabs(tide.cycle); }
    if (ph === 'flood') sfx.horn();
    if (ph === 'day') { if (G.mode !== 'guest') loot.clearCrabs(); sfx.phase(); }
    if (ph === 'ebb') sfx.phase();
    if (ph === 'day' || ph === 'ebb') G.warned = false;
  }
  // The tide bell rings before the flood (earlier with the Tide Charm)
  const warnAt = 25 + (save.upgrades.charm ? 15 : 0);
  if (ph === 'low' && !G.warned && tide.untilFlood <= warnAt) { G.warned = true; sfx.bells(); hud.banner('THE TIDE IS TURNING', `${Math.ceil(tide.untilFlood)} seconds. Get back to an island!`, '#ffb36b'); }

  // Look around
  const menuOpen = !!currentScreen;
  const play = input.locked && !menuOpen && !paused;
  G.lookDX = 0; G.lookDY = 0;
  if (play && !p.dead) {
    const k = 0.0022 * settings.sens;
    G.lookDX = input.dx; G.lookDY = input.dy;
    G.yaw -= input.dx * k;
    G.pitch = clamp(G.pitch - input.dy * k * (settings.invertY ? -1 : 1), -1.5, 1.5);
  }
  const kd = c => play && !!input.keys[c];
  const mx = (kd('KeyD') ? 1 : 0) - (kd('KeyA') ? 1 : 0), mz = (kd('KeyW') ? 1 : 0) - (kd('KeyS') ? 1 : 0);
  const jumpHit = play && input.hit('Space');
  const prying = !!G.channel;
  const ev = paused ? {} : p.update(dt, {
    mx: prying ? 0 : mx, mz: prying ? 0 : mz, yaw: G.yaw, pitch: G.pitch, sprint: kd('ShiftLeft') || kd('ShiftRight'),
    jump: kd('Space'), jumpHit, dive: kd('KeyC') || kd('ControlLeft'), attack: play && input.mouse.left && !prying
  }, { level: tide.level, flood: ph === 'flood', highTide: ph === 'day' });

  // What just happened to you
  const feet = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  if (ev.step) { sfx.step(p.surface, p.sprinting ? 0.55 : 0.38, p.wade > 0.12); if (p.sprinting && p.surface === 'sand' && p.wade < 0.1) fx.dust(p.pos.x, p.pos.y, p.pos.z, 2); if (p.wade > 0.12) fx.splash(p.pos.x, tide.level, p.pos.z, 5, 0.4); }
  if (ev.jumped) sfx.jump();
  if (ev.mantled) { sfx.mantle(); cam.landV -= 1.2; }
  if (ev.landed) { sfx.land(p.surface, ev.landed > 9); vm.landed(ev.landed); cam.landV -= Math.min(2.6, ev.landed * 0.16); if (p.wade < 0.1) fx.dust(p.pos.x, p.pos.y, p.pos.z, ev.landed > 9 ? 10 : 4); }
  if (ev.splashed) { sfx.splash(feet, ev.splashed > 0.5); fx.splash(p.pos.x, tide.level, p.pos.z, 14 + ev.splashed * 30, 0.5 + ev.splashed); fx.bubbles(p.pos.x, tide.level - 0.6, p.pos.z, 14, tide.level, 0.5); }
  if (ev.surfaced) { fx.splash(p.pos.x, tide.level, p.pos.z, 8, 0.4); if (ev.surfaced === 'gasp') sfx.gasp(); }
  if (ev.respawned) { $('#fade').classList.remove('on'); $('#death').classList.remove('on'); vm.draw(); hud.feed(`You wake up by the fire on ${esc(p.respawn.name)}.`); }

  // Death: drop the pack where you fell
  if (p.dead && !G.wasDead) {
    loot.dropBag(p.pos, p.pack); const lost = p.packCount; p.pack = {};
    $('#death b').textContent = p.oxygen <= 0 ? 'YOU DROWNED' : 'YOU FELL';
    $('#death-sub').textContent = lost ? 'Your pack is where you fell. Find it next low tide.' : 'Back to camp…';
    $('#death').classList.add('on'); setTimeout(() => { if (G?.player.dead) $('#fade').classList.add('on'); }, 1800);
    G.channel = null; G.mapOpen = false; $('#map').classList.add('hidden');
  }
  G.wasDead = p.dead;

  // Swing: the cut lands a moment after you click
  if (ev.swung) { vm.swing(); sfx.swing(); G.swingHit = 0.13; G.body.play('slash'); G.net?.send({ type: 'anim', a: 'slash' }); }
  if (G.swingHit >= 0 && (G.swingHit -= dt) < 0) {
    G.swingHit = -1;
    const crab = loot.crabInFront(p.pos, G.yaw, PLAYER.attackRange);
    if (crab) {
      sfx.hit({ x: crab.x, y: crab.y + 0.5, z: crab.z }); hitMark(false); cam.shake = Math.max(cam.shake, 0.25);
      if (G.mode === 'guest') { loot.flashCrab(crab.id, p.pos); G.net.sendTo('h', { type: 'hit', crab: crab.id, dmg: p.damage }); }
      else if (loot.hitCrab(crab.id, p.damage, p.pos)) { G.net?.send({ type: 'crabDead', id: crab.id, by: G.myId }); rewardCrab(); }
      else G.net?.send({ type: 'crabHit', id: crab.id });
    }
  }
  if (play && input.hit('KeyF')) vm.inspect();
  if (play && input.hit('KeyG')) { G.body.play('wave'); G.net?.send({ type: 'anim', a: 'wave' }); }
  if (input.hit('KeyM') && !menuOpen && !p.dead) { G.mapOpen = !G.mapOpen; $('#map').classList.toggle('hidden', !G.mapOpen); sfx.click(); }

  interact(dt, play);

  // Reaching a campfire makes it the place you wake up
  for (const c of world.camps) if (c !== p.respawn && Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 9 && !p.dead) {
    p.respawn = c; save.camp = c.name; writeSave(); sfx.camp();
    hud.banner(c.name.toUpperCase(), "Camp reached. You'll wake up here if you drown.", '#ffb36b');
  }

  // Host: crabs hunt everyone
  if (G.mode !== 'guest' && !paused && loot.crabs.size) {
    const players = [{ id: G.myId, pos: p.pos, dead: p.dead }, ...[...G.remotes].map(([id, r]) => ({ id, pos: { x: r.x, y: r.y, z: r.z }, dead: r.dead }))];
    loot.simulateCrabs(dt, players, (id, dmg) => { if (id === G.myId) bitten(dmg); else G.net?.sendTo(id, { type: 'bite', dmg }); });
  }

  // Network: me 15x a second; the host also shares the tide and the crabs
  const sy = Math.sin(G.yaw), cy = Math.cos(G.yaw);
  const fwd = -p.vel.x * sy - p.vel.z * cy, side = p.vel.x * cy - p.vel.z * sy;
  if (G.net) {
    G.sendT -= dt;
    if (G.sendT <= 0) {
      G.sendT = 1 / 15;
      G.net.send({ type: 'p', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +G.yaw.toFixed(2), sp: +p.speed.toFixed(1), f: +fwd.toFixed(1), s: +side.toFixed(1), sw: +p.swim.toFixed(2), g: p.grounded, dead: p.dead, under: p.headUnder });
    }
    if (G.mode === 'host') {
      G.tideSendT -= dt; if (G.tideSendT <= 0) { G.tideSendT = 2; G.net.send({ type: 'tide', t: tide.t, cycle: tide.cycle }); }
      G.crabSendT -= dt; G.crabFullT -= dt;
      if (G.crabSendT <= 0) {
        G.crabSendT = 0.1;
        const full = G.crabFullT <= 0; if (full) G.crabFullT = 2;
        const list = loot.crabList(full);
        if (list.length || full) G.net.send({ type: 'crabs', list, full });
      }
    }
  }

  // Friends: smooth toward their latest position
  for (const r of G.remotes.values()) {
    const k = Math.min(1, dt * 12);
    r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k;
    r.char.root.position.set(r.x, r.y, r.z);
    r.char.update(dt, { speed: r.sp, fwd: r.f, side: r.s, swim: r.sw, grounded: r.gr, dead: r.dead, yaw: r.yaw });
  }
  // Your own body only casts a shadow
  G.body.root.position.copy(p.pos);
  G.body.update(dt, { speed: p.speed, fwd, side, swim: p.swim, grounded: p.grounded, dead: p.dead, yaw: G.yaw });

  // ---- first-person camera
  const speed01 = clamp(p.speed / PLAYER.walk, 0, 1.6) * (p.grounded ? 1 : 0);
  cam.bob += ((settings.bob ? speed01 : 0) - cam.bob) * Math.min(1, dt * 8);
  cam.landV += (-cam.land * 120 - cam.landV * 14) * dt; cam.land = clamp(cam.land + cam.landV * dt, -0.5, 0.2);
  cam.shake = Math.max(0, cam.shake - dt * 2.2);
  cam.roll += (clamp(-side * 0.006, -0.03, 0.03) - cam.roll) * Math.min(1, dt * 6);
  const bobY = Math.sin(p.stepPhase * 2) * 0.03 * cam.bob, bobX = Math.cos(p.stepPhase) * 0.022 * cam.bob;
  const swimSway = p.swim * Math.sin(G.time * 1.3) * 0.02;
  let eyeY = p.pos.y + p.eye + bobY + cam.land, roll = cam.roll + swimSway + (Math.random() - 0.5) * cam.shake * 0.05;
  if (p.dead) { G.deadK = Math.min(1, (G.deadK || 0) + dt * 1.2); eyeY = p.pos.y + lerp(p.eye, 0.35, G.deadK); roll += G.deadK * 1.1; } else G.deadK = 0;
  camera.position.set(p.pos.x + cy * bobX, Math.max(eyeY, world.ground(p.pos.x, p.pos.z) + 0.25), p.pos.z - sy * bobX);
  camera.rotation.set(G.pitch + (Math.random() - 0.5) * cam.shake * 0.04 + cam.land * 0.12, G.yaw, roll);
  const fovT = settings.fov + (p.sprinting && !p.swimming ? 7 : 0) - (p.headUnder ? 4 : 0);
  cam.fov += (fovT - cam.fov) * Math.min(1, dt * 6);
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }

  const camUnder = camera.position.y < tide.level - 0.02;
  const at = atmosphere(dt, G.time, tide, p.pos, camUnder);
  hud.cls('#underwater', 'on', camUnder);
  // The Tide Lantern
  const lit = save.upgrades.lantern && !p.dead;
  lantern.position.set(camera.position.x - cy * 0.3, camera.position.y - 0.2, camera.position.z + sy * 0.3);
  lantern.intensity = lit ? (3 + 24 * at.night) * (0.92 + Math.sin(G.time * 17) * 0.05) * (p.swimming ? 0.5 : 1) : 0;
  loot.update(dt, G.time, ph, camera.position);
  if (p.headUnder && !p.dead && Math.random() < dt * 2.2) fx.bubbles(camera.position.x - sy * 0.3, camera.position.y - 0.15, camera.position.z - cy * 0.3, 2 + Math.floor(Math.random() * 3), tide.level, 0.08);
  fx.update(dt, { cam: camera.position, level: tide.level, night: at.night, under: camUnder, viewH: renderer.domElement.height, fov: camera.fov, onLand: p.pos.y > 1.2 });

  vm.update(dt, { look: { dx: G.lookDX, dy: G.lookDY }, speed01, step: p.stepPhase, sprint: p.sprinting, grounded: p.grounded, swim: p.swimming, interact: prying, dead: p.dead, lantern: !!save.upgrades.lantern, night: at.night, aspect: camera.aspect });
  vm.light(sun.color, sun.intensity, hemi.intensity * 2.2 + (lit ? at.night * 1.2 : 0), scene.environmentIntensity, camUnder);

  // Sound: where you are and what the sea is doing
  const nearIsle = world.camps.reduce((b, c) => (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < Math.hypot(b.x - p.pos.x, b.z - p.pos.z) ? c : b));
  updateAudio({ dt, pos: camera.position, yaw: G.yaw, pitch: G.pitch, under: camUnder, level01: at.level01, night: at.night, phase: ph, shore: clamp(1 - Math.abs(p.pos.y - tide.level) / 6, 0, 1), height: p.pos.y - tide.level, swimming: p.swimming, speed: p.vel.length(), island: nearIsle });

  // Voice: positions for proximity chat, push-to-talk on V
  if (G.voice) {
    G.voice.setTalking(play && !!input.keys.KeyV);
    const players = new Map([...G.remotes].map(([id, r]) => [id, { x: r.x, y: r.y + 1.6, z: r.z, under: r.under }]));
    G.voice.update({ x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: G.yaw, under: p.headUnder }, players, settings.volume);
  }

  // Autosave (single player keeps the tide; everyone keeps their stash and upgrades)
  G.saveT -= dt;
  if (G.saveT <= 0) { G.saveT = 10; if (G.mode !== 'guest') { save.tideT = tide.t; save.cycle = tide.cycle; } writeSave(); }

  updateHud();
}

function interact(dt, play) {
  const { player: p, loot, tide } = G, world = W.world;
  let prompt = '', act = false;
  const near = (o, r) => Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < r;
  const ePressed = play && input.hit('KeyE');
  const eHeld = play && !!input.keys.KeyE;
  let channel = null;
  if (!p.dead) {
    const camp = world.camps.find(c => near(c, 14));
    const bagNear = loot.bags.some(b => Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < 1.8 && Math.abs(b.y - p.pos.y) < 2.5);
    if (bagNear) {
      prompt = '<kbd>E</kbd> Pick up your pack'; act = true;
      if (ePressed) {
        const items = loot.takeBag(p.pos), left = {};
        if (items) {
          let got = 0;
          for (const [k, n] of Object.entries(items)) { const g = p.addItem(k, n); got += g; if (g < n) left[k] = n - g; }
          if (Object.keys(left).length) loot.dropBag(p.pos, left);
          sfx.pickup(); G.body.play('interact');
          hud.feed(got ? (Object.keys(left).length ? 'Pack full: the rest stays in the sack.' : 'Got your pack back!') : 'Your pack is full.', got ? 'gold' : 'bad');
        }
      }
    } else if (camp && near(camp.stash, 2.8)) {
      prompt = `<kbd>E</kbd> Stash your loot (${p.packCount})`; act = true;
      if (ePressed) bankPack();
    } else if (camp?.bench && near(camp.bench, 2.9)) {
      prompt = '<kbd>E</kbd> Workbench: build upgrades'; act = true;
      if (ePressed) openBench();
    } else {
      const c = loot.nearestChest(p.pos, 2.4);
      if (c) {
        if (tide.phase !== 'low') prompt = 'Sealed shut. It opens at low tide.';
        else if (p.packCount >= p.packSize) prompt = 'Your pack is full. Stash your loot first.';
        else {
          prompt = '<kbd>E</kbd> Hold to pry open'; act = true;
          if (eHeld && !p.swimming) {
            channel = G.channel && G.channel.id === c.id ? G.channel : { id: c.id, t: 0 };
            channel.t += dt;
            if ((G.pryT -= dt) <= 0) { G.pryT = 0.45; sfx.pry({ x: c.x, y: c.y, z: c.z }); }
            if (channel.t >= 1.2) {
              channel = null;
              G.body.play('interact'); G.net?.send({ type: 'anim', a: 'interact' });
              if (G.mode === 'guest') G.net.sendTo('h', { type: 'open', id: c.id });
              else { G.net?.send({ type: 'opened', id: c.id, by: G.myId }); onOpened(c.id, G.myId); }
            }
          }
        }
      }
    }
  }
  G.channel = channel;
  hud.html('#prompt', prompt);
  hud.cls('#prompt', 'on', !!prompt);
  hud.cls('#crosshair', 'act', act);
  hud.cls('#crosshair', 'prying', !!channel);
  if (channel) $('#ch-ring').style.strokeDashoffset = RING * (1 - channel.t / 1.2);
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
  if (!locked && !currentScreen) { G.paused = true; G.mapOpen = false; $('#map').classList.add('hidden'); $('#pause-note').textContent = G.net ? `Room ${G.net.code} · the game keeps running for your friends` : 'The tide waits for you.'; show('pause'); }
  if (locked) { G.paused = false; if (currentScreen === 'pause') show(null); }
  $('#clickplay').style.display = !locked && !currentScreen ? 'flex' : 'none';
};
$('#clickplay').addEventListener('click', () => { unlock(); input.lock(); });
canvas.addEventListener('click', () => { if (G && !currentScreen) { unlock(); input.lock(); } });

let settingsReturn = 'title', howtoReturn = 'title', busy = false;
const start = async fn => { if (busy) return; busy = true; unlock(); saveName(); input.lock(); try { if (await fn()) input.lock(); } finally { busy = false; } };
const actions = {
  solo() { start(async () => { await buildSession({ mode: 'solo', seed: save.seed, tideT: save.tideT, cycle: save.cycle }); return true; }); },
  host() { start(hostGame); },
  join() { start(() => joinGame($('#join-code').value.trim().toUpperCase())); },
  settings() { settingsReturn = currentScreen || 'title'; openSettings(); },
  'settings-back'() { show(settingsReturn); },
  howto() { howtoReturn = 'title'; show('howto'); },
  'howto-pause'() { howtoReturn = 'pause'; show('howto'); },
  back() { show(howtoReturn); },
  resume() { show(null); input.lock(); },
  leave() { leaveToTitle(); },
  quit() { window.electronAPI?.quit?.() ?? window.close(); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && actions[b.dataset.act]) { unlock(); sfx.click(); actions[b.dataset.act](); } });
addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (currentScreen === 'settings') { e.preventDefault(); actions['settings-back'](); }
  else if (currentScreen === 'howto') { e.preventDefault(); actions.back(); }
  else if (currentScreen === 'bench' || currentScreen === 'pause') { if (G) actions.resume(); }
});

function saveName() {
  settings.name = String($('#name').value || 'Diver').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Diver';
  if (!ok(settings.name)) { settings.name = 'Diver'; $('#name').value = 'Diver'; }
  settings.outfit = +$('#outfit').value || 0;
  saveSettings();
}
$('#name').value = settings.name;
$('#outfit').innerHTML = OUTFITS.map((o, i) => `<option value="${i}">${o.name}</option>`).join('');
$('#outfit').value = String(settings.outfit);
$('#join-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') actions.join(); });

function openSettings() {
  $('#set-vol').value = settings.volume; $('#set-music').value = settings.music; $('#set-sens').value = settings.sens; $('#set-fov').value = settings.fov; $('#fov-val').textContent = settings.fov + '°';
  $('#set-quality').value = settings.quality; $('#set-invert').checked = settings.invertY; $('#set-bob').checked = settings.bob; $('#set-voice').value = settings.voice;
  show('settings');
}
$('#set-vol').addEventListener('input', e => { settings.volume = +e.target.value; setVolume(settings.volume); saveSettings(); });
$('#set-music').addEventListener('input', e => { settings.music = +e.target.value; setMusicVolume(settings.music); saveSettings(); });
$('#set-sens').addEventListener('input', e => { settings.sens = +e.target.value; saveSettings(); });
$('#set-fov').addEventListener('input', e => { settings.fov = +e.target.value; $('#fov-val').textContent = settings.fov + '°'; saveSettings(); });
$('#set-quality').addEventListener('change', e => { settings.quality = e.target.value; saveSettings(); toast('Graphics change applies next time the game starts.', true); });
$('#set-invert').addEventListener('change', e => { settings.invertY = e.target.checked; saveSettings(); });
$('#set-bob').addEventListener('change', e => { settings.bob = e.target.checked; saveSettings(); });
$('#set-voice').addEventListener('change', e => { settings.voice = e.target.value; saveSettings(); if (G?.voice && settings.voice !== 'off') G.voice.setMode(settings.voice); else if (G?.voice) { G.voice.stop(); G.voice = null; } else if (G?.net && settings.voice !== 'off') startVoice(); });

function leaveToTitle() {
  if (G) { if (G.mode !== 'guest') { save.tideT = G.tide.t; save.cycle = G.tide.cycle; } writeSave(); G.voice?.stop(); G.net?.destroy(); }
  // Simplest clean slate: reload the page
  location.reload();
}
addEventListener('beforeunload', () => { if (G) { if (G.mode !== 'guest') { save.tideT = G.tide.t; save.cycle = G.tide.cycle; } writeSave(); } });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight); }
});

// ---------------------------------------------------------------- boot
(async function boot() {
  const fill = $('#load-fill'), text = $('#load-text');
  try {
    await loadAll(renderer, audioContext(), k => { fill.style.width = (k * 92).toFixed(0) + '%'; });
    scene.environment = A.env;
    text.textContent = 'Building the lagoon…';
    await new Promise(r => setTimeout(r, 30));
    vm = new ViewModel();
    setupComposer();
    buildWorld(save.seed);
    fill.style.width = '100%';
    requestAnimationFrame(frame);
    // Give the first frame a moment to compile shaders before lifting the curtain
    setTimeout(() => $('#loading').classList.remove('on'), 350);
  } catch (e) {
    console.error(e);
    text.textContent = 'Could not load the game: ' + (e?.message || e);
  }
})();
show('title');
// Test hooks (step runs the game forward without waiting for frames)
window.__ht = { step(n = 1, dt = 1 / 60) { for (let i = 0; i < n && G; i++) { tick(dt); input.endFrame(); } }, get G() { return G; }, get W() { return W; }, get vm() { return vm; }, settings, save, actions, input, camera, renderer, scene, titleTide };
