// Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved.
//! ABS-1 Bit Spitter, sample by sample: the source (tone, pink / white / brown noise,
//! walking 1s, PRBS-15, min/max, a looped file), the channel B buttons, then a fault on
//! the AES3 line. The browser runs the same thing (web/sources/spitter-synth.ts): keep
//! the two in step.

use std::f64::consts::PI;
use std::sync::Arc;

const TWO_PI: f64 = 2.0 * PI;
/// One 20 Hz → 20 kHz sweep (seconds).
pub const SWEEP_S: f64 = 10.0;

/// A looped file: interleaved stereo f32 at `rate`.
#[derive(Clone)]
pub struct SpitterFile {
    pub pcm: Arc<Vec<f32>>,
    pub rate: f64,
}

#[derive(Clone)]
pub struct SpitterParams {
    /// sweep | tone | pink | white | brown | walk1s | prbs | minmax | file
    pub pattern: String,
    /// dBFS; None = OFF
    pub level: Option<f64>,
    pub tone: f64,
    pub cycle: bool,
    pub invert: bool,
    pub b_off: bool,
    /// EXT with no reference: clock stopped
    pub muted: bool,
    /// clean | noise | badeq | jitter | drop | slip | biphase | noclock
    pub fault: String,
    pub file: Option<SpitterFile>,
}

impl Default for SpitterParams {
    fn default() -> Self {
        SpitterParams {
            pattern: "sweep".into(), level: Some(-20.0), tone: 1000.0, cycle: false, invert: false,
            b_off: false, muted: false, fault: "clean".into(), file: None,
        }
    }
}

pub struct SpitterSynth {
    p: SpitterParams,
    sr: f64,
    t: u64,
    phase: f64,
    lfsr: u32,
    seed: u32,
    pink: [f64; 7],
    brown: f64,
    file_pos: f64,
    lp: (f64, f64),
    event_in: i64,
    event_left: i64,
    last: (f64, f64),
    dl: [f64; 256],
    dr: [f64; 256],
    dw: usize,
}

impl SpitterSynth {
    pub fn new(p: SpitterParams, sample_rate: f64) -> Self {
        SpitterSynth {
            p, sr: sample_rate, t: 0, phase: 0.0, lfsr: 0x7ace, seed: 0x2545f491, pink: [0.0; 7], brown: 0.0,
            file_pos: 0.0, lp: (0.0, 0.0), event_in: (sample_rate * 0.5) as i64, event_left: 0, last: (0.0, 0.0),
            dl: [0.0; 256], dr: [0.0; 256], dw: 0,
        }
    }

    fn rnd(&mut self) -> f64 {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        x as f64 / 4294967296.0
    }
    fn between(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.rnd()
    }

    fn source(&mut self) -> (f64, f64) {
        let amp = self.p.level.map(|l| 10f64.powf(l / 20.0)).unwrap_or(0.0);
        let sr = self.sr;
        let v = match self.p.pattern.as_str() {
            "tone" => {
                let v = amp * self.phase.sin();
                self.phase = (self.phase + TWO_PI * self.p.tone / sr) % TWO_PI;
                v
            }
            "sweep" => {
                // 20 Hz → 20 kHz logarithmic, every SWEEP_S seconds
                let t = (self.t as f64 / sr) % SWEEP_S;
                let f = 20.0 * 1000f64.powf(t / SWEEP_S);
                let v = amp * self.phase.sin();
                self.phase = (self.phase + TWO_PI * f / sr) % TWO_PI;
                v
            }
            "white" => amp * (self.rnd() * 2.0 - 1.0),
            "pink" => {
                let w = self.rnd() * 2.0 - 1.0;
                let b = &mut self.pink;
                b[0] = 0.99886 * b[0] + w * 0.0555179;
                b[1] = 0.99332 * b[1] + w * 0.0750759;
                b[2] = 0.969 * b[2] + w * 0.153852;
                b[3] = 0.8665 * b[3] + w * 0.3104856;
                b[4] = 0.55 * b[4] + w * 0.5329522;
                b[5] = -0.7616 * b[5] - w * 0.016898;
                let v = amp * 0.11 * (b.iter().sum::<f64>() + w * 0.5362);
                b[6] = w * 0.115926;
                v
            }
            "brown" => {
                let w = self.rnd() * 2.0 - 1.0;
                self.brown = (self.brown + 0.02 * w) / 1.02;
                amp * self.brown * 3.5
            }
            "walk1s" => {
                let bit = (self.t as f64 / sr).floor() as i32 % 10;
                let v = 2f64.powi(-(bit + 1)) * if self.phase.sin() >= 0.0 { 1.0 } else { -1.0 };
                self.phase = (self.phase + TWO_PI * 1000.0 / sr) % TWO_PI;
                v
            }
            "minmax" => {
                let v = if self.phase < PI { 0.95 } else { -0.95 };
                self.phase = (self.phase + TWO_PI * 60.0 / sr) % TWO_PI;
                v
            }
            "file" => {
                let Some(f) = &self.p.file else { return (0.0, 0.0) };
                let frames = f.pcm.len() / 2;
                if frames == 0 {
                    return (0.0, 0.0);
                }
                let i = self.file_pos as usize % frames;
                self.file_pos = (self.file_pos + f.rate / sr) % frames as f64;
                return (amp * f.pcm[2 * i] as f64, amp * f.pcm[2 * i + 1] as f64);
            }
            _ => {
                let bit = (self.lfsr ^ (self.lfsr >> 1)) & 1;
                self.lfsr = (self.lfsr >> 1) | (bit << 14);
                if bit != 0 { 0.35 } else { -0.35 }
            }
        };
        (v, v)
    }

