/* eslint-disable */
// ---------------------------------------------------------------------------
// Offline SFX renderer for Banana X.
//
// Renders every sound in the game's synth manifest (client/engine/audio.js)
// to a real 16-bit mono WAV file — no browser, no AI generator, no trimming.
// It re-implements the SAME Web-Audio primitives (tone / noise / chord) as a
// pure offline DSP so the files sound identical to what the game synthesizes.
//
// Usage:   node tools/render-sfx.js
// Output:  client/assets/audio/*.wav   (also a manifest.json listing them)
//
// To wire the files into the game afterwards, add `src:"<name>.wav"` to the
// matching SFX entry in client/engine/audio.js — the engine's hybrid loader
// then plays the file instead of synthesizing. (Ask Claude to do this step.)
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");

const SR = 44100;          // sample rate
const OUT_DIR = path.join(__dirname, "..", "client", "assets", "audio");
const RENDER_LEN = 2.0;    // generous render window (s); trailing silence is auto-trimmed
const TRIM_FLOOR = 0.0009; // amplitude below which the tail counts as "silent"
const TAIL_PAD = 0.02;     // keep 20ms of air after the last audible sample

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Deterministic noise so re-runs produce byte-identical files.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(0x9e3779b9);

// The current render target. Primitives add into this buffer.
let OUT = null; // Float32Array

// --- offline Web-Audio primitives (signature-compatible with audio.js) -----
// `ctx` only needs { currentTime: 0 }; everything renders into OUT at SR.

function expInterp(v0, v1, x) {
  // exponentialRampToValueAtTime semantics; x in [0,1]
  v0 = Math.max(1e-5, v0); v1 = Math.max(1e-5, v1);
  return v0 * Math.pow(v1 / v0, x);
}

function osc(type, p) {
  // p = normalized phase [0,1)
  switch (type) {
    case "square":   return p < 0.5 ? 1 : -1;
    case "sawtooth": return 2 * p - 1;
    case "triangle": return 4 * Math.abs(p - 0.5) - 1;
    case "sine":
    default:         return Math.sin(2 * Math.PI * p);
  }
}

function tone(ctx, _dest, { type = "sine", freq = 440, freqEnd = null, t = 0, dur = 0.2, gain = 0.5, attack = 0.002, release = null } = {}) {
  const start = ctx.currentTime + t;
  const rel = release == null ? dur * 0.6 : release;
  const endAtk = start + attack;
  const endEnv = start + dur + rel;
  const i0 = Math.max(0, Math.floor(start * SR));
  const i1 = Math.min(OUT.length, Math.ceil(endEnv * SR));
  let phase = 0;
  for (let i = i0; i < i1; i++) {
    const tt = i / SR;
    // frequency (exponential ramp over [start, start+dur], then holds freqEnd)
    let f = freq;
    if (freqEnd != null) {
      const x = clamp((tt - start) / dur, 0, 1);
      f = expInterp(freq, Math.max(1, freqEnd), x);
    }
    phase += f / SR; if (phase >= 1) phase -= Math.floor(phase);
    // gain envelope: 0 -> gain (attack), gain -> 0 (release), both exponential
    let g;
    if (tt < endAtk) g = expInterp(0.0001, gain, (tt - start) / Math.max(1e-6, attack));
    else             g = expInterp(gain, 0.0001, (tt - endAtk) / Math.max(1e-6, (endEnv - endAtk)));
    OUT[i] += osc(type, phase) * g;
  }
}

