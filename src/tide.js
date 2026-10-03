// The tide clock: one shared cycle (day -> ebb -> low -> flood). In co-op the host owns it.
import { TIDE, CYCLE } from './config.js';
import { smooth, lerp } from './util.js';

export const PHASES = ['day', 'ebb', 'low', 'flood'];

export class Tide {
  constructor(t = 0) { this.t = t; this.cycle = 0; }

  update(dt) {
    this.t += dt;
    while (this.t >= CYCLE) { this.t -= CYCLE; this.cycle++; }
  }

  get phase() {
    const t = this.t;
    if (t < TIDE.day) return 'day';
    if (t < TIDE.day + TIDE.ebb) return 'ebb';
    if (t < TIDE.day + TIDE.ebb + TIDE.low) return 'low';
    return 'flood';
  }
  // Seconds left in the current phase
  get left() {
    const ends = [TIDE.day, TIDE.day + TIDE.ebb, TIDE.day + TIDE.ebb + TIDE.low, CYCLE];
    return ends[PHASES.indexOf(this.phase)] - this.t;
  }
  // Seconds until the flood starts (counts down through day/ebb/low)
  get untilFlood() { const f = TIDE.day + TIDE.ebb + TIDE.low; return this.t < f ? f - this.t : 0; }

  // Water height right now
  get level() {
    const t = this.t, a = TIDE.day, b = a + TIDE.ebb, c = b + TIDE.low;
    if (t < a) return TIDE.high;
    if (t < b) return lerp(TIDE.high, TIDE.lowLevel, smooth(0, 1, (t - a) / TIDE.ebb));
    if (t < c) return TIDE.lowLevel;
    // The flood comes in fast at first, then slows near the top
    const k = (t - c) / TIDE.flood;
    return lerp(TIDE.lowLevel, TIDE.high, 1 - Math.pow(1 - k, 2.2));
  }

  // 0 = full day, 1 = deep night (the Hollow is open at night)
  get night() {
    const t = this.t, a = TIDE.day, b = a + TIDE.ebb, c = b + TIDE.low;
    if (t < a) return smooth(a - 25, a, t) * 0.35;
    if (t < b) return lerp(0.35, 1, (t - a) / TIDE.ebb);
    if (t < c) return 1;
    return 1 - smooth(0, 1, (t - c) / TIDE.flood);
  }
}
