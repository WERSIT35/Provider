#!/usr/bin/env node
/**
 * Builds each new game's OWN sound set from CC0 originals in art-src/audio/ into
 * games/<code>/client/audio/ (sfx/*.ogg + *.m4a, manifest.json, LICENSES.md), played by the
 * shared engine (client/audio/audio.js, VX_AUDIO_BASE = "audio/").
 *
 * No original is shared between two games, or with Vault 20K's current set (its effects
 * come from art-src/audio/freesound/, its music from three OpenGameArt tracks). Recordings
 * only: originals are trimmed, layered, pitched, echoed and levelled; nothing is synthesised.
 *
 *   node tools/build-game-audio.mjs            # every game below
 *   node tools/build-game-audio.mjs relicforge # one game
 *
 * Needs ffmpeg (the ffmpeg-static devDependency, else ffmpeg on PATH).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "art-src", "audio");
let FF = "ffmpeg";
try { FF = createRequire(import.meta.url)("ffmpeg-static") || FF; } catch { /* PATH */ }

// Where each original came from (all CC0 1.0; credits in client/assets/audio/LICENSES.md too).
const ORIGIN = {
  kenney: (f) => [`Kenney (kenney.nl), ${f.split("/")[1].replace(/-/g, " ")} pack`, `art-src/audio/kenney/${f.split("/")[1]}/License.txt`],
  oga: () => ["OpenGameArt.org (packs listed in client/assets/audio/LICENSES.md)", "CC0 1.0 per its OpenGameArt page"]
};

