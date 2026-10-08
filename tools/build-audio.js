#!/usr/bin/env node
"use strict";

// Builds the game's sound files from the licensed originals in art-src/audio/.
//
//   node tools/build-audio.js           build client/assets/audio/{sfx,music}/* + manifest.json
//   node tools/build-audio.js --check   verify the built set (licence rows, loudness, peaks, sizes)
//
// Every sound key has 1-4 variations; a variation is a recipe of layers
// (file, gain dB, delay ms) mixed in mono at 48 kHz, trimmed, faded, then
// levelled to its bus's target RMS (peaks capped at -3 dBFS before encoding). Music moods are
// stereo and made seamless: the loop's tail is crossfaded into its head. Each
// output is encoded twice: Opus in Ogg (most browsers) and AAC in .m4a
// (Safari); the engine (client/audio/audio.js) picks what the browser decodes.
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
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "vx-audio-"));

// Bus loudness targets (RMS dBFS of the levelled file; the engine's bus gains
// and per-event offsets sit on top).
const TARGET = { sfx: -18, ui: -22, sting: -16, tick: -24, music: -20 };
const PEAK_CAP = -3; // before encoding: lossy codecs overshoot by up to ~2 dB

const k = (pack, file) => `kenney/${pack}/${file}`;
const o = (file) => `oga/${file}`;
// key → { bus, variations: [ { layers: [[file, db, delayMs]], max (s), fadeOut (ms) } ] }
const SOUNDS = {
  ui_click: { bus: "ui", variations: [k("interface-sounds", "click_001.ogg"), k("interface-sounds", "click_003.ogg")].map((f) => ({ layers: [[f, 0, 0]], max: 0.12 })) },
  ui_bet: { bus: "ui", variations: [{ layers: [[k("interface-sounds", "select_002.ogg"), 0, 0]], max: 0.1 }] },
  ui_turbo_on: { bus: "ui", variations: [{ layers: [[k("interface-sounds", "maximize_002.ogg"), 0, 0]], max: 0.3 }] },
  ui_turbo_off: { bus: "ui", variations: [{ layers: [[k("interface-sounds", "minimize_002.ogg"), 0, 0]], max: 0.3 }] },
  // A spin kicks off: an air whoosh over a soft low push.
  spin_start: { bus: "sfx", variations: [
    { layers: [[o("sfx100v2_air_02.ogg"), 0, 0], [k("impact-sounds", "impactSoft_heavy_001.ogg"), -12, 0]], max: 0.6, fadeOut: 220 },
    { layers: [[o("sfx100v2_air_03.ogg"), 0, 0], [o("swish-9.wav"), -4, 40], [k("impact-sounds", "impactSoft_heavy_003.ogg"), -12, 0]], max: 0.5, fadeOut: 180 }
  ] },
  // A reel lands as a stack: a deep soft thud with a heavy plate on top.
  reel_stop: { bus: "sfx", variations: [0, 2, 4].map((i) => ({
    layers: [[k("impact-sounds", `impactSoft_heavy_00${i}.ogg`), 0, 0], [k("impact-sounds", `impactPlate_heavy_00${i}.ogg`), -9, 0]], max: 0.38, fadeOut: 140 })) },
  // One light crystal tink per symbol landing.
  tick: { bus: "tick", variations: [0, 1, 2, 3].map((i) => ({ layers: [[k("impact-sounds", `impactGlass_light_00${i}.ogg`), 0, 0]], max: 0.16, fadeOut: 60 })) },
  // A tumble refill: a short airy swish.
  refill: { bus: "sfx", variations: ["swish-3.wav", "swish-4.wav", "swish-7.wav"].map((f) => ({ layers: [[o(f), 0, 0]], max: 0.25, fadeOut: 60 })) },
  // A cluster bursts: glass breaking; a great burst adds a low crunch.
  explode: { bus: "sfx", variations: [0, 1, 3].map((i) => ({ layers: [[k("impact-sounds", `impactGlass_medium_00${i}.ogg`), 0, 0]], max: 0.55, fadeOut: 160 })) },
  explode_great: { bus: "sfx", variations: [0, 1].map((i) => ({
    layers: [[k("impact-sounds", `impactGlass_medium_00${i + 2}.ogg`), 0, 0], [k("sci-fi-sounds", `explosionCrunch_00${i}.ogg`), -6, 0]], max: 0.85, fadeOut: 300 })) },
  // The scatter anticipation: a recorded air swell, looped by the engine (it raises its pitch and opens a filter).
  riser: { bus: "sfx", variations: [{ layers: [[o("sfx100v2_air_01.ogg"), 0, 0]], max: 2.4, fadeOut: 40 }] },
  // The win meter counting: chip clinks.
  win_tick: { bus: "sfx", variations: [1, 2, 3, 4].map((i) => ({ layers: [[k("casino-audio", `chips-collide-${i}.ogg`), 0, 0]], max: 0.2, fadeOut: 60 })) },
  // A scatter lands: a gem sparkle (the engine raises it a step per scatter).
  scatter: { bus: "sfx", variations: ["item_gem_01.ogg", "item_gem_03.ogg"].map((f) => ({ layers: [[o(f), 0, 0]], max: 0.35, fadeOut: 80 })) },
  // Multiplier BANG: a temple bell over a soft low thud; a big one adds a low blast.
  bang: { bus: "sfx", variations: [2, 3].map((i) => ({
    layers: [[k("impact-sounds", `impactBell_heavy_00${i}.ogg`), 0, 0], [k("impact-sounds", "impactSoft_heavy_000.ogg"), -6, 0]], max: 0.8, fadeOut: 250 })) },
  bang_big: { bus: "sfx", variations: [0, 1].map((i) => ({
    layers: [[k("impact-sounds", `impactBell_heavy_00${i}.ogg`), 0, 0], [k("sci-fi-sounds", "lowFrequency_explosion_001.ogg"), -4, 0]], max: 1.5, fadeOut: 500 })) },
  // The lightning strike: a sharp metal crack, then thunder rolling off.
  strike: { bus: "sfx", variations: [0, 1].map((i) => ({
    layers: [[k("impact-sounds", `impactMetal_heavy_00${i}.ogg`), 0, 0], [k("impact-sounds", `impactGlass_light_00${i + 3}.ogg`), -8, 0], [o("sfx100v2_thunder_01.ogg"), -2, 20]], max: 1.4, fadeOut: 600 })) },
  // A multiplier caught / combined: magic.
  catch: { bus: "sfx", variations: [{ layers: [[o("spell_02.ogg"), 0, 0]], max: 0.55, fadeOut: 150 }, { layers: [[o("item_gem_04.ogg"), 0, 0], [o("spell_02.ogg"), -8, 0]], max: 0.55, fadeOut: 150 }] },
  combine: { bus: "sfx", variations: [{ layers: [[o("spell_01.ogg"), 0, 0], [k("impact-sounds", "impactBell_heavy_003.ogg"), -5, 120]], max: 0.9, fadeOut: 300 }] },
  // Stings: orchestral hits, sized to the moment.
  win_small: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT01.ogg"), 0, 0], [k("casino-audio", "chips-collide-2.ogg"), -10, 0]], max: 0.6 }] },
  win_big: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT09.ogg"), 0, 0], [k("impact-sounds", "impactBell_heavy_002.ogg"), -8, 0]], max: 1.0, fadeOut: 300 }] },
  win_mega: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT11.ogg"), 0, 0], [k("impact-sounds", "impactBell_heavy_000.ogg"), -6, 0]], max: 1.4, fadeOut: 400 }] },
  max_win: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT15.ogg"), 0, 0], [k("sci-fi-sounds", "lowFrequency_explosion_000.ogg"), -6, 0], [k("impact-sounds", "impactBell_heavy_001.ogg"), -6, 0]], max: 1.8, fadeOut: 500 }] },
  bonus_trigger: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT15.ogg"), 0, 0], [k("impact-sounds", "impactBell_heavy_001.ogg"), -6, 0], [o("spell_01.ogg"), -8, 0]], max: 1.7, fadeOut: 500 }] },
  fs_intro: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT03.ogg"), 0, 0], [o("sfx100v2_air_02.ogg"), -10, 0]], max: 1.0, fadeOut: 300 }] },
  fs_outro: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT10.ogg"), 0, 0], [k("impact-sounds", "impactBell_heavy_002.ogg"), -8, 0]], max: 1.0, fadeOut: 300 }] },
  buy: { bus: "sting", variations: [{ layers: [[k("music-jingles", "jingles_HIT05.ogg"), 0, 0], [k("casino-audio", "chips-collide-3.ogg"), -8, 0]], max: 0.8, fadeOut: 250 }] }
};

