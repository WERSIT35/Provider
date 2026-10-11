#!/usr/bin/env node
"use strict";

// Sound audition (dev only). Serves the game client at / and the audition page
// at /?audition=1, where every event of the sound redesign lists its CC0
// candidates (art-src/audio/candidates/, fetched by fetch-candidates.js), the
// sound it plays today, and any file dropped into art-src/audio/incoming/.
// Pick one per event by ear and press Save: the picks are written to
// art-src/audio/selection.json, which tools/build-audio.js builds from.
//
// Never part of a deploy: the page, the candidates and the save endpoint
// exist only on this local server (client/ holds none of it).
//
//   npm run audition            → http://localhost:4100/?audition=1
//   PORT=4200 npm run audition

const http = require("http");
const fs = require("fs");
const path = require("path");
const EVENTS = require("./events");

const ROOT = path.join(__dirname, "..", "..");
const CLIENT = path.join(ROOT, "client");
const AUDIO_SRC = path.join(ROOT, "art-src", "audio");
const CANDIDATES = path.join(AUDIO_SRC, "candidates", "candidates.json");
const INCOMING = path.join(AUDIO_SRC, "incoming");
const SELECTION = path.join(AUDIO_SRC, "selection.json");
const MANIFEST = path.join(CLIENT, "assets", "audio", "manifest.json");
const PAGE = path.join(__dirname, "index.html");
const PORT = Number(process.env.PORT) || 4100;
const AUDIO_EXT = /\.(ogg|wav|mp3|m4a|flac|aif|aiff|opus)$/i;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".flac": "audio/flac", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".opus": "audio/ogg" };

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

/** Serve a file from `base`, refusing anything outside it. */
function serveFrom(base, rel, res) {
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, { error: "outside" });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
}

/** Everything the page shows: events, their candidates, today's sound, incoming files. */
function catalogue() {
  const cand = readJson(CANDIDATES, { events: {} });
  const manifest = readJson(MANIFEST, { sounds: {} });
  const incoming = fs.existsSync(INCOMING)
    ? fs.readdirSync(INCOMING).filter((f) => AUDIO_EXT.test(f)).map((f) => ({ id: `in:${f}`, file: `incoming/${f}`, title: f, author: "(your file)", license: "see your notes", incoming: true }))
    : [];
  return {
    events: EVENTS.map((ev) => ({
      ...ev,
      candidates: cand.events[ev.id] || [],
      current: (manifest.sounds[ev.id] || []).map((n) => `/assets/audio/${n}.ogg`)
    })),
    incoming,
    selection: readJson(SELECTION, null)
  };
}

function saveSelection(req, res) {
  let body = "";
  req.on("data", (d) => { body += d; if (body.length > 1e6) req.destroy(); });
  req.on("end", () => {
    let data;
    try { data = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }); }
    const ids = new Set(EVENTS.map((e) => e.id));
    const picks = {};
    for (const [ev, p] of Object.entries(data.picks || {})) {
      if (!ids.has(ev) || !p || typeof p !== "object") continue;
      const file = String(p.file || "");
      if (file && (file.includes("..") || !AUDIO_EXT.test(file) || !fs.existsSync(path.join(AUDIO_SRC, file)))) return send(res, 400, { error: `bad file for ${ev}` });
      picks[ev] = { file: file || null, id: p.id ? String(p.id) : null, reject: Boolean(p.reject), note: String(p.note || "").slice(0, 500) };
    }
    const out = { savedAt: new Date().toISOString(), note: "Picks from the audition page (npm run audition). tools/build-audio.js builds from these.", picks };
    fs.writeFileSync(SELECTION, JSON.stringify(out, null, 2) + "\n");
    const missing = EVENTS.filter((e) => !picks[e.id] || (!picks[e.id].file && !picks[e.id].reject)).map((e) => e.id);
    send(res, 200, { ok: true, saved: Object.keys(picks).length, missing, path: path.relative(ROOT, SELECTION) });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  if (p === "/audition/catalogue") return send(res, 200, catalogue());
  if (p === "/audition/selection" && req.method === "POST") return saveSelection(req, res);
  if (p.startsWith("/audition/file/")) return serveFrom(AUDIO_SRC, p.slice("/audition/file/".length), res);
  if ((p === "/" || p === "/index.html") && url.searchParams.has("audition")) return serveFrom(__dirname, "index.html", res);
  return serveFrom(CLIENT, p === "/" ? "index.html" : p.replace(/^\/+/, ""), res);
});
server.listen(PORT, "127.0.0.1", () => {
  if (!fs.existsSync(PAGE)) console.warn("missing tools/audition/index.html");
  console.log(`Sound audition: http://localhost:${PORT}/?audition=1  (game at http://localhost:${PORT}/)`);
});
