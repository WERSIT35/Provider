import path from "node:path";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { verifyToken } from "../lib/tokens";

/**
 * Player-facing game client — the real Banana X canvas game in `client/`.
 *
 *   /play                  same page as /play/ with <base href="/play/"> (no redirect round trip)
 *   /play/                 serves client/index.html (with ?lt=… preserved)
 *   /play/<sub/path>       serves client/<sub/path>
 *
 * The browser sees a normal static site rooted at /play/; the canvas client's
 * own <base href> logic (client/index.html) sets the base to /play/ so its
 * relative requests (engine/*.js, math/*.json, assets/symbols/*.png) all
 * resolve back into this handler.
 *
 * The launch token in `?lt=` is picked up by main.js (no server-side templating
 * needed); when present, main.js routes session/init + spin to /game/v1/* on
 * this same origin.
 *
 * Framing: every HTML response carries `Content-Security-Policy: frame-ancestors`
 * limited to the launching operator's registered domains (see framingHeaders), so
 * only that casino can embed the game. The casino ↔ game postMessage contract is
 * client/embed-bridge.js.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg"
};

/** Text worth compressing (images, fonts and audio are compressed formats already). */
const COMPRESSIBLE = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".svg", ".map"]);

function clientRoot(): string {
  // platform/src/http/*.ts -> ../../../client  (tsx)
  // platform/dist/http/*.js -> ../../../client (compiled)
  return path.resolve(__dirname, "..", "..", "..", "client");
}

/**
 * Who may frame this page: the hosts of the operator that issued the `?lt=` launch
 * token (its registered domains), else nobody. The token's signature is checked
 * but not its expiry: a reload inside the casino's iframe still carries the
 * original 60s handoff token, and it still proves which operator launched the
 * game. A missing, forged or foreign token, or an operator with no domains, gets
 * 'none'.
 */
function framingHeaders(app: FastifyInstance, launchToken: unknown): Record<string, string> {
  let hosts: string[] = [];
  if (typeof launchToken === "string" && launchToken) {
    try {
      const claims = verifyToken(app.container.config.launchSecret, launchToken, { ignoreExpiry: true });
      if (typeof claims.operator_id === "string") hosts = app.container.mgmt.embedHosts(claims.operator_id);
    } catch {
      hosts = [];
    }
  }
  if (!hosts.length) {
    return { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" };
  }
  // A scheme-less host source matches https (and http only when /play itself is
  // served over http, i.e. local dev), so production framing is https-only.
  return { "content-security-policy": `frame-ancestors ${hosts.join(" ")}` };
}

/**
 * A served file, kept in memory: its bytes, ETag and (for text) brotli / gzip forms,
 * made once. Re-validated against the file's mtime at most every RECHECK_MS, so an
 * edit still shows up (dev) without a stat per request.
 */
interface Asset {
  mtimeMs: number;
  type: string;
  ext: string;
  body: Buffer;
  etag: string;
  br?: Buffer;
  gz?: Buffer;
  checkedAt: number;
}
const RECHECK_MS = 2_000;
const assets = new Map<string, Asset>();

function makeAsset(ext: string, body: Buffer, mtimeMs: number): Asset {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
  return { mtimeMs, type: MIME[ext] ?? "application/octet-stream", ext, body, etag, checkedAt: Date.now() };
}

/** The file under `root`, or null (missing, a directory, or outside the root). */
async function loadAsset(root: string, rel: string): Promise<Asset | null> {
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  const cached = assets.get(target);
  if (cached && Date.now() - cached.checkedAt < RECHECK_MS) return cached;
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    assets.delete(target);
    return null;
  }
  if (stat.isDirectory()) return null;
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    cached.checkedAt = Date.now();
    return cached;
  }
  const ext = path.extname(target).toLowerCase();
  const raw = await fs.readFile(target);
  const asset = makeAsset(ext, ext === ".css" ? await minifyCss(raw) : raw, stat.mtimeMs);
  assets.set(target, asset);
  return asset;
}

/**
 * One request for the whole client code instead of 18 (Slow 4G pays ~560 ms per
 * round trip): the scripts between the `bundle:start` / `bundle:end` markers in
 * index.html, concatenated in the same order. They are classic scripts sharing one
 * global scope, so one script with the same code in the same order behaves the same
 * (`;` between files guards against ASI). The HTML gets one tag, versioned by content.
 */
const BUNDLE_BLOCK = /<!-- bundle:start[\s\S]*?<!-- bundle:end -->/;
const BUNDLE_PATH = "app.bundle.js";
/** One bundle per client root (Vault 20K at /play/, every other game at /play/g/<code>/). */
const bundles = new Map<string, { key: string; asset: Asset; html: Asset }>();

