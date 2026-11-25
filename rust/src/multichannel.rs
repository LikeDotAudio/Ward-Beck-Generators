// Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved.
//! Eight-channel test signals, planar (one buffer per channel):
//!
//! - [`ChannelId`]: channel n (1-8) carries a sine at n x 100 Hz, all at -18 dBFS, so every
//!   leg of an 8-channel path can be told apart by ear or on an analyser.
//! - [`Diagonal`]: a 1 kHz tone on every channel, levels in equal dB steps from
//!   `DIAGONAL_LOW_DBFS` (ch1) to `DIAGONAL_HIGH_DBFS` (ch8). Every `DIAGONAL_HOLD_S` it
//!   flips to the mirror image (ch1 high ... ch8 low) through a short raised-cosine
//!   crossfade, so four stereo meters side by side draw a diagonal up, then down.
//!
//! Both are driven by an absolute sample index (set it from TAI with `set_position` and
//! the flips land on even seconds). Every frequency is a whole number of Hz, so each sine
//! repeats every `rate` samples: the phase comes from `index mod rate` and never drifts.

use std::f64::consts::PI;

pub const CHANNELS: usize = 8;
/// Channel ID tone level (0 VU EBU).
pub const ID_LEVEL_DBFS: f64 = -18.0;
/// Channel ID spacing: channel n is n x this.
pub const ID_STEP_HZ: f64 = 100.0;
pub const DIAGONAL_FREQ_HZ: f64 = 1000.0;
pub const DIAGONAL_LOW_DBFS: f64 = -38.0;
pub const DIAGONAL_HIGH_DBFS: f64 = -3.0;
/// Seconds each half (rising, falling) holds.
pub const DIAGONAL_HOLD_S: f64 = 2.0;
/// Crossfade at each flip, seconds.
pub const DIAGONAL_FADE_S: f64 = 0.010;