function noise(ctx, _dest, { t = 0, dur = 0.2, gain = 0.4, type = "highpass", freq = 1200, q = 0.7, sweepTo = null } = {}) {
  const start = ctx.currentTime + t;
  const i0 = Math.max(0, Math.floor(start * SR));
  const n = Math.max(1, Math.floor(SR * dur));
  const i1 = Math.min(OUT.length, i0 + n);
  // biquad state (Direct Form I), coefficients recomputed per sample for sweep
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const atkEnd = start + dur * 0.15;
  const env0 = start, envEnd = start + dur;
  for (let i = i0; i < i1; i++) {
    const tt = i / SR;
    const f0 = sweepTo != null
      ? expInterp(freq, Math.max(20, sweepTo), clamp((tt - start) / dur, 0, 1))
      : freq;
    const w0 = 2 * Math.PI * f0 / SR;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Math.max(0.0001, q));
    let b0, b1, b2, a0, a1, a2;
    if (type === "lowpass") {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    } else if (type === "highpass") {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    } else { // bandpass (constant 0 dB peak — Web Audio default)
      b0 = alpha; b1 = 0; b2 = -alpha;
    }
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    const x0 = rng() * 2 - 1;
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    // gain env: 0 -> gain over 15%, gain -> 0 over remainder (exponential)
    let g;
    if (tt < atkEnd) g = expInterp(0.0001, gain, (tt - env0) / Math.max(1e-6, (atkEnd - env0)));
    else             g = expInterp(gain, 0.0001, (tt - atkEnd) / Math.max(1e-6, (envEnd - atkEnd)));
    OUT[i] += y0 * g;
  }
}

function chord(ctx, dest, { freqs = [], t = 0, dur = 0.5, gain = 0.25, type = "triangle" } = {}) {
  freqs.forEach((f, i) => tone(ctx, dest, { type, freq: f, t: t + i * 0.012, dur, gain, attack: 0.01 }));
}

