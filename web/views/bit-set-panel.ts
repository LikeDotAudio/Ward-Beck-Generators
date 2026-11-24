/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * ABS-1 Audio Bit Spitter, laid out like the POD-33 panel: a title bar with the power
 * button, then every control as a row of buttons.
 *
 * The ABS-1's own controls (abs1v103.asm PROCESS):
 *   AUDIO LEVEL OFF / -20 / -12 / 0 dBFS; SAMPLE RATE 48K / 44.1K / 32K / EXT;
 *   TONE 1KHz / 400Hz; CHB CYCLE / INVERT / OFF; INVALID sets the validity bit.
 *   CYCLE and INVERT clear B OFF; B OFF clears CYCLE and INVERT.
 *   EXT locks to an AES reference (here: POD-33 when it is running at 48 kHz).
 * Then the XTM extras the real unit does not have: test pattern, channel status
 * (professional / consumer) and audio / non-audio data.
 *
 * Settings can be made with the unit off; they apply when it is switched on.
 */

import type { GeneratorRouter } from '../host';

type Opt = readonly [string, string, string?];
interface Group { title: string; attr: string; opts: readonly Opt[] }

/** The ABS-1 front panel, left to right. */
const PANEL: Group[] = [
  { title: 'AUDIO LEVEL (dBFS)', attr: 'bs-lvl', opts: [['0', '0'], ['-12', '-12'], ['-20', '-20'], ['off', 'OFF']] },
  { title: 'TONE', attr: 'bs-tone', opts: [['1000', '1 kHz'], ['400', '400 Hz']] },
  { title: 'SAMPLE RATE', attr: 'bs-rate', opts: [['48000', '48 kHz'], ['44100', '44.1 kHz'], ['32000', '32 kHz'], ['ext', 'EXT', 'Lock to an AES reference: the POD-33 running at 48 kHz']] },
  { title: 'CHANNEL B', attr: 'bs-chb', opts: [['cycle', 'Cycle', 'Channel B on / off every half second'], ['invert', 'Ø 180°', 'Channel B out of phase'], ['off', 'Off', 'Channel B muted']] },
  { title: 'VALIDITY', attr: 'bs-valid', opts: [['valid', 'Valid'], ['invalid', 'Invalid', 'Sets the validity bit on the AES stream']] },
];
/** XTM extras: not on the real unit. */
const EXTRAS: Group[] = [
  { title: 'TEST PATTERN', attr: 'abb-pat', opts: [['tone', 'Tone'], ['walk1s', 'Walking 1s'], ['prbs', 'PRBS-15'], ['minmax', 'Min/Max']] },
  { title: 'CHANNEL STATUS', attr: 'abb-pro', opts: [['pro', 'Professional'], ['cons', 'Consumer']] },
  { title: 'DATA', attr: 'abb-data', opts: [['audio', 'Audio'], ['data', 'Non-audio']] },
];

const group = (g: Group) => `
  <div class="rc-bs-group">
    <div class="rc-control-group-title">${g.title}</div>
    <div class="rc-btn-group" role="group" aria-label="${g.title}">${g.opts
      .map(([v, l, t]) => `<button type="button" class="rc-btn-sel" data-${g.attr}="${v}"${t ? ` title="${t}"` : ''}>${l}</button>`).join('')}</div>
  </div>`;

export class BitSetPanel {
  private boundTo?: HTMLElement;

  constructor(private router: GeneratorRouter) {}

  html(): string {
    return `
      <div class="rc-pod-panel rc-bs-panel wbs-bitset">
        <div class="rc-panel-title">
          <div class="rc-panel-title-left"><strong>WBS ABS-1 AUDIO BIT SPITTER</strong></div>
          <button type="button" id="btnToggleBitSpitter" class="rc-power-btn">○ ACTIVATE BIT SPITTER</button>
        </div>
        <div class="rc-bs-grid">${PANEL.map(group).join('')}</div>
        <div class="rc-bs-grid rc-bs-extras" title="XTM extras: not on the real unit">${EXTRAS.map(group).join('')}</div>
        <div class="rc-bs-status" id="bsStatus"></div>
      </div>`;
  }

