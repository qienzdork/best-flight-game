// Skyline Run — all sound is synthesised with WebAudio, no audio files.
// One clear job: engine hum, wind, and the game's event sounds.
export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineOsc2: null,
    engineGain: null,
    windSource: null,
    windGain: null,
    windFilter: null,
    muted: false,
    started: false,

    /** Call from the first user gesture; browsers block audio before that. */
    ensure() {
      if (this.started) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        // Engine: a sawtooth plus a sub octave, pitched by throttle.
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 55;
        this.engineOsc2 = this.ctx.createOscillator();
        this.engineOsc2.type = 'triangle';
        this.engineOsc2.frequency.value = 27;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0.0;
        const engineFilter = this.ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 900;
        this.engineOsc.connect(engineFilter);
        this.engineOsc2.connect(engineFilter);
        engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engineOsc.start();
        this.engineOsc2.start();
        // Wind: looped noise through a bandpass, louder and higher with speed.
        const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        this.windSource = this.ctx.createBufferSource();
        this.windSource.buffer = noiseBuffer;
        this.windSource.loop = true;
        this.windFilter = this.ctx.createBiquadFilter();
        this.windFilter.type = 'bandpass';
        this.windFilter.frequency.value = 500;
        this.windFilter.Q.value = 0.6;
        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0.0;
        this.windSource.connect(this.windFilter);
        this.windFilter.connect(this.windGain);
        this.windGain.connect(this.master);
        this.windSource.start();
        this.started = true;
      } catch (err) {
        this.started = false;
      }
    },

    /** Continuous engine and wind, called every frame with the flight state. */
    update(throttle, speed, afterburner, flying) {
      if (!this.started || !this.ctx) return;
      const t = this.ctx.currentTime;
      const base = 42 + throttle * 58 + (afterburner ? 26 : 0);
      this.engineOsc.frequency.setTargetAtTime(base, t, 0.08);
      this.engineOsc2.frequency.setTargetAtTime(base / 2, t, 0.08);
      const engineLevel = flying ? 0.05 + throttle * 0.075 + (afterburner ? 0.05 : 0) : 0.0;
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : engineLevel, t, 0.1);
      const windLevel = flying ? Math.min(0.22, (speed / 120) * 0.22) : 0.0;
      this.windGain.gain.setTargetAtTime(this.muted ? 0 : windLevel, t, 0.15);
      this.windFilter.frequency.setTargetAtTime(320 + speed * 7, t, 0.15);
    },

    tone(freq, dur, type, level, when = 0) {
      if (!this.started || !this.ctx || this.muted) return;
      const t = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    },

    ringChime() {
      this.tone(880, 0.35, 'sine', 0.22);
      this.tone(1318, 0.45, 'sine', 0.16, 0.07);
      this.tone(1760, 0.5, 'sine', 0.1, 0.14);
    },

    warningBeep() {
      this.tone(620, 0.16, 'square', 0.1);
      this.tone(620, 0.16, 'square', 0.1, 0.2);
    },

    touchdown() {
      this.tone(140, 0.25, 'sine', 0.3);
      this.tone(90, 0.3, 'triangle', 0.2, 0.05);
    },

    crashBoom() {
      if (!this.started || !this.ctx) return;
      const t = this.ctx.currentTime;
      const dur = 0.9;
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      const gain = this.ctx.createGain();
      gain.gain.value = this.muted ? 0 : 0.5;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t);
      this.tone(55, 0.7, 'sine', 0.35);
    },

    toggleMute() {
      this.muted = !this.muted;
      return this.muted;
    },
  };
  return audio;
}
