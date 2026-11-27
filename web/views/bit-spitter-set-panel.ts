/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * ABS-1 Audio Bit Spitter set: the Bit Spitter's own flows, 1, 2, 4, 8 and 16 channels
 * (wbs-flow-bit-spitter-<n>), each with its own AES67 transmitter (groups .11 … .15).
 * One tab per flow; a tab glows while its flow is on the wire.
 *
 * Per flow: ACTIVATE (the flow plays), TRANSMIT (its AES67 sender), FLOW GOOD / BAD / UGLY
 * (the network the packets cross: lost, late, re-ordered, doubled packets; UGLY adds loss
 * bursts, wrong timestamps and damaged payloads), then one row per AES pair with its own
 * source, level, tone, channel B and line fault.
 *
 * The TAP plays it (Generators/rust/src/spitter8.rs, SpitterBank); this panel talks to the
 * TAP directly at /api/bitspitter/<n> and /api/aes67. With the TAP off it only says so.
 */

import { DEFAULT_SPITTER8_PAIR } from '../sources/spitter8-synth';
import type { Spitter8Pair } from '../sources/spitter8-synth';

const TAP = 'http://localhost:8467';
export const SPITTER_SIZES = [1, 2, 4, 8, 16] as const;
type Size = (typeof SPITTER_SIZES)[number];
const QUALITIES = [['good', 'Good', 'Every packet on time'], ['bad', 'Bad', 'A busy network: the odd packet lost, late, re-ordered or doubled'],
  ['ugly', 'Ugly', 'A broken network: loss bursts, late and re-ordered packets, doubles, wrong timestamps, damaged payloads']] as const;
type Quality = (typeof QUALITIES)[number][0];

const pairsFor = (n: number): number => Math.max(1, Math.ceil(n / 2));
const flowId = (n: number): string => `wbs-flow-bit-spitter-${n}`;
const pairName = (n: number, i: number): string => (n === 1 ? 'AES 1 A' : `AES ${2 * i + 1}/${2 * i + 2}`);

interface Flow { active: boolean; pairs: Spitter8Pair[] }
interface Tx { running: boolean; quality: Quality; multicast_ip?: string; impairments?: Record<string, number>; error?: string | null }

type Opt = readonly [string, string, string?];
interface Col { title: string; key: keyof Spitter8Pair; opts: readonly Opt[] }

const COLS: Col[] = [
  { title: 'SOURCE', key: 'pattern', opts: [['sweep', 'Sweep', '20 Hz → 20 kHz'], ['tone', 'Tone'], ['pink', 'Pink'], ['white', 'White'], ['brown', 'Brown'], ['walk1s', 'Walking 1s'], ['prbs', 'PRBS-15'], ['minmax', 'Min/Max']] },
  { title: 'LEVEL (dBFS)', key: 'level_db', opts: [['0', '0'], ['-12', '-12'], ['-20', '-20'], ['off', 'OFF']] },
  { title: 'TONE', key: 'tone_hz', opts: [['1000', '1 kHz'], ['400', '400 Hz']] },
  { title: 'CHANNEL B', key: 'ch_b', opts: [['same', 'A = B'], ['cycle', 'Cycle', 'Channel B on / off every half second'], ['invert', 'Ø 180°', 'Channel B out of phase'], ['off', 'Off', 'Channel B muted']] },
  { title: 'LINE FAULT', key: 'fault', opts: [['clean', 'Clean'], ['noise', 'Noise', 'Hiss on the line and the odd bit error'], ['badeq', 'Bad EQ', 'Long cable, no equaliser'], ['jitter', 'Jitter', 'A wandering clock'], ['drop', 'Dropouts', 'The receiver loses lock and mutes'], ['slip', 'Slips', 'A frame repeated now and then'], ['biphase', 'Bi-phase', 'Coding errors: crackle bursts'], ['noclock', 'No clock', 'Silence']] },
];
/** A 1-channel flow has no channel B. */
const colsFor = (n: number): Col[] => (n === 1 ? COLS.filter((c) => c.key !== 'ch_b') : COLS);

/** A button's value as the API wants it. */
const wire = (key: keyof Spitter8Pair, v: string): unknown =>
  key === 'level_db' ? (v === 'off' ? null : +v) : key === 'tone_hz' ? +v : v;
/** Does a pair's setting light this button? */
const lit = (key: keyof Spitter8Pair, v: string, p: Spitter8Pair): boolean =>
  key === 'level_db' ? (v === 'off' ? p.level_db === null : p.level_db === +v) : key === 'tone_hz' ? p.tone_hz === +v : p[key] === v;

const IMPAIR_LABELS: [string, string][] = [['lost', 'lost'], ['late', 'late'], ['reordered', 'out of order'], ['doubled', 'doubled'], ['bad_timestamp', 'bad stamp'], ['damaged', 'damaged']];

