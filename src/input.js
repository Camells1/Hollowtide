// Keyboard, mouse and pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {}; this.pressed = {}; this.mouse = { left: false, right: false }; this.dx = 0; this.dy = 0;
    this.locked = false;
    addEventListener('keydown', e => { if (e.repeat) return; this.keys[e.code] = true; this.pressed[e.code] = true; if (['Space', 'Tab'].includes(e.code) && this.locked) e.preventDefault(); });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.mouse.left = true; if (e.button === 2) this.mouse.right = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => { if (!this.locked) return; if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return; this.dx += e.movementX; this.dy += e.movementY; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; this.onLockChange?.(this.locked); });
  }
  lock() { if (!this.locked) { try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(() => { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch (_) {} }); } catch (_) { this.canvas.requestPointerLock(); } } }
  unlock() { if (this.locked) document.exitPointerLock(); }
  // True once per key press
  hit(code) { const v = !!this.pressed[code]; this.pressed[code] = false; return v; }
  endFrame() { this.pressed = {}; this.dx = 0; this.dy = 0; }
}
