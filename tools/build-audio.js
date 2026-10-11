#!/usr/bin/env node
"use strict";

// Builds the game's sound files from the picks in art-src/audio/selection.json
// (made on the audition page: npm run audition).
//
//   node tools/build-audio.js           build client/assets/audio/{sfx,music,ir}/* + manifest.json
//   node tools/build-audio.js --check   verify the built set (licence rows, sources, peaks, onsets, sizes)
//
// Every pick is copied from art-src/audio/candidates/ (or incoming/) into
// art-src/audio/freesound/ (or user/), and its Freesound licence row is written
// into client/assets/audio/LICENSES.md from candidates.json. Each sound key is a
// recipe of picks (layers: pick, gain dB, delay ms, start ms) with its own
// processing (high-pass, low-pass, pitch, gentle compression), trimmed and
// faded so its tail never smears the next beat, levelled to its loudness tier
// (UI < tick < base < win < feature < peak) with peaks capped so no file
// exceeds -1 dBFS. Sounds are stereo; panned per-column sounds and tiny ticks
// are mono. Each key also gets a reverb send amount (by tier) in the manifest;
// the engine (client/audio/audio.js) feeds it to one shared convolution reverb
// built from the picked impulse response. Music moods are stereo and made
// seamless (tail crossfaded into head). Output is Opus in Ogg + AAC in .m4a.
//
// Sources and licences: client/assets/audio/LICENSES.md (one row per original).
// Needs the ffmpeg-static devDependency.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const FF = require("ffmpeg-static");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "art-src", "audio");
const OUT = path.join(ROOT, "client", "assets", "audio");
const SELECTION = path.join(SRC, "selection.json");
const CANDIDATES = path.join(SRC, "candidates", "candidates.json");
const LICENSES = path.join(OUT, "LICENSES.md");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "vx-audio-"));

// Loudness tiers: RMS dBFS of the levelled file (the engine's bus gains and
// per-event offsets sit on top). UI also sits on a -8 dB bus.
const TARGET = { ui: -22, tick: -24, base: -20, win: -17, feature: -15, peak: -13, music: -20 };
// Reverb send by tier (0 = dry). Frequent sounds stay close, big moments open up.
const SEND = { ui: 0, tick: 0.03, base: 0.07, win: 0.14, feature: 0.22, peak: 0.28 };
const PEAK_CAP = -4.5; // before encoding: AAC overshoots sharp transients by up to ~3.5 dB
// A beat-synced sound reaches within 6 dB of its peak this soon after it starts.
const ONSET_MS = 40;

// ── the picks ──
const selection = JSON.parse(fs.readFileSync(SELECTION, "utf8"));
const candidates = fs.existsSync(CANDIDATES) ? JSON.parse(fs.readFileSync(CANDIDATES, "utf8")) : { events: {} };
/** Where a pick lives once imported (freesound/<file> or user/<file>). */
function importedPath(ev) {
  const p = selection.picks[ev];
  if (!p || !p.file) throw new Error(`selection.json has no pick for "${ev}" (pick one: npm run audition)`);
  const base = path.basename(p.file);
  return p.file.startsWith("incoming/") ? `user/${base}` : p.file.startsWith("candidates/") ? `freesound/${base}` : p.file;
}
const P = (ev) => importedPath(ev);

