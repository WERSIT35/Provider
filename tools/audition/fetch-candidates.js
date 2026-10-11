#!/usr/bin/env node
"use strict";

// Fetch CC0 sound candidates for the audition page (tools/audition/server.js).
// For every event in events.js: search Freesound with the CC0 licence filter
// and the event's longest usable length, most-downloaded first; re-check each
// sound's licence on its own page (CC0 1.0 only); download its HQ preview
// (Ogg) into art-src/audio/candidates/; measure length, peak and RMS.
// Writes art-src/audio/candidates/candidates.json (the page's list, with the
// source URL, author and licence of every file).
//
//   node tools/audition/fetch-candidates.js [--per 5] [--only spin_start,tick] [--refresh]
// An event keeps the candidates it has (minus any off-brief title) and is topped
// up to --per; --refresh (or --only) fetches it from scratch.
//
// Freesound originals need a login; the HQ previews are the same CC0 sound.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const FF = require("ffmpeg-static");
const EVENTS = require("./events");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "art-src", "audio", "candidates");
const LIST = path.join(OUT, "candidates.json");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PER = Number(opt("per", 5));
const ONLY = opt("only", "") ? new Set(opt("only", "").split(",")) : null;
const REFRESH = args.includes("--refresh");
const UA = { "user-agent": "Mozilla/5.0 (Vault20K audition fetcher)" };
const CC0 = "creativecommons.org/publicdomain/zero/1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Off-brief for a premium slot: never offered (titles are matched).
const EXCLUDE = /horror|jumpscare|toilet|flexatone|whistle|anime|rpg|\bheal\b|scary|creepy|spooky|zombie|crash|batman|fart|cartoon|comic|8.?bit|chiptune|retro|arcade|game ?over|laser ?gun|blaster|marble|backfire|car |gunshot|scream|1-sample|test tone|\bsine\b|square wave/i;
const allowed = (ev, c) => !EXCLUDE.test(c.title) && (!ev.must || new RegExp(ev.must, "i").test(c.title));

async function get(url, as = "text") {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return as === "buf" ? Buffer.from(await r.arrayBuffer()) : r.text();
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(800 * (i + 1));
  }
  return null;
}

/** Result cards of one CC0 search page. */
async function search(query, maxS) {
  const f = `license:"Creative Commons 0" duration:[0 TO ${maxS}]`;
  const url = `https://freesound.org/search/?q=${encodeURIComponent(query)}&f=${encodeURIComponent(f)}&s=${encodeURIComponent("Downloads (most first)")}`;
  const html = await get(url);
  if (!html) return [];
  const cards = [];
  const re = /data-sound-id="(\d+)"\s+data-username="([^"]+)"[\s\S]*?data-ogg="([^"]+)"[\s\S]*?data-title="([^"]*)"\s+data-duration="([\d.]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    cards.push({ id: m[1], author: m[2], ogg: m[3].replace("-lq.ogg", "-hq.ogg"), title: m[4].replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"'), duration: Number(m[5]) });
  }
  return cards;
}

/** Decoded length, peak and RMS (dBFS) of a file. */
function measure(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 27 });
  const b = r.stdout; const n = b.length / 2;
  let pk = 0, ss = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(b.readInt16LE(i * 2)); if (v > pk) pk = v; ss += v * v; }
  const db = (x) => Math.round(20 * Math.log10(Math.max(1, x) / 32768) * 10) / 10;
  return { seconds: Math.round((n / 16000) * 1000) / 1000, peakDb: db(pk), rmsDb: db(Math.sqrt(ss / Math.max(1, n))) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const list = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, "utf8")) : { source: "Freesound (CC0 1.0 only)", events: {} };
  const used = new Set(Object.values(list.events).flat().map((c) => c.id));
  for (const ev of EVENTS) {
    if (ONLY && !ONLY.has(ev.id)) continue;
    const keep = ONLY || REFRESH ? [] : (list.events[ev.id] || []).filter((c) => allowed(ev, c));
    if (keep.length >= PER) { list.events[ev.id] = keep; console.log(`${ev.id}: kept ${keep.length}`); continue; }
    const picks = keep.slice();
    const seen = new Set();
    // Round-robin over the queries so each event gets varied characters.
    const results = [];
    for (const q of ev.queries) { results.push(await search(q, ev.maxS)); await sleep(400); }
    for (let rank = 0; picks.length < PER && rank < 15; rank++) {
      for (let qi = 0; qi < results.length && picks.length < PER; qi++) {
        const c = results[qi][rank];
        if (!c || seen.has(c.id) || used.has(c.id) || !allowed(ev, c)) continue;
        seen.add(c.id);
        const page = await get(`https://freesound.org/people/${encodeURIComponent(c.author)}/sounds/${c.id}/`);
        if (!page || !page.includes(CC0)) { console.log(`  skip ${c.id} (licence not CC0 1.0 on its page)`); continue; }
        const buf = await get(c.ogg, "buf");
        if (!buf) continue;
        const file = path.join(OUT, `${ev.id}__fs${c.id}.ogg`);
        fs.writeFileSync(file, buf);
        picks.push({
          id: c.id, file: path.relative(path.join(ROOT, "art-src", "audio"), file).replace(/\\/g, "/"),
          title: c.title, author: c.author, query: ev.queries[qi],
          url: `https://freesound.org/people/${c.author}/sounds/${c.id}/`, license: "CC0 1.0", licenseUrl: `https://${CC0}/`,
          ...measure(file)
        });
        used.add(c.id);
        await sleep(300);
      }
    }
    for (const c of (list.events[ev.id] || [])) if (!picks.includes(c)) { try { fs.unlinkSync(path.join(ROOT, "art-src", "audio", c.file)); } catch {} }
    list.events[ev.id] = picks;
    console.log(`${ev.id}: ${picks.length} candidates${picks.length < 3 ? "  (FEW: needs a shopping list)" : ""}`);
    fs.writeFileSync(LIST, JSON.stringify(list, null, 2));
  }
  console.log(`wrote ${path.relative(ROOT, LIST)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