export class BitSpitterSetPanel {
  private boundTo?: HTMLElement;
  private sel: Size = 8;
  private flows = new Map<number, Flow>(SPITTER_SIZES.map((n) => [n, { active: false, pairs: Array.from({ length: pairsFor(n) }, () => ({ ...DEFAULT_SPITTER8_PAIR })) }]));
  private txs = new Map<number, Tx>(SPITTER_SIZES.map((n) => [n, { running: false, quality: 'good' }]));
  /** null = not asked yet, false = the TAP did not answer. */
  private tap: boolean | null = null;
  private timer = 0;

  html(): string {
    return `
      <div class="rc-pod-panel rc-bs8-panel rc-bsset-panel wbs-bitset8">
        <div class="rc-panel-title">
          <div class="rc-panel-title-left"><strong>WBS ABS-1 AUDIO BIT SPITTER SET</strong></div>
          <div class="rc-btn-group rc-bsset-tabs" role="tablist" aria-label="Bit Spitter flows">${SPITTER_SIZES.map((n) =>
            `<button type="button" role="tab" class="rc-btn-sel" data-bsset-size="${n}" title="${flowId(n)}">${n} CH</button>`).join('')}</div>
        </div>
        <div class="rc-bsset-body"></div>
        <div class="rc-bs-status" id="bssetStatus"></div>
      </div>`;
  }