// key → { tier, mono?, onset?, variations: [ { layers: [[src, db, delayMs, startMs]], max (s), fadeOut (ms), hp, lp, pitch, comp } ] }
// One identity per key: extra variations are close takes of the same recording
// (a hair of pitch), so a repeat never sounds like a different event.
const takes = (n, v) => [1, 0.97, 1.03, 1.06].slice(0, n).map((pitch) => ({ ...v, pitch: (v.pitch || 1) * pitch }));
const SOUNDS = {
  // UI: soft, short, no tail.
  ui_click: { tier: "ui", mono: true, variations: takes(2, { layers: [[P("ui_click"), 0, 0]], max: 0.07, fadeOut: 15, hp: 300 }) },
  ui_toggle: { tier: "ui", mono: true, variations: [{ layers: [[P("ui_toggle"), 0, 0]], max: 0.08, fadeOut: 15, hp: 300 }] },
  ui_confirm: { tier: "ui", mono: true, variations: [{ layers: [[P("ui_confirm"), 0, 0]], max: 0.11, fadeOut: 25, hp: 150 }] },
  // Base game.
  spin_start: { tier: "base", variations: [{ layers: [[P("spin_start"), 0, 0, 45], [P("refill"), -10, 0]], max: 0.38, fadeOut: 90, hp: 60, comp: true }] },
  reel_stop: { tier: "base", mono: true, variations: takes(3, { layers: [[P("reel_stop"), 0, 0]], max: 0.3, fadeOut: 110, hp: 40 }) },
  tick: { tier: "tick", mono: true, variations: takes(4, { layers: [[P("tick"), 0, 0]], max: 0.12, fadeOut: 40, hp: 400 }) },
  refill: { tier: "base", onset: false, variations: [{ layers: [[P("refill"), 0, 0]], max: 0.4, fadeOut: 120, hp: 120 }] },
  // Wins.
  win_light: { tier: "win", variations: [{ layers: [[P("win_light"), 0, 0]], max: 1.2, fadeOut: 500, hp: 300, comp: true }] },
  explode: { tier: "win", variations: takes(3, { layers: [[P("explode"), 0, 0]], max: 1.2, fadeOut: 450, hp: 80, comp: true }) },
  explode_great: { tier: "win", variations: takes(2, { layers: [[P("explode"), 0, 0], [P("sub_impact"), -6, 0]], max: 1.6, fadeOut: 550, hp: 30, comp: true }) },
  win_tick: { tier: "tick", mono: true, variations: takes(4, { layers: [[P("win_tick"), 0, 0]], max: 0.17, fadeOut: 50, hp: 300 }) },
  win_land: { tier: "win", variations: takes(2, { layers: [[P("win_land"), 0, 0, 40]], max: 0.5, fadeOut: 150, hp: 200 }) },
  win_small: { tier: "win", variations: [{ layers: [[P("win_land"), 0, 0, 40], [P("win_light"), -8, 0]], max: 1.0, fadeOut: 400, hp: 150 }] },
  combine_total: { tier: "win", variations: [{ layers: [[P("combine_total"), 0, 0]], max: 1.0, fadeOut: 300, hp: 150 }] },
  // Multipliers.
  strike: { tier: "win", variations: [{ layers: [[P("strike"), 0, 0], [P("thunder"), -6, 80]], max: 1.4, fadeOut: 600, hp: 40, comp: true }] },
  bang: { tier: "win", variations: takes(2, { layers: [[P("bang"), 0, 0]], max: 0.9, fadeOut: 350, hp: 100 }) },
  bang_big: { tier: "win", variations: takes(2, { layers: [[P("bang"), 0, 0], [P("sub_impact"), -5, 0]], max: 1.6, fadeOut: 550, hp: 30, comp: true }) },
  soul_launch: { tier: "base", onset: false, variations: [{ layers: [[P("soul_launch"), 0, 0]], max: 0.3, fadeOut: 80, hp: 150 }] },
  catch: { tier: "win", variations: [{ layers: [[P("catch"), 0, 0]], max: 0.25, fadeOut: 60, hp: 200 }] },
  combine_enter: { tier: "base", onset: false, variations: [{ layers: [[P("soul_launch"), 0, 0]], max: 0.35, fadeOut: 100, hp: 150, pitch: 0.9 }] },
  combine_slam: { tier: "win", variations: takes(2, { layers: [[P("combine_slam"), 0, 0]], max: 0.45, fadeOut: 150, hp: 40, comp: true }) },
  // The total locks in: the lock-in click, deeper, with a touch of the impact.
  combine: { tier: "win", variations: [{ layers: [[P("catch"), 0, 0], [P("combine_slam"), -12, 0]], max: 0.4, fadeOut: 120, hp: 60, pitch: 0.85 }] },
  // Scatters & feature.
  scatter: { tier: "win", variations: [{ layers: [[P("scatter"), 0, 0]], max: 1.6, fadeOut: 500, hp: 150 }] },
  riser: { tier: "win", onset: false, variations: [{ layers: [[P("riser"), 0, 0]], max: 8, fadeOut: 60, hp: 60 }] },
  scatter_catch: { tier: "feature", variations: takes(2, { layers: [[P("scatter_catch"), 0, 0, 45], [P("sub_impact"), -10, 0]], max: 3.5, fadeOut: 1200, hp: 30 }) },
  feature_award: { tier: "feature", variations: [{ layers: [[P("vault_slam"), 0, 0, 40], [P("feature_award"), -1, 120]], max: 3.2, fadeOut: 900, hp: 40, comp: true }] },
  feature_more: { tier: "feature", variations: [{ layers: [[P("feature_more"), 0, 0]], max: 1.4, fadeOut: 400, hp: 60 }] },
  fs_intro: { tier: "feature", onset: false, variations: [{ layers: [[P("fs_intro"), 0, 0]], max: 3.2, fadeOut: 900, hp: 30 }] },
  // Its first note lands at once; the loudest chord comes ~250 ms later (a closing flourish).
  fs_outro: { tier: "feature", onset: false, variations: [{ layers: [[P("fs_outro"), 0, 0]], max: 3.0, fadeOut: 900, hp: 40 }] },
  buy: { tier: "feature", variations: [{ layers: [[P("buy"), 0, 0]], max: 1.3, fadeOut: 400, hp: 120 }] },
  // Big wins: escalating (Big < Mega < Epic < Max), each a layer bigger.
  bigwin_open: { tier: "peak", variations: [{ layers: [[P("bigwin_open"), 0, 0], [P("sub_impact"), -6, 0]], max: 1.6, fadeOut: 500, hp: 25, comp: true }] },
  win_big: { tier: "peak", variations: [{ layers: [[P("win_big"), 0, 0, 25]], max: 3.0, fadeOut: 900, hp: 30 }] },
  win_mega: { tier: "peak", variations: [{ layers: [[P("win_mega"), 0, 0], [P("sub_impact"), -8, 0]], max: 2.6, fadeOut: 800, hp: 25, comp: true }] },
  win_epic: { tier: "peak", variations: [{ layers: [[P("win_mega"), 0, 0], [P("choir"), -4, 0], [P("sub_impact"), -6, 0]], max: 3.5, fadeOut: 1000, hp: 25, comp: true }] },
  max_win: { tier: "peak", variations: [{ layers: [[P("max_win"), 0, 0], [P("choir"), -3, 0], [P("sub_impact"), -4, 0], [P("scatter_catch"), -10, 0]], max: 5, fadeOut: 1500, hp: 25, comp: true }] }
};
// The shared reverb's impulse response.
const IR = { src: P("reverb_ir"), max: 2.0, fadeOut: 400 };

