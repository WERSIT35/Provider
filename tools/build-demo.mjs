#!/usr/bin/env node
/**
 * Builds the static demo site (Vercel / Netlify, no server) into dist-demo/:
 *
 *   /            the lobby (demo/lobby.html): pick a game, one play-money balance, reset
 *   /vault/      Vault 20K, client/ as it is (its local engine mode)
 *   /classic/    Classic 5x3, games/classic-5x3/client + its engine and rules, its RGS
 *                calls answered in the page by demo/demo.js
 *   /demo/       demo.js and the lobby's images
 *
 * Nothing in client/ or games/ changes: the game pages only get demo.js added (and
 * Classic 5x3's shared-asset paths moved from /play/ to /vault/). No dependencies.
 *   node tools/build-demo.mjs [--out dist-demo]
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = path.resolve(root, outArg > 0 ? process.argv[outArg + 1] : "dist-demo");
const p = (...s) => path.join(root, ...s);

function inject(file, marker, html, { before = true } = {}) {
  const src = readFileSync(file, "utf8");
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${path.relative(root, file)}: marker not found: ${marker}`);
  const i = before ? at : at + marker.length;
  writeFileSync(file, src.slice(0, i) + html + src.slice(i));
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Lobby + demo script + images.
cpSync(p("demo"), path.join(out, "demo"), { recursive: true, filter: (f) => !f.endsWith("lobby.html") });
cpSync(p("demo", "lobby.html"), path.join(out, "index.html"));

// Vault 20K: the client folder, demo.js right after its <base href> script (before any game code).
cpSync(p("client"), path.join(out, "vault"), { recursive: true });
inject(path.join(out, "vault", "index.html"), "</script>", '\n    <script src="/demo/demo.js" data-game="vault"></script>', { before: false });

// Classic 5x3: its client, engine and rules side by side; shared bridge/audio from /vault/.
const classic = path.join(out, "classic");
cpSync(p("games", "classic-5x3", "client"), classic, { recursive: true });
cpSync(p("games", "classic-5x3", "engine", "engine.js"), path.join(classic, "engine.js"));
cpSync(p("games", "classic-5x3", "math", "rules.json"), path.join(classic, "rules.json"));
const ci = path.join(classic, "index.html");
writeFileSync(ci, readFileSync(ci, "utf8").replaceAll('"/play/', '"/vault/'));
inject(ci, '<link rel="preload" href="rules.json"', '<script src="engine.js"></script>\n  <script src="/demo/demo.js" data-game="classic"></script>\n  ');

// Relic Forge: its client, its engine files in the manifest's load order, and its rules.
const rf = path.join(out, "relicforge");
const rfManifest = JSON.parse(readFileSync(p("games", "relicforge", "game.json"), "utf8"));
cpSync(p("games", "relicforge", "client"), rf, { recursive: true });
cpSync(p("games", "relicforge", rfManifest.engine.dir), path.join(rf, "engine"), { recursive: true });
cpSync(p("games", "relicforge", rfManifest.rules), path.join(rf, "rules.json"));
const rfTags = rfManifest.engine.files.map((f) => `<script src="engine/${f}"></script>`).join("\n  ");
inject(path.join(rf, "index.html"), '<script src="game.js">', rfTags + '\n  <script src="/demo/demo.js" data-game="relicforge"></script>\n  ');

for (const f of ["index.html", "demo/demo.js", "vault/index.html", "vault/main.js", "classic/index.html", "classic/game.js", "classic/engine.js", "classic/rules.json", "demo/img/vault-20k.webp", "demo/img/classic-5x3.webp", "relicforge/index.html", "relicforge/game.js", "relicforge/rules.json", "relicforge/engine/spin-engine.js", "demo/img/relic-forge.webp"]) {
  if (!existsSync(path.join(out, f))) throw new Error(`missing in the build: ${f}`);
}
console.log(`demo site → ${path.relative(root, out)}/ (lobby, vault/, classic/, relicforge/)`);
