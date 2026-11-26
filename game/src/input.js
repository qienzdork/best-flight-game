// Skyline Run — keyboard and mouse. One clear job: turn raw device events into
// a small, stable control state the flight model reads each frame.
import { KEYS } from './config.js';

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    mouseX: 0.5, // 0..1 across the canvas, 0.5 is centred
    mouseY: 0.5,
    mouseActive: false,
    mouseSeen: false,
    pressed: new Set(), // codes pressed since the last consumePress call

    attach() {
      window.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        this.keys.add(event.code);
        this.pressed.add(event.code);
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
          event.preventDefault();
        }
      });
      window.addEventListener('keyup', (event) => {
        this.keys.delete(event.code);
      });
      window.addEventListener('blur', () => {
        this.keys.clear();
        this.mouseActive = false;
      });
      canvas.addEventListener('pointermove', (event) => {
        const rect = canvas.getBoundingClientRect();
        this.mouseX = (event.clientX - rect.left) / rect.width;
        this.mouseY = (event.clientY - rect.top) / rect.height;
        this.mouseSeen = true;
      });
      canvas.addEventListener('pointerdown', () => {
        this.mouseActive = true;
      });
      canvas.addEventListener('pointerup', () => {
        this.mouseActive = false;
      });
    },

    held(codes) {
      for (const code of codes) if (this.keys.has(code)) return true;
      return false;
    },

    /** True once for each physical press; the caller consumes it. */
    consumePress(codes) {
      for (const code of codes) {
        if (this.pressed.has(code)) {
          this.pressed.delete(code);
          return true;
        }
      }
      return false;
    },

    endFrame() {
      this.pressed.clear();
    },

    /** -1..1 roll and pitch demand from the current input state. */
    axes() {
      let pitch = 0;
      let roll = 0;
      if (this.held(KEYS.pitchUp)) pitch -= 1;
      if (this.held(KEYS.pitchDown)) pitch += 1;
      if (this.held(KEYS.rollLeft)) roll -= 1;
      if (this.held(KEYS.rollRight)) roll += 1;
      if (this.mouseActive && this.mouseSeen) {
        // Mouse steering: pointer offset from centre banks and pitches the jet.
        roll += (this.mouseX - 0.5) * 2;
        pitch += (this.mouseY - 0.5) * 2;
      }
      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
      };
    },

    throttleDelta(dt) {
      let d = 0;
      if (this.held(KEYS.throttleUp)) d += 1;
      if (this.held(KEYS.throttleDown)) d -= 1;
      return d * dt * 0.55;
    },
  };
  return input;
}