// The three music moods: source, the section used (s), loop crossfade (s).
const MUSIC = {
  base: { src: "oga/desert_mystic2.mp3", start: 0, end: 56.0, xfade: 2.5 },
  freeSpins: { src: "oga/hidden_temple.ogg", start: 0, end: 67.4, xfade: 2.5 },
  bigWin: { src: "oga/determined_pursuit_0-40s.ogg", start: 0, end: 32, xfade: 1.5 }
};
const MUSIC_FILE = { base: "base", freeSpins: "free_spins", bigWin: "big_win" };
// Sound effects may not come from the old game-asset packs any more.
const BANNED_SFX = /^(kenney|oga)\//;

// Size budgets (bytes, per encoded file).
const BUDGET = { sfx: 160 * 1024, music: 1300 * 1024, ir: 120 * 1024 };

function ff(args) {
  const r = spawnSync(FF, ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}\n${r.stderr}`);
  return r.stderr;
}
function stats(file) {
  const err = ff(["-i", file, "-af", "astats=metadata=0", "-f", "null", "-"]);
  const last = (re) => { const m = err.match(re); return m ? Number(m[m.length - 1].split(": ")[1]) : -120; };
  const rms = last(/RMS level dB: (-?[\d.]+)/g);
  const peak = last(/Peak level dB: (-?[\d.]+)/g);
  const dur = (() => { const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; })();
  return { rms, peak, dur };
}
/** ms from a file's start until its level first comes within 6 dB of its peak. */
function onsetMs(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const pcm = r.stdout;
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  const gate = peak / 2; // -6 dB
  for (let i = 0; i + 1 < pcm.length; i += 2) if (Math.abs(pcm.readInt16LE(i)) >= gate) return Math.round(i / 2 / 16);
  return 0;
}
/** Encode both formats; if a codec overshoots past -1.2 dBFS, re-encode that one quieter. */
function encode(wav, base, stereo) {
  const ch = String(stereo ? 2 : 1);
  const codecs = {
    ogg: ["-c:a", "libopus", "-b:a", stereo ? "96k" : "64k", "-vbr", "on", "-application", "audio"],
    m4a: ["-c:a", "aac", "-b:a", stereo ? "128k" : "96k", "-movflags", "+faststart"]
  };
  for (const [ext, args] of Object.entries(codecs)) {
    let trimDb = 0;
    for (let i = 0; i < 4; i++) {
      ff(["-i", wav, "-ac", ch, ...(trimDb ? ["-af", `volume=${trimDb.toFixed(2)}dB`] : []), ...args, `${base}.${ext}`]);
      const over = stats(`${base}.${ext}`).peak + 1.2;
      if (over <= 0) break;
      trimDb -= over + 0.2;
    }
  }
}

/** Copy every pick into art-src/audio/freesound/ (or user/) and write the Freesound licence rows. */
function importPicks() {
  const rows = [];
  for (const [ev, p] of Object.entries(selection.picks)) {
    if (!p || !p.file) continue;
    const to = path.join(SRC, importedPath(ev));
    const from = path.join(SRC, p.file);
    if (!fs.existsSync(to)) {
      if (!fs.existsSync(from)) throw new Error(`${ev}: ${p.file} is neither imported nor in candidates/ (re-fetch: npm run audition:fetch)`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    const c = (candidates.events[ev] || []).find((x) => x.file === p.file);
    if (c) rows.push(`| ${path.basename(to)} | ${c.title.replace(/\|/g, "/")} (${c.author}) | ${c.url} | ${c.license} | \`${ev}\` |`);
  }
  // The generated block sits between markers; everything else in LICENSES.md is hand-written.
  const block = ["<!-- freesound:start (generated by tools/build-audio.js from selection.json + candidates.json) -->", "",
    "## Freesound.org, CC0 1.0", "", "Each file is the HQ preview of a CC0 1.0 sound (licence checked on its page), kept in `art-src/audio/freesound/`.", "",
    "| Original | Sound (author) | Source | Licence | Pick for |", "|---|---|---|---|---|", ...rows.sort(), "", "<!-- freesound:end -->"].join("\n");
  let lic = fs.readFileSync(LICENSES, "utf8").replace(/\r\n/g, "\n");
  lic = /<!-- freesound:start[\s\S]*?<!-- freesound:end -->/.test(lic)
    ? lic.replace(/<!-- freesound:start[\s\S]*?<!-- freesound:end -->/, block)
    : lic.replace(/\n## /, `\n${block}\n\n## `);
  fs.writeFileSync(LICENSES, lic);
}

