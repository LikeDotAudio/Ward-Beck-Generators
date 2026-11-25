/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * ABS-1 ×4 Audio Bit Spitter (8 ch): four ABS-1 pairs on one 8-channel MXL flow
 * (wbs-flow-bit-spitter-8). One row per AES pair, laid out like the POD-33's outputs.
 *
 * The TAP plays it (Generators/rust/src/spitter8.rs); this panel talks to the TAP
 * directly at /api/bitspitter8. With the TAP off it only says so.
 */

import { DEFAULT_SPITTER8_PAIR } from '../sources/spitter8-synth';
import type { Spitter8Pair } from '../sources/spitter8-synth';

const API = 'http://localhost:8467/api/bitspitter8';
const PAIR_NAMES = ['AES 1/2', 'AES 3/4', 'AES 5/6', 'AES 7/8'];

interface State { active: boolean; pairs: Spitter8Pair[] }

type Opt = readonly [string, string, string?];
interface Col { title: string; key: keyof Spitter8Pair; opts: readonly Opt[] }

const COLS: Col[] = [
  { title: 'SOURCE', key: 'pattern', opts: [['sweep', 'Sweep', '20 Hz → 20 kHz'], ['tone', 'Tone'], ['pink', 'Pink'], ['white', 'White'], ['brown', 'Brown'], ['walk1s', 'Walking 1s'], ['prbs', 'PRBS-15'], ['minmax', 'Min/Max']] },
  { title: 'LEVEL (dBFS)', key: 'level_db', opts: [['0', '0'], ['-12', '-12'], ['-20', '-20'], ['off', 'OFF']] },
  { title: 'TONE', key: 'tone_hz', opts: [['1000', '1 kHz'], ['400', '400 Hz']] },
  { title: 'CHANNEL B', key: 'ch_b', opts: [['same', 'A = B'], ['cycle', 'Cycle', 'Channel B on / off every half second'], ['invert', 'Ø 180°', 'Channel B out of phase'], ['off', 'Off', 'Channel B muted']] },
  { title: 'LINE FAULT', key: 'fault', opts: [['clean', 'Clean'], ['noise', 'Noise', 'Hiss on the line and the odd bit error'], ['badeq', 'Bad EQ', 'Long cable, no equaliser'], ['jitter', 'Jitter', 'A wandering clock'], ['drop', 'Dropouts', 'The receiver loses lock and mutes'], ['slip', 'Slips', 'A frame repeated now and then'], ['biphase', 'Bi-phase', 'Coding errors: crackle bursts'], ['noclock', 'No clock', 'Silence']] },
];

/** A button's value as the API wants it. */
const wire = (key: keyof Spitter8Pair, v: string): unknown =>
  key === 'level_db' ? (v === 'off' ? null : +v) : key === 'tone_hz' ? +v : v;
/** Does a pair's setting light this button? */
const lit = (key: keyof Spitter8Pair, v: string, p: Spitter8Pair): boolean =>
  key === 'level_db' ? (v === 'off' ? p.level_db === null : p.level_db === +v) : key === 'tone_hz' ? p.tone_hz === +v : p[key] === v;

export class BitSet8Panel {
  private boundTo?: HTMLElement;
  private state: State = { active: false, pairs: PAIR_NAMES.map(() => ({ ...DEFAULT_SPITTER8_PAIR })) };
  /** null = not asked yet, false = the TAP did not answer. */
  private tap: boolean | null = null;
  private timer = 0;