// A layer: { f: "kenney/…/x.ogg" | "oga/x.ogg", p: semitones, d: delay ms, g: dB, t: [start, end] s }.
// A sound: { v: [[layer, …], …] (variations), db: target peak dB, fade: ms, echo: "aecho args" }.
const L = (f, o = {}) => ({ f, p: 0, d: 0, g: 0, ...o });
const RECIPES = {
  "classic-5x3": {
    title: "Moth & Lantern (code classic-5x3)",
    note: "A night garden: soft and airy. Paper flutter, glass chimes, glints, small bells and a quiet night bed. No chips, no coins.",
    sounds: {
      ui_click: { v: [[L("kenney/interface-sounds/click_002.ogg")], [L("kenney/interface-sounds/click_004.ogg")]], db: -8 },
      ui_toggle: { v: [[L("kenney/interface-sounds/toggle_004.ogg")]], db: -8 },
      ui_confirm: { v: [[L("kenney/interface-sounds/select_001.ogg")]], db: -8 },
      // Paper strips released: two flutters.
      spin_start: { v: [[L("oga/swish-3.wav", { p: 2 }), L("oga/swish-4.wav", { d: 70, g: -3 })]], db: -6 },
      // A strip settles: a soft paper flap with a faint chime.
      reel_stop: { v: [0, 1, 2].map((i) => [L("kenney/interface-sounds/minimize_002.ogg", { p: -6 - i }), L(`kenney/impact-sounds/impactGlass_light_00${i}.ogg`, { p: 5, g: -12 })]), db: -6, fade: 80 },
      tick: { v: [1, 2, 3, 4].map((i) => [L(`kenney/impact-sounds/impactGlass_light_00${i - 1}.ogg`, { p: 7 })]), db: -12 },
      scatter: { v: [[L("oga/bell_02.ogg", { p: 2 })]], db: -5 },
      scatter_catch: { v: [[L("kenney/impact-sounds/impactBell_heavy_000.ogg", { p: 5 }), L("oga/bell_02.ogg", { d: 60, g: -3 })]], db: -3, echo: "0.8:0.7:220|440:0.35|0.2" },
      line: { v: [[L("oga/item_gem_01.ogg", { p: 2 })], [L("oga/item_gem_03.ogg", { p: 2 })]], db: -7 },
      win_small: { v: [[L("oga/item_gem_04.ogg", { t: [0, 0.45], p: 3 })]], db: -7, fade: 140 },
      win_land: { v: [[L("oga/item_gem_03.ogg"), L("oga/bell_02.ogg", { d: 60, g: -7, p: 7 })]], db: -5 },
      win_tick: { v: [0, 2, 4].map((i) => [L(`kenney/impact-sounds/impactGlass_light_00${i}.ogg`, { p: 9 })]), db: -13 },
      win_big: { v: [[L("kenney/impact-sounds/impactBell_heavy_001.ogg", { p: 4 }), L("oga/item_gem_04.ogg", { d: 120, g: -4 })]], db: -3, echo: "0.8:0.7:260|520:0.35|0.2" },
      win_mega: { v: [[L("kenney/impact-sounds/impactBell_heavy_000.ogg", { p: 4 }), L("oga/item_gem_01.ogg", { d: 140, g: -3 }), L("oga/item_gem_03.ogg", { d: 300, g: -3, p: 4 }), L("oga/item_gem_04.ogg", { d: 460, g: -5, p: 7 })]], db: -2, echo: "0.8:0.7:280|560:0.35|0.2" },
      win_epic: { v: [[L("kenney/impact-sounds/impactBell_heavy_000.ogg", { p: 2 }), L("kenney/impact-sounds/impactBell_heavy_001.ogg", { d: 240, p: 7, g: -3 }), L("oga/item_gem_04.ogg", { d: 420, g: -3 }), L("oga/item_gem_01.ogg", { d: 640, p: 7, g: -4 })]], db: -1, echo: "0.8:0.75:300|620:0.4|0.25" },
      max_win: { v: [[L("kenney/impact-sounds/impactBell_heavy_000.ogg"), L("kenney/impact-sounds/impactBell_heavy_001.ogg", { d: 300, p: 5 }), L("oga/item_gem_04.ogg", { d: 500 }), L("oga/bell_02.ogg", { d: 800, p: 12, g: -4 })]], db: -1, echo: "0.8:0.8:320|700:0.45|0.3", fade: 600 },
      bigwin_open: { v: [[L("kenney/impact-sounds/impactBell_heavy_001.ogg", { p: 6 })]], db: -5 },
      feature_award: { v: [[L("kenney/interface-sounds/open_002.ogg", { p: -3 }), L("kenney/impact-sounds/impactBell_heavy_002.ogg", { d: 120 }), L("oga/item_gem_01.ogg", { d: 260, p: 5, g: -4 })]], db: -3, echo: "0.8:0.7:260|520:0.35|0.2" },
      feature_more: { v: [[L("kenney/impact-sounds/impactBell_heavy_003.ogg", { p: 3 }), L("oga/item_gem_03.ogg", { d: 120, p: 5, g: -4 })]], db: -4 },
      fs_intro: { v: [[L("kenney/impact-sounds/impactBell_heavy_002.ogg", { p: -5 }), L("oga/swish-3.wav", { p: -6, g: -6 })]], db: -4, echo: "0.8:0.8:400|900:0.45|0.3", fade: 400 },
      fs_outro: { v: [[L("oga/bell_02.ogg", { p: -3 })]], db: -5, echo: "0.8:0.75:380|820:0.4|0.25", fade: 400 }
    },
    // The night bed: bells two octaves down through long echoes; a deeper one for the night (free spins).
    music: {
      base: { v: [[L("kenney/impact-sounds/impactBell_heavy_000.ogg", { p: -19 }), L("oga/bell_02.ogg", { p: -24, d: 2600, g: -2 }), L("kenney/impact-sounds/impactBell_heavy_001.ogg", { p: -17, d: 5600, g: -4 })]], db: -14, echo: "0.8:0.85:900|1800|2700:0.55|0.4|0.3", pad: 14, fade: 2500 },
      freeSpins: { v: [[L("kenney/impact-sounds/impactBell_heavy_001.ogg", { p: -22 }), L("oga/bell_02.ogg", { p: -26, d: 2000, g: -2 }), L("kenney/impact-sounds/impactBell_heavy_002.ogg", { p: -19, d: 5000, g: -4 })]], db: -13, echo: "0.8:0.85:800|1600|2500:0.6|0.45|0.3", pad: 14, fade: 2500 }
    }
  },
  relicforge: {
    title: "Relic Forge",
    note: "A forge: anvils, plates, shattering glass, sparks, gongs and a deep furnace drone.",
    sounds: {
      ui_click: { v: [[L("kenney/impact-sounds/impactMetal_heavy_002.ogg", { p: 7 })]], db: -10, fade: 40 },
      ui_confirm: { v: [[L("kenney/impact-sounds/impactMetal_heavy_000.ogg", { p: 5 })]], db: -8, fade: 60 },
      rf_spin: { v: [[L("oga/swish-7.wav", { p: -3 }), L("kenney/impact-sounds/impactMetal_heavy_000.ogg", { p: -4, d: 60, g: -3 })], [L("oga/swish-9.wav", { p: -3 }), L("kenney/impact-sounds/impactMetal_heavy_002.ogg", { p: -4, d: 60, g: -3 })]], db: -4 },
      rf_land: { v: [0, 1, 2].map((i) => [L(`kenney/impact-sounds/impactSoft_heavy_00${i}.ogg`, { p: -2 }), L(`kenney/impact-sounds/impactPlate_heavy_00${i + 1}.ogg`, { p: -5, g: -9 })]), db: -4, fade: 80 },
      rf_pop: { v: [0, 1, 2, 3].map((i) => [L(`kenney/impact-sounds/impactGlass_medium_00${i}.ogg`, { p: -3 })]), db: -5, fade: 80 },
      rf_anvil: { v: [[L("kenney/impact-sounds/impactMetal_heavy_001.ogg"), L("kenney/impact-sounds/impactPlate_heavy_000.ogg", { g: -6 })], [L("kenney/impact-sounds/impactMetal_heavy_001.ogg", { p: -1 }), L("kenney/impact-sounds/impactPlate_heavy_004.ogg", { g: -6 })]], db: -3 },
      rf_spark: { v: [[L("oga/spark.wav")], [L("oga/continuousspark.wav")]], db: -7, fade: 60 },
      rf_glint: { v: [[L("oga/sfx100v2_glass_04.ogg", { p: -2 })]], db: -6 },
      rf_crunch: { v: [[L("kenney/sci-fi-sounds/explosionCrunch_000.ogg")], [L("kenney/sci-fi-sounds/explosionCrunch_002.ogg", { t: [0, 0.9] })]], db: -3, fade: 150 },
      rf_burst: { v: [[L("oga/sfx100v2_air_02.ogg", { t: [0, 0.8] }), L("oga/groundhit.wav", { d: 120, g: -2 })]], db: -3, fade: 150 },
      rf_mult: { v: [[L("oga/spell_01.ogg")], [L("oga/spell_02.ogg")]], db: -4 },
      rf_gong: { v: [[L("oga/gong_01.ogg")]], db: -3 },
      rf_gong_soft: { v: [[L("oga/gong_02.ogg", { p: -3 })]], db: -8 },
      rf_pick: { v: [[L("kenney/impact-sounds/impactPunch_heavy_000.ogg"), L("oga/spell_02.ogg", { p: 5, d: 60, g: -4 })]], db: -3 },
      rf_evolve: { v: [[L("oga/fw_03.ogg"), L("oga/gong_01.ogg", { p: -5, g: -3 })]], db: -1 },
      rf_meltdown: { v: [[L("kenney/sci-fi-sounds/lowFrequency_explosion_000.ogg"), L("oga/gong_02.ogg", { p: -7, g: -4 })]], db: -1 },
      rf_thunder: { v: [[L("oga/sfx100v2_thunder_01.ogg", { t: [0, 2.2] })]], db: -3, fade: 500 },
      rf_win: { v: [[L("kenney/impact-sounds/impactPlate_heavy_002.ogg", { p: 4 }), L("oga/spark.wav", { d: 40, g: -8 })]], db: -5 },
      rf_win_big: { v: [[L("oga/cannon_01.ogg"), L("kenney/impact-sounds/impactMetal_heavy_001.ogg", { g: -4 })]], db: -2 },
      rf_win_mega: { v: [[L("oga/cannon_01.ogg"), L("oga/fw_03.ogg", { d: 250, g: -2 })]], db: -1 },
      rf_win_epic: { v: [[L("kenney/sci-fi-sounds/lowFrequency_explosion_001.ogg"), L("oga/fw_03.ogg", { d: 150 }), L("oga/cannon_01.ogg", { d: 400, g: -3 })]], db: -1 },
      rf_max_win: { v: [[L("oga/cannon_01.ogg"), L("kenney/sci-fi-sounds/lowFrequency_explosion_000.ogg", { g: -2 }), L("oga/sfx100v2_thunder_01.ogg", { d: 300, g: -6, t: [0, 2] })]], db: -1, fade: 600 }
    },
    // The furnace: a gong two octaves down, stretched through long echoes; a darker one for the Forge.
    music: {
      base: { v: [[L("oga/gong_02.ogg", { p: -24, g: 0 }), L("oga/gong_01.ogg", { p: -19, d: 3200, g: -3 })]], db: -10, echo: "0.8:0.85:900|1700|2600:0.55|0.4|0.3", pad: 14, fade: 2500 },
      freeSpins: { v: [[L("oga/gong_01.ogg", { p: -24 }), L("kenney/sci-fi-sounds/lowFrequency_explosion_000.ogg", { p: -5, d: 2000, g: -6 }), L("oga/gong_02.ogg", { p: -17, d: 5200, g: -4 })]], db: -9, echo: "0.8:0.85:700|1400|2300:0.6|0.45|0.3", pad: 14, fade: 2500 }
    }
  },
  clockwork: {
    title: "Clockwork Menagerie (code clockwork)",
    note: "A toymaker's workshop: ratchets, key winds, wooden clunks and a music box. Every tune is one small bell, pitched into notes and rung through short echoes like a music-box tine. No chips, no coins.",
    sounds: (() => {
      const BELL = "kenney/impact-sounds/impactBell_heavy_004.ogg";
      // A music-box phrase: the small bell an octave and more up, one note per step.
      const box = (notes, gap, o = {}) => notes.map((p, i) => L(BELL, { p, d: Math.round(i * gap) + (o.d || 0), g: (o.g || 0) - (o.soften ? i * 0.6 : 0) }));
      // A ratchet: one click, repeated and stepped in pitch.
      const ratchet = (f, n, gap, p0, step, o = {}) => Array.from({ length: n }, (_, i) => L(f, { p: p0 + i * step, d: Math.round((o.d || 0) + i * gap), g: o.g || 0 }));
      return {
        ui_click: { v: [[L("kenney/interface-sounds/click_001.ogg")]], db: -8 },
        ui_toggle: { v: [[L("kenney/interface-sounds/click_003.ogg", { p: -2 })]], db: -8 },
        ui_confirm: { v: [[L("kenney/interface-sounds/select_002.ogg")]], db: -8 },
        // The mechanism lets go: a quick ratchet over a breath of air.
        spin_start: { v: [[...ratchet("kenney/interface-sounds/click_003.ogg", 4, 42, -4, 1), L("oga/sfx100v2_air_01.ogg", { t: [0, 0.4], g: -10 })]], db: -6, fade: 120 },
        // A reel locks: a wooden clunk with a small latch on top.
        reel_stop: { v: [[L("kenney/impact-sounds/impactSoft_heavy_003.ogg"), L("kenney/interface-sounds/click_001.ogg", { p: -6, g: -8 })], [L("kenney/impact-sounds/impactSoft_heavy_004.ogg"), L("kenney/interface-sounds/click_001.ogg", { p: -7, g: -8 })], [L("kenney/impact-sounds/impactSoft_heavy_003.ogg", { p: -2 }), L("kenney/interface-sounds/click_003.ogg", { p: -6, g: -9 })]], db: -6, fade: 90 },
        // A music box lands: one note (the engine steps it up per box).
        scatter: { v: [[L(BELL, { p: 2 }), L("kenney/interface-sounds/click_001.ogg", { p: -3, g: -10 })]], db: -5, echo: "0.8:0.6:70|140|210:0.35|0.22|0.12", fade: 300 },
        // A key winds its reel: six turns of the ratchet, rising, then the spring rings.
        cw_wind: { v: [[...ratchet("kenney/interface-sounds/click_003.ogg", 6, 70, 0, 1), L(BELL, { p: 7, d: 470, g: -2 })]], db: -4, echo: "0.8:0.6:70|140|210|180:0.35|0.22|0.12|0.25", fade: 250 },
        // A wound reel's multiplier steps up: a gear tooth and a tiny bell.
        cw_tick: { v: [[L("kenney/interface-sounds/click_001.ogg", { p: 4 }), L(BELL, { p: 12, d: 20, g: -5 })]], db: -6, fade: 160 },
        // The reels let go: the ratchet runs down.
        cw_unwind: { v: [[...ratchet("kenney/interface-sounds/click_003.ogg", 7, 34, 2, -1.2, { g: -2 }), L("oga/sfx100v2_air_03.ogg", { t: [0, 0.5], g: -12 })]], db: -8, fade: 160 },
        win_tick: { v: [[L("kenney/interface-sounds/click_001.ogg", { p: 9 })], [L("kenney/interface-sounds/click_003.ogg", { p: 9 })]], db: -14 },
        win_small: { v: [[...box([0, 4], 120)]], db: -7, echo: "0.8:0.6:70|140|210:0.35|0.22|0.12", fade: 300 },
        win_land: { v: [[...box([0, 4, 7, 12], 110)]], db: -5, echo: "0.8:0.6:70|140|210|200:0.35|0.22|0.12|0.25", fade: 300 },
        win_big: { v: [[...box([0, 4, 7, 12, 16], 100), L("kenney/music-jingles/jingles_HIT01.ogg", { g: -6 })]], db: -3, echo: "0.8:0.7:70|140|210|240|480:0.35|0.22|0.12|0.3|0.18" },
        win_mega: { v: [[...box([0, 4, 7, 12, 7, 12, 16], 95), L("kenney/music-jingles/jingles_HIT07.ogg", { g: -5 })]], db: -2, echo: "0.8:0.7:70|140|210|260|520:0.35|0.22|0.12|0.32|0.2" },
        win_epic: { v: [[...box([0, 4, 7, 12, 16, 19, 24], 90), L("kenney/music-jingles/jingles_HIT12.ogg", { g: -4 }), L("kenney/impact-sounds/impactSoft_heavy_004.ogg", { p: -5, g: -6 })]], db: -1, echo: "0.8:0.75:70|140|210|280|560:0.35|0.22|0.12|0.35|0.22" },
        max_win: { v: [[...box([0, 4, 7, 12, 16, 19, 24, 19, 24], 100), L("kenney/music-jingles/jingles_HIT16.ogg", { g: -3 }), L(BELL, { p: -12, d: 900, g: -2 })]], db: -1, echo: "0.8:0.8:70|140|210|300|650:0.35|0.22|0.12|0.4|0.28", fade: 600 },
        bigwin_open: { v: [[L(BELL, { p: 0 }), L("kenney/interface-sounds/click_003.ogg", { p: -4, g: -6 })]], db: -5, echo: "0.8:0.6:70|140|210:0.35|0.22|0.12", fade: 300 },
        // The music box opens: the lid, then its tune.
        feature_award: { v: [[L("kenney/interface-sounds/maximize_002.ogg", { p: -4 }), ...box([0, 7, 4, 12, 16], 120, { d: 150 }), L("kenney/music-jingles/jingles_HIT10.ogg", { d: 120, g: -6 })]], db: -3, echo: "0.8:0.7:70|140|210|240|480:0.35|0.22|0.12|0.3|0.18" },
        feature_more: { v: [[...box([3, 7, 10, 15], 100)]], db: -4, echo: "0.8:0.6:70|140|210|200:0.35|0.22|0.12|0.25", fade: 300 },
        // Night falls: the lamp clicks on, the box plays low.
        fs_intro: { v: [[L("kenney/interface-sounds/click_003.ogg", { p: -6 }), ...box([-5, 0, -2, 3], 260, { d: 200 }), L("kenney/music-jingles/jingles_HIT11.ogg", { p: -2, d: 150, g: -6 })]], db: -4, echo: "0.8:0.8:70|140|210|400|900:0.35|0.22|0.12|0.42|0.28", fade: 500 },
        // Morning: the box winds down, slower each note.
        fs_outro: { v: [[L(BELL, { p: 12 }), L(BELL, { p: 7, d: 240 }), L(BELL, { p: 4, d: 560, g: -1 }), L(BELL, { p: 0, d: 980, g: -2 })]], db: -5, echo: "0.8:0.75:70|140|210|380|820:0.35|0.22|0.12|0.4|0.25", fade: 600 }
      };
    })(),
    // The workshop's music box: a slow tune on the small bell through long echoes, a soft clock under it;
    // at night the same box a fourth lower, in minor.
    music: (() => {
      const BELL = "kenney/impact-sounds/impactBell_heavy_004.ogg", TICK = "kenney/interface-sounds/click_001.ogg";
      const tune = (notes, gap, base) => notes.map((p, i) => L(BELL, { p: p + base, d: Math.round(i * gap), g: -1 - (i % 4 === 0 ? 0 : 2) }));
      const clock = (n, gap, p) => Array.from({ length: n }, (_, i) => L(TICK, { p, d: i * gap, g: i % 2 ? -16 : -13 }));
      return {
        base: { v: [[...tune([0, 4, 7, 4, 2, 5, 9, 5, 0, 4, 7, 12, 7, 4, 5, 2, -1, 2, 5, 9, 7, 4, 2, 0], 800, 0), ...clock(24, 800, -10)]], db: -16, echo: "0.8:0.8:70|140|210|450|900|1350:0.35|0.22|0.12|0.4|0.28|0.18", pad: 16, fade: 1500 },
        freeSpins: { v: [[...tune([0, 3, 7, 3, 2, 5, 8, 5, 0, 3, 7, 10, 7, 3, 5, 2, -1, 2, 5, 8, 7, 3, 2, 0], 800, -5), ...clock(24, 800, -12)]], db: -15, echo: "0.8:0.85:70|140|210|500|1000|1500:0.35|0.22|0.12|0.45|0.32|0.2", pad: 16, fade: 1500 }
      };
    })()
  }
};

