/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/**
 * What the generators need from the app that hosts them. Nothing here imports the
 * host: XTM's audio engine and Web Router satisfy these shapes structurally, and the
 * host hands over its audio-graph and autoplay helpers once with configureGenerators().
 */
import type { Pod33Config, BitBuddyConfig } from './sources/pod33-generator';

/** The audio engine fields the browser generators read and write. */
export interface GeneratorEngine {
  ctx: AudioContext | null;
  sourceType: string;
  testType: string;
  testOsc: OscillatorNode | AudioBufferSourceNode | null;
  testGain: GainNode | null;
  toneCalDb: number;
  sweepTimer: any;
  onStatusChange: ((status: any) => void) | null;
  /** A live MXL flow feed; a generator replaces it (they cannot mix). */
  mxlFeed?: { stop(): void } | null;
  setupAudioGraph(sourceObj: any, isDirectNode?: boolean): void;
  stopCurrentSource(): void;
}

/** The router state the generators tab drives (XTM: the Web Router owns it). */
export interface GeneratorRouter {
  pod33Config: Pod33Config;
  /** The four rear AES outputs, each its own frequency / level / channel (optional for older hosts). */
  pod33Outputs?: Pick<Pod33Config, 'freq' | 'levelDb' | 'channelMode'>[];
  /** Which output is playing. */
  pod33Out?: number;
  setPod33Output?(n: number, patch: Partial<Pick<Pod33Config, 'freq' | 'levelDb' | 'channelMode'>>): void;
  pod33Engaged: boolean;
  bitBuddyConfig: BitBuddyConfig;
  bitBuddyEngaged: boolean;
  readonly extRefLocked: boolean;
  onChange(cb: (router: any) => void): () => void;
  setPod33(on: boolean): void;
  setPod33Config(patch: Partial<Pod33Config>): void;
  setBitBuddy(on: boolean): void;
  setBitBuddyConfig(patch: Partial<BitBuddyConfig>): void;
}

export interface GeneratorHooks {
  /** Build (once) and return the host's summing bus that generators feed. */
  ensureAudioGraph(engine: GeneratorEngine): GainNode | null;
  /** Resume a suspended AudioContext within the browser's autoplay rules. */
  resumeAudio(ctx: AudioContext | null | undefined): void;
}

export const hooks: GeneratorHooks = {
  ensureAudioGraph: () => null,
  resumeAudio: (ctx) => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
};

/** Called once by the host before any generator starts. */
export function configureGenerators(h: Partial<GeneratorHooks>): void {
  Object.assign(hooks, h);
}
