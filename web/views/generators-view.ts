/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * Generators view (footer tab "generators").
 * POD-33 AES DARS & precision tone generator, the CBC / Radio-Canada MXL
 * test pattern studio (shown in the host's MXL tab when a cbcHost is given), and the ABS-1 Audio Bit Spitter
 * (see bit-set-panel.ts).
 *
 * POD-33 and ABS-1 state lives in the Web Router (its CH 3 / CH 4 inputs
 * engage them), so these panels read and write it through the router.
 */

import type { GeneratorRouter } from '../host';
import { BitSetPanel } from './bit-set-panel';

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

          <div class="rc-pod-grid">
            <!-- Genlock Reference Clock -->
            <div class="rc-pod-col">
              <div class="rc-control-group-title">REFERENCE LOCK</div>
              <div class="rc-btn-group" role="group">
                <button type="button" class="rc-btn-sel ${r.pod33Config.refClock === 'video' ? 'active' : ''}" data-pod-ref="video">
                  <span class="rc-led-dot ${r.pod33Config.refClock === 'video' ? 'lit-green' : ''}"></span>
                  VIDEO
                </button>
                <button type="button" class="rc-btn-sel ${r.pod33Config.refClock === 'aes' ? 'active' : ''}" data-pod-ref="aes">
                  <span class="rc-led-dot ${r.pod33Config.refClock === 'aes' ? 'lit-green' : ''}"></span>
                  AES DARS
                </button>
                <button type="button" class="rc-btn-sel ${r.pod33Config.refClock === 'int48' ? 'active' : ''}" data-pod-ref="int48">
                  <span class="rc-led-dot ${r.pod33Config.refClock === 'int48' ? 'lit-green' : ''}"></span>
                  INT 48k
                </button>
                <button type="button" class="rc-btn-sel ${r.pod33Config.refClock === 'int96' ? 'active' : ''}" data-pod-ref="int96">
                  <span class="rc-led-dot ${r.pod33Config.refClock === 'int96' ? 'lit-green' : ''}"></span>
                  INT 96k
                </button>
              </div>
            </div>

          </div>

          <!-- The four rear AES outputs: each its own frequency, level and channel / phase -->
          <table class="rc-pod-outs" aria-label="POD-33 AES outputs">
            <thead><tr>
              <th></th>
              <th class="rc-control-group-title">CALIBRATED FREQUENCY</th>
              <th class="rc-control-group-title">CALIBRATED LEVEL (dBFS)</th>
              <th class="rc-control-group-title">CHANNEL &amp; PHASE</th>
            </tr></thead>
            <tbody>${[0, 1, 2, 3].map((n) => `
              <tr class="rc-pod-out" data-pod-row="${n}">
                <th scope="row" class="rc-pod-out-name">AES ${n + 1}</th>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} frequency">${([[100, '100 Hz'], [400, '400 Hz'], [1000, '1 kHz'], [0, 'Silence']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-freq="${v}">${l}</button>`).join('')}</div></td>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} level">${([[0, '0'], [-12, '-12'], [-14, '-14'], [-18, '-18 EBU'], [-20, '-20 SMPTE'], [-24, '-24'], [-40, '-40'], [-100, 'OFF']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-lvl="${v}">${l}</button>`).join('')}</div></td>
                <td><div class="rc-btn-group" role="group" aria-label="AES ${n + 1} channel">${([['stereo', 'Stereo'], ['left', 'Left'], ['right', 'Right'], ['invert', 'Ø 180°']] as const)
                  .map(([v, l]) => `<button type="button" class="rc-btn-sel" data-pod-out="${n}" data-pod-ch="${v}"${v === 'invert' ? ' title="Phase invert 180° on the right channel"' : ''}>${l}</button>`).join('')}</div></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- CBC / RADIO-CANADA MXL TEST GENERATOR & PATTERN STUDIO -->
        <div class="rc-cbc-studio-panel">
          <div class="rc-cbc-header">
            <div class="rc-cbc-title">
              <strong>CBC / RADIO-CANADA MXL TEST GENERATOR &amp; PATTERN STUDIO</strong>
            </div>
            <div class="rc-cbc-svcs" id="rcCbcSvcs">
              ${CBC_SERVICES.map(([k, label, port]) => `<a class="rc-cbc-svc" data-cbc-svc="${k}" href="http://localhost:${port}" target="_blank" rel="noopener" title="${label} (:${port})"><span class="rc-led-dot"></span>${label}</a>`).join('')}
              <button type="button" class="rc-power-btn" id="btnCbcPipeline" title="Start / stop the CBC test generator pipeline">○ START</button>
            </div>
          </div>

          <div class="rc-cbc-grid">
            <!-- Video Test Patterns -->
            <div class="rc-cbc-col">
              <div class="rc-cbc-label">VIDEO TEST PATTERN</div>
              <select id="rcCbcVideoSelect" class="rc-cbc-select"><option>—</option></select>
              <div class="rc-cbc-flow-info" id="rcCbcVideoFlow"></div>
            </div>

            <!-- Audio Test Patterns -->
            <div class="rc-cbc-col">
              <div class="rc-cbc-label">AUDIO TEST PATTERN</div>
              <select id="rcCbcAudioSelect" class="rc-cbc-select"><option>—</option></select>
              <div class="rc-cbc-flow-info" id="rcCbcAudioFlow"></div>
            </div>

            <!-- Calibrated Output Level -->
            <div class="rc-cbc-col">
              <div class="rc-cbc-label">OUTPUT LEVEL</div>
              <div class="rc-cbc-btn-group">
                <button type="button" class="rc-cbc-btn active" data-cbc-lvl="-20">-20 dBFS (EBU)</button>
                <button type="button" class="rc-cbc-btn" data-cbc-lvl="-18">-18 dBFS (0 VU)</button>
                <button type="button" class="rc-cbc-btn" data-cbc-lvl="-12">-12 dBFS</button>
                <button type="button" class="rc-cbc-btn" data-cbc-lvl="0">0 dBFS (Ceiling)</button>
              </div>
            </div>
          </div>
        </div>
${this.bitSet.html()}
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
      if (d.podFreq !== undefined) return setOut({ freq: +d.podFreq });
      if (d.podLvl !== undefined) return setOut({ levelDb: +d.podLvl });
      if (d.podCh !== undefined) return setOut({ channelMode: d.podCh });
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
    markOut('data-pod-freq', (v, o) => +v === o.freq);
    markOut('data-pod-lvl', (v, o) => +v === o.levelDb);
    markOut('data-pod-ch', (v, o) => v === o.channelMode);
    root.querySelectorAll('[data-pod-row]').forEach((row) =>
      row.classList.toggle('playing', r.pod33Engaged && +row.getAttribute('data-pod-row')! === (r.pod33Out ?? 0)));
    root.querySelectorAll('[data-pod-ref] .rc-led-dot').forEach((dot) =>
      dot.classList.toggle('lit-green', dot.parentElement?.getAttribute('data-pod-ref') === pc.refClock));
    this.bitSet.paint(root);
  }
}
