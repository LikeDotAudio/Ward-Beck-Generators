/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * ABS-1 Bit Spitter, sample by sample: the source (tone, pink / white / brown noise,
 * walking 1s, PRBS-15, min/max, a looped WAV / MP3), the channel B buttons, then a fault
 * on the AES3 line. The TAP runs the same thing in Rust (Generators/rust/src/spitter.rs):
 * keep the two in step.
 */

export type SpitterPattern = 'tone' | 'pink' | 'white' | 'brown' | 'walk1s' | 'prbs' | 'minmax' | 'file';
export type SpitterFault = 'clean' | 'noise' | 'badeq' | 'jitter' | 'drop' | 'slip' | 'biphase' | 'noclock';

export interface SpitterParams {
  pattern: SpitterPattern;
  level: number | null; // dBFS; null = OFF
  tone: number;         // Hz
  cycle: boolean;
  invert: boolean;
  bOff: boolean;
  muted: boolean;       // EXT with no reference: clock stopped
  fault: SpitterFault;
  /** Looped file, 48 kHz (any rate: fileRate). */
  file?: { l: Float32Array; r: Float32Array; rate: number } | null;
}

const TWO_PI = Math.PI * 2;

export class SpitterSynth {
  private t = 0;            // samples since start
  private phase = 0;
  private lfsr = 0x7ace;
  private seed = 0x2545f491;
  private pink = [0, 0, 0, 0, 0, 0, 0];
  private brown = 0;
  private filePos = 0;
  // faults
  private lpL = 0; private lpR = 0;
  private eventIn = 0;      // samples until the next fault event
  private eventLeft = 0;    // samples left in the current event
  private lastL = 0; private lastR = 0;
  private dl = new Float32Array(256); private dr = new Float32Array(256); private dw = 0;

  constructor(private p: SpitterParams, private sr: number) {
    this.eventIn = Math.round(sr * 0.5);
  }

  private rnd(): number { // xorshift32, 0..1
    let x = this.seed;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 4294967296;
  }
  private between(a: number, b: number): number { return a + (b - a) * this.rnd(); }

  /** The source before channel B: [A, B]. */
  private source(): [number, number] {
    const p = this.p, sr = this.sr;
    const amp = p.level === null ? 0 : Math.pow(10, p.level / 20);
    let v = 0;
    switch (p.pattern) {
      case 'tone':
        v = amp * Math.sin(this.phase);
        this.phase = (this.phase + TWO_PI * p.tone / sr) % TWO_PI;
        break;
      case 'white':
        v = amp * (this.rnd() * 2 - 1);
        break;
      case 'pink': { // Paul Kellet's refined filter
        const w = this.rnd() * 2 - 1, b = this.pink;
        b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759;
        b[2] = 0.969 * b[2] + w * 0.153852; b[3] = 0.8665 * b[3] + w * 0.3104856;
        b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898;
        v = amp * 0.11 * (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362);
        b[6] = w * 0.115926;
        break;
      }
      case 'brown':
        this.brown = (this.brown + 0.02 * (this.rnd() * 2 - 1)) / 1.02;
        v = amp * this.brown * 3.5;
        break;
      case 'walk1s': { // one bit a second, 1 kHz square at that bit's weight
        const bit = Math.floor(this.t / sr) % 10;
        v = Math.pow(2, -(bit + 1)) * (Math.sin(this.phase) >= 0 ? 1 : -1);
        this.phase = (this.phase + TWO_PI * 1000 / sr) % TWO_PI;
        break;
      }
      case 'prbs': {
        const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
        this.lfsr = (this.lfsr >> 1) | (bit << 14);
        v = bit ? 0.35 : -0.35;
        break;
      }
      case 'minmax':
        v = this.phase < Math.PI ? 0.95 : -0.95;
        this.phase = (this.phase + TWO_PI * 60 / sr) % TWO_PI;
        break;
      case 'file': {
        const f = p.file;
        if (!f || !f.l.length) return [0, 0];
        const i = Math.floor(this.filePos) % f.l.length;
        this.filePos = (this.filePos + f.rate / sr) % f.l.length;
        return [amp * f.l[i], amp * f.r[i]];
      }
    }
    return [v, v];
  }

  next(): [number, number] {
    const p = this.p, sr = this.sr;
    let [a, b] = this.source();
    if (p.bOff) b = 0;
    else {
      if (p.invert) b = -b;
      if (p.cycle && Math.floor(this.t / (sr * 0.52)) % 2 === 1) b = 0;
    }
    if (p.muted) { a = 0; b = 0; }
    this.t++;
    return this.fault(a, b);
  }

  /** What a receiver makes of the line. */
  private fault(l: number, r: number): [number, number] {
    const sr = this.sr;
    // Event clock shared by the bursty faults
    let inEvent = false;
    if (this.eventLeft > 0) { this.eventLeft--; inEvent = true; }
    else if (--this.eventIn <= 0) {
      const f = this.p.fault;
      const [gap, len] = f === 'drop' ? [[0.5, 3], [0.02, 0.3]] : f === 'badeq' ? [[0.7, 2.5], [0.01, 0.06]]
        : f === 'biphase' ? [[0.2, 1.5], [0.003, 0.025]] : f === 'slip' ? [[0.3, 1.2], [0, 0]] : [[1, 1], [0, 0]];
      this.eventIn = Math.round(sr * this.between(gap[0], gap[1]));
      this.eventLeft = Math.max(1, Math.round(sr * this.between(len[0], len[1])));
      inEvent = true;
    }
    const err = () => (this.rnd() < 0.5 ? -1 : 1) * this.between(0.2, 0.9);
    switch (this.p.fault) {
      case 'noise': // hiss on the line and the odd bit error
        l += (this.rnd() * 2 - 1) * 0.003; r += (this.rnd() * 2 - 1) * 0.003;
        if (this.rnd() < 0.0002) l = err();
        if (this.rnd() < 0.0002) r = err();
        break;
      case 'badeq': { // long cable, no EQ: highs gone, the eye closes now and then
        const a = 1 - Math.exp(-TWO_PI * 2500 / sr);
        this.lpL += a * (l - this.lpL); this.lpR += a * (r - this.lpR);
        l = this.lpL; r = this.lpR;
        if (inEvent && this.rnd() < 0.08) { l = err(); r = err(); }
        break;
      }
      case 'jitter': { // a wandering clock: the samples arrive early and late
        this.dl[this.dw] = l; this.dr[this.dw] = r;
        const s = this.t / sr;
        const d = 24 + 10 * Math.sin(TWO_PI * 5.3 * s) + 6 * Math.sin(TWO_PI * 0.37 * s);
        const pos = (this.dw - d + 256) % 256, i0 = Math.floor(pos), fr = pos - i0, i1 = (i0 + 1) % 256;
        l = this.dl[i0] * (1 - fr) + this.dl[i1] * fr;
        r = this.dr[i0] * (1 - fr) + this.dr[i1] * fr;
        this.dw = (this.dw + 1) % 256;
        break;
      }
      case 'drop': // the receiver loses lock and mutes
        if (inEvent) { l = 0; r = 0; }
        break;
      case 'slip': // a frame repeated: the clocks are not locked
        if (inEvent) { l = this.lastL; r = this.lastR; }
        break;
      case 'biphase': // coding errors: crackle bursts
        if (inEvent && this.rnd() < 0.4) { l = err(); r = err(); }
        break;
      case 'noclock':
        l = 0; r = 0;
        break;
    }
    this.lastL = l; this.lastR = r;
    return [l, r];
  }
}