// The three music moods: source, the section used (s), loop crossfade (s).
const MUSIC = {
  base: { src: o("desert_mystic2.mp3"), start: 0, end: 56.0, xfade: 2.5 },
  freeSpins: { src: o("hidden_temple.ogg"), start: 0, end: 67.4, xfade: 2.5 },
  bigWin: { src: o("determined_pursuit_0-40s.ogg"), start: 0, end: 32, xfade: 1.5 }
};
const MUSIC_FILE = { base: "base", freeSpins: "free_spins", bigWin: "big_win" };

// Size budgets (bytes, per encoded file).
const BUDGET = { sfx: 120 * 1024, music: 1300 * 1024 };

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
function encode(wav, base, stereo) {
  const ch = stereo ? 2 : 1;
  ff(["-i", wav, "-ac", String(ch), "-c:a", "libopus", "-b:a", stereo ? "96k" : "64k", "-vbr", "on", "-application", "audio", `${base}.ogg`]);
  ff(["-i", wav, "-ac", String(ch), "-c:a", "aac", "-b:a", stereo ? "128k" : "96k", "-movflags", "+faststart", `${base}.m4a`]);
}

function buildVariation(key, bus, v, idx) {
  const inputs = [];
  const parts = [];
  v.layers.forEach(([file, db, delay], i) => {
    const p = path.join(SRC, file);
    if (!fs.existsSync(p)) throw new Error(`${key}: missing source ${file}`);
    inputs.push("-i", p);
    parts.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-50dB,volume=${db}dB,adelay=${delay || 0}|${delay || 0}[l${i}]`);
  });
  const mix = v.layers.length > 1 ? `${v.layers.map((_, i) => `[l${i}]`).join("")}amix=inputs=${v.layers.length}:normalize=0:duration=longest[m]` : `[l0]anull[m]`;
  const fade = v.fadeOut ? `,afade=t=out:st=${Math.max(0, v.max - v.fadeOut / 1000).toFixed(3)}:d=${(v.fadeOut / 1000).toFixed(3)}` : "";
  const raw = path.join(TMP, `${key}_${idx}_raw.wav`);
  ff([...inputs, "-filter_complex", `${parts.join(";")};${mix};[m]atrim=0:${v.max},afade=t=in:d=0.004${fade}[o]`, "-map", "[o]", "-ar", "48000", raw]);
  // Level to the bus target RMS, peaks capped.
  const s = stats(raw);
  const gain = Math.min(TARGET[bus] - s.rms, PEAK_CAP - s.peak);
  const lev = path.join(TMP, `${key}_${idx}.wav`);
  ff(["-i", raw, "-af", `volume=${gain.toFixed(2)}dB`, lev]);
  const name = `sfx/${key}_${idx + 1}`;
  encode(lev, path.join(OUT, name), false);
  return name;
}

function buildMusic(mood, m) {
  const p = path.join(SRC, m.src);
  const X = m.xfade;
  const raw = path.join(TMP, `music_${mood}.wav`);
  // Seamless loop: [tail ⨯ head crossfade] + body, so body's end flows into the
  // crossfade's start (the original tail) and its end (the original head)
  // flows into body's start.
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
  for (const d of ["sfx", "music"]) {
    fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
  }
  const manifest = { version: 1, formats: ["ogg", "m4a"], sounds: {}, music: {} };
  for (const [key, def] of Object.entries(SOUNDS)) {
    manifest.sounds[key] = def.variations.map((v, i) => buildVariation(key, def.bus, v, i));
    process.stdout.write(`${key} (${def.variations.length}) `);
  }
  for (const [mood, m] of Object.entries(MUSIC)) {
    manifest.music[mood] = buildMusic(mood, m);
    process.stdout.write(`music:${mood} `);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("\nbuilt", path.relative(ROOT, OUT));
}

function check() {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const licences = fs.readFileSync(path.join(OUT, "LICENSES.md"), "utf8");
  const problems = [];
  const used = new Set();
  for (const def of Object.values(SOUNDS)) for (const v of def.variations) for (const [f] of v.layers) used.add(f);
  for (const m of Object.values(MUSIC)) used.add(m.src);
  for (const f of used) if (!licences.includes(path.basename(f))) problems.push(`no licence row for ${f}`);
  const files = [...Object.values(manifest.sounds).flat().map((n) => ["sfx", n]), ...Object.values(manifest.music).map((n) => ["music", n])];
  let total = 0;
  for (const [kind, n] of files) {
    for (const ext of manifest.formats) {
      const p = path.join(OUT, `${n}.${ext}`);
      if (!fs.existsSync(p)) { problems.push(`missing ${n}.${ext}`); continue; }
      const size = fs.statSync(p).size;
      total += ext === "ogg" ? size : 0;
      if (size > BUDGET[kind]) problems.push(`${n}.${ext} is ${Math.round(size / 1024)} KB (budget ${BUDGET[kind] / 1024} KB)`);
      const s = stats(p);
      if (s.peak > -0.5) problems.push(`${n}.${ext} peaks at ${s.peak.toFixed(1)} dBFS`);
    }
  }
  console.log(`${files.length} sounds, ${(total / 1024).toFixed(0)} KB (ogg set)`);
  if (problems.length) { console.log(problems.map((p) => "  FAIL " + p).join("\n")); process.exit(1); }
  console.log("audio check: PASS");
}

try {
  if (process.argv.includes("--check")) check();
  else build();
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