  html(): string {
    return `
      <div class="rc-pod-panel rc-bs8-panel wbs-bitset8">
        <div class="rc-panel-title">
          <div class="rc-panel-title-left"><strong>WBS ABS-1 ×4 AUDIO BIT SPITTER (8 CH)</strong></div>
          <button type="button" id="btnToggleBitSpitter8" class="rc-power-btn">○ ACTIVATE</button>
        </div>
        <table class="rc-pod-outs rc-bs8-outs" aria-label="ABS-1 ×4 AES pairs">
          <thead><tr><th></th>${COLS.map((c) => `<th class="rc-control-group-title">${c.title}</th>`).join('')}</tr></thead>
          <tbody>${PAIR_NAMES.map((name, n) => `
            <tr class="rc-pod-out" data-bs8-row="${n}">
              <th scope="row" class="rc-pod-out-name">${name}</th>${COLS.map((c) => `
              <td><div class="rc-btn-group" role="group" aria-label="${name} ${c.title}">${c.opts
                .map(([v, l, t]) => `<button type="button" class="rc-btn-sel" data-bs8-pair="${n}" data-bs8-key="${c.key}" data-bs8-val="${v}"${t ? ` title="${t}"` : ''}>${l}</button>`).join('')}</div></td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="rc-bs-status" id="bs8Status"></div>
      </div>`;
  }

  bind(root: HTMLElement): void {
    if (this.boundTo === root) return;
    this.boundTo = root;
    root.addEventListener('click', (e) => {
      const t = (e.target as Element).closest('button');
      if (!t || !t.closest('.rc-bs8-panel')) return;
      if (t.id === 'btnToggleBitSpitter8') return void this.send({ active: !this.state.active });
      const d = t.dataset;
      if (d.bs8Pair === undefined || !d.bs8Key || d.bs8Val === undefined) return;
      const key = d.bs8Key as keyof Spitter8Pair;
      const pairs: (Partial<Record<keyof Spitter8Pair, unknown>> | null)[] = PAIR_NAMES.map(() => null);
      pairs[+d.bs8Pair] = { [key]: wire(key, d.bs8Val) };
      // Light it now; the TAP's answer puts it right
      (this.state.pairs[+d.bs8Pair] as any)[key] = wire(key, d.bs8Val);
      this.paint(root);
      void this.send({ pairs });
    });
    // Keep in step with the TAP (another page may change it) while on screen
    window.clearInterval(this.timer);
    const tick = () => {
      if (!root.isConnected) return window.clearInterval(this.timer);
      if (root.offsetParent !== null) void this.fetchState('GET');
    };
    this.timer = window.setInterval(tick, 3000);
    tick();
  }

  private send(body: unknown): Promise<void> {
    return this.fetchState('POST', body);
  }

  private async fetchState(method: 'GET' | 'POST', body?: unknown): Promise<void> {
    try {
      const res = await fetch(API, method === 'GET' ? { cache: 'no-store' }
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        const s = await res.json();
        if (Array.isArray(s.pairs)) this.state = { active: !!s.active, pairs: s.pairs };
        this.tap = true;
      } else {
        this.tap = res.status === 404 ? false : this.tap;
      }
    } catch {
      this.tap = false;
    }
    if (this.boundTo) this.paint(this.boundTo);
  }

  paint(root: HTMLElement): void {
    const s = this.state, on = s.active && this.tap === true;
    root.querySelectorAll<HTMLElement>('.rc-bs8-panel [data-bs8-pair]').forEach((b) => {
      const p = s.pairs[+b.dataset.bs8Pair!];
      b.classList.toggle('active', !!p && lit(b.dataset.bs8Key as keyof Spitter8Pair, b.dataset.bs8Val!, p));
    });
    root.querySelectorAll('.rc-bs8-panel [data-bs8-row]').forEach((row) => row.classList.toggle('playing', on));
    const pwr = root.querySelector<HTMLButtonElement>('#btnToggleBitSpitter8');
    if (pwr) {
      pwr.classList.toggle('active', on);
      pwr.disabled = this.tap === false;
      pwr.textContent = on ? '● ACTIVE' : '○ ACTIVATE';
    }
    const st = root.querySelector('#bs8Status');
    if (st) {
      st.textContent = this.tap === false ? 'needs the TAP' : '';
      st.classList.toggle('warn', this.tap === false);
    }
  }
}
