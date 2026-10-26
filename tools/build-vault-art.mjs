#!/usr/bin/env node
// Vault 20K art (Colchis Treasury): art-src/colchis/ masters -> client/assets/symbols/.
//
// The masters are the owner's Gemini images (client/assets/ART.md), already cut from
// their black backdrop. This script only sizes and encodes them, so a re-cut master
// is one command away from the game:
//   node tools/build-vault-art.mjs
// File names in the client stay the old ones (Crown.webp, RedGem.webp, ...): the game
// code, the preloads and the probes keep addressing the same URLs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "art-src", "colchis");
const OUT = path.join(ROOT, "client", "assets", "symbols");
const SM = path.join(OUT, "sm");
fs.mkdirSync(SM, { recursive: true });

const src = (name) => path.join(SRC, `${name}.webp`);

// Symbols: centred on a transparent square. `fit` is the share of the square the
// object's longest side takes: the high symbols fill their cell, the gems sit smaller
// (the pay hierarchy reads at a glance), the scatter is the biggest thing on the board.
const SYMBOLS = [
  ["Crown", "crown", 0.82],
  ["HourGlass", "hourglass", 0.86],
  ["Ring", "ring", 0.8],
  ["Chaile", "cup", 0.82],
  ["RedGem", "gem_ruby", 0.7],
  ["PurpleGem", "gem_amethyst", 0.7],
  ["YellowGem", "gem_citrine", 0.68],
  ["GreenGem", "gem_emerald", 0.7],
  ["BlueGem", "gem_sapphire", 0.7],
  ["Scatter", "scatter", 0.9]
];

// Multiplier plates, trimmed (drawHexPlate contains them in the multiplier's box).
const PLATES = [
  ["PlateBronze", "plate_bronze"],
  ["PlateGold", "plate_gold"],
  ["PlateRuby", "plate_ruby"]
];

// The chamber: wide for landscape screens, tall for portrait ones and phones; the
// Golden Fleece versions are the same room for free spins.
const SCENES = [
  ["Background.webp", "chamber_base_wide", { width: 1920 }, 78],
  ["Background-portrait.webp", "chamber_base_tall", { height: 1600 }, 76],
  ["sm/Background.webp", "chamber_base_tall", { width: 640 }, 72],
  ["Feature.webp", "chamber_fleece_wide", { width: 1920 }, 78],
  ["Feature-portrait.webp", "chamber_fleece_tall", { height: 1600 }, 76],
  ["sm/Feature.webp", "chamber_fleece_tall", { width: 640 }, 72]
];

async function squareSymbol(master, size, fit, out) {
  const inner = Math.round(size * fit);
  const obj = await sharp(src(master)).resize({ width: inner, height: inner, fit: "inside" }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: obj, gravity: "centre" }])
    .webp({ quality: 86, alphaQuality: 100, effort: 6 })
    .toFile(out);
}

// The board frame as one 9-slice image for CSS border-image: a corner block (the ram)
// in each corner, the thin bead rail along the edges (rotated for the sides). The rail
// runs along the middle of the slice band, so with border-image-outset at half the band
// it sits exactly on the board's edge.
async function frame(out) {
  const C = 160;                       // corner slice, px
  const railMeta = await sharp(src("rail")).metadata();
  const T = Math.round(C * 0.34);      // rail thickness in the slice
  const scale = T / railMeta.height;
  const E = Math.round(railMeta.width * scale); // one whole tile of beads
  const W = C * 2 + E;
  const railH = await sharp(src("rail")).resize({ width: E, height: T, fit: "fill" }).toBuffer();
  const railV = await sharp(railH).rotate(90).toBuffer();
  const corner = await sharp(src("corner")).resize({ width: Math.round(C * 0.96), height: Math.round(C * 0.96), fit: "inside" }).toBuffer();
  const cm = await sharp(corner).metadata();
  const off = (n) => Math.round((C - n) / 2);
  const layers = [
    { input: railH, left: C, top: off(T) },
    { input: railH, left: C, top: C + E + off(T) },
    { input: railV, left: off(T), top: C },
    { input: railV, left: C + E + off(T), top: C }
  ];
  for (const [x, y] of [[0, 0], [C + E, 0], [0, C + E], [C + E, C + E]]) {
    layers.push({ input: corner, left: x + off(cm.width), top: y + off(cm.height) });
  }
  await sharp({ create: { width: W, height: W, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toFile(out);
  return { C, W };
}

const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;
for (const [name, master, fit] of SYMBOLS) {
  await squareSymbol(master, 256, fit, path.join(OUT, `${name}.webp`));
  await squareSymbol(master, 160, fit, path.join(SM, `${name}.webp`));
  console.log(`${name.padEnd(14)} ${kb(path.join(OUT, `${name}.webp`))} / sm ${kb(path.join(SM, `${name}.webp`))}`);
}
for (const [name, master] of PLATES) {
  for (const [dir, box] of [[OUT, 256], [SM, 160]]) {
    await sharp(src(master)).resize({ width: box, height: box, fit: "inside" })
      .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toFile(path.join(dir, `${name}.webp`));
  }
  console.log(`${name.padEnd(14)} ${kb(path.join(OUT, `${name}.webp`))}`);
}
for (const [file, master, size, quality] of SCENES) {
  const out = path.join(OUT, file);
  await sharp(src(master)).resize(size).webp({ quality, effort: 6 }).toFile(out);
  console.log(`${file.padEnd(26)} ${kb(out)}`);
}
// The art effects: frame strips (one row of square cells on black, additive) and the
// beam (a strip stretched along its length).
const FX = path.join(ROOT, "client", "assets", "fx");
fs.mkdirSync(FX, { recursive: true });
for (const name of ["splash", "shards", "glint", "swirl", "flare", "beam"]) {
  const out = path.join(FX, `${name}.webp`);
  // Light on black -> light with alpha (alpha = brightness, colour un-blended), so it
  // also adds up correctly over the transparent board canvas, not only over black.
  const { data, info } = await sharp(src(`fx_${name}`)).resize(name === "beam" ? {} : { height: 192 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    const a = m < 12 ? 0 : m; // JPEG noise in the black stays black
    const k = a ? 255 / a : 0;
    rgba[j] = Math.min(255, data[i] * k); rgba[j + 1] = Math.min(255, data[i + 1] * k); rgba[j + 2] = Math.min(255, data[i + 2] * k);
    rgba[j + 3] = a;
  }
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 80, alphaQuality: 80, effort: 6 }).toFile(out);
  console.log(`fx/${name}.webp`.padEnd(27) + kb(out));
}
const f = await frame(path.join(OUT, "Frame.webp"));
console.log(`Frame.webp                 ${kb(path.join(OUT, "Frame.webp"))} (slice ${f.C}px of ${f.W}px)`);