    /// One stereo frame.
    pub fn next(&mut self) -> (f64, f64) {
        let (a, mut b) = self.source();
        let mut a = a;
        if self.p.b_off {
            b = 0.0;
        } else {
            if self.p.invert {
                b = -b;
            }
            if self.p.cycle && (self.t as f64 / (self.sr * 0.52)).floor() as u64 % 2 == 1 {
                b = 0.0;
            }
        }
        if self.p.muted {
            a = 0.0;
            b = 0.0;
        }
        self.t += 1;
        self.fault(a, b)
    }

    fn fault(&mut self, mut l: f64, mut r: f64) -> (f64, f64) {
        let sr = self.sr;
        let mut in_event = false;
        if self.event_left > 0 {
            self.event_left -= 1;
            in_event = true;
        } else {
            self.event_in -= 1;
            if self.event_in <= 0 {
                let (gap, len) = match self.p.fault.as_str() {
                    "drop" => ((0.5, 3.0), (0.02, 0.3)),
                    "badeq" => ((0.7, 2.5), (0.01, 0.06)),
                    "biphase" => ((0.2, 1.5), (0.003, 0.025)),
                    "slip" => ((0.3, 1.2), (0.0, 0.0)),
                    _ => ((1.0, 1.0), (0.0, 0.0)),
                };
                self.event_in = (sr * self.between(gap.0, gap.1)).round() as i64;
                self.event_left = ((sr * self.between(len.0, len.1)).round() as i64).max(1);
                in_event = true;
            }
        }
        let fault = self.p.fault.clone();
        match fault.as_str() {
            "noise" => {
                l += (self.rnd() * 2.0 - 1.0) * 0.003;
                r += (self.rnd() * 2.0 - 1.0) * 0.003;
                if self.rnd() < 0.0002 {
                    l = self.err();
                }
                if self.rnd() < 0.0002 {
                    r = self.err();
                }
            }
            "badeq" => {
                let a = 1.0 - (-TWO_PI * 2500.0 / sr).exp();
                self.lp.0 += a * (l - self.lp.0);
                self.lp.1 += a * (r - self.lp.1);
                l = self.lp.0;
                r = self.lp.1;
                if in_event && self.rnd() < 0.08 {
                    l = self.err();
                    r = self.err();
                }
            }
            "jitter" => {
                self.dl[self.dw] = l;
                self.dr[self.dw] = r;
                let s = self.t as f64 / sr;
                let d = 24.0 + 10.0 * (TWO_PI * 5.3 * s).sin() + 6.0 * (TWO_PI * 0.37 * s).sin();
                let pos = (self.dw as f64 - d + 256.0) % 256.0;
                let i0 = pos.floor() as usize % 256;
                let fr = pos - pos.floor();
                let i1 = (i0 + 1) % 256;
                l = self.dl[i0] * (1.0 - fr) + self.dl[i1] * fr;
                r = self.dr[i0] * (1.0 - fr) + self.dr[i1] * fr;
                self.dw = (self.dw + 1) % 256;
            }
            "drop" if in_event => {
                l = 0.0;
                r = 0.0;
            }
            "slip" if in_event => {
                (l, r) = self.last;
            }
            "biphase" if in_event && self.rnd() < 0.4 => {
                l = self.err();
                r = self.err();
            }
            "noclock" => {
                l = 0.0;
                r = 0.0;
            }
            _ => {}
        }
        self.last = (l, r);
        (l, r)
    }

