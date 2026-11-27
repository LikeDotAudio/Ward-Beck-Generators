/*! Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved. */
/** Ward-Beck Generators, browser side: POD-33, ABB-1 / ABP-1, test tones and the generators tab. */
export { configureGenerators, hooks } from './host';
export type { GeneratorEngine, GeneratorRouter, GeneratorHooks } from './host';
export * as testGen from './sources/test-generator';
export * as pod33Gen from './sources/pod33-generator';
export type { Pod33Config, BitBuddyConfig } from './sources/pod33-generator';
export { DEFAULT_POD33_CONFIG, DEFAULT_BITBUDDY_CONFIG } from './sources/pod33-generator';
export { GeneratorsView } from './views/generators-view';
export { BitSetPanel } from './views/bit-set-panel';
export { BitSpitterSetPanel, SPITTER_SIZES } from './views/bit-spitter-set-panel';