async function bundleFor(root: string, index: Asset): Promise<{ asset: Asset; html: Asset } | null> {
  const html = index.body.toString("utf8");
  const block = BUNDLE_BLOCK.exec(html);
  if (!block) return null;
  const srcs = [...block[0].matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map((m) => m[1]);
  const parts = await Promise.all(srcs.map((src) => loadAsset(root, src)));
  if (parts.some((p) => !p)) return null; // a missing file: serve the page unbundled
  const key = index.etag + parts.map((p) => (p as Asset).etag).join("");
  let bundle = bundles.get(root);
  if (bundle?.key !== key) {
    const code = await minify(parts.map((p) => (p as Asset).body.toString("utf8")).join("\n;\n"));
    bundle = bundles.get(root);
    if (bundle?.key === key) return { asset: bundle.asset, html: bundle.html }; // another request built it meanwhile
    const asset = makeAsset(".js", Buffer.from(code), 0);
    const tag = `<script src="${BUNDLE_PATH}?v=${asset.etag.slice(1, 13)}"></script>`;
    bundle = { key, asset, html: makeAsset(".html", Buffer.from(html.replace(BUNDLE_BLOCK, tag)), 0) };
    bundles.set(root, bundle);
  }
  return { asset: bundle.asset, html: bundle.html };
}

/**
 * Minified with esbuild (500 → 236 KB, brotli 136 → 70 KB), off the event loop (its
 * own process). Script mode: top-level names stay as they are, because the files
 * share them as globals; only names inside functions shrink. `keepNames` keeps
 * `fn.name` / class names. PLAY_MINIFY=0, or esbuild missing or failing, serves the
 * plain concatenation (same behaviour, just bigger).
 */
async function minify(code: string): Promise<string> {
  if (process.env.PLAY_MINIFY === "0") return code;
  try {
    const { transform } = await import("esbuild");
    return (await transform(code, { minify: true, keepNames: true, target: "es2019", legalComments: "none" })).code;
  } catch {
    return code;
  }
}

/**
 * Stylesheets minified once per edit (Vault 20K's styles.css: brotli 30.9 → 15.9 KB, on
 * the critical path before the first paint). esbuild's minifier: whitespace, comments and
 * shorter equivalent values; no target, so no syntax is lowered. PLAY_MINIFY=0 or an esbuild failure serves the file
 * as it is.
 */
async function minifyCss(body: Buffer): Promise<Buffer> {
  if (process.env.PLAY_MINIFY === "0") return body;
  try {
    const { transform } = await import("esbuild");
    return Buffer.from((await transform(body.toString("utf8"), { loader: "css", minify: true, legalComments: "none" })).code);
  } catch {
    return body;
  }
}

/** Pick brotli / gzip from Accept-Encoding; made once per asset, then served from memory. */
function encodingFor(req: FastifyRequest, asset: Asset): { body: Buffer; encoding: string | null } {
  if (!COMPRESSIBLE.has(asset.ext) || asset.body.length < 1024) return { body: asset.body, encoding: null };
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (/\bbr\b/.test(accept)) {
    asset.br ??= zlib.brotliCompressSync(asset.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: asset.body.length } });
    return { body: asset.br, encoding: "br" };
  }
  if (/\bgzip\b/.test(accept)) {
    asset.gz ??= zlib.gzipSync(asset.body, { level: 9 });
    return { body: asset.gz, encoding: "gzip" };
  }
  return { body: asset.body, encoding: null };
}

function send(req: FastifyRequest, reply: import("fastify").FastifyReply, asset: Asset, htmlHeaders: Record<string, string>) {
  const isHtml = asset.ext === ".html" || asset.ext === ".htm";
  // The HTML shell never caches (a fresh launch token always lands). A URL with a
  // version (?v=…) never changes: cache it for good. Anything else: an hour, then
  // revalidate by ETag.
  const versioned = /[?&]v=/.test(req.raw.url ?? "");
  const cache = isHtml ? "no-store" : versioned ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  if (isHtml) reply.headers(htmlHeaders);
  reply.header("cache-control", cache).header("etag", asset.etag);
  if (COMPRESSIBLE.has(asset.ext)) reply.header("vary", "accept-encoding");
  if (!isHtml && req.headers["if-none-match"] === asset.etag) return reply.code(304).send();
  const { body, encoding } = encodingFor(req, asset);
  if (encoding) reply.header("content-encoding", encoding);
  return reply.type(asset.type).send(body);
}

const notFound = (reply: import("fastify").FastifyReply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "file not found" } });

