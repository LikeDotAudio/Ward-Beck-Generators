/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * ABS-1 ×4 Bit Spitter, 8 channels: four ABS-1 pairs side by side, one per AES pair
 * (AES 1/2, 3/4, 5/6, 7/8). Each pair is its own SpitterSynth with its own source, level,
 * tone, channel B and line fault. The TAP runs the same thing in Rust
 * (Generators/rust/src/spitter8.rs): keep the two in step.
 */

import { SpitterSynth } from './spitter-synth';
import type { SpitterParams, SpitterPattern, SpitterFault } from './spitter-synth';

/** AES pairs on the 8-channel spitter. */
export const SPITTER8_PAIRS = 4;
/** Channels out (two per pair). */
export const SPITTER8_CHANNELS = 2 * SPITTER8_PAIRS;

export type Spitter8ChB = 'same' | 'cycle' | 'invert' | 'off';

/** One pair's front-panel settings, as the panel and the TAP's /api/bitspitter8 send them. */
export interface Spitter8Pair {
  pattern: Exclude<SpitterPattern, 'file'>;
  level_db: number | null; // dBFS; null = OFF
  tone_hz: number;
  ch_b: Spitter8ChB;
  fault: SpitterFault;
}

export const DEFAULT_SPITTER8_PAIR: Spitter8Pair = { pattern: 'sweep', level_db: -20, tone_hz: 1000, ch_b: 'same', fault: 'clean' };

/** The SpitterParams a pair plays. */
export function spitter8PairParams(p: Spitter8Pair): SpitterParams {
  return {
    pattern: p.pattern, level: p.level_db, tone: p.tone_hz,
    cycle: p.ch_b === 'cycle', invert: p.ch_b === 'invert', bOff: p.ch_b === 'off',
    muted: false, fault: p.fault,
  };
}

export class Spitter8Synth {
  private pairs: SpitterSynth[];

  constructor(pairs: readonly Spitter8Pair[], private sr: number) {
    this.pairs = Array.from({ length: SPITTER8_PAIRS }, (_, i) =>
      new SpitterSynth(spitter8PairParams(pairs[i] ?? DEFAULT_SPITTER8_PAIR), sr));
  }

  /** New settings for pair `i` (0..3): that pair starts over, the others play on. */
  setPair(i: number, p: Spitter8Pair): void {
    if (i >= 0 && i < SPITTER8_PAIRS) this.pairs[i] = new SpitterSynth(spitter8PairParams(p), this.sr);
  }

  /** One 8-channel frame: [AES1 A, AES1 B, AES2 A, AES2 B, ...]. */
  next(): number[] {
    const out = new Array<number>(SPITTER8_CHANNELS);
    for (let i = 0; i < SPITTER8_PAIRS; i++) {
      const [a, b] = this.pairs[i].next();
      out[2 * i] = a; out[2 * i + 1] = b;
    }
    return out;
  }

  /** `out[c].length` frames, planar: one array per channel. */
  fill(out: Float32Array[]): void {
    const n = out[0]?.length ?? 0;
    for (let k = 0; k < n; k++) {
      const f = this.next();
      for (let c = 0; c < SPITTER8_CHANNELS && c < out.length; c++) out[c][k] = f[c];
    }
  }
}