// --- SFX manifest — copied verbatim from client/engine/audio.js ------------
const SFX = {
  click: { synth: (c, d) => tone(c, d, { type: "square", freq: 520, freqEnd: 360, dur: 0.05, gain: 0.18 }) },
  bet_change: { synth: (c, d, o = {}) => tone(c, d, { type: "triangle", freq: o.up ? 680 : 460, freqEnd: o.up ? 760 : 400, dur: 0.07, gain: 0.22 }) },
  turbo_toggle: { synth: (c, d, o = {}) => tone(c, d, { type: "sawtooth", freq: o.on ? 420 : 620, freqEnd: o.on ? 880 : 320, dur: 0.14, gain: 0.22 }) },
  spin_start: {
    synth: (c, d) => {
      tone(c, d, { type: "square", freq: 320, freqEnd: 180, dur: 0.06, gain: 0.22 });
      noise(c, d, { dur: 0.5, gain: 0.2, type: "bandpass", freq: 360, sweepTo: 3000, q: 0.7 });
      tone(c, d, { type: "sawtooth", freq: 150, freqEnd: 560, dur: 0.46, gain: 0.14 });
      tone(c, d, { type: "sine", freq: 90, freqEnd: 220, dur: 0.4, gain: 0.1, t: 0.02 });
    }
  },
  reel_stop: {
    synth: (c, d, o = {}) => {
      const base = 220 + (o.index || 0) * 24;
      tone(c, d, { type: "triangle", freq: base, freqEnd: base * 0.6, dur: 0.11, gain: 0.26 });
      tone(c, d, { type: "sine", freq: base * 0.5, freqEnd: base * 0.34, dur: 0.13, gain: 0.18 });
      noise(c, d, { dur: 0.08, gain: 0.16, type: "lowpass", freq: 1100 });
      noise(c, d, { dur: 0.06, gain: 0.06, type: "highpass", freq: 4200, t: 0.01 });
    }
  },
  tumble: {
    synth: (c, d, o = {}) => {
      const base = 300 + (o.step || 0) * 44;
      tone(c, d, { type: "sine", freq: base, freqEnd: base * 0.55, dur: 0.12, gain: 0.2 });
      noise(c, d, { dur: 0.1, gain: 0.1, type: "lowpass", freq: 1400, sweepTo: 500 });
    }
  },
  explode: {
    synth: (c, d, o = {}) => {
      const tier = o.tier || "medium";
      const big = tier === "great" || tier === "blast-great";
      const med = big || tier === "medium" || tier === "blast-medium";
      noise(c, d, { dur: big ? 0.34 : med ? 0.24 : 0.16, gain: big ? 0.4 : 0.28, type: "lowpass", freq: 1800, sweepTo: 200 });
      tone(c, d, { type: "sine", freq: big ? 120 : 170, freqEnd: 40, dur: big ? 0.3 : 0.18, gain: big ? 0.4 : 0.26 });
      if (big) tone(c, d, { type: "square", freq: 90, freqEnd: 30, dur: 0.22, gain: 0.2, t: 0.01 });
    }
  },
  win_tick: {
    synth: (c, d, o = {}) => {
      const f = clamp(520 + (o.progress || 0) * 900, 520, 1700);
      tone(c, d, { type: "triangle", freq: f, dur: 0.04, gain: 0.12 });
    }
  },
  win_small: { synth: (c, d) => chord(c, d, { freqs: [523, 659, 784], dur: 0.35, gain: 0.18 }) },
  win_big: {
    synth: (c, d) => {
      chord(c, d, { freqs: [523, 659, 784, 1046], dur: 0.5, gain: 0.2 });
      tone(c, d, { type: "triangle", freq: 1568, dur: 0.4, gain: 0.12, t: 0.18 });
    }
  },
  win_mega: {
    synth: (c, d) => {
      chord(c, d, { freqs: [523, 659, 784, 1046], dur: 0.6, gain: 0.22 });
      chord(c, d, { freqs: [659, 784, 988, 1318], dur: 0.6, gain: 0.18, t: 0.18 });
      tone(c, d, { type: "sawtooth", freq: 80, freqEnd: 160, dur: 0.5, gain: 0.16 });
    }
  },
  multiplier_catch: {
    synth: (c, d, o = {}) => {
      const v = Math.max(2, o.value || 2);
      const f = clamp(440 + Math.log2(v) * 130, 440, 1600);
      tone(c, d, { type: "square", freq: f, freqEnd: f * 1.5, dur: 0.12, gain: 0.2 });
      tone(c, d, { type: "sine", freq: f * 2, dur: 0.16, gain: 0.1, t: 0.04 });
    }
  },
  multiplier_combine: {
    synth: (c, d, o = {}) => {
      const v = Math.max(2, o.value || 2);
      const f = clamp(520 + Math.log2(v) * 90, 520, 1500);
      tone(c, d, { type: "triangle", freq: f, freqEnd: f * 2, dur: 0.22, gain: 0.2 });
      tone(c, d, { type: "sine", freq: f * 0.5, freqEnd: f, dur: 0.22, gain: 0.12 });
    }
  },
  multiplier_drop: {
    synth: (c, d, o = {}) => {
      const v = Math.max(2, Number(o.value) || 2);
      const heavy = clamp(Math.log2(v) / Math.log2(1000), 0, 1);
      const dropDur = 0.16 + heavy * 0.32;
      const impactFreq = 150 - heavy * 80;
      const impactGain = 0.22 + heavy * 0.24;
      const tImpact = dropDur * 0.8;
      tone(c, d, { type: "sawtooth", freq: 820 - heavy * 160, freqEnd: impactFreq * 2.4, dur: dropDur, gain: 0.1 + heavy * 0.08 });
      noise(c, d, { dur: dropDur, gain: 0.08 + heavy * 0.1, type: "bandpass", freq: 1900, sweepTo: 280, q: 0.6 });
      tone(c, d, { type: "sine", freq: impactFreq, freqEnd: impactFreq * 0.5, dur: 0.16 + heavy * 0.22, gain: impactGain, t: tImpact });
      if (heavy > 0.45) {
        tone(c, d, { type: "square", freq: impactFreq * 0.7, freqEnd: impactFreq * 0.34, dur: 0.22 + heavy * 0.22, gain: 0.14 + heavy * 0.12, t: tImpact });
        noise(c, d, { dur: 0.22, gain: 0.16 * heavy, type: "lowpass", freq: 1600, sweepTo: 150, t: tImpact });
      }
      const chime = clamp(420 + Math.log2(v) * 120, 420, 1600);
      const stack = v >= 1000 ? [chime, chime * 1.25, chime * 1.5, chime * 2]
        : v >= 250 ? [chime, chime * 1.25, chime * 1.5]
        : v >= 50 ? [chime, chime * 1.5]
        : [chime];
      chord(c, d, { freqs: stack, dur: 0.38 + heavy * 0.34, gain: 0.1 + heavy * 0.06, t: tImpact + 0.02 });
    }
  },
  bonus_trigger: {
    synth: (c, d) => {
      chord(c, d, { freqs: [392, 523, 659], dur: 0.3, gain: 0.18 });
      chord(c, d, { freqs: [523, 659, 784], dur: 0.3, gain: 0.18, t: 0.16 });
      chord(c, d, { freqs: [659, 784, 1046, 1318], dur: 0.5, gain: 0.2, t: 0.32 });
    }
  },
  buy_feature: {
    synth: (c, d) => {
      tone(c, d, { type: "sawtooth", freq: 220, freqEnd: 660, dur: 0.18, gain: 0.2 });
      chord(c, d, { freqs: [659, 880, 1318], dur: 0.4, gain: 0.18, t: 0.14 });
    }
  },
  max_win: {
    synth: (c, d) => {
      tone(c, d, { type: "sawtooth", freq: 100, freqEnd: 220, dur: 0.6, gain: 0.18 });
      chord(c, d, { freqs: [784, 988, 1318, 1568], dur: 0.7, gain: 0.22, t: 0.1 });
      chord(c, d, { freqs: [1046, 1318, 1568, 2093], dur: 0.7, gain: 0.18, t: 0.4 });
    }
  }
};