function buildVariation(key, def, v, idx) {
  const stereo = !def.mono;
  const layout = stereo ? "stereo" : "mono";
  const inputs = [];
  const parts = [];
  v.layers.forEach(([file, db, delay, startMs], i) => {
    const p = path.join(SRC, file);
    if (!fs.existsSync(p)) throw new Error(`${key}: missing source ${file}`);
    inputs.push("-i", p);
    const trim = startMs ? `atrim=start=${(startMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,` : "";
    const d = delay || 0;
    // Lead-in silence first, then startMs cuts a slow rise so the hit lands on the beat.
    parts.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=${layout},silenceremove=start_periods=1:start_threshold=-50dB,${trim}volume=${db}dB,adelay=${d}|${d}[l${i}]`);
  });
  const mix = v.layers.length > 1 ? `${v.layers.map((_, i) => `[l${i}]`).join("")}amix=inputs=${v.layers.length}:normalize=0:duration=longest[m]` : `[l0]anull[m]`;
  // Processing: pitch (a close take), high-pass, low-pass, gentle compression.
  const fx = [];
  if (v.pitch && v.pitch !== 1) fx.push(`asetrate=${Math.round(48000 * v.pitch)},aresample=48000`);
  if (v.hp) fx.push(`highpass=f=${v.hp}`);
  if (v.lp) fx.push(`lowpass=f=${v.lp}`);
  if (v.comp) fx.push("acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120:makeup=1");
  const fade = v.fadeOut ? `,afade=t=out:st=${Math.max(0, v.max - v.fadeOut / 1000).toFixed(3)}:d=${(v.fadeOut / 1000).toFixed(3)}` : "";
  const raw = path.join(TMP, `${key}_${idx}_raw.wav`);
  ff([...inputs, "-filter_complex", `${parts.join(";")};${mix};[m]${fx.length ? fx.join(",") + "," : ""}atrim=0:${v.max},afade=t=in:d=0.003${fade}[o]`, "-map", "[o]", "-ar", "48000", raw]);
  const s = stats(raw);
  const gain = Math.min(TARGET[def.tier] - s.rms, PEAK_CAP - s.peak);
  const lev = path.join(TMP, `${key}_${idx}.wav`);
  ff(["-i", raw, "-af", `volume=${gain.toFixed(2)}dB`, lev]);
  const name = `sfx/${key}_${idx + 1}`;
  encode(lev, path.join(OUT, name), stereo);
  return name;
}

function buildIr() {
  const raw = path.join(TMP, "ir.wav");
  ff(["-i", path.join(SRC, IR.src), "-af", `aformat=sample_rates=48000:channel_layouts=stereo,silenceremove=start_periods=1:start_threshold=-60dB,atrim=0:${IR.max},afade=t=out:st=${(IR.max - IR.fadeOut / 1000).toFixed(3)}:d=${(IR.fadeOut / 1000).toFixed(3)}`, raw]);
  const s = stats(raw);
  const lev = path.join(TMP, "ir_lev.wav");
  ff(["-i", raw, "-af", `volume=${(-3 - s.peak).toFixed(2)}dB`, lev]); // the engine normalises it; keep headroom for the codec
  const name = "ir/room";
  encode(lev, path.join(OUT, name), true);
  return name;
}

function buildMusic(mood, m) {
  const p = path.join(SRC, m.src);
  const X = m.xfade;
  const raw = path.join(TMP, `music_${mood}.wav`);
  // Seamless loop: [tail ⨯ head crossfade] + body.
  const fc = [
    `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=3[a][b][c]`,
    `[a]atrim=${m.start}:${m.start + X},asetpts=PTS-STARTPTS[head]`,
    `[b]atrim=${m.end - X}:${m.end},asetpts=PTS-STARTPTS[tail]`,
    `[c]atrim=${m.start + X}:${m.end - X},asetpts=PTS-STARTPTS[body]`,
    `[tail][head]acrossfade=d=${X}:c1=qsin:c2=qsin[xf]`,
    `[xf][body]concat=n=2:v=0:a=1[o]`
  ].join(";");
  ff(["-i", p, "-filter_complex", fc, "-map", "[o]", raw]);
  const s = stats(raw);
  const gain = Math.min(TARGET.music - s.rms, PEAK_CAP - s.peak);
  const lev = path.join(TMP, `music_${mood}_lev.wav`);
  ff(["-i", raw, "-af", `volume=${gain.toFixed(2)}dB`, lev]);
  const name = `music/${MUSIC_FILE[mood]}`;
  encode(lev, path.join(OUT, name), true);
  return name;
}

function build() {
  importPicks();
  for (const d of ["sfx", "music", "ir"]) {
    fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
  }
  const manifest = { version: 2, formats: ["ogg", "m4a"], sounds: {}, sends: {}, music: {}, ir: null };
  for (const [key, def] of Object.entries(SOUNDS)) {
    manifest.sounds[key] = def.variations.map((v, i) => buildVariation(key, def, v, i));
    manifest.sends[key] = SEND[def.tier];
    process.stdout.write(`${key} (${def.variations.length}) `);
  }
  manifest.ir = buildIr();
  for (const [mood, m] of Object.entries(MUSIC)) {
    manifest.music[mood] = buildMusic(mood, m);
    process.stdout.write(`music:${mood} `);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("\nbuilt", path.relative(ROOT, OUT));
}

function check() {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const licences = fs.readFileSync(LICENSES, "utf8");
  const problems = [];
  const used = new Set();
  for (const [key, def] of Object.entries(SOUNDS)) for (const v of def.variations) for (const [f] of v.layers) {
    used.add(f);
    if (BANNED_SFX.test(f)) problems.push(`${key} is still built from an old game-asset pack (${f})`);
    if (!fs.existsSync(path.join(SRC, f))) problems.push(`${key}: source ${f} is missing (run the build to import picks)`);
  }
  used.add(IR.src);
  for (const m of Object.values(MUSIC)) used.add(m.src);
  for (const f of used) if (!licences.includes(path.basename(f))) problems.push(`no licence row for ${f}`);
  for (const key of Object.keys(SOUNDS)) if (!manifest.sounds[key]) problems.push(`manifest has no ${key} (rebuild)`);
  if (!manifest.ir) problems.push("manifest has no reverb impulse response");
  const files = [...Object.values(manifest.sounds).flat().map((n) => ["sfx", n]), ...Object.values(manifest.music).map((n) => ["music", n]), ...(manifest.ir ? [["ir", manifest.ir]] : [])];
  let total = 0;
  for (const [kind, n] of files) {
    for (const ext of manifest.formats) {
      const p = path.join(OUT, `${n}.${ext}`);
      if (!fs.existsSync(p)) { problems.push(`missing ${n}.${ext}`); continue; }
      const size = fs.statSync(p).size;
      total += ext === "ogg" ? size : 0;
      if (size > BUDGET[kind]) problems.push(`${n}.${ext} is ${Math.round(size / 1024)} KB (budget ${BUDGET[kind] / 1024} KB)`);
      const s = stats(p);
      // Headroom: no file above -1 dBFS (the limiter catches stacked voices).
      if (s.peak > -1) problems.push(`${n}.${ext} peaks at ${s.peak.toFixed(1)} dBFS (limit -1)`);
    }
  }
  // Onset: a sound tied to a visual beat must hit at once, not swell into it.
  const onsets = [];
  for (const [key, def] of Object.entries(SOUNDS)) {
    if (def.onset === false) continue;
    for (const n of manifest.sounds[key] || []) {
      const ms = onsetMs(path.join(OUT, `${n}.ogg`));
      onsets.push(`${key}:${ms}`);
      if (ms > ONSET_MS) problems.push(`${n} reaches its peak ${ms}ms after it starts (onset limit ${ONSET_MS}ms)`);
    }
  }
  console.log(`onset (ms to within 6 dB of peak): ${onsets.join(" ")}`);
  console.log(`${files.length} files, ${(total / 1024).toFixed(0)} KB (ogg set)`);
  if (problems.length) { console.log(problems.map((p) => "  FAIL " + p).join("\n")); process.exit(1); }
  console.log("audio check: PASS");
}

module.exports = { SOUNDS, TARGET, SEND, IR, MUSIC };
if (require.main === module) {
  try {
    if (process.argv.includes("--check")) check();
    else build();
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
} else {
  fs.rmSync(TMP, { recursive: true, force: true });
}
