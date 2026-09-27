#!/usr/bin/env node
/*
 * MedWiki local server: serves the site and lets the editor save straight
 * into content/. No dependencies. Usage:  node serve.js   (PORT=8080 node serve.js)
 *
 * Writing is for devices on your own network only (localhost, or a private LAN address such as your
 * wifi). Articles are private unless their front matter says "visibility: public": private ones live
 * in content/private/ (git-ignored, never published); public ones in content/ and the manifest in data.js.
 * Endpoints (all JSON):
 *   GET  /api/ping
 *   POST /api/save      { id, source }          → content/<id>.js, adds id to the manifest
 *   POST /api/delete    { id }                  → removes content/<id>.js and its manifest entry
 *   POST /api/image     { data }                → content/images/<hash>.<ext>, returns { path }
 *   POST /api/chapters  { extra }               → content/_chapters.js
 *   POST /api/structure { structure }           → content/_structure.js (subjects and chapters)
 *   POST /api/bites     { bites }               → content/_bites.js (quick bites: one-glance definitions)
 *   POST /api/pdf       { path }                → a PDF of that print.html view, with real PDF bookmarks
 *
 * /api/pdf works by driving a hidden, local copy of Chrome or Edge: only Chrome's automation API can
 * turn headings into PDF bookmarks, a browser's own Print dialog cannot. Needs Chrome or Edge installed;
 * set MEDWIKI_CHROME to its full path if it isn't found automatically.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = process.env.MEDWIKI_ROOT ? path.resolve(process.env.MEDWIKI_ROOT) : __dirname;
const PORT = Number(process.env.PORT) || 5173;
const CONTENT = path.join(ROOT, "content");
const PRIVATE = path.join(CONTENT, "private");
const PRIVATE_MANIFEST = path.join(PRIVATE, "_manifest.js");
const DATA_JS = path.join(ROOT, "assets", "js", "data.js");
const HOST = process.env.HOST || "0.0.0.0";
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

/* Loopback or a private-network address (10/8, 172.16/12, 192.168/16, link-local, IPv6 ULA). */
function isPrivateAddress(addr) {
  let a = String(addr || "").replace(/^::ffff:/i, "");
  if (a === "::1" || a === "127.0.0.1" || /^127\./.test(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^(fe80|fc|fd)/i.test(a);
}

/* A Host header naming this machine or a LAN host, never a public domain (blocks DNS rebinding). */
function isLanHostHeader(host) {
  const h = String(host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "::1" || isPrivateAddress(h)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return h.endsWith(".local") || !h.includes(".");
}

function isWriter(req) {
  return isPrivateAddress(req.socket.remoteAddress) && isLanHostHeader(req.headers.host);
}

function isPublicSource(source) {
  const m = /^MedWiki\.define\("[^"]*",\s*`---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return !!m && /^visibility:\s*public\s*$/m.test(m[1]);
}

function readPrivateIds() {
  try {
    const m = /\[([\s\S]*?)\]/.exec(fs.readFileSync(PRIVATE_MANIFEST, "utf8"));
    return m ? (m[1].match(/"([^"]+)"/g) || []).map((x) => x.slice(1, -1)) : [];
  } catch (e) { return []; }
}

function writePrivateIds(ids) {
  const loader =
    "MedWiki.privateManifest.forEach(function (id) {\n" +
    "  document.write('<script src=\"content/private/' + id + '.js?t=' + Date.now() + '\"><\\/script>');\n" +
    "});\n";
  writeAtomic(PRIVATE_MANIFEST, "/* Private articles. This folder is git-ignored and never published. */\nMedWiki.privateManifest = " + JSON.stringify(ids, null, 2) + ";\n" + loader);
}

function addPrivate(id) {
  const ids = readPrivateIds();
  if (!ids.includes(id)) { ids.push(id); writePrivateIds(ids); }
}

function removePrivate(id) {
  const ids = readPrivateIds();
  if (ids.includes(id)) writePrivateIds(ids.filter((x) => x !== id));
}

function dropFile(file) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/* ---------- Bookmarked PDF (drives a hidden local Chrome/Edge over the DevTools protocol) ---------- */

function findBrowser() {
  if (process.env.MEDWIKI_CHROME) return fs.existsSync(process.env.MEDWIKI_CHROME) ? process.env.MEDWIKI_CHROME : null;
  const candidates = process.platform === "win32" ? [
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

/* A tiny DevTools-protocol client: send(method, params) → Promise<result>. */
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const timer = setTimeout(() => reject(new Error("Could not talk to the local browser")), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const id = ++seq;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params: params || {} }));
          });
        },
        close() { try { ws.close(); } catch (e) {} },
      });
    };
    ws.onerror = () => reject(new Error("Could not talk to the local browser"));
    ws.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.id && pending.has(d.id)) {
        const { res, rej } = pending.get(d.id);
        pending.delete(d.id);
        if (d.error) rej(new Error(d.error.message)); else res(d.result);
      }
    };
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* printPath: a "print.html?..." path on this same server. → PDF Buffer, with real bookmarks. */
async function renderPdf(printPath) {
  const browser = findBrowser();
  if (!browser) throw new Error("No Chrome or Edge found on this computer for building the PDF. Set MEDWIKI_CHROME to its full path.");
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "medwiki-pdf-"));
  const child = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=" + debugPort, "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=" + profileDir, "about:blank",
  ], { stdio: "ignore" });
  let client;
  try {
    let targets = null;
    for (let i = 0; i < 100; i++) {
      try {
        const list = await (await fetch("http://127.0.0.1:" + debugPort + "/json")).json();
        if (list && list.length) { targets = list; break; }
      } catch (e) { /* not up yet */ }
      await sleep(150);
    }
    if (!targets) throw new Error("The local browser did not respond in time.");
    const page = targets.find((t) => t.type === "page") || targets[0];
    client = await cdpConnect(page.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/" + printPath });

    let ready = false;
    for (let i = 0; i < 360; i++) {
      const r = await client.send("Runtime.evaluate", { expression: "window.__mwPrintDone === true", returnByValue: true }).catch(() => null);
      if (r && r.result && r.result.value) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) throw new Error("The article took too long to render (images may be stuck loading).");
    const empty = await client.send("Runtime.evaluate", { expression: "!!document.querySelector('.jr-none')", returnByValue: true }).catch(() => null);
    if (empty && empty.result && empty.result.value) throw new Error("No matching article was found to print.");

    const pdf = await Promise.race([
      client.send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true }),
      sleep(240000).then(() => { throw new Error("Building the PDF took too long — this atlas may have too many images for this to build in one go. Use the browser's own Print / Save as PDF instead (it won't have bookmarks, but it will work)."); }),
    ]);
    return Buffer.from(pdf.data, "base64");
  } finally {
    if (client) client.close();
    child.kill();
    /* Windows can hold the profile dir's files locked for a moment after the process exits;
       clearing it is just housekeeping, so never let that failure hide the real result above. */
    setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} }, 1000);
  }
}

