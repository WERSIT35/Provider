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
 *   node tools/build-game-audio.mjs            # both games
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
    title: "Classic 5x3",
    note: "A fruit machine: dry and bright. Clicks, chips, bells and short jingles; no music bed.",
    sounds: {
      ui_click: { v: [[L("kenney/interface-sounds/click_002.ogg")], [L("kenney/interface-sounds/click_004.ogg")]], db: -6 },
      ui_toggle: { v: [[L("kenney/interface-sounds/toggle_004.ogg")]], db: -6 },
      ui_confirm: { v: [[L("kenney/interface-sounds/select_001.ogg")]], db: -6 },
      spin_start: { v: [[L("kenney/interface-sounds/maximize_002.ogg", { p: -2 }), L("kenney/casino-audio/chips-stack-2.ogg", { d: 40, g: -6 })]], db: -4 },
      reel_stop: { v: [1, 2, 3].map((i) => [L("kenney/interface-sounds/click_001.ogg", { p: -8 }), L(`kenney/casino-audio/chips-collide-${i}.ogg`, { p: -4, g: -5 })]), db: -3, fade: 60 },
      tick: { v: [1, 2, 3, 4].map((i) => [L(`kenney/impact-sounds/impactGlass_light_00${i - 1}.ogg`, { p: 2 })]), db: -8 },
      scatter: { v: [[L("kenney/impact-sounds/impactBell_heavy_004.ogg", { p: 3 })]], db: -3 },
      scatter_catch: { v: [[L("kenney/impact-sounds/impactBell_heavy_000.ogg", { p: 2 }), L("oga/bell_02.ogg", { d: 30, g: -4 })]], db: -2 },
      line: { v: [[L("oga/item_gem_01.ogg")], [L("oga/item_gem_03.ogg")]], db: -6 },
      win_small: { v: [[L("oga/item_gem_04.ogg", { t: [0, 0.45] })]], db: -5, fade: 120 },
      win_land: { v: [[L("oga/item_coins_02.ogg"), L("kenney/casino-audio/chips-stack-3.ogg", { d: 60, g: -4 })]], db: -3 },
      win_tick: { v: [1, 2, 4].map((i) => [L(`kenney/casino-audio/chips-collide-${i}.ogg`, { p: 3 })]), db: -9 },
      win_big: { v: [[L("kenney/music-jingles/jingles_HIT01.ogg"), L("oga/item_coins_02.ogg", { d: 120, g: -6 })]], db: -2 },
      win_mega: { v: [[L("kenney/music-jingles/jingles_HIT03.ogg"), L("oga/item_coins_02.ogg", { d: 160, g: -5 })]], db: -2 },
      win_epic: { v: [[L("kenney/music-jingles/jingles_HIT11.ogg"), L("kenney/impact-sounds/impactBell_heavy_001.ogg", { g: -6 })]], db: -1 },
      max_win: { v: [[L("kenney/music-jingles/jingles_HIT15.ogg"), L("oga/item_coins_02.ogg", { d: 200, g: -4 }), L("kenney/impact-sounds/impactBell_heavy_001.ogg", { d: 0, g: -5 })]], db: -1 },
      bigwin_open: { v: [[L("kenney/impact-sounds/impactBell_heavy_001.ogg", { p: -2 })]], db: -3 },
      feature_award: { v: [[L("kenney/music-jingles/jingles_HIT10.ogg"), L("kenney/impact-sounds/impactBell_heavy_002.ogg", { g: -5 })]], db: -2 },
      feature_more: { v: [[L("kenney/music-jingles/jingles_HIT06.ogg")]], db: -2 },
      fs_intro: { v: [[L("kenney/music-jingles/jingles_HIT12.ogg"), L("kenney/impact-sounds/impactBell_heavy_003.ogg", { d: 80, g: -6 })]], db: -2 },
      fs_outro: { v: [[L("kenney/music-jingles/jingles_HIT16.ogg")]], db: -3 }
    },
    music: {}
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
