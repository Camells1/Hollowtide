// HUD pieces that draw things: the compass strip, the tide graph, the lagoon map,
// and the little notifications (toast, loot feed, big phase banner).
import { TIDE, CYCLE, WORLD } from './config.js';
import { Tide } from './tide.js';
import { clamp, lerp, smooth, esc } from './util.js';

const $ = s => document.querySelector(s);
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class Hud {
  constructor() {
    this.cache = new Map();
    this.cctx = $('#compass').getContext('2d');
    // The tide graph: one whole cycle, drawn once
    const t = new Tide(0), pts = [];
    for (let i = 0; i <= 120; i++) { t.t = i / 120 * (CYCLE - 0.001); pts.push([i / 120 * 200, lerp(34, 7, (t.level - TIDE.lowLevel) / (TIDE.high - TIDE.lowLevel))]); }
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    $('#tide-line').setAttribute('d', line); $('#tide-fill').setAttribute('d', line + ' L200 40 L0 40 Z');
    this.pts = pts;
    this.mapBase = null;
  }

  html(sel, html) { if (this.cache.get(sel) === html) return; this.cache.set(sel, html); $(sel).innerHTML = html; }
  text(sel, text) { if (this.cache.get(sel) === text) return; this.cache.set(sel, text); $(sel).textContent = text; }
  cls(sel, name, on) { const k = sel + '|' + name; if (this.cache.get(k) === on) return; this.cache.set(k, on); $(sel).classList.toggle(name, on); }
  style(sel, prop, val) { const k = sel + '~' + prop; if (this.cache.get(k) === val) return; this.cache.set(k, val); $(sel).style[prop] = val; }

  toast(msg, ok = false, ms = 3000) {
    const t = $('#toast'); t.textContent = msg; t.className = 'on' + (ok ? ' ok' : '');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => { t.className = ''; }, ms);
  }
  // A line in the feed on the right (loot, friends joining...)
  feed(html, cls = '', ms = 4200) {
    const f = $('#feed'), d = document.createElement('div');
    d.className = 'fd ' + cls; d.innerHTML = html; f.appendChild(d);
    while (f.children.length > 6) f.firstChild.remove();
    setTimeout(() => d.classList.add('out'), ms); setTimeout(() => d.remove(), ms + 600);
  }
  banner(title, sub, color = '#eef7f4', ms = 3800) {
    const b = $('#banner'); b.querySelector('b').textContent = title; b.style.color = color; b.querySelector('span').textContent = sub || '';
    b.classList.add('on'); clearTimeout(this._bannerT); this._bannerT = setTimeout(() => b.classList.remove('on'), ms);
  }
  place(name) {
    if (this._place === name) return; this._place = name;
    const p = $('#place'); if (!name) { p.classList.remove('on'); return; }
    p.textContent = name; p.classList.add('on'); clearTimeout(this._placeT); this._placeT = setTimeout(() => p.classList.remove('on'), 4000);
  }

  tide(tide) {
    const x = tide.t / CYCLE * 200, i = Math.min(119, Math.floor(tide.t / CYCLE * 120)), a = this.pts[i], b = this.pts[i + 1], y = lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0] || 1));
    $('#tide-now').setAttribute('x1', x); $('#tide-now').setAttribute('x2', x);
    $('#tide-dot').setAttribute('cx', x); $('#tide-dot').setAttribute('cy', y);
  }

  // heading: radians clockwise from north. marks: [{ x, z, color, label, icon }], from: { x, z }
  compass(heading, marks, from) {
    const c = this.cctx, W = 720, H = 56, ppd = W / 150, hd = heading * 180 / Math.PI;
    c.clearRect(0, 0, W, H);
    c.textAlign = 'center'; c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 4;
    const xOf = deg => { let d = ((deg - hd) % 360 + 540) % 360 - 180; return W / 2 + d * ppd; };
    for (let deg = 0; deg < 360; deg += 5) {
      const x = xOf(deg); if (x < 0 || x > W) continue;
      const major = deg % 45 === 0, mid = deg % 15 === 0;
      c.fillStyle = major ? '#fff' : 'rgba(255,255,255,.6)';
      c.fillRect(Math.round(x) - (major ? 1 : 0.5), 22, major ? 2 : 1, major ? 12 : mid ? 8 : 4);
      if (major) { const card = deg % 90 === 0; c.font = `600 ${card ? 17 : 12}px Bahnschrift, Segoe UI, sans-serif`; c.fillStyle = deg === 0 ? '#ffd27a' : card ? '#fff' : 'rgba(255,255,255,.75)'; c.fillText(DIRS[deg / 45], x, 17); }
    }
    for (const m of marks) {
      const dx = m.x - from.x, dz = m.z - from.z, dist = Math.hypot(dx, dz);
      const x = clamp(xOf(Math.atan2(dx, -dz) * 180 / Math.PI), 96, W - 96);
      c.fillStyle = m.color;
      c.save(); c.translate(x, 43); c.rotate(Math.PI / 4); c.fillRect(-4.5, -4.5, 9, 9); c.restore();
      c.font = '600 11px Bahnschrift, Segoe UI, sans-serif'; c.fillStyle = '#fff';
      c.fillText(`${Math.round(dist)}m`, x + 26, 47);
    }
    c.shadowBlur = 0; c.fillStyle = '#ffd27a';
    c.beginPath(); c.moveTo(W / 2 - 5, 0); c.lineTo(W / 2 + 5, 0); c.lineTo(W / 2, 7); c.fill();
  }

  // ---------------------------------------------------------------- map
  buildMap(terrain) {
    const N = 450, S = WORLD.size;
    const make = flooded => {
      const cv = document.createElement('canvas'); cv.width = cv.height = N;
      const c = cv.getContext('2d'), img = c.createImageData(N, N), d = img.data;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = -S / 2 + (i + 0.5) / N * S, z = -S / 2 + (j + 0.5) / N * S, h = terrain.heightAt(x, z), r = Math.hypot(x, z);
        const shade = clamp(1 + (terrain.heightAt(x - 3, z - 3) - terrain.heightAt(x + 3, z + 3)) * 0.07, 0.6, 1.4);
        let R, G, B;
        const water = flooded ? h < 0 : h < TIDE.lowLevel;
        if (r > WORLD.rim + 38 || (water && r > WORLD.rim)) { R = 8; G = 34; B = 50; }
        else if (water) { const k = smooth(0, flooded ? 14 : 6, (flooded ? 0 : TIDE.lowLevel) - h); R = lerp(52, 12, k); G = lerp(150, 62, k); B = lerp(160, 96, k); }
        else if (h < -3) { const k = smooth(-18, -3, h); R = lerp(74, 150, k) * shade; G = lerp(98, 150, k) * shade; B = lerp(98, 120, k) * shade; }
        else if (h < 2.6) { R = 222 * shade; G = 208 * shade; B = 160 * shade; }
        else if (r > WORLD.rim - 25) { R = 128 * shade; G = 124 * shade; B = 116 * shade; }
        else { const k = smooth(3, 22, h); R = lerp(118, 70, k) * shade; G = lerp(160, 118, k) * shade; B = lerp(92, 66, k) * shade; }
        // Depth contours on the seabed
        if (!water && h < -3 && Math.abs(((h % 3) + 3) % 3 - 1.5) > 1.42) { R *= 0.82; G *= 0.82; B *= 0.82; }
        const k = (j * N + i) * 4; d[k] = R; d[k + 1] = G; d[k + 2] = B; d[k + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      return cv;
    };
    this.mapLow = make(false); this.mapHigh = make(true);
  }

  // s: { level01, sites, camps, bags, friends [{x,z,name}], me {x,z,yaw}, phase, respawn }
  drawMap(s) {
    const cv = $('#map-canvas'), c = cv.getContext('2d'), W = cv.width, S = WORLD.size;
    const px = v => (v + S / 2) / S * W;
    c.imageSmoothingQuality = 'high';
    c.globalAlpha = 1; c.drawImage(this.mapLow, 0, 0, W, W);
    c.globalAlpha = smooth(0, 1, s.level01); c.drawImage(this.mapHigh, 0, 0, W, W); c.globalAlpha = 1;
    c.textAlign = 'center'; c.lineJoin = 'round';
    const label = (text, x, y, color = '#fff', size = 12) => {
      c.font = `600 ${size}px Bahnschrift, Segoe UI, sans-serif`; c.lineWidth = 3; c.strokeStyle = 'rgba(2,12,18,.85)'; c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y);
    };
    for (const site of s.sites) {
      const x = px(site.x), y = px(site.z);
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = site.type === 'wreck' ? '#c9a27a' : '#ffd27a'; c.strokeStyle = 'rgba(2,12,18,.9)'; c.lineWidth = 1.5;
      c.fillRect(-4.5, -4.5, 9, 9); c.strokeRect(-4.5, -4.5, 9, 9); c.restore();
      label(site.name, x, y - 9, '#f4ead2', 10.5);
    }
    for (const camp of s.camps) {
      const x = px(camp.x), y = px(camp.z);
      c.beginPath(); c.arc(x, y, 6.5, 0, 7); c.fillStyle = '#ff9d5c'; c.fill(); c.lineWidth = 2; c.strokeStyle = camp === s.respawn ? '#fff' : 'rgba(2,12,18,.9)'; c.stroke();
      label(camp.name.toUpperCase(), x, y + 21, '#fff', 12.5);
    }
    for (const b of s.bags) { const x = px(b.x), y = px(b.z); c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = '#ffd27a'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#000'; c.stroke(); label('Your pack', x, y - 9, '#ffd27a', 11); }
    for (const f of s.friends) { const x = px(f.x), y = px(f.z); c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = '#6fe0d0'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#02131a'; c.stroke(); label(f.name, x, y - 9, '#6fe0d0', 11); }
    // You: an arrow pointing where you look
    c.save(); c.translate(px(s.me.x), px(s.me.z)); c.rotate(-s.me.yaw);
    c.beginPath(); c.moveTo(0, -11); c.lineTo(7.5, 8); c.lineTo(0, 3.5); c.lineTo(-7.5, 8); c.closePath();
    c.fillStyle = '#fff'; c.strokeStyle = '#02131a'; c.lineWidth = 2; c.fill(); c.stroke(); c.restore();
    // Compass rose
    label('N', W - 28, 30, '#ffd27a', 18);
    c.beginPath(); c.moveTo(W - 28, 36); c.lineTo(W - 28, 56); c.strokeStyle = '#ffd27a'; c.lineWidth = 2; c.stroke();
    $('#map-tide').textContent = { day: 'High tide: the lagoon is full. Ruins are under water.', ebb: 'The tide is going out.', low: 'Low tide: the Hollow is open.', flood: 'The flood is coming in!' }[s.phase];
  }
}
export { esc };
