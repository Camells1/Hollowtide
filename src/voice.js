// Proximity voice chat. Every player calls every other player directly (WebRTC audio through PeerJS).
// Each voice goes through a 3D panner placed at that player's head, so friends sound louder when close,
// come from the side they're standing on, fade out by ~35 m, and sound muffled under water.
const VOICE_RANGE = 35;

export class Voice {
  constructor() {
    this.ctx = null; this.peer = null; this.local = null; this.micOk = false;
    this.mode = 'ptt';           // 'ptt' (hold V) or 'open'
    this.talking = false;
    this.remotes = new Map();    // playerId -> { call, src, gain, filter, panner, analyser, el, level }
    this.peerIds = new Map();    // playerId -> PeerJS id
    this.myPlayerId = null;
  }

  // Start once a co-op session exists. peer: the PeerJS instance, myPlayerId: our co-op id ('h', 'g1'...)
  async start(peer, myPlayerId, mode) {
    this.peer = peer; this.myPlayerId = myPlayerId; this.mode = mode || this.mode;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination);
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.micOk = true;
      // Our own mic level (for the "you are talking" indicator)
      const a = this.ctx.createAnalyser(); a.fftSize = 256;
      this.ctx.createMediaStreamSource(this.local).connect(a); this.localAnalyser = a;
    } catch (_) {
      // No microphone (or permission denied): still listen, send silence
      this.local = this.ctx.createMediaStreamDestination().stream;
      this.micOk = false;
    }
    this._applyMic();
    this.pending = new Map(); // calls from players we haven't been told about yet (by PeerJS id)
    this._onCall = call => {
      const from = [...this.peerIds].find(([, pid]) => pid === call.peer)?.[0];
      if (!from) { this.pending.set(call.peer, call); setTimeout(() => { if (this.pending.get(call.peer) === call) { this.pending.delete(call.peer); call.close(); } }, 8000); return; }
      call.answer(this.local);
      this._attach(from, call);
    };
    peer.on('call', this._onCall);
    return this.micOk;
  }

  setMode(mode) { this.mode = mode; this._applyMic(); }
  setTalking(on) { if (this.talking !== on) { this.talking = on; this._applyMic(); } }
  _applyMic() { const on = this.mode === 'open' || this.talking; for (const t of this.local?.getAudioTracks() || []) t.enabled = on; }
  get transmitting() { return this.micOk && (this.mode === 'open' || this.talking); }

  // Learn a player's PeerJS id. Once their voice is ready too, the side with the smaller id places the call
  // (calling before the other side listens would be silently lost).
  addPlayer(playerId, peerId, ready = false) {
    if (!peerId || playerId === this.myPlayerId) return;
    this.peerIds.set(playerId, peerId);
    if (!this.peer || this.remotes.has(playerId)) return;
    const waiting = this.pending?.get(peerId);
    if (waiting) { this.pending.delete(peerId); waiting.answer(this.local); this._attach(playerId, waiting); return; }
    if (ready && this.peer.id < peerId) {
      const call = this.peer.call(peerId, this.local);
      if (call) this._attach(playerId, call);
    }
  }

  removePlayer(playerId) {
    const r = this.remotes.get(playerId);
    if (r) { try { r.call.close(); } catch (_) {} try { r.src?.disconnect(); } catch (_) {} r.el?.remove(); this.remotes.delete(playerId); }
    this.peerIds.delete(playerId);
  }

  _attach(playerId, call) {
    this.removePlayer(playerId); this.peerIds.set(playerId, call.peer);
    const r = { call, level: 0 };
    this.remotes.set(playerId, r);
    call.on('stream', stream => {
      if (r.src) return;
      // Chrome only plays WebRTC audio through Web Audio if the stream is also attached to a media element
      r.el = new Audio(); r.el.muted = true; r.el.srcObject = stream; r.el.play().catch(() => {});
      const c = this.ctx;
      r.src = c.createMediaStreamSource(stream);
      r.filter = c.createBiquadFilter(); r.filter.type = 'lowpass'; r.filter.frequency.value = 20000;
      r.panner = new PannerNode(c, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 2, maxDistance: VOICE_RANGE, rolloffFactor: 1 });
      r.analyser = c.createAnalyser(); r.analyser.fftSize = 256;
      r.gain = c.createGain(); r.gain.gain.value = 1.4;
      r.src.connect(r.analyser);
      r.src.connect(r.filter); r.filter.connect(r.gain); r.gain.connect(r.panner); r.panner.connect(this.out);
    });
    call.on('close', () => { if (this.remotes.get(playerId) === r) this.remotes.delete(playerId); });
    call.on('error', () => {});
  }

  _level(analyser) {
    const buf = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(buf);
    let s = 0; for (const v of buf) s += (v - 128) * (v - 128);
    return Math.sqrt(s / buf.length) / 128;
  }

  // listener: { x, y, z, yaw, under }; players: Map playerId -> { x, y, z, under }
  update(listener, players, volume) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.out.gain.value = volume;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(listener.yaw), fz = -Math.cos(listener.yaw);
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.x, t, 0.05); L.positionY.setTargetAtTime(listener.y, t, 0.05); L.positionZ.setTargetAtTime(listener.z, t, 0.05);
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(listener.x, listener.y, listener.z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    for (const [id, r] of this.remotes) {
      const p = players.get(id);
      if (!r.panner || !p) continue;
      r.panner.positionX.setTargetAtTime(p.x, t, 0.05); r.panner.positionY.setTargetAtTime(p.y, t, 0.05); r.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
      // Muffled if either of you is under water
      r.filter.frequency.setTargetAtTime(listener.under || p.under ? 700 : 20000, t, 0.1);
      r.level = this._level(r.analyser);
    }
    this.localLevel = this.localAnalyser && this.transmitting ? this._level(this.localAnalyser) : 0;
  }

  speaking(playerId) { const r = this.remotes.get(playerId); return !!r && r.level > 0.04; }

  stop() {
    for (const id of [...this.remotes.keys()]) this.removePlayer(id);
    if (this.peer && this._onCall) this.peer.off('call', this._onCall);
    for (const c of this.pending?.values() || []) { try { c.close(); } catch (_) {} }
    for (const t of this.local?.getTracks() || []) t.stop();
    try { this.ctx?.close(); } catch (_) {}
    this.ctx = null; this.local = null; this.peer = null;
  }
}