  /** The selected flow's controls and pair rows (rebuilt when the tab changes). */
  private body(): string {
    const n = this.sel, cols = colsFor(n);
    return `
        <div class="rc-bsset-bar">
          <button type="button" class="rc-power-btn" data-bsset-act="active">○ ACTIVATE</button>
          <button type="button" class="rc-power-btn" data-bsset-act="tx">○ TRANSMIT</button>
          <div class="rc-bs-group"><span class="rc-control-group-title">FLOW</span>
            <div class="rc-btn-group" role="group" aria-label="Flow quality">${QUALITIES.map(([v, l, t]) =>
              `<button type="button" class="rc-btn-sel" data-bsset-q="${v}" title="${t}">${l}</button>`).join('')}</div></div>
          <span class="rc-bsset-wire" id="bssetWire"></span>
        </div>
        <table class="rc-pod-outs rc-bs8-outs" aria-label="${n}-channel Bit Spitter AES pairs">
          <thead><tr><th></th>${cols.map((c) => `<th class="rc-control-group-title">${c.title}</th>`).join('')}</tr></thead>
          <tbody>${Array.from({ length: pairsFor(n) }, (_, i) => `
            <tr class="rc-pod-out" data-bsset-row="${i}">
              <th scope="row" class="rc-pod-out-name">${pairName(n, i)}</th>${cols.map((c) => `
              <td><div class="rc-btn-group" role="group" aria-label="${pairName(n, i)} ${c.title}">${c.opts
                .map(([v, l, t]) => `<button type="button" class="rc-btn-sel" data-bsset-pair="${i}" data-bsset-key="${c.key}" data-bsset-val="${v}"${t ? ` title="${t}"` : ''}>${l}</button>`).join('')}</div></td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>`;
  }

  bind(root: HTMLElement): void {
    if (this.boundTo === root) return;
    this.boundTo = root;
    this.render(root);
    root.addEventListener('click', (e) => {
      const t = (e.target as Element).closest('button');
      if (!t || !t.closest('.rc-bsset-panel')) return;
      const d = t.dataset, n = this.sel;
      if (d.bssetSize) {
        this.sel = +d.bssetSize as Size;
        this.render(root);
        return;
      }
      if (d.bssetAct === 'active') return void this.postFlow(n, { active: !this.flows.get(n)!.active });
      if (d.bssetAct === 'tx') {
        const on = !this.txs.get(n)!.running;
        // Transmitting a silent flow helps nobody: TRANSMIT starts the flow too
        if (on && !this.flows.get(n)!.active) void this.postFlow(n, { active: true });
        return void this.postTx({ flow_id: flowId(n), enabled: on });
      }
      if (d.bssetQ) {
        this.txs.get(n)!.quality = d.bssetQ as Quality;
        this.paint(root);
        return void this.postTx({ flow_id: flowId(n), quality: d.bssetQ });
      }
      if (d.bssetPair === undefined || !d.bssetKey || d.bssetVal === undefined) return;
      const key = d.bssetKey as keyof Spitter8Pair, i = +d.bssetPair;
      const pairs: (Partial<Record<keyof Spitter8Pair, unknown>> | null)[] = Array.from({ length: pairsFor(n) }, () => null);
      pairs[i] = { [key]: wire(key, d.bssetVal) };
      // Light it now; the TAP's answer puts it right
      (this.flows.get(n)!.pairs[i] as any)[key] = wire(key, d.bssetVal);
      this.paint(root);
      void this.postFlow(n, { pairs });
    });
    // Keep in step with the TAP (another page may change it) while on screen
    window.clearInterval(this.timer);
    const tick = () => {
      if (!root.isConnected) return window.clearInterval(this.timer);
      if (root.offsetParent !== null) void this.refresh();
    };
    this.timer = window.setInterval(tick, 2000);
    tick();
  }

  private render(root: HTMLElement): void {
    const b = root.querySelector('.rc-bsset-panel .rc-bsset-body');
    if (b) b.innerHTML = this.body();
    this.paint(root);
  }

  private async call(path: string, body?: unknown): Promise<any> {
    try {
      const res = await fetch(TAP + path, body === undefined ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { this.tap = true; return await res.json(); }
      if (res.status === 404) this.tap = false;
    } catch {
      this.tap = false;
    }
    return null;
  }

  private takeFlow(s: any): void {
    if (s && typeof s.channel_count === 'number' && Array.isArray(s.pairs)) this.flows.set(s.channel_count, { active: !!s.active, pairs: s.pairs });
  }

  private takeTxs(d: any): void {
    for (const t of Array.isArray(d?.transmitters) ? d.transmitters : []) {
      const n = SPITTER_SIZES.find((k) => flowId(k) === t.flow_id);
      if (n) this.txs.set(n, { running: !!t.running, quality: t.quality ?? 'good', multicast_ip: t.multicast_ip, impairments: t.impairments, error: t.error });
    }
  }

  private async refresh(): Promise<void> {
    const [all, tx] = await Promise.all([this.call('/api/bitspitters'), this.call('/api/aes67')]);
    for (const s of Array.isArray(all?.spitters) ? all.spitters : []) this.takeFlow(s);
    this.takeTxs(tx);
    if (this.boundTo) this.paint(this.boundTo);
  }

  private async postFlow(n: number, body: unknown): Promise<void> {
    this.takeFlow(await this.call(`/api/bitspitter/${n}`, body));
    if (this.boundTo) this.paint(this.boundTo);
  }

  private async postTx(body: unknown): Promise<void> {
    this.takeTxs(await this.call('/api/aes67', body));
    if (this.boundTo) this.paint(this.boundTo);
  }

  paint(root: HTMLElement): void {
    const panel = root.querySelector('.rc-bsset-panel');
    if (!panel) return;
    const n = this.sel, f = this.flows.get(n)!, tx = this.txs.get(n)!, up = this.tap === true;
    // Tabs: selected, and glowing while that flow is on the wire
    panel.querySelectorAll<HTMLElement>('[data-bsset-size]').forEach((b) => {
      const k = +b.dataset.bssetSize!;
      b.classList.toggle('active', k === n);
      b.classList.toggle('live', up && !!this.flows.get(k)?.active && !!this.txs.get(k)?.running);
    });
    panel.querySelectorAll<HTMLElement>('[data-bsset-pair]').forEach((b) => {
      const p = f.pairs[+b.dataset.bssetPair!];
      b.classList.toggle('active', !!p && lit(b.dataset.bssetKey as keyof Spitter8Pair, b.dataset.bssetVal!, p));
    });
    panel.querySelectorAll('[data-bsset-row]').forEach((row) => row.classList.toggle('playing', up && f.active));
    panel.querySelectorAll<HTMLElement>('[data-bsset-q]').forEach((b) => b.classList.toggle('active', b.dataset.bssetQ === tx.quality));
    const btn = (act: string, on: boolean, yes: string, no: string) => {
      const b = panel.querySelector<HTMLButtonElement>(`[data-bsset-act="${act}"]`);
      if (!b) return;
      b.classList.toggle('active', up && on);
      b.disabled = this.tap === false;
      b.textContent = up && on ? `● ${yes}` : `○ ${no}`;
    };
    btn('active', f.active, 'ACTIVE', 'ACTIVATE');
    btn('tx', tx.running, 'ON AIR', 'TRANSMIT');
    // On the wire: where it goes and what the network did to it (only what happened)
    const w = panel.querySelector('#bssetWire');
    if (w) {
      const hits = IMPAIR_LABELS.map(([k, l]) => [tx.impairments?.[k] ?? 0, l] as const).filter(([v]) => v > 0).map(([v, l]) => `${v} ${l}`);
      w.textContent = up && tx.running ? [tx.multicast_ip, ...hits].filter(Boolean).join(' · ') : '';
    }
    const st = panel.querySelector('#bssetStatus');
    if (st) {
      st.textContent = this.tap === false ? 'needs the TAP' : tx.error ?? '';
      st.classList.toggle('warn', this.tap === false || !!tx.error);
    }
  }
}
