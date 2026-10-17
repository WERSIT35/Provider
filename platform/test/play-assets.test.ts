import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";

const CLIENT = path.resolve(__dirname, "..", "..", "client");
const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 600 };

describe("/play assets: one bundle, compressed, cacheable", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: buildContainer(CONFIG, {}) });
    await app.ready();
  });
  afterAll(async () => app.close());

  const scriptsInIndex = () =>
    [...fs.readFileSync(path.join(CLIENT, "index.html"), "utf8").matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map((m) => m[1]);

  it("the page loads the client as ONE script: the same files, in the same order", async () => {
    const page = await app.inject({ method: "GET", url: "/play/" });
    expect(page.statusCode).toBe(200);
    const tags = [...page.body.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/^app\.bundle\.js\?v=[\w-]{12}$/);
    const bundle = await app.inject({ method: "GET", url: `/play/${tags[0]}` });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers["content-type"]).toMatch(/javascript/);
    expect(bundle.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const files = scriptsInIndex();
    expect(files.length).toBeGreaterThan(10);
    expect(files.at(-1)).toBe("main.js");
    // The concatenation, minified by esbuild (script mode: top-level names unchanged).
    const plain = files.map((f) => fs.readFileSync(path.join(CLIENT, f), "utf8")).join("\n;\n");
    const { transform } = await import("esbuild");
    expect(bundle.body).toBe((await transform(plain, { minify: true, keepNames: true, target: "es2019", legalComments: "none" })).code);
    expect(bundle.body.length).toBeLessThan(plain.length * 0.6);
  });

  it("the minified bundle keeps every top-level name the files share as globals", async () => {
    const page = await app.inject({ method: "GET", url: "/play/" });
    const src = /<script src="([^"]+)"><\/script>/.exec(page.body)![1];
    const min = (await app.inject({ method: "GET", url: `/play/${src}` })).body;
    const plain = scriptsInIndex().map((f) => fs.readFileSync(path.join(CLIENT, f), "utf8")).join("\n;\n");
    const names = [...plain.matchAll(/^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(20);
    const esc = (n: string) => n.replace(/\$/g, "\\$");
    for (const name of names) expect(min, `global ${name}`).toMatch(new RegExp(`(?:var|let|const|function|class|,)\\s*${esc(name)}\\b`));
  });

  it("text is compressed (brotli, else gzip) and identical once decoded; binaries are not", async () => {
    const raw = fs.readFileSync(path.join(CLIENT, "main.js"));
    const br = await app.inject({ method: "GET", url: "/play/main.js", headers: { "accept-encoding": "gzip, deflate, br" } });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers.vary).toBe("accept-encoding");
    expect(zlib.brotliDecompressSync(br.rawPayload).equals(raw)).toBe(true);
    expect(br.rawPayload.length).toBeLessThan(raw.length / 3);
    const gz = await app.inject({ method: "GET", url: "/play/main.js", headers: { "accept-encoding": "gzip" } });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(gz.rawPayload).equals(raw)).toBe(true);
    const plain = await app.inject({ method: "GET", url: "/play/main.js" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.rawPayload.equals(raw)).toBe(true);
    const font = await app.inject({ method: "GET", url: "/play/assets/fonts/inter-sub-wght-400-900.woff2", headers: { "accept-encoding": "br" } });
    expect(font.statusCode).toBe(200);
    expect(font.headers["content-encoding"]).toBeUndefined();
  });

  it("ETag revalidation answers 304 without a body; the HTML shell is never cached", async () => {
    const first = await app.inject({ method: "GET", url: "/play/styles.css" });
    expect(first.headers.etag).toBeTruthy();
    expect(first.headers["cache-control"]).toBe("public, max-age=3600");
    const again = await app.inject({ method: "GET", url: "/play/styles.css", headers: { "if-none-match": String(first.headers.etag) } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
    const html = await app.inject({ method: "GET", url: "/play/" });
    expect(html.headers["cache-control"]).toBe("no-store");
  });

  it("audio has an audio type; paths outside the client stay refused", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(CLIENT, "assets/audio/manifest.json"), "utf8"));
    const first = Object.values(manifest.sounds as Record<string, string[]>)[0][0];
    const ogg = await app.inject({ method: "GET", url: `/play/assets/audio/${first}.ogg` });
    expect(ogg.statusCode).toBe(200);
    expect(ogg.headers["content-type"]).toBe("audio/ogg");
    const escape = await app.inject({ method: "GET", url: "/play/..%2f..%2fpackage.json" });
    expect([400, 404]).toContain(escape.statusCode);
  });
});
