#!/usr/bin/env node
// Art, not CSS (CLAUDE.md; docs/lumina-overhaul/art-not-css.md): what players see in
// Vault 20K is art images and SVG; CSS only places things. This lint fails when Vault's own
// files make CSS draw: a decorative gradient, box-shadow, text-shadow, filter,
// backdrop-filter, border-image, clip-path or mask — in a stylesheet rule (keyframes
// included), an inline style="" or <style> block, or a JS style assignment.
//
// What is still there today is listed, one "file|selector|property" per entry, in
// visual-lint-allow.json: the work list of the art-not-css plan. A NEW finding fails, and
// so does an entry that no longer exists (the list only ever shrinks: remove it).
//
//   node tools/probes/visual-lint.mjs           exits 1 on a new or a stale entry
//   node tools/probes/visual-lint.mjs --write   rewrites the allowlist from the files (owner-approved changes only)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOW = path.join(ROOT, "tools/probes/visual-lint-allow.json");
const FILES = ["client/styles.css", "client/index.html", "client/main.js", "client/vault-shell.js", "client/notify.js"];

const BANNED = [
  ["box-shadow", (v) => !/^\s*none\s*$/.test(v)],
  ["text-shadow", (v) => !/^\s*none\s*$/.test(v)],
  ["filter", (v) => !/^\s*none\s*$/.test(v)],
  ["-webkit-filter", (v) => !/^\s*none\s*$/.test(v)],
  ["backdrop-filter", (v) => !/^\s*none\s*$/.test(v)],
  ["-webkit-backdrop-filter", (v) => !/^\s*none\s*$/.test(v)],
  ["border-image", (v) => !/^\s*none\s*$/.test(v)],
  ["border-image-source", (v) => !/^\s*none\s*$/.test(v)],
  ["clip-path", (v) => !/^\s*none\s*$/.test(v)],
  ["mask", (v) => !/^\s*none\s*$/.test(v)],
  ["mask-image", (v) => !/^\s*none\s*$/.test(v)],
  ["-webkit-mask-image", (v) => !/^\s*none\s*$/.test(v)],
  ["background", (v) => /gradient\(/.test(v)],
  ["background-image", (v) => /gradient\(/.test(v)]
];
const banned = (prop, value) => BANNED.some(([p, test]) => p === prop.trim().toLowerCase() && test(value));

const norm = (s) => s.replace(/\s+/g, " ").trim();

/** Every declaration in a stylesheet text, with the selector path it sits under. */
function cssDecls(text) {
  const out = [];
  text = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const stack = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") { stack.push(norm(buf)); buf = ""; }
    else if (ch === "}") { flush(); stack.pop(); buf = ""; }
    else if (ch === ";") { flush(); buf = ""; }
    else buf += ch;
  }
  function flush() {
    const d = buf.trim();
    const c = d.indexOf(":");
    if (c > 0 && stack.length && !d.startsWith("@")) out.push({ sel: stack.join(" >> "), prop: d.slice(0, c).trim(), value: d.slice(c + 1).trim() });
  }
  return out;
}

const found = new Set();
for (const f of FILES) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  const add = (sel, prop, value) => { if (banned(prop, value)) found.add(`${f}|${sel}|${prop.trim().toLowerCase()}`); };
  if (f.endsWith(".css")) for (const d of cssDecls(text)) add(d.sel, d.prop, d.value);
  if (f.endsWith(".html")) {
    for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) for (const d of cssDecls(m[1])) add("<style> " + d.sel, d.prop, d.value);
    for (const m of text.matchAll(/<([a-z0-9-]+)[^>]*\sstyle="([^"]*)"/gi)) for (const d of m[2].split(";")) { const c = d.indexOf(":"); if (c > 0) add(`<${m[1]} style>`, d.slice(0, c), d.slice(c + 1)); }
  }
  if (f.endsWith(".js")) {
    const js = { boxShadow: "box-shadow", textShadow: "text-shadow", filter: "filter", backdropFilter: "backdrop-filter", webkitBackdropFilter: "-webkit-backdrop-filter", clipPath: "clip-path", maskImage: "mask-image", borderImage: "border-image" };
    for (const m of text.matchAll(/\.style\.(boxShadow|textShadow|filter|backdropFilter|webkitBackdropFilter|clipPath|maskImage|borderImage)\s*=\s*([^;\n]+)/g)) {
      if (!/^["'`]\s*none\s*["'`]$|^["'`]{2}$/.test(m[2].trim())) found.add(`${f}|.style.${m[1]}|${js[m[1]]}`);
    }
    for (const m of text.matchAll(/\.style\.(background|backgroundImage)\s*=\s*([^;\n]*gradient\([^;\n]*)/g)) found.add(`${f}|.style.${m[1]}|background`);
    for (const m of text.matchAll(/setProperty\(\s*["'](box-shadow|text-shadow|filter|backdrop-filter|clip-path|mask-image)["']\s*,\s*["'`](?!none)/g)) found.add(`${f}|setProperty|${m[1]}`);
  }
}

const now = [...found].sort();
if (process.argv.includes("--write")) {
  fs.writeFileSync(ALLOW, JSON.stringify({ note: "Art, not CSS: what Vault's files still draw with CSS (docs/lumina-overhaul/art-not-css.md). Only ever shrinks.", entries: now }, null, 1) + "\n");
  console.log(`visual-lint: wrote ${now.length} entries`);
  process.exit(0);
}
const allow = new Set(JSON.parse(fs.readFileSync(ALLOW, "utf8")).entries);
const added = now.filter((k) => !allow.has(k));
const stale = [...allow].filter((k) => !found.has(k));
for (const k of added) console.log(`NEW   ${k}   (CSS may not draw: make it art or SVG)`);
for (const k of stale) console.log(`STALE ${k}   (gone: remove it from visual-lint-allow.json)`);
console.log(`visual-lint: ${now.length} known, ${added.length} new, ${stale.length} stale`);
process.exit(added.length || stale.length ? 1 : 0);
