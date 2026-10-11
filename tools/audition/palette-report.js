#!/usr/bin/env node
"use strict";

// Proof that the sound palette changed: for every sound key, its old sources
// (the recipe on `--base`, default main) and new ones (the picks it is built
// from now), why the main pick fits, its loudness tier, measured RMS and length.
// FAILS (exit 1) when a built file is byte-identical to the one on the base, or
// a sound effect is still built from a Kenney / OpenGameArt original.
//
//   node tools/audition/palette-report.js [--base main] [--out report.md]

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");
const FF = require("ffmpeg-static");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "client", "assets", "audio");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt("base", "main");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const gitShow = (p) => { try { return git("show", `${BASE}:${p}`); } catch { return null; } };

const { SOUNDS, TARGET } = require("../build-audio.js");
const selection = JSON.parse(fs.readFileSync(path.join(ROOT, "art-src", "audio", "selection.json"), "utf8"));
const candidates = JSON.parse(fs.readFileSync(path.join(ROOT, "art-src", "audio", "candidates", "candidates.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
const oldManifest = JSON.parse(gitShow("client/assets/audio/manifest.json") || '{"sounds":{}}');

/** The old recipes: the SOUNDS block of the base's build-audio.js, evaluated with its helpers. */
function oldRecipes() {
  const src = String(gitShow("tools/build-audio.js") || "");
  const m = src.match(/\nconst SOUNDS = (\{[\s\S]*?\n\});\n/);
  if (!m) return {};
  const k = (pack, file) => `kenney/${pack}/${file}`;
  const o = (file) => `oga/${file}`;
  try { return new Function("k", "o", `return ${m[1]};`)(k, o); } catch { return {}; }
}
const OLD = oldRecipes();
const sourcesOf = (def) => [...new Set((def?.variations || []).flatMap((v) => v.layers.map(([f]) => f)))];
const pickOf = (file) => {
  for (const [ev, p] of Object.entries(selection.picks)) if (p.file && path.basename(p.file) === path.basename(file)) {
    const c = (candidates.events[ev] || []).find((x) => x.file === p.file);
    return { ev, title: c ? `${c.title} (${c.author})` : path.basename(file), note: p.note };
  }
  return { ev: null, title: path.basename(file), note: "" };
};
function measure(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-af", "astats=metadata=0", "-f", "null", "-"], { encoding: "utf8" });
  const rms = [...r.stderr.matchAll(/RMS level dB: (-?[\d.]+)/g)].pop();
  const dur = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { rms: rms ? Number(rms[1]) : null, s: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null };
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const problems = [];
const rows = [];
for (const [key, def] of Object.entries(SOUNDS)) {
  const news = sourcesOf(def);
  const olds = sourcesOf(OLD[key]);
  for (const f of news) if (/^(kenney|oga)\//.test(f)) problems.push(`${key} is still built from ${f}`);
  // Byte-identical to the base?
  for (const n of manifest.sounds[key] || []) for (const ext of manifest.formats) {
    const now = fs.readFileSync(path.join(OUT, `${n}.${ext}`));
    const was = gitShow(`client/assets/audio/${n}.${ext}`);
    if (was && sha(was) === sha(now)) problems.push(`${n}.${ext} is byte-identical to ${BASE}`);
  }
  const main = pickOf(news[0]);
  const m = measure(path.join(OUT, `${manifest.sounds[key][0]}.ogg`));
  rows.push(`| \`${key}\` | ${olds.length ? olds.map((f) => path.basename(f)).join(" + ") : "(new key)"} | ${news.map((f) => pickOf(f).title).join(" + ")} | ${main.note || ""} | ${def.tier} (${TARGET[def.tier]} dB) | ${m.rms == null ? "–" : m.rms.toFixed(1)} dB | ${m.s == null ? "–" : m.s < 1 ? Math.round(m.s * 1000) + " ms" : m.s.toFixed(2) + " s"} |`);
}
const removed = Object.keys(oldManifest.sounds).filter((k) => !SOUNDS[k]);
const md = [
  `## Every sound, old → new (vs \`${BASE}\`)`, "",
  "| key | old source | new source | why it fits | tier | loudness (RMS) | length |", "|---|---|---|---|---|---|---|",
  ...rows, "",
  removed.length ? `Keys removed: ${removed.map((k) => `\`${k}\``).join(", ")}.` : "No keys removed.",
  "", problems.length ? `**FAIL**\n\n${problems.map((p) => `- ${p}`).join("\n")}` : `**PASS**: every sound file differs from \`${BASE}\` and no sound effect is built from a Kenney or OpenGameArt original.`
].join("\n");
const out = opt("out", null);
if (out) fs.writeFileSync(out, md + "\n");
console.log(md);
process.exit(problems.length ? 1 : 0);
