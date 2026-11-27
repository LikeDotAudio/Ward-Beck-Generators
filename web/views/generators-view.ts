/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * Generators view (footer tab "generators").
 * POD-33 AES DARS & precision tone generator, the CBC / Radio-Canada MXL
 * test pattern studio (shown in the host's MXL tab when a cbcHost is given), and the ABS-1 Audio Bit Spitter
 * (see bit-set-panel.ts), then the Bit Spitter set: its 1, 2, 4, 8 and 16-channel flows and their AES67 transmitters (bit-spitter-set-panel.ts, TAP only).
 *
 * POD-33 and ABS-1 state lives in the Web Router (its CH 3 / CH 4 inputs
 * engage them), so these panels read and write it through the router.
 */

import type { GeneratorRouter } from '../host';
import { BitSetPanel } from './bit-set-panel';
import { BitSpitterSetPanel } from './bit-spitter-set-panel';

const DAEMON = 'http://localhost:8467';

/** CBC / Radio-Canada MXL test containers, reached through the daemon (/api/cbc/*). */
const CBC_SERVICES: [string, string, number][] = [
  ['generator', 'Generator', 9600], ['player', 'File Player', 9602], ['webrtc', 'WebRTC', 9601], ['info', 'MXL Info', 9699],
];

interface CbcStatus {
  online?: boolean;
  running?: boolean;
  services?: Record<string, { label?: string; port?: number; url?: string; up?: boolean }>;
  patterns?: { video?: string[]; audio?: string[] };
  video_pattern?: string;
  audio_pattern?: string;
  level_db?: number;
  resolution?: string;
  framerate?: string;
  flows?: Record<string, string>;
}

export class GeneratorsView {
  private unsubscribe?: () => void;
  private bitSet: BitSetPanel;
  private bitSet8 = new BitSpitterSetPanel();
  private cbc: CbcStatus = {};
  private cbcTimer = 0;
  private cbcBusy = false;

  /** Where the CBC panel lives: the host's MXL tab when given, else this view. */
  private cbcRoot: HTMLElement;

  constructor(private container: HTMLElement, private router: GeneratorRouter, private cbcHost?: HTMLElement | null) {
    this.bitSet = new BitSetPanel(router);
    this.cbcRoot = container;
  }

  build(): void {
    this.container.innerHTML = this.renderHtml();
    const cbcPanel = this.container.querySelector('.rc-cbc-studio-panel');
    if (this.cbcHost && cbcPanel) {
      this.cbcHost.replaceChildren(cbcPanel);
      this.cbcRoot = this.cbcHost;
    }
    this.attachEvents();
    this.bitSet.bind(this.container);
    this.bitSet8.bind(this.container);
    this.startCbcPolling();
    this.unsubscribe?.();
    this.unsubscribe = this.router.onChange(() => this.refresh());
    this.refresh();
  }

  private renderHtml(): string {
    const r = this.router;
    return `
      <div class="routing-console-rack">
        <div class="routing-aux-panels">
        <!-- POD-33 REFERENCE TONE GENERATOR -->
        <div class="rc-pod-panel">
          <div class="rc-panel-title">
            <div class="rc-panel-title-left">
              <strong>WBS POD-33 AES DARS &amp; PRECISION TONE GENERATOR</strong>
            </div>
            <button type="button" id="btnTogglePod33" class="rc-power-btn ${r.pod33Engaged ? 'active' : ''}">
              ${r.pod33Engaged ? '● POD-33 ACTIVE' : '○ ACTIVATE POD-33'}
            </button>
          </div>

          <!-- The four rear AES outputs: each its own frequency, level and channel / phase -->
          <table class="rc-pod-outs" aria-label="POD-33 AES outputs">
            <thead><tr>
              <th></th>
              <th class="rc-control-group-title">CALIBRATED FREQUENCY</th>
              <th class="rc-control-group-title">CALIBRATED LEVEL (dBFS)</th>
              <th class="rc-control-group-title">CHANNEL &amp; PHASE</th>
              <th class="rc-control-group-title">BEEP</th>
            </tr></thead>
            <tbody>${[0, 1, 2, 3].map((n) => `
              <tr class="rc-pod-out" data-pod-row="${n}">
                <th scope="row" class="rc-pod-out-name">AES ${n + 1}</th>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} frequency">${([[100, '100 Hz'], [400, '400 Hz'], [1000, '1 kHz'], ['100/400', '100/400'], ['1000/4000', '1k/4k'], ['10000/20000', '10k/20k'], [0, 'Silence']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-freq="${v}"${String(v).includes('/') ? ` title="Split: left ${l.split('/')[0]}, right ${l.split('/')[1]}"` : ''}>${l}</button>`).join('')}</div></td>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} level">${([[0, '0'], [-12, '-12'], [-14, '-14'], [-18, '-18 EBU'], [-20, '-20 SMPTE'], [-24, '-24'], [-40, '-40'], [-100, 'OFF']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-lvl="${v}">${l}</button>`).join('')}</div></td>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} channel">${([['stereo', 'Stereo'], ['left', 'Left'], ['right', 'Right'], ['invert', 'Ø 180°']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-ch="${v}"${v === 'invert' ? ' title="Phase invert 180° on the right channel"' : ''}>${l}</button>`).join('')}</div></td>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} beep">${([[0, 'Off'], [1, '1/1'], [2, '1/2'], [3, '1/3'], [4, '1/4']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-beep="${v}" title="${v ? `A beep every ${l} s` : 'Steady tone'}">${l}</button>`).join('')}<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-beepl="1" title="Beep the left channel only (stereo ident)">L only</button></div></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- CBC / RADIO-CANADA MXL TEST GENERATOR & PATTERN STUDIO -->
        <div class="rc-cbc-studio-panel">
          <div class="rc-cbc-header">
            <div class="rc-cbc-title">
              <a href="${DAEMON}/CBC" target="_blank" rel="noopener" title="Every CBC / Radio-Canada test tool on one page (patterns, level, flows, Generator, WebRTC, File Player, MXL Info): the TAP's /CBC, driven by /api/cbc"><strong>CBC / RADIO-CANADA MXL TEST TOOLS ↗</strong></a>
            </div>
            <div class="rc-cbc-svcs" id="rcCbcSvcs">
              ${CBC_SERVICES.map(([k, label, port]) => `<a class="rc-cbc-svc" data-cbc-svc="${k}" href="http://localhost:${port}" target="_blank" rel="noopener" title="${label} (:${port})"><span class="rc-led-dot"></span>${label}</a>`).join('')}
              <button type="button" class="rc-power-btn" id="btnCbcPipeline" title="Start / stop the CBC test generator pipeline">○ START</button>
            </div>
          </div>

        </div>
${this.bitSet.html()}
${this.bitSet8.html()}
        </div>
      </div>
    `;
  }

  private post(path: string, body: unknown): void {
    fetch(`${DAEMON}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  private attachEvents(): void {
    const r = this.router;
    const roots = this.cbcRoot === this.container ? [this.container] : [this.container, this.cbcRoot];

    const onClick = (root: HTMLElement) => (e: Event) => {
      const t = (e.target as HTMLElement).closest('button');
      if (!t || !root.contains(t)) return;
      const d = t.dataset;
      if (t.id === 'btnTogglePod33') return r.setPod33(!r.pod33Engaged);
      if (t.id === 'btnCbcPipeline') return this.toggleCbcPipeline();
      if (d.podRef !== undefined) return r.setPod33Config({ refClock: d.podRef as any });
      const out = d.podOut !== undefined ? +d.podOut : r.pod33Out ?? 0;
      const setOut = (patch: any) => (r.setPod33Output ? r.setPod33Output(out, patch) : r.setPod33Config(patch));
      if (d.podFreq !== undefined) {
        const [fl, fr] = d.podFreq.split('/').map(Number);
        return setOut({ freq: fl, freqR: fr ?? null });
      }
      if (d.podLvl !== undefined) return setOut({ levelDb: +d.podLvl });
      if (d.podCh !== undefined) return setOut({ channelMode: d.podCh });
      if (d.podBeep !== undefined) return setOut({ beep: +d.podBeep });
      if (d.podBeepl !== undefined) return setOut({ beepLeft: !(r.pod33Outputs?.[out] as any)?.beepLeft });
      if (d.cbcLvl !== undefined) {
        const lvl = parseFloat(d.cbcLvl);
        this.cbcRoot.querySelectorAll('[data-cbc-lvl]').forEach((b) => b.classList.toggle('active', b === t));
        this.post('/api/cbc/audio_level', { level_db: lvl });
      }
    };
    roots.forEach((root) => root.addEventListener('click', onClick(root)));

    const onPattern = (target: 'video' | 'audio') => (e: Event) =>
      this.post('/api/cbc/pattern', { target, pattern: (e.target as HTMLSelectElement).value });
    this.cbcRoot.querySelector('#rcCbcVideoSelect')?.addEventListener('change', onPattern('video'));
    this.cbcRoot.querySelector('#rcCbcAudioSelect')?.addEventListener('change', onPattern('audio'));
  }

  /* ---------------- CBC / Radio-Canada MXL test generators ---------------- */

  /** Poll /api/cbc/status every 2.5 s while the CBC panel is on screen. */
  private startCbcPolling(): void {
    window.clearInterval(this.cbcTimer);
    const tick = () => {
      if (!this.cbcRoot.isConnected) return window.clearInterval(this.cbcTimer);
      if (this.cbcRoot.offsetParent !== null) this.pollCbc();
    };
    this.cbcTimer = window.setInterval(tick, 2500);
    tick();
  }

  private async pollCbc(): Promise<void> {
    try {
      const res = await fetch(`${DAEMON}/api/cbc/status`, { cache: 'no-store' });
      this.cbc = res.ok ? await res.json() : {};
    } catch {
      this.cbc = {}; // daemon not running
    }
    this.paintCbc();
  }

  private async toggleCbcPipeline(): Promise<void> {
    if (this.cbcBusy) return;
    this.cbcBusy = true;
    this.paintCbc();
    try {
      await fetch(`${DAEMON}/api/cbc/pipeline/${this.cbc.running ? 'stop' : 'start'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
    } catch { /* daemon offline: paint shows it */ }
    this.cbcBusy = false;
    await this.pollCbc();
  }

  private paintCbc(): void {
    const root = this.cbcRoot, st = this.cbc;
    const daemon = st.online !== undefined;
    CBC_SERVICES.forEach(([k, label, port]) => {
      const a = root.querySelector<HTMLAnchorElement>(`[data-cbc-svc="${k}"]`);
      if (!a) return;
      const svc = st.services?.[k];
      const up = svc ? !!svc.up : k === 'generator' && !!st.online;
      a.classList.toggle('up', up);
      a.querySelector('.rc-led-dot')?.classList.toggle('lit-green', up);
      if (svc?.url) a.href = svc.url;
      a.title = `${svc?.label ?? label} (:${svc?.port ?? port}) — ${!daemon ? 'daemon offline' : up ? 'up' : 'down'}`;
    });
    const btn = root.querySelector<HTMLButtonElement>('#btnCbcPipeline');
    if (btn) {
      btn.disabled = !st.online || this.cbcBusy;
      btn.classList.toggle('active', !!st.running);
      btn.textContent = this.cbcBusy ? '… WAIT' : st.running ? '● RUNNING' : '○ START';
      btn.title = !daemon ? 'Daemon offline (localhost:8467)' : !st.online ? 'Generator container (:9600) not reachable'
        : st.running ? 'Stop the CBC test generator pipeline' : 'Start the CBC test generator pipeline';
    }
    const fill = (id: string, list: string[] | undefined, cur: string | undefined) => {
      const sel = root.querySelector<HTMLSelectElement>(`#${id}`);
      if (!sel || !list?.length || document.activeElement === sel) return;
      const key = list.join('|');
      if (sel.dataset.key !== key) {
        sel.innerHTML = list.map((p) => `<option value="${p.replace(/"/g, '&quot;')}">${p}</option>`).join('');
        sel.dataset.key = key;
      }
      if (cur && list.includes(cur)) sel.value = cur;
    };
    fill('rcCbcVideoSelect', st.patterns?.video, st.video_pattern);
    fill('rcCbcAudioSelect', st.patterns?.audio, st.audio_pattern);
    const flows = st.flows ?? {};
    const short = (u?: string) => (u ? u.slice(0, 8) + '…' : '');
    const vid = root.querySelector('#rcCbcVideoFlow');
    if (vid) {
      vid.textContent = flows.video ? `${short(flows.video)} · ${st.resolution ?? ''} @ ${st.framerate ?? ''}` : '';
      (vid as HTMLElement).title = flows.video ?? '';
    }
    const aud = root.querySelector('#rcCbcAudioFlow');
    if (aud) {
      const ids = ['audio1', 'audio2'].filter((k) => flows[k]);
      aud.textContent = ids.map((k) => short(flows[k])).join(' · ');
      (aud as HTMLElement).title = ids.map((k) => `${k}: ${flows[k]}`).join('\n');
    }
    if (typeof st.level_db === 'number') {
      root.querySelectorAll('[data-cbc-lvl]').forEach((b) =>
        b.classList.toggle('active', Math.abs(+b.getAttribute('data-cbc-lvl')! - st.level_db!) < 0.05));
    }
  }

  /** Mirror router generator state onto buttons and LEDs. */
  private refresh(): void {
    const root = this.container;
    const r = this.router;
    const pc = r.pod33Config;

    const pod = root.querySelector('#btnTogglePod33');
    if (pod) {
      pod.classList.toggle('active', r.pod33Engaged);
      pod.textContent = r.pod33Engaged ? '● POD-33 ACTIVE' : '○ ACTIVATE POD-33';
    }
    const mark = (attr: string, match: (v: string) => boolean) =>
      root.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.toggle('active', match(b.getAttribute(attr)!)));
    mark('data-pod-ref', (v) => v === pc.refClock);
    // Each AES output's own buttons light from its own settings
    const outOf = (b: Element) => r.pod33Outputs?.[+(b.getAttribute('data-pod-out') ?? r.pod33Out ?? 0)] ?? pc;
    const markOut = (attr: string, match: (v: string, o: { freq: number; levelDb: number; channelMode: string }) => boolean) =>
      root.querySelectorAll(`[${attr}]`).forEach((b) => b.classList.toggle('active', match(b.getAttribute(attr)!, outOf(b))));
    markOut('data-pod-freq', (v, o) => {
      const [fl, fr] = v.split('/').map(Number);
      return fl === o.freq && (fr ?? null) === ((o as any).freqR ?? null);
    });
    markOut('data-pod-lvl', (v, o) => +v === o.levelDb);
    markOut('data-pod-ch', (v, o) => v === o.channelMode);
    markOut('data-pod-beep', (v, o) => +v === ((o as any).beep ?? 0));
    markOut('data-pod-beepl', (_v, o) => !!(o as any).beepLeft);
    root.querySelectorAll('[data-pod-row]').forEach((row) =>
      row.classList.toggle('playing', r.pod33Engaged && +row.getAttribute('data-pod-row')! === (r.pod33Out ?? 0)));
    root.querySelectorAll('[data-pod-ref] .rc-led-dot').forEach((dot) =>
      dot.classList.toggle('lit-green', dot.parentElement?.getAttribute('data-pod-ref') === pc.refClock));
    this.bitSet.paint(root);
    this.bitSet8.paint(root);
  }
}
