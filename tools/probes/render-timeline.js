#!/usr/bin/env node
"use strict";

// Before/after listening clip. Renders the sound timeline that
// sound-sync-probe.js recorded (every Sound.play with its file, gain, pitch,
// pan and reverb send, plus the music moods) offline, twice: once with the set
// on `--base` (default main) and once with the working tree's set, and writes
// old + gap + new as one MP3.
//
//   node tools/probes/sound-sync-probe.js --out <dir> --label v2
//   node tools/probes/render-timeline.js <dir>/v2-sound-sync.json --out clip.mp3 [--base main]
//     [--windows "multiplied win=9.5,big win=12,scatter trigger + free spins + retrigger=10"]
//
// --windows keeps that many seconds from the start of each named scenario, so
// ~30 s per set covers a multiplier, a big win and a scatter trigger.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const FF = require("ffmpeg-static");

const ROOT = path.join(__dirname, "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const TIMELINE = args[0];
const OUT = path.resolve(opt("out", "before-after.mp3"));
const BASE = opt("base", "main");
const WINDOWS = Object.fromEntries(opt("windows", "multiplied win=9.5,big win=12,scatter trigger + free spins + retrigger=10").split(",").map((w) => { const [k, v] = w.split("="); return [k.trim(), Number(v)]; }));
const SR = 48000;
const BUS = { sfx: 1, ui: 0.4, music: 0.42 };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vx-render-"));
const dbToGain = (db) => Math.pow(10, db / 20);

function decode(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 29 });
  const b = r.stdout; const n = Math.floor(b.length / 8);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = b.readFloatLE(i * 8); R[i] = b.readFloatLE(i * 8 + 4); }
  return { L, R, n };
}
function writeWav(file, L, R) {
  const n = L.length; const buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write("data", 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(L[i], 44 + i * 8); buf.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(file, buf);
}

/** The base's audio folder, extracted to a temp dir. */
function baseAudioDir() {
  const dir = path.join(TMP, "base");
  fs.mkdirSync(dir, { recursive: true });
  // File by file from git (no tar: Windows tar reads "C:" as a host name).
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", BASE, "client/assets/audio"], { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/).filter((f) => /\.(ogg|json)$/.test(f));
  for (const f of files) {
    const to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, execFileSync("git", ["show", `${BASE}:${f}`], { cwd: ROOT, maxBuffer: 1 << 28 }));
  }
  return path.join(dir, "client", "assets", "audio");
}

/** Which scenario windows to keep: the first WINDOWS[name] seconds of each named one. */
function windows(plays) {
  const byScenario = new Map();
  for (const p of plays) if (!byScenario.has(p.scenario)) byScenario.set(p.scenario, p.t);
  return [...byScenario.entries()].filter(([s]) => WINDOWS[s]).map(([s, t0]) => ({ s, t0, t1: t0 + WINDOWS[s] * 1000 }));
}