async function api(req, res, url) {
  if (!isWriter(req)) return reply(res, 403, { error: "Not an authorized writer" });
  if (url === "/api/ping") return reply(res, 200, { ok: true, version: 2, writer: true });
  if (req.method !== "POST") return reply(res, 405, { error: "POST required" });

  let b;
  try { b = await readBody(req); } catch (e) { return reply(res, 400, { error: e.message }); }

  try {
    if (url === "/api/save") {
      if (!validId(b.id)) return reply(res, 400, { error: "Bad id" });
      if (typeof b.source !== "string" || !b.source.startsWith('MedWiki.define("' + b.id + '"')) return reply(res, 400, { error: "Bad source" });
      if (isPublicSource(b.source)) {
        writeAtomic(path.join(CONTENT, b.id + ".js"), b.source);
        addToManifest(b.id);
        dropFile(path.join(PRIVATE, b.id + ".js"));
        removePrivate(b.id);
      } else {
        writeAtomic(path.join(PRIVATE, b.id + ".js"), b.source);
        addPrivate(b.id);
        dropFile(path.join(CONTENT, b.id + ".js"));
        removeFromManifest(b.id);
      }
      return reply(res, 200, { ok: true });
    }
    if (url === "/api/delete") {
      if (!validId(b.id)) return reply(res, 400, { error: "Bad id" });
      dropFile(path.join(CONTENT, b.id + ".js"));
      dropFile(path.join(PRIVATE, b.id + ".js"));
      removeFromManifest(b.id);
      removePrivate(b.id);
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
      const ok = Array.isArray(b.bites) && b.bites.length <= 5000 && b.bites.every((x) => x && validId(x.id) && str(x.term, 80) && x.term.trim() && str(x.means, 60000) && str(x.key || "", 5000) && str(x.hook || "", 5000) && str(x.more || "", 200) && str(x.image || "", 2000) &&
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
    if (url === "/api/pdf") {
      if (typeof b.path !== "string" || b.path.length > 2000 || !/^print\.html\?[a-z0-9=&,._%-]+$/i.test(b.path)) return reply(res, 400, { error: "Bad path" });
      const buf = await renderPdf(b.path);
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="medwiki.pdf"', "Cache-Control": "no-store" });
      return res.end(buf);
    }
  } catch (e) {
    return reply(res, 500, { error: e.message });
  }
  reply(res, 404, { error: "Unknown endpoint" });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.startsWith("/api/")) return api(req, res, url);
  if (url.startsWith("/content/private/") && !isWriter(req)) return reply(res, 403, "Not an authorized writer", "text/plain");
  let rel = url === "/" ? "/index.html" : url;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return reply(res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return reply(res, 404, "Not found", "text/plain");
    reply(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(PORT, HOST, () => {
  const lan = [].concat(...Object.values(os.networkInterfaces())).filter((n) => n.family === "IPv4" && !n.internal).map((n) => "http://" + n.address + ":" + PORT);
  console.log("\n  MedWiki is running at http://localhost:" + PORT + (lan.length ? "\n  On your wifi (writers only): " + lan.join("  ") : "") + "\n  Edits are saved to " + path.relative(process.cwd(), CONTENT) + (path.relative(process.cwd(), CONTENT) ? "" : "content") + "/\n  Press Ctrl+C to stop.\n");
});
