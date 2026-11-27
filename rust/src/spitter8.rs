// Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved.
//! ABS-1 ×4 Bit Spitter, 8 channels: four ABS-1 pairs side by side, one per AES pair
//! (AES 1/2, 3/4, 5/6, 7/8). Each pair is its own `SpitterSynth` with its own source,
//! level, tone, channel B and line fault. The browser runs the same thing
//! (web/sources/spitter8-synth.ts): keep the two in step. `SpitterBank` is the same at
//! any width: the Bit Spitter's 1, 2, 4, 8 and 16-channel flows (`SIZES`).

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

/// The flow sizes the Bit Spitter transmits: 1, 2, 4, 8 and 16 channels.
pub const SIZES: [usize; 5] = [1, 2, 4, 8, 16];

/// AES pairs a `channels`-channel spitter needs (a 1-channel flow is one pair, channel A only).
pub fn pairs_for(channels: usize) -> usize {
    channels.div_ceil(2).max(1)
}

/// A Bit Spitter of any width: `pairs_for(channels)` ABS-1 pairs side by side, one per
/// AES pair, each its own `SpitterSynth` (source, level, tone, channel B, line fault).
pub struct SpitterBank {
    sr: f64,
    channels: usize,
    pairs: Vec<SpitterSynth>,
}

impl SpitterBank {
    /// `pairs` may be shorter than the bank: the rest play `Pair8::default()`.
    pub fn new(pairs: &[Pair8], channels: usize, sample_rate: f64) -> Self {
        let channels = channels.max(1);
        let d = Pair8::default();
        SpitterBank {
            sr: sample_rate,
            channels,
            pairs: (0..pairs_for(channels)).map(|i| SpitterSynth::new(pairs.get(i).unwrap_or(&d).params(), sample_rate)).collect(),
        }
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn pair_count(&self) -> usize {
        self.pairs.len()
    }

    /// New settings for pair `i`: that pair starts over, the others play on.
    pub fn set_pair(&mut self, i: usize, p: &Pair8) {
        if i < self.pairs.len() {
            self.pairs[i] = SpitterSynth::new(p.params(), self.sr);
        }
    }

    /// One frame into `out` (`channels` long): [AES1 A, AES1 B, AES2 A, AES2 B, ...].
    pub fn next_into(&mut self, out: &mut [f64]) {
        for (i, s) in self.pairs.iter_mut().enumerate() {
            let (a, b) = s.next();
            if let Some(o) = out.get_mut(2 * i) {
                *o = a;
            }
            if let Some(o) = out.get_mut(2 * i + 1) {
                *o = b;
            }
        }
    }

    /// `n` frames, planar: one Vec per channel (`out` is resized to the bank's channels).
    pub fn fill(&mut self, out: &mut Vec<Vec<f64>>, n: usize) {
        out.resize(self.channels, Vec::new());
        for ch in out.iter_mut() {
            ch.resize(n, 0.0);
        }
        let mut f = vec![0.0; self.channels];
        for k in 0..n {
            self.next_into(&mut f);
            for (c, v) in f.iter().enumerate() {
                out[c][k] = *v;
            }
        }
    }
}

/// The 8-channel spitter (four pairs): a `SpitterBank` of 8.
pub struct Spitter8 {
    bank: SpitterBank,
}

impl Spitter8 {
    pub fn new(pairs: &[Pair8; PAIRS], sample_rate: f64) -> Self {
        Spitter8 { bank: SpitterBank::new(pairs, CHANNELS, sample_rate) }
    }

    /// New settings for pair `i` (0..4): that pair starts over, the others play on.
    pub fn set_pair(&mut self, i: usize, p: &Pair8) {
        self.bank.set_pair(i, p)
    }

    /// One 8-channel frame: [AES1 A, AES1 B, AES2 A, AES2 B, ...].
    pub fn next(&mut self) -> [f64; CHANNELS] {
        let mut out = [0.0; CHANNELS];
        self.bank.next_into(&mut out);
        out
    }

    /// `n` frames, planar: one Vec per channel.
    pub fn fill(&mut self, out: &mut [Vec<f64>; CHANNELS], n: usize) {
        let mut v = out.to_vec();
        self.bank.fill(&mut v, n);
        for (o, c) in out.iter_mut().zip(v) {
            *o = c;
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

    #[test]
    fn banks_of_every_size() {
        for &n in &SIZES {
            let p = pair("tone", Some(0.0), "invert", "clean");
            let mut b = SpitterBank::new(&vec![p; pairs_for(n)], n, 48000.0);
            assert_eq!((b.channels(), b.pair_count()), (n, n.div_ceil(2)));
            let mut out = Vec::new();
            b.fill(&mut out, 480);
            assert_eq!(out.len(), n);
            for (c, ch) in out.iter().enumerate() {
                let peak = ch.iter().fold(0.0f64, |m, v| m.max(v.abs()));
                assert!((peak - 1.0).abs() < 0.01, "{n} ch, channel {c}: {peak}");
            }
            if n > 1 {
                assert!(out[0].iter().zip(&out[1]).all(|(a, b)| (a + b).abs() < 1e-12), "{n} ch: B inverted");
            }
        }
    }

    #[test]
    fn one_channel_is_pair_one_a() {
        let p = pair("pink", Some(-12.0), "same", "noise");
        let mut b = SpitterBank::new(&[p.clone()], 1, 48000.0);
        let mut s2 = SpitterSynth::new(p.params(), 48000.0);
        let mut f = [0.0];
        for _ in 0..4800 {
            b.next_into(&mut f);
            assert_eq!(f[0], s2.next().0);
        }
    }
}
