// Copyright (c) 2026 Ward-Beck Systems (Ward-Beck.ca). All rights reserved.
//! Ward-Beck generators, daemon side: the sample math behind the TAP's MXL generator
//! flows (POD-33 1 kHz tone, ABP-1 walking 1s) and the Test Signals grains (sine,
//! pink noise, sweep, PRBS-15 Bit Buddy, silence). No I/O: callers own the rings.

pub mod spitter;
pub mod spitter8;
pub mod multichannel;

/// POD-33 calibrated tone: a continuous sine, one block at a time.
pub struct Tone {
    phase: f64,
    phase_inc: f64,
    amp: f64,
}

impl Tone {
    /// `level_dbfs` e.g. -18.0 for 0 VU (EBU).
    pub fn new(freq: f64, level_dbfs: f64, sample_rate: f64) -> Self {
        Tone { phase: 0.0, phase_inc: 2.0 * std::f64::consts::PI * freq / sample_rate, amp: 10f64.powf(level_dbfs / 20.0) }
    }
    pub fn fill(&mut self, out: &mut [f64]) {
        let two_pi = 2.0 * std::f64::consts::PI;
        for s in out.iter_mut() {
            *s = self.amp * self.phase.sin();
            self.phase += self.phase_inc;
            if self.phase > two_pi {
                self.phase -= two_pi;
            }
        }
    }
}

/// ABP-1 walking 1s: one bit per second, a 1 kHz bipolar square at that bit's weight
/// (-6, -12 ... -60 dBFS for `bits` = 10), steps locked to the ring position.
pub struct WalkingOnes {
    pub sample_rate: usize,
    pub bits: usize,
    sample_idx: usize,
}

impl WalkingOnes {
    pub fn new(sample_rate: usize, bits: usize) -> Self {
        WalkingOnes { sample_rate, bits, sample_idx: 0 }
    }
    /// `head` = ring write head, `buf_len` = ring length (frames).
    pub fn fill(&mut self, out: &mut [f64], head: usize, buf_len: usize) {
        let half_period = self.sample_rate / 2000;
        for (i, s) in out.iter_mut().enumerate() {
            let step = (((head + i) % buf_len) / self.sample_rate) % self.bits;
            let amp = 2f64.powi(-(step as i32 + 1));
            *s = if ((self.sample_idx + i) / half_period) % 2 == 0 { amp } else { -amp };
        }
        self.sample_idx += out.len();
    }
}

/// Small PRNG standing in for Python's random.random() (pink noise only).
struct SplitMix(u64);

impl SplitMix {
    fn seeded() -> Self {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x1234_5678);
        SplitMix(t ^ ((std::process::id() as u64) << 32))
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn random(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Synthesizes IEEE 754 Float32 *interleaved* stereo samples for broadcast test signals
/// (exactly what the Python writes to each Test Signals `channels` file).
pub fn synthesize_test_signal_buffer(signal_type: &str, num_frames: usize, sample_rate: u32) -> Vec<u8> {
    let sr = sample_rate as f64;
    let mut out: Vec<u8> = Vec::with_capacity(num_frames * 8);
    let mut push = |v: f64| {
        let b = (v as f32).to_le_bytes();
        out.extend_from_slice(&b);
        out.extend_from_slice(&b);
    };
    let sine = |freq: f64, push: &mut dyn FnMut(f64)| {
        let amp = 0.1;
        let phase_inc = 2.0 * std::f64::consts::PI * freq / sr;
        for i in 0..num_frames {
            push(amp * (phase_inc * i as f64).sin());
        }
    };
    match signal_type {
        "sine_1000" => sine(1000.0, &mut push),
        "sine_400" => sine(400.0, &mut push),
        "sine_100" => sine(100.0, &mut push),
        "silence" => return vec![0u8; num_frames * 2 * 4],
        "pink_noise" => {
            let mut rng = SplitMix::seeded();
            let amp = 0.08;
            let (mut b0, mut b1, mut b2, mut b3, mut b4, mut b5, mut b6) = (0.0f64, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
            for _ in 0..num_frames {
                let white = rng.random() * 2.0 - 1.0;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                let pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11 * amp;
                b6 = white * 0.115926;
                push(pink);
            }
        }
        "sweep" => {
            let f_start = 20.0f64;
            let f_end = 20000.0f64;
            let duration = num_frames as f64 / sr;
            let amp = 0.1;
            let log_ratio = (f_end / f_start).ln();
            for i in 0..num_frames {
                let t = i as f64 / sr;
                let phase = 2.0 * std::f64::consts::PI * f_start * ((f_end / f_start).powf(t / duration) - 1.0)
                    / (log_ratio / duration);
                push(amp * phase.sin());
            }
        }
        "bitbuddy" => {
            let amp = 0.1;
            let mut lfsr: u32 = 0x7ACE;
            for _ in 0..num_frames {
                let bit = (lfsr ^ (lfsr >> 1)) & 1;
                lfsr = (lfsr >> 1) | (bit << 14);
                push(if bit != 0 { amp } else { -amp });
            }
        }
        _ => sine(1000.0, &mut push),
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_level() {
        let mut t = Tone::new(1000.0, -18.0, 48000.0);
        let mut b = vec![0.0; 4800];
        t.fill(&mut b);
        let peak = b.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        assert!((20.0 * peak.log10() + 18.0).abs() < 0.01);
    }

    #[test]
    fn walking_ones_steps() {
        let mut w = WalkingOnes::new(48000, 10);
        let mut b = vec![0.0; 4];
        w.fill(&mut b, 0, 480000);
        assert_eq!(b[0], 0.5);
        w.fill(&mut b, 48000 * 3, 480000);
        assert_eq!(b[0].abs(), 1.0 / 16.0);
    }

    #[test]
    fn grains_are_stereo_f32() {
        for t in ["sine_1000", "sine_400", "sine_100", "silence", "pink_noise", "sweep", "bitbuddy", "master"] {
            assert_eq!(synthesize_test_signal_buffer(t, 64, 48000).len(), 64 * 8, "{}", t);
        }
    }
}