    fn err(&mut self) -> f64 {
        let s = if self.rnd() < 0.5 { -1.0 } else { 1.0 };
        s * self.between(0.2, 0.9)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(p: SpitterParams, n: usize) -> Vec<(f64, f64)> {
        let mut s = SpitterSynth::new(p, 48000.0);
        (0..n).map(|_| s.next()).collect()
    }

    #[test]
    fn tone_level_and_channel_b() {
        let p = SpitterParams { pattern: "tone".into(), level: Some(-20.0), invert: true, ..Default::default() };
        let out = run(p, 4800);
        let peak = out.iter().map(|f| f.0.abs()).fold(0.0, f64::max);
        assert!((peak - 0.1).abs() < 0.002, "peak {peak}");
        assert!(out.iter().all(|(a, b)| (a + b).abs() < 1e-12), "B is A inverted");
    }

    #[test]
    fn noises_are_bounded_and_live() {
        for pat in ["pink", "white", "brown"] {
            let out = run(SpitterParams { pattern: pat.into(), level: Some(0.0), ..Default::default() }, 48000);
            let rms = (out.iter().map(|f| f.0 * f.0).sum::<f64>() / out.len() as f64).sqrt();
            assert!(rms > 0.05 && out.iter().all(|f| f.0.abs() <= 1.5), "{pat} rms {rms}");
        }
    }

    #[test]
    fn sweep_is_the_default_and_climbs() {
        assert_eq!(SpitterParams::default().pattern, "sweep");
        let mut s = SpitterSynth::new(SpitterParams { level: Some(-20.0), ..Default::default() }, 48000.0);
        // zero crossings in the first and last 100 ms of a sweep: low then high frequency
        let mut count = |n: usize, s: &mut SpitterSynth| { let mut z = 0; let mut last = 0.0; for _ in 0..n { let (l, _) = s.next(); if (l >= 0.0) != (last >= 0.0) { z += 1; } last = l; } z };
        let lo = count(4800, &mut s);
        for _ in 0..(48000 * 9 + 38400) { s.next(); }
        let hi = count(4800, &mut s);
        assert!(lo < 20 && hi > 1000, "lo {lo} hi {hi}");
    }

    #[test]
    fn faults() {
        let base = SpitterParams { pattern: "tone".into(), level: Some(-20.0), ..Default::default() };
        let out = run(SpitterParams { fault: "noclock".into(), ..base.clone() }, 1000);
        assert!(out.iter().all(|f| *f == (0.0, 0.0)));
        let out = run(SpitterParams { fault: "drop".into(), ..base.clone() }, 48000 * 4);
        assert!(out.windows(480).any(|w| w.iter().all(|f| *f == (0.0, 0.0))), "a dropout");
        let out = run(SpitterParams { fault: "biphase".into(), ..base }, 48000 * 3);
        assert!(out.iter().any(|f| f.0.abs() > 0.15), "crackle above the tone");
    }

    #[test]
    fn file_loops() {
        let pcm: Vec<f32> = (0..200).flat_map(|i| [i as f32 / 1000.0, -(i as f32) / 1000.0]).collect();
        let file = SpitterFile { pcm: Arc::new(pcm), rate: 48000.0 };
        let out = run(SpitterParams { pattern: "file".into(), level: Some(0.0), file: Some(file), ..Default::default() }, 450);
        assert!((out[205].0 - 0.005).abs() < 1e-6 && (out[205].1 + 0.005).abs() < 1e-6);
    }
}