  bind(root: HTMLElement): void {
    if (this.boundTo === root) return;
    this.boundTo = root;
    root.addEventListener('click', (e) => {
      const t = (e.target as Element).closest('button');
      if (!t || !t.closest('.rc-bs-panel')) return;
      this.press(t);
      this.paint(root);
    });
  }

  private press(t: HTMLElement): void {
    const r = this.router, b = r.bitBuddyConfig, d = t.dataset;
    if (t.id === 'btnToggleBitSpitter') return r.setBitBuddy(!r.bitBuddyEngaged);
    if (d.bsLvl !== undefined) return r.setBitBuddyConfig({ level: d.bsLvl === 'off' ? null : (+d.bsLvl as 0 | -12 | -20) });
    if (d.bsTone !== undefined) return r.setBitBuddyConfig({ tone: +d.bsTone as 1000 | 400 });
    if (d.bsRate !== undefined) {
      return d.bsRate === 'ext' ? r.setBitBuddyConfig({ ext: true }) : r.setBitBuddyConfig({ ext: false, sampleRate: +d.bsRate as 48000 | 44100 | 32000 });
    }
    if (d.bsChb === 'cycle') return r.setBitBuddyConfig({ cycle: !b.cycle, bOff: false });
    if (d.bsChb === 'invert') return r.setBitBuddyConfig({ invert: !b.invert, bOff: false });
    if (d.bsChb === 'off') return r.setBitBuddyConfig(b.bOff ? { bOff: false } : { bOff: true, cycle: false, invert: false });
    if (d.bsValid !== undefined) return r.setBitBuddyConfig({ invalid: d.bsValid === 'invalid' });
    if (d.abbPat !== undefined) return r.setBitBuddyConfig({ pattern: d.abbPat as any });
    if (d.abbPro !== undefined) return r.setBitBuddyConfig({ proMode: d.abbPro === 'pro' });
    if (d.abbData !== undefined) return r.setBitBuddyConfig({ audioData: d.abbData as any });
  }

  paint(root: HTMLElement): void {
    const r = this.router, b = r.bitBuddyConfig, on = r.bitBuddyEngaged;
    const mark = (attr: string, lit: (v: string) => boolean) =>
      root.querySelectorAll(`.rc-bs-panel [data-${attr}]`).forEach((el) => el.classList.toggle('active', lit(el.getAttribute(`data-${attr}`)!)));
    mark('bs-lvl', (v) => (v === 'off' ? b.level === null : +v === b.level));
    mark('bs-tone', (v) => +v === b.tone);
    mark('bs-rate', (v) => (v === 'ext' ? b.ext : !b.ext && +v === b.sampleRate));
    mark('bs-chb', (v) => (v === 'cycle' ? b.cycle : v === 'invert' ? b.invert : b.bOff));
    mark('bs-valid', (v) => (v === 'invalid') === b.invalid);
    mark('abb-pat', (v) => v === b.pattern);
    mark('abb-pro', (v) => (v === 'pro') === b.proMode);
    mark('abb-data', (v) => v === b.audioData);

    const pwr = root.querySelector('#btnToggleBitSpitter');
    if (pwr) {
      pwr.classList.toggle('active', on);
      pwr.textContent = on ? '● BIT SPITTER ACTIVE' : '○ ACTIVATE BIT SPITTER';
    }
    // One line: what is on the AES output (or why nothing is)
    const st = root.querySelector('#bsStatus');
    if (st) {
      const extLock = b.ext && r.extRefLocked;
      const chB = b.bOff ? 'B off' : [b.invert && 'B Ø 180°', b.cycle && 'B cycling'].filter(Boolean).join(', ') || 'A + B';
      const sig = b.pattern !== 'tone' ? b.pattern.toUpperCase()
        : `${b.tone === 1000 ? '1 kHz' : '400 Hz'} @ ${b.level === null ? 'OFF' : `${b.level} dBFS`}`;
      st.textContent = !on ? ''
        : b.ext && !extLock ? 'EXT: no AES reference, output muted. Start the POD-33 at 48 kHz to lock.'
        : `AES OUT ${b.ext ? 48 : b.sampleRate / 1000} kHz${extLock ? ' (locked to POD-33)' : ''} · ${sig} · ${chB}${b.invalid ? ' · V = 1' : ''}`;
      st.classList.toggle('warn', on && b.ext && !extLock);
    }
  }
}
