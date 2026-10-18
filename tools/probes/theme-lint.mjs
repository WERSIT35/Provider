#!/usr/bin/env node
// The system chrome is the shell's alone (docs/lumina-overhaul/layers.md, Layer 1). This lint
// fails when a game's own files restyle it:
//   - setting any --lsh-* custom property (CSS, <style> blocks, JS strings);
//   - a CSS rule whose target is a shell element (a .lsh* class in the selector's LAST
//     compound). Allowed: a game's own elements inside shell containers (".lsh-stage .board",
//     ".lsh-sheet .card"), the system state class as a prefix ("html.lsh-reduced .lantern"),
//     and exclusions (":not(:where(.lsh *))").
// Games dress the themed slots (Layer 2) only through --skin-* (LuminaShell.mount({ skin })).
//
//   node tools/probes/theme-lint.mjs        exits 1 on any finding
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (!["node_modules", "assets", "audio", "engine", "shell"].includes(e.name)) walk(p); } else if (/\.(css|html|js)$/.test(e.name)) files.push(p); } };
for (const g of fs.readdirSync(path.join(ROOT, "games"))) { const c = path.join(ROOT, "games", g, "client"); if (fs.existsSync(c)) walk(c); }
for (const f of ["client/index.html", "client/styles.css", "client/main.js", "client/vault-shell.js"]) files.push(path.join(ROOT, f));

const findings = [];
const rel = (p) => path.relative(ROOT, p);
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
// Remove :not(...) / :where(...) inside :not, with nested parentheses.
function stripNot(sel) {
  let out = "", i = 0;
  while (i < sel.length) {
    if (sel.startsWith(":not(", i)) { let d = 0, j = i + 4; for (; j < sel.length; j++) { if (sel[j] === "(") d++; else if (sel[j] === ")" && --d === 0) break; } i = j + 1; continue; }
    out += sel[i++];
  }
  return out;
}
function checkCss(css, file, offset, full) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  for (const m of text.matchAll(/(^|[;{\s])(--lsh-[\w-]+)\s*:/g)) findings.push(`${rel(file)}:${lineOf(full, offset + m.index)} sets ${m[2]}`);
  for (const m of text.matchAll(/([^{};]+)\{/g)) {
    const selList = m[1].trim();
    if (!selList || selList.startsWith("@")) continue;
    for (const sel of selList.split(",")) {
      const s = stripNot(sel.trim()).replace(/html\.lsh-reduced\s*/g, "");
      const compounds = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      const last = compounds[compounds.length - 1] || "";
      if (/\.lsh[\w-]*/.test(last) || /^\.lsh\b/.test(last)) findings.push(`${rel(file)}:${lineOf(full, offset + m.index)} styles a shell element: ${sel.trim()}`);
    }
  }
}
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".css")) checkCss(text, file, 0, text);
  else if (file.endsWith(".html")) for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) checkCss(m[1], file, m.index + m[0].indexOf(m[1]), text);
  else for (const m of text.matchAll(/["'`](--lsh-[\w-]+)["'`]\s*[:,]/g)) findings.push(`${rel(file)}:${lineOf(text, m.index)} sets ${m[1]} from script`);
}
for (const f of findings) console.log(`  FAIL - ${f}`);
console.log(`theme-lint: ${files.length} files, ${findings.length ? `${findings.length} finding(s): FAIL` : "PASS"}`);
process.exit(findings.length ? 1 : 0);