function run(args) {
  const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}\n${r.stderr}`);
  return r;
}
function peakDb(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : 0;
}

/** Mix one variation's layers into a 48 kHz stereo WAV, then level it and encode both formats. */
function build(layers, spec, outBase, tmp) {
  const inputs = [], chains = [];
  layers.forEach((l, i) => {
    const src = path.join(SRC, l.f);
    if (!existsSync(src)) throw new Error(`missing original ${l.f}`);
    inputs.push("-i", src);
    const f = [`aformat=sample_rates=48000:channel_layouts=stereo`];
    if (l.t) f.push(`atrim=${l.t[0]}:${l.t[1]}`, "asetpts=PTS-STARTPTS");
    if (l.p) f.push(`asetrate=${Math.round(48000 * Math.pow(2, l.p / 12))}`, "aresample=48000");
    if (l.d) f.push(`adelay=${l.d}|${l.d}`);
    if (l.g) f.push(`volume=${l.g}dB`);
    chains.push(`[${i}:a]${f.join(",")}[l${i}]`);
  });
  let mix = `${layers.map((_, i) => `[l${i}]`).join("")}amix=inputs=${layers.length}:normalize=0:duration=longest`;
  if (spec.pad) mix += `,apad=pad_dur=${spec.pad}`;
  if (spec.echo) mix += `,aecho=${spec.echo.replace(/\|/g, "|")}`;
  if (spec.pad) mix += `,atrim=0:${spec.pad + 4}`;
  if (spec.fade) mix += `,areverse,afade=t=in:d=${spec.fade / 1000},areverse`;
  mix += ",silenceremove=start_periods=1:start_threshold=-60dB";
  const raw = path.join(tmp, "raw.wav");
  run([...inputs, "-filter_complex", `${chains.join(";")};${mix}[out]`, "-map", "[out]", raw]);
  const gain = (spec.db ?? -3) - peakDb(raw);
  const lev = path.join(tmp, "lev.wav");
  run(["-i", raw, "-af", `volume=${gain.toFixed(2)}dB`, lev]);
  mkdirSync(path.dirname(outBase), { recursive: true });
  run(["-i", lev, "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", outBase + ".ogg"]);
  run(["-i", lev, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outBase + ".m4a"]);
}

const only = process.argv[2];
for (const [code, recipe] of Object.entries(RECIPES)) {
  if (only && only !== code) continue;
  const dir = path.join(root, "games", code, "client", "audio");
  const tmp = path.join(dir, ".tmp");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const manifest = { version: 2, formats: ["ogg", "m4a"], sounds: {}, sends: {}, music: {} };
  const used = new Map();
  const note = (l, what) => { if (!used.has(l.f)) used.set(l.f, new Set()); used.get(l.f).add(what); };
  for (const [key, spec] of Object.entries(recipe.sounds)) {
    manifest.sounds[key] = spec.v.map((layers, i) => {
      const rel = `sfx/${key}_${i + 1}`;
      build(layers, spec, path.join(dir, rel), tmp);
      layers.forEach((l) => note(l, `\`${key}\``));
      return rel;
    });
    manifest.sends[key] = 0;
  }
  for (const [mood, spec] of Object.entries(recipe.music)) {
    const rel = `music/${mood}`;
    build(spec.v[0], spec, path.join(dir, rel), tmp);
    spec.v[0].forEach((l) => note(l, `music \`${mood}\``));
    manifest.music[mood] = rel;
  }
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const rows = [...used].sort().map(([f, w]) => { const [who, lic] = ORIGIN[f.split("/")[0]](f); return `| ${f.split("/").pop()} | ${who} | ${lic} | ${[...w].join(", ")} |`; });
  writeFileSync(path.join(dir, "LICENSES.md"), `# ${recipe.title}: sound sources

${recipe.note}

Built by \`tools/build-game-audio.mjs\` from originals in \`art-src/audio/\` (trimmed, layered,
pitched, echoed and levelled). Every original is **CC0 1.0** (public domain dedication): free
for commercial use, no attribution required. None is shared with another Lumina game's
current set.

| Original | Source | Licence | Used in |
|---|---|---|---|
${rows.join("\n")}
`);
  console.log(`${code}: ${Object.keys(manifest.sounds).length} sounds, ${Object.keys(manifest.music).length} music → ${path.relative(root, dir)}`);
}
