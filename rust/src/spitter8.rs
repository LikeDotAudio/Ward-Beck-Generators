// Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved.
//! ABS-1 ×4 Bit Spitter, 8 channels: four ABS-1 pairs side by side, one per AES pair
//! (AES 1/2, 3/4, 5/6, 7/8). Each pair is its own `SpitterSynth` with its own source,
//! level, tone, channel B and line fault. The browser runs the same thing
//! (web/sources/spitter8-synth.ts): keep the two in step.

use crate::spitter::{SpitterParams, SpitterSynth};

/// AES pairs on the 8-channel spitter.
pub const PAIRS: usize = 4;
/// Channels out (two per pair).
pub const CHANNELS: usize = 2 * PAIRS;

/// One pair's front-panel settings, as the panel and the TAP's API send them.
#[derive(Clone, Debug, PartialEq)]
pub struct Pair8 {
    /// sweep | tone | pink | white | brown | walk1s | prbs | minmax
    pub pattern: String,
    /// dBFS; None = OFF
    pub level_db: Option<f64>,
    pub tone_hz: f64,
    /// same | cycle | invert | off
    pub ch_b: String,
    /// clean | noise | badeq | jitter | drop | slip | biphase | noclock
    pub fault: String,
}

impl Default for Pair8 {
    fn default() -> Self {
        let p = SpitterParams::default();
        Pair8 { pattern: p.pattern, level_db: p.level, tone_hz: p.tone, ch_b: "same".into(), fault: p.fault }
    }
}

impl Pair8 {
    /// The `SpitterParams` this pair plays.
    pub fn params(&self) -> SpitterParams {
        SpitterParams {
            pattern: self.pattern.clone(),
            level: self.level_db,
            tone: self.tone_hz,
            cycle: self.ch_b == "cycle",
            invert: self.ch_b == "invert",
            b_off: self.ch_b == "off",
            fault: self.fault.clone(),
            ..Default::default()
        }
    }
}

pub struct Spitter8 {
    sr: f64,
    pairs: Vec<SpitterSynth>,
}

impl Spitter8 {
    pub fn new(pairs: &[Pair8; PAIRS], sample_rate: f64) -> Self {
        Spitter8 { sr: sample_rate, pairs: pairs.iter().map(|p| SpitterSynth::new(p.params(), sample_rate)).collect() }
    }

    /// New settings for pair `i` (0..4): that pair starts over, the others play on.
    pub fn set_pair(&mut self, i: usize, p: &Pair8) {
        if i < PAIRS {
            self.pairs[i] = SpitterSynth::new(p.params(), self.sr);
        }
    }

    /// One 8-channel frame: [AES1 A, AES1 B, AES2 A, AES2 B, ...].
    pub fn next(&mut self) -> [f64; CHANNELS] {
        let mut out = [0.0; CHANNELS];
        for (i, s) in self.pairs.iter_mut().enumerate() {
            let (a, b) = s.next();
            out[2 * i] = a;
            out[2 * i + 1] = b;
        }
        out
    }

    /// `n` frames, planar: one Vec per channel.
    pub fn fill(&mut self, out: &mut [Vec<f64>; CHANNELS], n: usize) {
        for ch in out.iter_mut() {
            ch.resize(n, 0.0);
        }
        for k in 0..n {
            let f = self.next();
            for (c, v) in f.iter().enumerate() {
                out[c][k] = *v;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(pattern: &str, level: Option<f64>, ch_b: &str, fault: &str) -> Pair8 {
        Pair8 { pattern: pattern.into(), level_db: level, tone_hz: 1000.0, ch_b: ch_b.into(), fault: fault.into() }
    }

    #[test]
    fn each_pair_is_its_own_spitter() {
        let pairs = [
            pair("tone", Some(-20.0), "invert", "clean"),
            pair("tone", Some(0.0), "off", "clean"),
            pair("tone", None, "same", "clean"),
            pair("prbs", Some(-20.0), "same", "noclock"),
        ];
        let mut s = Spitter8::new(&pairs, 48000.0);
        let out: Vec<[f64; 8]> = (0..4800).map(|_| s.next()).collect();
        let peak = |c: usize| out.iter().map(|f| f[c].abs()).fold(0.0, f64::max);
        assert!((peak(0) - 0.1).abs() < 0.002, "AES 1 A at -20 dBFS: {}", peak(0));
        assert!(out.iter().all(|f| (f[0] + f[1]).abs() < 1e-12), "AES 1 B inverted");
        assert!((peak(2) - 1.0).abs() < 0.002, "AES 2 A at 0 dBFS: {}", peak(2));
        assert_eq!(peak(3), 0.0, "AES 2 B off");
        assert_eq!(peak(4) + peak(5), 0.0, "AES 3 level OFF");
        assert_eq!(peak(6) + peak(7), 0.0, "AES 4 no clock");
    }

    #[test]
    fn a_pair_matches_the_stereo_spitter() {
        let p = pair("pink", Some(-12.0), "cycle", "badeq");
        let mut s8 = Spitter8::new(&[Pair8::default(), Pair8::default(), p.clone(), Pair8::default()], 48000.0);
        let mut s2 = SpitterSynth::new(p.params(), 48000.0);
        for _ in 0..48000 {
            let f = s8.next();
            assert_eq!((f[4], f[5]), s2.next());
        }
    }

    #[test]
    fn set_pair_and_fill() {
        let prbs = pair("prbs", Some(-20.0), "same", "clean");
        let mut s = Spitter8::new(&[prbs.clone(), prbs.clone(), prbs.clone(), prbs], 48000.0);
        s.set_pair(1, &pair("minmax", Some(0.0), "same", "clean"));
        s.set_pair(9, &pair("minmax", Some(0.0), "same", "clean")); // out of range: ignored
        let mut out: [Vec<f64>; 8] = Default::default();
        s.fill(&mut out, 256);
        assert!(out.iter().all(|c| c.len() == 256));
        assert!(out[2].iter().all(|v| v.abs() == 0.95) && out[3] == out[2]);
        assert!(out[0].iter().all(|v| v.abs() == 0.35), "PRBS on AES 1");
    }
}
