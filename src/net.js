// Co-op over PeerJS (WebRTC, no server to run). The host keeps the tide clock, the chests and the crabs;
// everyone simulates their own diver. Star layout: guests talk to the host, the host relays.
import { VERSION } from './config.js';

const PREFIX = 'hollowtide-v2-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] };
const TIMEOUT = 10000;
// Only the host may send these
const HOST_ONLY = new Set(['welcome', 'tide', 'crabs', 'opened', 'crabDead', 'crabHit', 'bite', 'left', 'joined']);

function newPeer(id) {
  return new Promise((resolve, reject) => {
    const P = window.Peer;
    if (typeof P !== 'function') return reject(new Error('Online play needs an internet connection.'));
    const peer = id ? new P(id, { config: ICE, debug: 0 }) : new P({ config: ICE, debug: 0 });
    const t = setTimeout(() => { try { peer.destroy(); } catch (_) {} reject(new Error('Could not reach the matchmaking server.')); }, 12000);
    peer.once('open', () => { clearTimeout(t); resolve(peer); });
    peer.once('error', e => { clearTimeout(t); try { peer.destroy(); } catch (_) {} reject(e); });
  });
}

export class Net {
  constructor() {
    this.peer = null; this.isHost = false; this.myId = null; this.code = '';
    this.links = new Map();  // id -> { conn, last }
    this.handlers = {}; this.nextId = 1; this.maxGuests = 3;
    this.onJoin = null; this.onLeave = null; this.onClose = null;
  }

  async host() {
    for (let tries = 0; tries < 4; tries++) {
      let code = ''; for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      try { this.peer = await newPeer(PREFIX + code); this.code = code; break; }
      catch (e) { if (e.type !== 'unavailable-id') throw e; }
    }
    if (!this.peer) throw new Error('Could not create a room. Try again.');
    this.isHost = true; this.myId = 'h';
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    this.peer.on('connection', conn => {
      conn.on('data', d => {
        if (d?.type !== 'hello') return;
        if (d.v !== VERSION) { conn.send({ type: 'full', reason: `Version mismatch: host has v${VERSION}, you have v${d.v}.` }); setTimeout(() => conn.close(), 400); return; }
        if (this.links.size >= this.maxGuests) { conn.send({ type: 'full', reason: 'That room is full (4 players).' }); setTimeout(() => conn.close(), 400); return; }
        const id = 'g' + this.nextId++;
        this._attach(conn, id);
        this.onJoin?.(id, d);
      });
    });
    this._heartbeat();
    return this.code;
  }

  async join(code, hello) {
    this.peer = await newPeer();
    this.peer.on('error', () => {});
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = msg => { if (done) return; done = true; clearTimeout(t); try { conn.close(); } catch (_) {} this.destroy(); reject(new Error(msg)); };
      const t = setTimeout(() => fail('Could not connect. Check the code, or one of you may be behind a strict firewall.'), 15000);
      this.peer.on('error', e => { if (e.type === 'peer-unavailable') fail('No room with that code.'); });
      const conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
      conn.on('open', () => conn.send({ type: 'hello', v: VERSION, ...hello, peerId: this.peer.id }));
      conn.on('data', d => {
        if (done) return;
        if (d?.type === 'full') fail(d.reason);
        if (d?.type === 'welcome') {
          done = true; clearTimeout(t);
          this.isHost = false; this.myId = d.you; this.code = code.toUpperCase();
          this._attach(conn, 'h');
          this._heartbeat();
          resolve(d);
        }
      });
    });
  }

  _attach(conn, id) {
    const link = { conn, last: performance.now() };
    this.links.set(id, link);
    conn.on('data', d => {
      link.last = performance.now();
      if (d?.type === 'ping') { try { conn.send({ type: 'pong' }); } catch (_) {} return; }
      if (d?.type === 'pong' || d?.type === 'hello') return;
      this._recv(d, id);
    });
    const lost = () => this._lost(id, link);
    conn.on('close', lost); conn.on('error', lost);
  }

  _lost(id, link) {
    if (this.links.get(id) !== link) return;
    this.links.delete(id);
    try { link.conn.close(); } catch (_) {}
    if (this.isHost) this.onLeave?.(id); else this.onClose?.();
  }

  _heartbeat() {
    clearInterval(this._hb);
    this._hb = setInterval(() => {
      const now = performance.now();
      for (const [id, l] of this.links) { try { l.conn.send({ type: 'ping' }); } catch (_) {} if (now - l.last > TIMEOUT) this._lost(id, l); }
    }, 1000);
  }

  _recv(d, from) {
    if (!d || typeof d.type !== 'string') return;
    if (HOST_ONLY.has(d.type) && (this.isHost || from !== 'h')) return;
    if (this.isHost) {
      d.sender = from; // never trust a guest's claimed id
      if (d.to && d.to !== 'h') { this._raw(d.to, d); return; }
      if (!d.to) for (const id of this.links.keys()) if (id !== from) this._raw(id, d);
    }
    try { this.handlers[d.type]?.(d, d.sender || from); } catch (e) { console.error('net handler', d.type, e); }
  }

  _raw(id, msg) { const l = this.links.get(id); if (l?.conn.open) { try { l.conn.send(msg); } catch (_) {} } }
  on(type, fn) { this.handlers[type] = fn; }
  // Send to everyone (guests send to the host, which relays)
  send(msg) { msg.sender = this.myId; delete msg.to; if (this.isHost) for (const id of this.links.keys()) this._raw(id, msg); else this._raw('h', msg); }
  sendTo(id, msg) { msg.sender = this.myId; msg.to = id; if (id === this.myId) { this.handlers[msg.type]?.(msg, this.myId); return; } if (this.isHost) this._raw(id, msg); else this._raw('h', msg); }
  get guests() { return [...this.links.keys()]; }

  destroy() {
    clearInterval(this._hb);
    this.onClose = null; this.onLeave = null;
    for (const l of this.links.values()) { try { l.conn.close(); } catch (_) {} }
    this.links.clear();
    try { this.peer?.destroy(); } catch (_) {}
    this.peer = null;
  }
}
