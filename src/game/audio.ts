// Kleine Klangeffekte, mit WebAudio erzeugt (keine Dateien nötig).
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  private last = new Map<string, number>();
  private noiseBuf: AudioBuffer | null = null;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  play(name: string, vol = 1) {
    if (!this.enabled || !this.ctx || !this.master || vol <= 0.02) return;
    const now = performance.now();
    const gap = name === "slash" || name === "shoot" ? 60 : 30;
    if (now - (this.last.get(name) ?? 0) < gap) return;
    this.last.set(name, now);
    const v = Math.min(1, vol);
    switch (name) {
      case "slash":
        this.noise(0.12, 0.5 * v, 2400, 0.8);
        break;
      case "crit":
        this.noise(0.18, 0.7 * v, 1800, 0.7);
        this.tone(900, 0.15, "square", 0.08 * v, 0.5);
        break;
      case "shoot":
        this.noise(0.1, 0.25 * v, 4000, 2);
        this.tone(700, 0.08, "triangle", 0.06 * v, 1.6);
        break;
      case "fire":
        this.noise(0.35, 0.4 * v, 700, 0.6);
        break;
      case "hook":
        this.tone(300, 0.25, "sawtooth", 0.08 * v, 2.5);
        break;
      case "turret":
        this.tone(1200, 0.25, "sine", 0.12 * v, 0.3);
        this.noise(0.15, 0.2 * v, 3000, 3);
        break;
      case "boom":
        this.noise(0.4, 0.6 * v, 300, 0.7);
        this.tone(120, 0.35, "sine", 0.25 * v, 0.4);
        break;
      case "meteor":
        this.noise(0.9, 0.9 * v, 200, 0.5);
        this.tone(90, 0.8, "sine", 0.4 * v, 0.4);
        break;
      case "explode":
        this.noise(1.2, 1 * v, 160, 0.4);
        this.tone(70, 1.0, "sine", 0.5 * v, 0.5);
        break;
      case "blink":
        this.tone(500, 0.18, "sine", 0.12 * v, 3);
        break;
      case "heal":
        this.tone(520, 0.3, "sine", 0.1 * v, 1.5);
        this.tone(780, 0.3, "sine", 0.08 * v, 1.5, 0.08);
        break;
      case "smite":
        this.noise(0.25, 0.6 * v, 1200, 0.5);
        this.tone(200, 0.3, "square", 0.1 * v, 0.5);
        break;
      case "death":
        this.tone(300, 0.6, "sawtooth", 0.1 * v, 0.3);
        break;
      case "recall":
        this.tone(440, 0.5, "sine", 0.12 * v, 2);
        break;
      case "buy":
        this.tone(1300, 0.08, "square", 0.06 * v);
        this.tone(1750, 0.12, "square", 0.06 * v, 1, 0.07);
        break;
      case "levelup":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, "triangle", 0.1 * v, 1, i * 0.07));
        break;
      case "gold":
        this.tone(1600, 0.07, "sine", 0.05 * v);
        break;
      case "announce":
        this.tone(392, 0.35, "triangle", 0.12 * v);
        this.tone(523, 0.45, "triangle", 0.12 * v, 1, 0.12);
        break;
      case "victory":
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, "triangle", 0.14, 1, i * 0.16));
        break;
      case "defeat":
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.6, "sawtooth", 0.08, 1, i * 0.22));
        break;
      case "click":
        this.tone(900, 0.04, "square", 0.04 * v);
        break;
    }
  }
}