function render(dir, data, { reverb }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const cache = new Map();
  const load = (rel) => { if (!cache.has(rel)) { const f = path.join(dir, `${rel}.ogg`); cache.set(rel, fs.existsSync(f) ? decode(f) : null); } return cache.get(rel); };
  const rr = new Map();
  const variant = (key) => {
    const alias = { win_epic: "win_mega" }; // a key the old set did not have
    const files = manifest.sounds[key] || manifest.sounds[alias[key]] || [];
    if (!files.length) return null;
    const i = ((rr.get(key) ?? -1) + 1) % files.length; rr.set(key, i);
    return files[i];
  };
  const wins = windows(data.sounds);
  const total = wins.reduce((a, w) => a + (w.t1 - w.t0), 0) / 1000 + 2;
  const N = Math.ceil(total * SR);
  const L = new Float32Array(N), R = new Float32Array(N), WL = new Float32Array(N), WR = new Float32Array(N);
  const place = (rel, atS, { gain = 1, rate = 1, pan = 0, send = 0, maxS = Infinity } = {}) => {
    const b = load(rel); if (!b) return;
    const start = Math.round(atS * SR);
    const len = Math.min(Math.floor((b.n - 1) / rate), Math.round(maxS * SR), N - start);
    // StereoPanner on a stereo source: equal-power balance.
    const p = Math.max(-1, Math.min(1, pan));
    const gl = p <= 0 ? 1 : Math.cos((p * Math.PI) / 2), gr = p >= 0 ? 1 : Math.cos((-p * Math.PI) / 2);
    for (let i = 0; i < len; i++) {
      const x = i * rate, j = Math.floor(x), f = x - j;
      const l = (b.L[j] * (1 - f) + b.L[j + 1] * f) * gain * gl, r = (b.R[j] * (1 - f) + b.R[j + 1] * f) * gain * gr;
      L[start + i] += l; R[start + i] += r;
      if (send) { WL[start + i] += l * send; WR[start + i] += r * send; }
    }
  };
  // Map each window onto the output clock back to back.
  let offset = 0;
  for (const w of wins) {
    const at = (t) => offset + (t - w.t0) / 1000;
    let mood = null;
    for (const s of data.sounds.filter((x) => x.scenario === w.s && x.t >= w.t0 && x.t < w.t1)) {
      if (s.name.startsWith("music:")) { mood = s.name.slice(6); continue; }
      if (s.name === "drone") { const f = variant("riser"); if (f) place(f, at(s.t), { gain: dbToGain(-6), maxS: 2.5, send: reverb ? 0.14 : 0 }); continue; }
      if (!s.played || !s.voice) continue;
      const f = variant(s.key); if (!f) continue;
      const v = s.voice;
      place(f, at(s.t), { gain: dbToGain(v.db || 0) * (BUS[v.bus] ?? 1), rate: v.rate || 1, pan: v.pan || 0, send: reverb ? v.send || 0 : 0 });
    }
    // Music bed for the window (the mood in force when it started).
    const m = manifest.music[mood || "base"] || manifest.music.base;
    if (m) { const b = load(m); if (b) { for (let t = 0; t < (w.t1 - w.t0) / 1000; t += b.n / SR) place(m, offset + t, { gain: BUS.music * dbToGain(-4), maxS: (w.t1 - w.t0) / 1000 - t }); } }
    offset += (w.t1 - w.t0) / 1000;
  }
  const dry = path.join(TMP, `dry_${reverb ? "new" : "old"}.wav`);
  writeWav(dry, L, R);
  if (!reverb || !manifest.ir) return dry;
  const wet = path.join(TMP, "wet.wav");
  writeWav(wet, WL, WR);
  const mixed = path.join(TMP, "mixed_new.wav");
  spawnSync(FF, ["-hide_banner", "-y", "-i", dry, "-i", wet, "-i", path.join(dir, `${manifest.ir}.ogg`), "-filter_complex",
    "[1:a][2:a]afir=gtype=peak:wet=10:dry=0[w];[0:a][w]amix=inputs=2:normalize=0:duration=first[o]", "-map", "[o]", mixed]);
  return mixed;
}

const data = JSON.parse(fs.readFileSync(TIMELINE, "utf8"));
const oldWav = render(baseAudioDir(), data, { reverb: false });
const newWav = render(path.join(ROOT, "client", "assets", "audio"), data, { reverb: true });
// old · 1.5 s gap · new, each limited at -1 dBFS, at matched loudness.
const r = spawnSync(FF, ["-hide_banner", "-y", "-i", oldWav, "-i", newWav, "-filter_complex",
  "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.89[a];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.89[b];anullsrc=r=48000:cl=stereo,atrim=0:1.5[g];[a][g][b]concat=n=3:v=0:a=1[o]",
  "-map", "[o]", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", OUT], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const dur = (r.stderr.match(/time=(\d+):(\d+):([\d.]+)/g) || []).pop();
console.log(`wrote ${OUT} (${dur || "?"}): ${BASE} set, 1.5 s gap, new set`);
fs.rmSync(TMP, { recursive: true, force: true });