fn db_to_amp(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

/// sin(2 pi f n / rate), exact for any n when f is a whole number of Hz.
fn sine_at(freq: f64, index: u64, sample_rate: u64) -> f64 {
    let n = (index % sample_rate) as f64;
    (2.0 * PI * freq * n / sample_rate as f64).sin()
}

/// Channel ID: ch n at n x 100 Hz, -18 dBFS.
pub struct ChannelId {
    sample_rate: u64,
    index: u64,
    amp: f64,
}

impl ChannelId {
    pub fn new(sample_rate: u32) -> Self {
        ChannelId { sample_rate: sample_rate.max(1) as u64, index: 0, amp: db_to_amp(ID_LEVEL_DBFS) }
    }

    /// Frequency of channel `ch` (0-based).
    pub fn frequency(ch: usize) -> f64 {
        ID_STEP_HZ * (ch + 1) as f64
    }

    /// Absolute sample index of the next sample.
    pub fn set_position(&mut self, index: u64) {
        self.index = index;
    }

    /// Fills `out[ch]` for every channel given (normally `CHANNELS`); all the same length.
    pub fn fill(&mut self, out: &mut [Vec<f64>]) {
        let frames = out.iter().map(|c| c.len()).min().unwrap_or(0);
        for (ch, buf) in out.iter_mut().enumerate() {
            let f = Self::frequency(ch);
            for (i, s) in buf.iter_mut().take(frames).enumerate() {
                *s = self.amp * sine_at(f, self.index + i as u64, self.sample_rate);
            }
        }
        self.index += frames as u64;
    }
}

/// Level staircase that flips direction every `DIAGONAL_HOLD_S`.
pub struct Diagonal {
    sample_rate: u64,
    index: u64,
    hold: u64,
    fade: u64,
    /// Linear amplitude per channel, rising (phase A); phase B is this reversed.
    rising: [f64; CHANNELS],
}

impl Diagonal {
    pub fn new(sample_rate: u32) -> Self {
        let sr = sample_rate.max(1) as u64;
        let mut rising = [0.0; CHANNELS];
        for (ch, a) in rising.iter_mut().enumerate() {
            *a = db_to_amp(Self::rising_level_dbfs(ch));
        }
        Diagonal {
            sample_rate: sr,
            index: 0,
            hold: ((DIAGONAL_HOLD_S * sr as f64).round() as u64).max(1),
            fade: (DIAGONAL_FADE_S * sr as f64).round() as u64,
            rising,
        }
    }

    /// Phase A level of channel `ch` (0-based): equal dB steps, low to high.
    pub fn rising_level_dbfs(ch: usize) -> f64 {
        let step = (DIAGONAL_HIGH_DBFS - DIAGONAL_LOW_DBFS) / (CHANNELS - 1) as f64;
        DIAGONAL_LOW_DBFS + step * ch as f64
    }

    /// Level of channel `ch` in the given phase (false = rising, true = falling).
    pub fn level_dbfs(ch: usize, falling: bool) -> f64 {
        Self::rising_level_dbfs(if falling { CHANNELS - 1 - ch } else { ch })
    }

    /// True while sample `index` is in the falling half (past any crossfade).
    pub fn falling_at(&self, index: u64) -> bool {
        (index / self.hold) % 2 == 1
    }

    pub fn set_position(&mut self, index: u64) {
        self.index = index;
    }

    /// Gain of channel `ch` at sample `index`: the new phase fades in over the first
    /// `fade` samples after each flip.
    fn gain(&self, ch: usize, index: u64) -> f64 {
        let a = self.rising[ch];
        let b = self.rising[CHANNELS - 1 - ch];
        let falling = self.falling_at(index);
        let (from, to) = if falling { (a, b) } else { (b, a) };
        let into = index % self.hold;
        // The very first block (index 0) starts settled.
        if into >= self.fade || index < self.hold {
            return to;
        }
        let x = 0.5 - 0.5 * (PI * into as f64 / self.fade as f64).cos();
        from + (to - from) * x
    }

    pub fn fill(&mut self, out: &mut [Vec<f64>]) {
        let frames = out.iter().map(|c| c.len()).min().unwrap_or(0);
        for (ch, buf) in out.iter_mut().enumerate().take(CHANNELS) {
            for (i, s) in buf.iter_mut().take(frames).enumerate() {
                let n = self.index + i as u64;
                *s = self.gain(ch, n) * sine_at(DIAGONAL_FREQ_HZ, n, self.sample_rate);
            }
        }
        self.index += frames as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 48000;

    fn bufs(frames: usize) -> Vec<Vec<f64>> {
        vec![vec![0.0; frames]; CHANNELS]
    }

    fn peak_db(b: &[f64]) -> f64 {
        20.0 * b.iter().fold(0.0f64, |m, v| m.max(v.abs())).log10()
    }

    /// Positive-going zero crossings per second.
    fn freq(b: &[f64]) -> f64 {
        let ups = b.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        ups as f64 * SR as f64 / b.len() as f64
    }

    #[test]
    fn channel_id_frequencies_and_level() {
        let mut g = ChannelId::new(SR);
        let mut b = bufs(SR as usize);
        g.fill(&mut b);
        for (ch, buf) in b.iter().enumerate() {
            let want = 100.0 * (ch + 1) as f64;
            assert_eq!(ChannelId::frequency(ch), want);
            assert!((freq(buf) - want).abs() <= 1.0, "ch{} {} Hz", ch + 1, freq(buf));
            assert!((peak_db(buf) - ID_LEVEL_DBFS).abs() < 0.01, "ch{} {} dB", ch + 1, peak_db(buf));
        }
    }

    #[test]
    fn channel_id_is_continuous_across_blocks() {
        let mut a = ChannelId::new(SR);
        let mut whole = bufs(1024);
        a.fill(&mut whole);
        let mut b = ChannelId::new(SR);
        let mut first = bufs(256);
        let mut rest = bufs(768);
        b.fill(&mut first);
        b.fill(&mut rest);
        for ch in 0..CHANNELS {
            assert_eq!(&whole[ch][..256], &first[ch][..]);
            assert_eq!(&whole[ch][256..], &rest[ch][..]);
        }
    }

    #[test]
    fn diagonal_levels_step_evenly() {
        assert_eq!(Diagonal::rising_level_dbfs(0), -38.0);
        assert_eq!(Diagonal::rising_level_dbfs(7), -3.0);
        for ch in 1..CHANNELS {
            let d = Diagonal::rising_level_dbfs(ch) - Diagonal::rising_level_dbfs(ch - 1);
            assert!((d - 5.0).abs() < 1e-9);
            assert_eq!(Diagonal::level_dbfs(ch, true), Diagonal::rising_level_dbfs(CHANNELS - 1 - ch));
        }
        // Measured: the first half rises, every channel at its step, 1 kHz.
        let mut g = Diagonal::new(SR);
        let mut b = bufs(4800);
        g.fill(&mut b);
        for (ch, buf) in b.iter().enumerate() {
            assert!((peak_db(buf) - Diagonal::level_dbfs(ch, false)).abs() < 0.01, "ch{}", ch + 1);
            assert!((freq(buf) - 1000.0).abs() <= 10.0);
        }
    }

    #[test]
    fn diagonal_flips_every_two_seconds() {
        let g = Diagonal::new(SR);
        let hold = 2 * SR as u64;
        assert!(!g.falling_at(0));
        assert!(!g.falling_at(hold - 1));
        assert!(g.falling_at(hold));
        assert!(g.falling_at(2 * hold - 1));
        assert!(!g.falling_at(2 * hold));

        // 100 ms just after the first flip, past the fade: falling (ch1 -3, ch8 -38).
        let fade = (DIAGONAL_FADE_S * SR as f64) as u64;
        let mut g = Diagonal::new(SR);
        g.set_position(hold + fade);
        let mut b = bufs(4800);
        g.fill(&mut b);
        for (ch, buf) in b.iter().enumerate() {
            assert!((peak_db(buf) - Diagonal::level_dbfs(ch, true)).abs() < 0.01, "ch{}", ch + 1);
        }
        // and back to rising at 4 s.
        g.set_position(2 * hold + fade);
        g.fill(&mut b);
        assert!((peak_db(&b[0]) + 38.0).abs() < 0.01);
        assert!((peak_db(&b[7]) + 3.0).abs() < 0.01);
    }

    #[test]
    fn diagonal_crossfade_has_no_jump() {
        // Across the flip, the gain moves in small steps over the 10 ms fade.
        let g = Diagonal::new(SR);
        let hold = 2 * SR as u64;
        let fade = (DIAGONAL_FADE_S * SR as f64) as u64;
        assert_eq!(fade, 480);
        for ch in 0..CHANNELS {
            let mut prev = g.gain(ch, hold - 1);
            for n in hold..hold + fade + 1 {
                let now = g.gain(ch, n);
                assert!((now - prev).abs() < 0.01, "ch{} at {}", ch + 1, n);
                prev = now;
            }
            assert_eq!(g.gain(ch, hold + fade), db_to_amp(Diagonal::level_dbfs(ch, true)));
        }
    }
}