// Representative parameters for the sounds that vary at runtime, plus extra
// named variants worth shipping as separate files.
const VARIANTS = [
  { file: "click",              name: "click" },
  { file: "bet_change",         name: "bet_change",         opts: { up: true } },
  { file: "turbo_on",           name: "turbo_toggle",       opts: { on: true } },
  { file: "turbo_off",          name: "turbo_toggle",       opts: { on: false } },
  { file: "spin_start",         name: "spin_start" },
  { file: "reel_stop",          name: "reel_stop" },
  { file: "tumble",             name: "tumble" },
  { file: "explode",            name: "explode",            opts: { tier: "medium" } },
  { file: "explode_great",      name: "explode",            opts: { tier: "great" } },
  { file: "win_tick",           name: "win_tick" },
  { file: "win_small",          name: "win_small" },
  { file: "win_big",            name: "win_big" },
  { file: "win_mega",           name: "win_mega" },
  { file: "multiplier_catch",   name: "multiplier_catch",   opts: { value: 10 } },
  { file: "multiplier_combine", name: "multiplier_combine", opts: { value: 10 } },
  { file: "multiplier_drop",    name: "multiplier_drop",    opts: { value: 25 } },
  { file: "multiplier_drop_big",name: "multiplier_drop",    opts: { value: 1000 } },
  { file: "bonus_trigger",      name: "bonus_trigger" },
  { file: "buy_feature",        name: "buy_feature" },
  { file: "max_win",            name: "max_win" }
];

// --- render + WAV writing --------------------------------------------------
function renderOne(name, opts) {
  rng = mulberry32(0x9e3779b9); // reset RNG per file → deterministic noise
  OUT = new Float32Array(Math.floor(RENDER_LEN * SR));
  SFX[name].synth({ currentTime: 0 }, null, opts || {});

  // Trim trailing silence, keep a small pad, apply a short fade-out.
  let last = 0;
  for (let i = OUT.length - 1; i >= 0; i--) {
    if (Math.abs(OUT[i]) > TRIM_FLOOR) { last = i; break; }
  }
  const end = Math.min(OUT.length, last + Math.floor(TAIL_PAD * SR));
  const buf = OUT.subarray(0, Math.max(1, end));

  // Peak-protect: scale down only if it would clip.
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const scale = peak > 0.99 ? 0.99 / peak : 1;

  // 5ms fade-out to avoid an end click.
  const fade = Math.min(buf.length, Math.floor(0.005 * SR));
  return { samples: buf, scale, fade, seconds: buf.length / SR };
}

function writeWav(file, { samples, scale, fade }) {
  const n = samples.length;
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + n * 2, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = samples[i] * scale;
    if (i >= n - fade) s *= (n - i) / fade; // linear fade-out
    s = Math.max(-1, Math.min(1, s));
    bytes.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, bytes);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const v of VARIANTS) {
    const r = renderOne(v.name, v.opts);
    const file = path.join(OUT_DIR, v.file + ".wav");
    writeWav(file, r);
    manifest.push({ file: v.file + ".wav", from: v.name, seconds: +r.seconds.toFixed(3) });
    console.log(`  ${(v.file + ".wav").padEnd(24)} ${r.seconds.toFixed(3)}s`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${manifest.length} files to ${OUT_DIR}`);
}

main();
