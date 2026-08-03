/* eslint-disable */
// ---------------------------------------------------------------------------
// Art optimizer for Banana X.
//
// The source PNGs in client/assets/symbols/ are authoring-resolution exports:
// 500x500 tiles at ~400KB each, a 1024x1024 spin button, 2MB reel/scatter
// plates — ~11MB of art for a game that draws those tiles into ~80px cells.
// That cost the player twice: a long first load, and a per-frame resample of
// multi-megapixel bitmaps down to thumbnail size on every canvas draw.
//
// This script re-encodes each one to WebP at roughly 2x its maximum on-screen
// size (2x so it still looks sharp on a retina backing store). WebP is
// supported by every browser the game targets (Safari 14+, 2020), so the
// client references the .webp directly — no <picture>, no PNG fallback.
//
// The PNGs stay in the repo as the sources of truth: re-run this script after
// replacing any of them.
//
// Usage:   npm run assets:optimize
// Output:  client/assets/symbols/*.webp
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SYMBOLS_DIR = path.join(__dirname, "..", "client", "assets", "symbols");

// Every asset the client actually references, with the box it is drawn into.
// `max` is the longest edge to keep; the other edge follows the source aspect
// ratio (fit: "inside", never enlarging). Sizes are ~2x the largest the asset
// is ever painted at, measured from the CSS/canvas layout.
const TARGETS = [
  // Symbol tiles — drawn into grid cells that top out around 120px.
  { src: "Crown.png",       max: 256 },
  { src: "HourGlass.png",   max: 256 },
  { src: "Ring.png",        max: 256 },
  { src: "Chaile.png",      max: 256 },
  { src: "RedGem.png",      max: 256 },
  { src: "PurpleGem.png",   max: 256 },
  { src: "YellowGem.png",   max: 256 },
  { src: "GreenGem.png",    max: 256 },
  { src: "BlueGem.png",     max: 256 },
  { src: "Common.png",      max: 256 },
  { src: "Rare.png",        max: 256 },
  { src: "Epic.png",        max: 256 },
  { src: "Legendary.png",   max: 256 },
  { src: "Mythic.png",      max: 256 },

  // Scatter is a wide tile drawn contained inside a cell, so it needs a little
  // more than a square symbol to keep its detail.
  { src: "Scatter.png",     max: 512 },

  // The reel frame is baked into the full-height stage cache once per resize,
  // so it can be asked for the full backing-store height of a tall canvas.
  // Kept at native size — WebP makes it cheap enough that downscaling is not
  // worth the risk of a soft frame on a large display.
  { src: "REEL.png",        max: 1672 },

  // Full-viewport background. Keep the pixels, just drop the PNG overhead.
  { src: "Background.png",  max: 1376, quality: 78 },

  // UI plates. The spin button caps out around 160px CSS; the removebg plates
  // are wide banners that never exceed ~400px CSS.
  { src: "SPIN.png",                         max: 320 },
  { src: "ANTE_ACTIVE-removebg-preview.png",  max: 800 },
  { src: "ANTE_INACTIVE-removebg-preview.png", max: 800 },
  { src: "BET-removebg-preview.png",          max: 776 },
  { src: "BUY_FEATURE-removebg-preview.png",  max: 800 },
  { src: "FREESPINS_INFO-removebg-preview.png", max: 707 }
];

const DEFAULT_QUALITY = 82;

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function run() {
  let srcTotal = 0;
  let outTotal = 0;
  let failed = 0;

  for (const target of TARGETS) {
    const srcPath = path.join(SYMBOLS_DIR, target.src);
    const outPath = path.join(SYMBOLS_DIR, target.src.replace(/\.png$/i, ".webp"));
    if (!fs.existsSync(srcPath)) {
      console.error(`  MISSING  ${target.src}`);
      failed += 1;
      continue;
    }

    const srcBytes = fs.statSync(srcPath).size;
    const meta = await sharp(srcPath).metadata();

    await sharp(srcPath)
      .resize({
        width: target.max,
        height: target.max,
        fit: "inside",
        withoutEnlargement: true
      })
      // Alpha matters on every one of these — they all sit over the backdrop.
      .webp({ quality: target.quality || DEFAULT_QUALITY, alphaQuality: 100, effort: 6 })
      .toFile(outPath);

    const outBytes = fs.statSync(outPath).size;
    const outMeta = await sharp(outPath).metadata();
    srcTotal += srcBytes;
    outTotal += outBytes;

    const saved = (100 * (1 - outBytes / srcBytes)).toFixed(0);
    console.log(
      `  ${path.basename(outPath).padEnd(38)} ` +
      `${String(meta.width).padStart(4)}x${String(meta.height).padEnd(4)} -> ` +
      `${String(outMeta.width).padStart(4)}x${String(outMeta.height).padEnd(4)}  ` +
      `${kb(srcBytes).padStart(8)} -> ${kb(outBytes).padStart(8)}  (-${saved}%)`
    );
  }

  console.log(
    `\n  ${TARGETS.length - failed}/${TARGETS.length} assets  ` +
    `${kb(srcTotal)} -> ${kb(outTotal)}  ` +
    `(-${(100 * (1 - outTotal / srcTotal)).toFixed(0)}%)`
  );
  if (failed) process.exitCode = 1;
}

console.log(`\nOptimizing art in ${SYMBOLS_DIR}\n`);
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
