#!/usr/bin/env node
/*
 * MedWiki local server: serves the site and lets the editor save straight
 * into content/. No dependencies. Usage:  node serve.js   (PORT=8080 node serve.js)
 *
 * Only accepts writes from localhost. Endpoints (all JSON):
 *   GET  /api/ping
 *   POST /api/save      { id, source }          → content/<id>.js, adds id to the manifest
 *   POST /api/delete    { id }                  → removes content/<id>.js and its manifest entry
 *   POST /api/image     { data }                → content/images/<hash>.<ext>, returns { path }
 *   POST /api/chapters  { extra }               → content/_chapters.js
 *   POST /api/structure { structure }           → content/_structure.js (subjects and chapters)
 *   POST /api/bites     { bites }               → content/_bites.js (quick bites: one-glance definitions)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.MEDWIKI_ROOT ? path.resolve(process.env.MEDWIKI_ROOT) : __dirname;
const PORT = Number(process.env.PORT) || 5173;
const CONTENT = path.join(ROOT, "content");
const DATA_JS = path.join(ROOT, "assets", "js", "data.js");
const MAX_BODY = 30 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
};

function reply(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "application/json", "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const validId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,120}$/.test(id) && !id.startsWith("_");
const MANIFEST = /(MedWiki\.manifest\s*=\s*\[)([\s\S]*?)(\];)/;

function addToManifest(id) {
  const src = fs.readFileSync(DATA_JS, "utf8");
  const m = MANIFEST.exec(src);
  if (!m) throw new Error("Could not find MedWiki.manifest in assets/js/data.js");
  if (new RegExp('"' + id + '"').test(m[2])) return;
  const body = m[2].replace(/\s*$/, "");
  const next = src.replace(MANIFEST, (_, a, b, c) => a + body + (body.trim() ? "" : "") + '\n  "' + id + '",\n' + c);
  writeAtomic(DATA_JS, next);
}

function removeFromManifest(id) {
  const src = fs.readFileSync(DATA_JS, "utf8");
  const next = src.replace(new RegExp('\\n[ \\t]*"' + id + '",?[ \\t]*(?=\\n|\\])', "g"), "");
  if (next !== src) writeAtomic(DATA_JS, next);
}

async function api(req, res, url) {
  const host = (req.headers.host || "").split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return reply(res, 403, { error: "Local access only" });
  if (url === "/api/ping") return reply(res, 200, { ok: true, version: 1 });
  if (req.method !== "POST") return reply(res, 405, { error: "POST required" });

  let b;
  try { b = await readBody(req); } catch (e) { return reply(res, 400, { error: e.message }); }

  try {
    if (url === "/api/save") {
      if (!validId(b.id)) return reply(res, 400, { error: "Bad id" });
      if (typeof b.source !== "string" || !b.source.startsWith('MedWiki.define("' + b.id + '"')) return reply(res, 400, { error: "Bad source" });
      writeAtomic(path.join(CONTENT, b.id + ".js"), b.source);
      addToManifest(b.id);
      return reply(res, 200, { ok: true });
    }
    if (url === "/api/delete") {
      if (!validId(b.id)) return reply(res, 400, { error: "Bad id" });
      const f = path.join(CONTENT, b.id + ".js");
      if (fs.existsSync(f)) fs.unlinkSync(f);
      removeFromManifest(b.id);
      return reply(res, 200, { ok: true });
    }
    if (url === "/api/image") {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.data || "");
      if (!m) return reply(res, 400, { error: "Unsupported image" });
      const buf = Buffer.from(m[2], "base64");
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const name = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10) + "." + ext;
      writeAtomic(path.join(CONTENT, "images", name), buf);
      return reply(res, 200, { ok: true, path: "content/images/" + name });
    }
    if (url === "/api/structure") {
      const ok = Array.isArray(b.structure) && b.structure.every((s) => s && typeof s.id === "string" && typeof s.title === "string" && Array.isArray(s.chapters) && s.chapters.every((c) => c && typeof c.id === "string" && typeof c.title === "string"));
      if (!ok) return reply(res, 400, { error: "Bad payload" });
      writeAtomic(path.join(CONTENT, "_structure.js"), "MedWiki.structure = " + JSON.stringify(b.structure, null, 2) + ";\n");
      return reply(res, 200, { ok: true });
    }
    if (url === "/api/bites") {
      const str = (v, max) => typeof v === "string" && v.length <= max;
      const ok = Array.isArray(b.bites) && b.bites.length <= 5000 && b.bites.every((x) => x && validId(x.id) && str(x.term, 80) && x.term.trim() && str(x.means, 600) && str(x.key || "", 400) && str(x.hook || "", 300) && str(x.more || "", 200) && str(x.image || "", 2000) &&
        Array.isArray(x.aliases) && x.aliases.every((a) => str(a, 80)) && Array.isArray(x.tags) && x.tags.every((t) => str(t, 60)));
      if (!ok) return reply(res, 400, { error: "Bad payload" });
      writeAtomic(path.join(CONTENT, "_bites.js"), "MedWiki.bitesData = " + JSON.stringify(b.bites, null, 2) + ";\n");
      return reply(res, 200, { ok: true });
    }
    if (url === "/api/chapters") {
      if (!b.extra || typeof b.extra !== "object") return reply(res, 400, { error: "Bad payload" });
      writeAtomic(path.join(CONTENT, "_chapters.js"), "MedWiki.extraChapters = " + JSON.stringify(b.extra, null, 2) + ";\n");
      return reply(res, 200, { ok: true });
    }
  } catch (e) {
    return reply(res, 500, { error: e.message });
  }
  reply(res, 404, { error: "Unknown endpoint" });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.startsWith("/api/")) return api(req, res, url);
  let rel = url === "/" ? "/index.html" : url;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return reply(res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return reply(res, 404, "Not found", "text/plain");
    reply(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\n  MedWiki is running at http://localhost:" + PORT + "\n  Edits are saved to " + path.relative(process.cwd(), CONTENT) + (path.relative(process.cwd(), CONTENT) ? "" : "content") + "/\n  Press Ctrl+C to stop.\n");
});
