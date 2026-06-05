import path from "node:path";
import fs from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";

/**
 * Player-facing game client — the real Banana X canvas game in `client/`.
 *
 *   /play                  redirect to /play/
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
  ".map": "application/json; charset=utf-8"
};

function clientRoot(): string {
  // platform/src/http/*.ts -> ../../../client  (tsx)
  // platform/dist/http/*.js -> ../../../client (compiled)
  return path.resolve(__dirname, "..", "..", "..", "client");
}

async function serveFile(root: string, rel: string, reply: import("fastify").FastifyReply): Promise<unknown> {
  // Reject path-traversal: resolve and confirm it stays under the root.
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "invalid path" } });
  }
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "not a file" } });
    }
    const data = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    // The HTML shell should never cache (so a fresh launch token always lands);
    // hashed/static assets can be short-cached for the session.
    const cache = ext === ".html" ? "no-store" : "public, max-age=3600";
    return reply.type(type).header("cache-control", cache).send(data);
  } catch {
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "file not found" } });
  }
}

const playPageRoutes: FastifyPluginAsync = async (app) => {
  const root = clientRoot();

  // /play (no slash) → /play/ so the canvas client's relative paths resolve.
  app.get("/play", (req, reply) => {
    const search = (req.raw.url || "").includes("?") ? (req.raw.url as string).slice((req.raw.url as string).indexOf("?")) : "";
    return reply.code(302).header("location", "/play/" + search).send();
  });

  app.get("/play/", async (_req, reply) => serveFile(root, "index.html", reply));

  app.get("/play/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"] || "index.html";
    return serveFile(root, rel, reply);
  });
};

export default playPageRoutes;
