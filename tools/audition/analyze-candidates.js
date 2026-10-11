#!/usr/bin/env node
"use strict";

// Measure every audition candidate so a pick can be justified on paper:
// lead-in silence, attack (ms from onset to within 6 dB of the peak), decay
// (ms from the peak until it falls 30 dB under it), audible length, energy
// share in three bands (low < 250 Hz, mid 250 Hz - 2.5 kHz, high > 2.5 kHz),
// stereo width (1 - L/R correlation; 0 = mono) and RMS. Adds `features` to
// each entry of art-src/audio/candidates/candidates.json.
//
//   node tools/audition/analyze-candidates.js [--print]

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const FF = require("ffmpeg-static");

const ROOT = path.join(__dirname, "..", "..");
const AUDIO = path.join(ROOT, "art-src", "audio");
const LIST = path.join(AUDIO, "candidates", "candidates.json");
const SR = 22050;

function pcm(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const b = r.stdout;
  const n = Math.floor(b.length / 8);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = b.readFloatLE(i * 8); R[i] = b.readFloatLE(i * 8 + 4); }
  return { L, R, n };
}

/** One-pole low-pass state machine (cutoff Hz). */
const onePole = (fc) => { const a = Math.exp((-2 * Math.PI * fc) / SR); let y = 0; return (x) => (y = (1 - a) * x + a * y); };

function features(file) {
  const { L, R, n } = pcm(file);
  if (!n) return null;
  const M = new Float32Array(n);
  for (let i = 0; i < n; i++) M[i] = (L[i] + R[i]) / 2;
  // Envelope (5 ms RMS windows).
  const W = Math.round(SR * 0.005);
  const env = [];
  for (let i = 0; i < n; i += W) { let s = 0; const e = Math.min(n, i + W); for (let j = i; j < e; j++) s += M[j] * M[j]; env.push(Math.sqrt(s / Math.max(1, e - i))); }
  let pk = 0, pkI = 0;
  env.forEach((v, i) => { if (v > pk) { pk = v; pkI = i; } });
  const ms = (k) => Math.round(k * 5);
  const onI = env.findIndex((v) => v >= pk * 0.01); // -40 dB
  const atkI = env.findIndex((v) => v >= pk * 0.5); // -6 dB
  let endI = pkI;
  for (let i = env.length - 1; i > pkI; i--) if (env[i] >= pk * 0.0316) { endI = i; break; } // -30 dB
  // Bands.
  const lp250 = onePole(250), lp2500 = onePole(2500);
  let lo = 0, mid = 0, hi = 0, all = 0;
  for (let i = 0; i < n; i++) {
    const x = M[i], a = lp250(x), b = lp2500(x);
    lo += a * a; mid += (b - a) * (b - a); hi += (x - b) * (x - b); all += x * x;
  }
  const tot = lo + mid + hi || 1;
  // Width.
  let sLL = 0, sRR = 0, sLR = 0;
  for (let i = 0; i < n; i++) { sLL += L[i] * L[i]; sRR += R[i] * R[i]; sLR += L[i] * R[i]; }
  const corr = sLL && sRR ? sLR / Math.sqrt(sLL * sRR) : 1;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;
  return {
    leadMs: ms(onI), attackMs: ms(Math.max(0, atkI - onI)), decayMs: ms(endI - pkI), audibleMs: ms(endI - onI),
    low: Math.round((lo / tot) * 100), mid: Math.round((mid / tot) * 100), high: Math.round((hi / tot) * 100),
    width: Math.round(Math.max(0, 1 - corr) * 100) / 100, peakDb: db(peak), rmsDb: db(Math.sqrt(all / n))
  };
}

const list = JSON.parse(fs.readFileSync(LIST, "utf8"));
for (const [ev, cands] of Object.entries(list.events)) {
  for (const c of cands) c.features = features(path.join(AUDIO, c.file));
  if (process.argv.includes("--print")) {
    console.log(`\n${ev}`);
    for (const c of cands) {
      const f = c.features || {};
      console.log(`  ${c.id.padEnd(7)} ${c.title.slice(0, 34).padEnd(34)} lead ${String(f.leadMs).padStart(4)} atk ${String(f.attackMs).padStart(4)} dec ${String(f.decayMs).padStart(5)} aud ${String(f.audibleMs).padStart(5)}  L/M/H ${f.low}/${f.mid}/${f.high}  w ${f.width}  rms ${f.rmsDb}`);
    }
  }
}
fs.writeFileSync(LIST, JSON.stringify(list, null, 2));
console.log(`analysed ${Object.values(list.events).flat().length} candidates`);
