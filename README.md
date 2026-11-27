# Ward-Beck Generators

Every Ward-Beck test-signal generator in one place, shared by the XTM meters and the
Ward-Beck Audio Tap daemon.

| Generator | Browser (`web/`) | Daemon (`rust/`) |
|---|---|---|
| POD-33 precision tone (100 Hz / 400 Hz / 1 kHz, 0 VU = -18 dBFS) | `sources/pod33-generator.ts` | `Tone` |
| ABB-1 Bit Buddy / ABP-1 Bit Spitter (walking 1s, PRBS-15, polarity) | `sources/pod33-generator.ts`, `views/bit-set-panel.ts` | `WalkingOnes`, `bitbuddy` grain |
| ABS-1 Bit Spitter set: 1, 2, 4, 8, 16-channel flows, a source / level / tone / channel B / line fault per AES pair (the TAP plays them, each on its own AES67 transmitter, flow GOOD / BAD / UGLY) | `views/bit-spitter-set-panel.ts`, `sources/spitter8-synth.ts` | `spitter8::SpitterBank` (`SIZES`) |
| Test tones: sine, pink noise, 20 Hz–20 kHz sweep | `sources/test-generator.ts`, `dsp/` | `synthesize_test_signal_buffer` |
| Generators tab (front panels) | `views/generators-view.ts`, `generators-bitset.css` | — |

## Browser

```ts
import { configureGenerators, pod33Gen, testGen, GeneratorsView } from './Generators/web';
configureGenerators({ ensureAudioGraph, resumeAudio });   // once, from the host
```

The generators import nothing from their host. The host's audio engine and router fit
the `GeneratorEngine` / `GeneratorRouter` shapes in `web/host.ts`.

## Daemon

```toml
[dependencies]
wbs-generators = { path = "Generators/rust" }
```

## Used by

- [XTM.WBSps.ca](https://xtm.wbsps.ca): submodule `Generators/`
- [Ward-Beck Audio Tap](https://github.com/WardBeckSystems/Ward-Beck-Audio-Tap): submodule `Generators/`

Copyright © 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved.