async function serveFile(
  root: string,
  rel: string,
  req: FastifyRequest,
  reply: import("fastify").FastifyReply,
  htmlHeaders: Record<string, string> = {}
): Promise<unknown> {
  // Reject path-traversal: resolve and confirm it stays under the root.
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "invalid path" } });
  }
  if (rel === "index.html" || rel === BUNDLE_PATH) {
    const index = await loadAsset(root, "index.html");
    if (!index) return notFound(reply);
    const bundled = await bundleFor(root, index);
    if (rel === BUNDLE_PATH) return bundled ? send(req, reply, bundled.asset, htmlHeaders) : notFound(reply);
    return send(req, reply, bundled ? bundled.html : index, htmlHeaders);
  }
  const asset = await loadAsset(root, rel);
  return asset ? send(req, reply, asset, htmlHeaders) : notFound(reply);
}

const playPageRoutes: FastifyPluginAsync = async (app) => {
  const root = clientRoot();

  const launchToken = (req: FastifyRequest): unknown => (req.query as Record<string, unknown> | undefined)?.lt;

  // /play (no slash) serves Vault 20K's page as it is: its <base href> script turns
  // "/play" into "/play/", so every relative path still resolves into this handler, and
  // the casino's launch URL costs no redirect (a round trip, 562 ms on Slow 4G). Another
  // game's launch goes straight to its own folder (one redirect).
  let slashless: { from: Asset; asset: Asset } | null = null; // /play's page with its <base>, made once per edit
  app.get("/play", async (req, reply) => {
    const search = (req.raw.url || "").includes("?") ? (req.raw.url as string).slice((req.raw.url as string).indexOf("?")) : "";
    const game = gameOf(launchToken(req));
    if (game && game !== app.container.games.default.gameCode) return reply.code(302).header("location", `/play/g/${game}/${search}`).send();
    // A real <base href="/play/"> in the HTML: the browser's preload scanner reads the
    // page before any script runs, so without it the preloads resolved against "/play"
    // (to /assets/…, 404) and every critical asset was fetched twice.
    const index = await loadAsset(root, "index.html");
    if (!index) return notFound(reply);
    const page = (await bundleFor(root, index))?.html ?? index;
    if (slashless?.from !== page) {
      const html = page.body.toString("utf8").replace(/<head>/i, '<head>\n    <base href="/play/">');
      slashless = { from: page, asset: makeAsset(".html", Buffer.from(html), page.mtimeMs) };
    }
    return send(req, reply, slashless.asset, framingHeaders(app, launchToken(req)));
  });
  // Multi-game: a launch for another game than Vault 20K goes to that game's own client,
  // /play/g/<code>/ (served from games/<code>/<client>), with the same query (?lt=…).
  const gameOf = (lt: unknown): string | null => {
    if (typeof lt !== "string" || !lt) return null;
    try {
      const code = verifyToken(app.container.config.launchSecret, lt, { ignoreExpiry: true }).game_code;
      return typeof code === "string" && app.container.games.has(code) ? app.container.games.engineFor(code).gameCode : null;
    } catch {
      return null;
    }
  };
  app.get("/play/", async (req, reply) => {
    const game = gameOf(launchToken(req));
    if (game && game !== app.container.games.default.gameCode) {
      const url = req.raw.url || "";
      return reply.code(302).header("location", `/play/g/${game}/${url.includes("?") ? url.slice(url.indexOf("?")) : ""}`).send();
    }
    return serveFile(root, "index.html", req, reply, framingHeaders(app, launchToken(req)));
  });

  app.get("/play/g/:game/*", async (req, reply) => {
    const { game, "*": rest } = req.params as { game: string; "*": string };
    const dir = /^[a-z0-9][a-z0-9_-]*$/.test(game) ? app.container.games.clientDir(game) : null;
    if (!dir || game === app.container.games.default.gameCode) return notFound(reply);
    // rules.json = the game's own rules file (outside its client folder): displayed pays = paid pays.
    if (rest === "rules.json") {
      const rules = app.container.games.rulesPath(game) as string;
      return serveFile(path.dirname(rules), path.basename(rules), req, reply);
    }
    return serveFile(dir, rest || "index.html", req, reply, framingHeaders(app, launchToken(req)));
  });

  app.get("/play/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"] || "index.html";
    return serveFile(root, rel, req, reply, framingHeaders(app, launchToken(req)));
  });

  // /play/g/<code> (no slash) → /play/g/<code>/ so the client's relative paths resolve.
  app.get("/play/g/:game", (req, reply) => {
    const { game } = req.params as { game: string };
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(game) || !app.container.games.clientDir(game) || game === app.container.games.default.gameCode) return notFound(reply);
    const url = req.raw.url ?? "";
    return reply.code(302).header("location", `/play/g/${game}/${url.includes("?") ? url.slice(url.indexOf("?")) : ""}`).send();
  });
};

export default playPageRoutes;
