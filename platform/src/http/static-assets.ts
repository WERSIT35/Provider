import path from "node:path";
import fs from "node:fs/promises";
import type { FastifyPluginAsync } from "fastify";

/**
 * Serves the real Banana X symbol artwork from client/assets/symbols. The Round
 * Inspector and the player demo both render the grid using these PNGs, so we
 * need them reachable from the platform's HTTP origin.
 *
 * Path-traversal is blocked by resolving relative to a fixed root and rejecting
 * any candidate that escapes it. We don't add a full static-file plugin (extra
 * dep, extra surface area) since this single directory is the only thing the
 * platform needs to serve.
 */

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

function resolveAssetsRoot(): string {
  // platform/src/http/*.ts -> ../../../client/assets/symbols (run as TS) or
  // platform/dist/http/*.js -> ../../../client/assets/symbols (run as JS).
  return path.resolve(__dirname, "..", "..", "..", "client", "assets", "symbols");
}

const staticAssetsRoutes: FastifyPluginAsync = async (app) => {
  const root = resolveAssetsRoot();
  app.get("/assets/symbols/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    // Reject path-traversal: a clean basename, alpha-num + underscore + dot.
    if (!/^[A-Za-z0-9._-]+$/.test(file)) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "invalid filename" } });
    }
    const target = path.resolve(root, file);
    if (!target.startsWith(root)) {
      return reply.code(400).send({ error: { code: "BAD_REQUEST", message: "invalid path" } });
    }
    try {
      const data = await fs.readFile(target);
      const ext = path.extname(target).toLowerCase();
      reply.type(MIME[ext] ?? "application/octet-stream").header("cache-control", "public, max-age=3600");
      return reply.send(data);
    } catch {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "asset not found" } });
    }
  });
};

export default staticAssetsRoutes;
