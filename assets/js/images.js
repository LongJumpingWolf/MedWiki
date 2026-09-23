/*
 * Images. Every pasted or dropped image is resized, saved on this device
 * (IndexedDB) and referenced in the article as ![](img:<key>) straight away, so
 * writing never waits on the network. Once an ImgBB API key is set, a background
 * queue uploads them in small batches (one at a time, with pauses, exponential
 * backoff and Retry-After handling), then rewrites the articles to use the hosted
 * URL and drops the local copy. Anything that cannot upload just stays queued.
 *
 *   MW.images.add(file)      → Promise<"img:<key>">
 *   MW.images.src(key)       → URL to display (hosted if uploaded, else a local blob URL)
 *   MW.images.state(key)     → "done" | "pending" | "uploading" | "failed" | "missing"
 *   MW.images.normalize(md)  → Markdown with uploaded img:<key> refs swapped for hosted URLs
 *   MW.images.settingsDialog()
 */
(function () {
  var MW = window.MedWiki;

  var ENDPOINT = "https://api.imgbb.com/1/upload";
  var MAX_SIDE = 1600;
  var GAP = 900; // ms between uploads
  var BATCH = 4; // uploads before a longer rest
  var BATCH_REST = 6000;
  var MAX_TRIES = 8;
  var TIMEOUT = 90000;

  var db = null;
  var records = {}; // key → record
  var blobUrls = {}; // key → object URL of a local blob
  var listeners = [];
  var running = false;
  var timer = null;
  var pauseUntil = 0;
  var channel = null;

  /* ---------- Settings ---------- */

  function settings() {
    return MW.store.get("medwiki:imgbb", {});
  }
  function saveSettings(patch) {
    var s = settings();
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    MW.store.set("medwiki:imgbb", s);
    return s;
  }

  /* ---------- IndexedDB ---------- */

  function openDb() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      try {
        var req = indexedDB.open("medwiki-images", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("images", { keyPath: "id" }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function put(rec) {
    return new Promise(function (resolve) {
      if (!db) return resolve(false);
      try {
        var tx = db.transaction("images", "readwrite");
        tx.objectStore("images").put(rec);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  function remove(id) {
    return new Promise(function (resolve) {
      if (!db) return resolve();
      try {
        var tx = db.transaction("images", "readwrite");
        tx.objectStore("images").delete(id);
        tx.oncomplete = tx.onerror = tx.onabort = function () { resolve(); };
      } catch (e) { resolve(); }
    });
  }

  function loadAll() {
    return new Promise(function (resolve) {
      if (!db) return resolve([]);
      try {
        var req = db.transaction("images").objectStore("images").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  function adopt(list) {
    records = {};
    list.forEach(function (r) {
      records[r.id] = r;
      if (r.blob && !blobUrls[r.id]) blobUrls[r.id] = URL.createObjectURL(r.blob);
    });
  }

  /* Old builds kept images as data URLs in localStorage. Move them into IndexedDB. */
  function migrateLegacy() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("medwiki:img:") === 0) keys.push(k);
      }
    } catch (e) { return Promise.resolve(); }
    return keys.reduce(function (chain, k) {
      return chain.then(function () {
        var id = k.slice("medwiki:img:".length);
        var data = MW.store.get(k, null);
        if (!data || records[id]) { MW.store.remove(k); return null; }
        return dataToBlob(data).then(function (blob) {
          return newRecord(id, blob, "legacy.png", 0, 0);
        }).then(function () { MW.store.remove(k); }, function () {});
      });
    }, Promise.resolve());
  }

  function dataToBlob(data) {
    return fetch(data).then(function (r) { return r.blob(); });
  }

  function blobToData(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function newRecord(id, blob, name, w, h) {
    var rec = { id: id, blob: blob, name: name, size: blob.size, type: blob.type, w: w, h: h, status: "pending", tries: 0, nextAt: 0, created: Date.now() };
    records[id] = rec;
    blobUrls[id] = URL.createObjectURL(blob);
    return put(rec).then(function (stored) {
      if (!stored) rec.memoryOnly = true;
      return rec;
    });
  }

  /* ---------- Events ---------- */

  function emit(remote) {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    if (!remote && channel) { try { channel.postMessage("changed"); } catch (e) {} }
  }

  /* ---------- Preparing a file ---------- */

  function extFor(type) {
    return type === "image/png" ? "png" : type === "image/gif" ? "gif" : type === "image/webp" ? "webp" : "jpg";
  }

  function toBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, q); });
  }

  function prepare(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 25 * 1024 * 1024) return reject(new Error("That image is over 25 MB."));
      if (file.type === "image/gif") return resolve({ blob: file, w: 0, h: 0 });
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        if (scale === 1 && file.size < 700 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) return resolve({ blob: file, w: w, h: h });
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext("2d");
        var png = file.type === "image/png";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        toBlob(canvas, png ? "image/png" : "image/jpeg", 0.86).then(function (blob) {
          if (png && blob && blob.size > 1.5 * 1024 * 1024) {
            /* Big screenshots and photos: JPEG is far smaller (transparency goes white). */
            ctx.globalCompositeOperation = "destination-over";
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return toBlob(canvas, "image/jpeg", 0.86);
          }
          return blob;
        }).then(function (blob) {
          if (!blob) return reject(new Error("Could not process that image."));
          resolve({ blob: blob, w: canvas.width, h: canvas.height });
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
      img.src = url;
    });
  }

  /* ---------- Upload queue ---------- */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pending() {
    return Object.keys(records).map(function (k) { return records[k]; }).filter(function (r) { return r.status === "pending" || r.status === "uploading"; });
  }

  function nextDue() {
    var now = Date.now();
    return pending().filter(function (r) { return r.status === "pending" && (r.nextAt || 0) <= now; })
      .sort(function (a, b) { return a.created - b.created; })[0];
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(run, Math.max(500, ms));
  }

  function canUpload() {
    var s = settings();
    return !!s.key && !s.paused && navigator.onLine !== false;
  }

  function run() {
    clearTimeout(timer);
    if (running || !canUpload() || !pending().length) return;
    var wait = pauseUntil - Date.now();
    if (wait > 0) return schedule(wait);
    if (navigator.locks && navigator.locks.request) {
      /* One tab at a time uploads; others notice the result through the channel. */
      navigator.locks.request("medwiki-imgbb", { ifAvailable: true }, function (lock) {
        if (!lock) return null;
        return loop();
      });
    } else {
      loop();
    }
  }

  function loop() {
    running = true;
    emit();
    var sent = 0;
    function step() {
      if (!canUpload()) return null;
      if (pauseUntil > Date.now()) return null;
      var rec = nextDue();
      if (!rec) return null;
      return upload(rec).then(function (outcome) {
        if (outcome === "stop") return null;
        sent++;
        return sleep(sent % BATCH === 0 ? BATCH_REST : GAP).then(step);
      });
    }
    return Promise.resolve(step()).catch(function () {}).then(function () {
      running = false;
      var later = pending().filter(function (r) { return r.status === "pending"; })
        .map(function (r) { return Math.max(r.nextAt || 0, pauseUntil) - Date.now(); });
      if (later.length && canUpload()) schedule(Math.min.apply(null, later));
      emit();
    });
  }

  function backoff(rec, retryAfterMs, note) {
    rec.tries = (rec.tries || 0) + 1;
    rec.status = "pending";
    rec.error = note;
    var wait = retryAfterMs || Math.min(300000, 5000 * Math.pow(2, rec.tries - 1)) * (0.8 + Math.random() * 0.4);
    rec.nextAt = Date.now() + wait;
    pauseUntil = Math.max(pauseUntil, rec.nextAt);
    if (rec.tries >= MAX_TRIES) return giveUp(rec, note);
    return put(rec);
  }

  function giveUp(rec, note) {
    rec.status = "failed";
    rec.error = note;
    var s = settings();
    if (s.fallbackLocal && MW.server.available && rec.blob) {
      return blobToData(rec.blob).then(function (data) { return MW.api("image", { data: data }); })
        .then(function (r) { return finish(rec, { url: r.path }); }, function () { return put(rec); });
    }
    return put(rec);
  }

  function finish(rec, info) {
    rec.status = "done";
    rec.url = info.url;
    rec.thumb = info.thumb || info.url;
    rec.medium = info.medium || info.url;
    rec.deleteUrl = info.deleteUrl || "";
    rec.error = "";
    rec.tries = 0;
    delete rec.blob; // the hosted copy replaces the local one
    return put(rec).then(function () { return rewritePages(rec.id, rec.url); });
  }

  /* Swap img:<key> for the hosted URL in every page that uses it (and write it out). */
  function rewritePages(key, url) {
    var token = "(img:" + key + ")";
    var ids = MW.pages.filter(function (p) { return p.body.indexOf(token) !== -1; }).map(function (p) { return p.id; });
    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        var p = MW.page(id);
        if (!p) return null;
        MW.savePage(id, {}, p.body.split(token).join("(" + url + ")"), { touch: false });
        return MW.server.available ? MW.persist(id).catch(function () {}) : null;
      });
    }, Promise.resolve());
  }

  function upload(rec) {
    var s = settings();
    rec.status = "uploading";
    emit();
    var fd = new FormData();
    fd.append("image", rec.blob, "medwiki-" + rec.id + "." + extFor(rec.type));
    fd.append("name", "medwiki-" + rec.id);
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(ENDPOINT + "?key=" + encodeURIComponent(s.key), { method: "POST", body: fd, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(t);
        var retryAfter = Number(r.headers.get("Retry-After")) * 1000 || 0;
        return r.json().catch(function () { return null; }).then(function (j) { return { r: r, j: j, retryAfter: retryAfter }; });
      }, function () {
        clearTimeout(t);
        return { network: true };
      })
      .then(function (res) {
        if (res.network) return backoff(rec, 0, "Network error").then(function () { return "stop"; });
        var status = res.r.status;
        var msg = (res.j && res.j.error && res.j.error.message) || res.r.statusText || "Upload failed";
        if (res.r.ok && res.j && res.j.success && res.j.data) {
          var d = res.j.data;
          return finish(rec, {
            url: (d.image && d.image.url) || d.url, thumb: d.thumb && d.thumb.url, medium: d.medium && d.medium.url, deleteUrl: d.delete_url,
          }).then(function () { pauseUntil = 0; saveSettings({ keyError: "" }); return "ok"; });
        }
        if (/api.*key/i.test(msg) || status === 401 || status === 403) {
          rec.status = "pending";
          rec.error = msg;
          saveSettings({ keyError: msg });
          MW.toast && MW.toast("ImgBB rejected the API key. Uploads are paused until you fix it.");
          return put(rec).then(function () { return "stop"; });
        }
        if (status === 429 || status >= 500 || status === 408 || /rate|limit|too many|quota/i.test(msg)) {
          return backoff(rec, res.retryAfter || (status === 429 ? 60000 : 0), msg).then(function () { return "stop"; });
        }
        return giveUp(rec, msg).then(function () { return "ok"; }); // a bad image: retrying will not help
      });
  }

  /* ---------- Public API ---------- */

  var API = {
    ready: null,

    init: function () {
      if (API.ready) return API.ready;
      API.ready = openDb().then(function (d) {
        db = d;
        return loadAll();
      }).then(function (list) {
        adopt(list);
        return migrateLegacy();
      }).then(function () {
        if (window.BroadcastChannel) {
          channel = new BroadcastChannel("medwiki-images");
          channel.onmessage = function () { loadAll().then(function (list) { adopt(list); emit(true); }); };
        }
        window.addEventListener("online", run);
        run();
      });
      return API.ready;
    },

    add: function (file) {
      return prepare(file).then(function (p) {
        var id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        return newRecord(id, p.blob, "image." + extFor(p.blob.type), p.w, p.h).then(function (rec) {
          emit();
          if (rec.memoryOnly) MW.toast("This browser can't keep images offline. Set an ImgBB key so they upload right away.");
          schedule(600);
          return "img:" + id;
        });
      });
    },

    src: function (key) {
      var r = records[key];
      if (r && r.status === "done") return r.url;
      return blobUrls[key] || "";
    },
    thumb: function (key) {
      var r = records[key];
      return r && r.status === "done" ? r.thumb || r.url : blobUrls[key] || "";
    },
    state: function (key) {
      var r = records[key];
      return r ? r.status : "missing";
    },

    normalize: function (body) {
      return body.replace(/\(img:([a-z0-9]+)\)/g, function (m, key) {
        var r = records[key];
        return r && r.status === "done" ? "(" + r.url + ")" : m;
      });
    },

    refs: function (body) {
      return (body.match(/\(img:([a-z0-9]+)\)/g) || []).map(function (m) { return m.slice(5, -1); });
    },

    /* → { key: dataURL } for the keys still held locally (for exports). */
    dataFor: function (keys) {
      var out = {};
      return keys.reduce(function (chain, k) {
        return chain.then(function () {
          var r = records[k];
          if (!r || !r.blob) return null;
          return blobToData(r.blob).then(function (d) { out[k] = d; });
        });
      }, Promise.resolve()).then(function () { return out; });
    },

    /* Restores an image from a backup as a waiting upload. */
    restore: function (key, dataUrl) {
      if (records[key]) return Promise.resolve();
      return dataToBlob(dataUrl).then(function (blob) { return newRecord(key, blob, "restored.png", 0, 0); }).then(function () { emit(); schedule(600); });
    },

    summary: function () {
      var out = { pending: 0, uploading: 0, failed: 0, done: 0 };
      Object.keys(records).forEach(function (k) { out[records[k].status]++; });
      out.waiting = out.pending + out.uploading;
      return out;
    },
    list: function () {
      return Object.keys(records).map(function (k) { return records[k]; }).sort(function (a, b) { return b.created - a.created; });
    },
    on: function (fn) { listeners.push(fn); },
    hasKey: function () { return !!settings().key; },
    kick: function () {
      Object.keys(records).forEach(function (k) {
        var r = records[k];
        if (r.status === "pending") r.nextAt = 0;
      });
      pauseUntil = 0;
      saveSettings({ paused: false });
      run();
      emit();
    },
    retry: function (key) {
      var r = records[key];
      if (!r || !r.blob) return;
      r.status = "pending";
      r.tries = 0;
      r.nextAt = 0;
      r.error = "";
      put(r);
      API.kick();
    },
    discard: function (key) {
      var r = records[key];
      if (!r) return;
      delete records[key];
      remove(key);
      emit();
    },
  };
  API.get = API.src; // older callers
  MW.images = API;

  /* ---------- Settings dialog ---------- */

  var TEST_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  function testKey(key) {
    var fd = new FormData();
    fd.append("image", TEST_PNG);
    fd.append("expiration", "60"); // the test image deletes itself after a minute
    return fetch(ENDPOINT + "?key=" + encodeURIComponent(key), { method: "POST", body: fd }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.ok && j && j.success) return { ok: true };
        return { ok: false, message: (j && j.error && j.error.message) || "ImgBB said no (" + r.status + ")." };
      });
    }, function () { return { ok: false, message: "Could not reach ImgBB. Check your connection." }; });
  }

  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  API.settingsDialog = function () {
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<div class="dialog img-dialog" role="dialog" aria-modal="true" aria-labelledby="img-title">' +
      '<h2 id="img-title">Image hosting</h2>' +
      '<p class="dialog-note">Pasted images are kept on this device first, then uploaded to your free ImgBB account in the background, so writing never waits.</p>' +
      '<ol class="img-steps">' +
      '<li><span class="n">1</span><div><strong>Create a free ImgBB account</strong><span class="img-links">' +
      '<a class="btn" href="https://imgbb.com/signup" target="_blank" rel="noopener">Sign up ' + MW.icon("external-link", 13) + "</a>" +
      '<a class="btn" href="https://imgbb.com/login" target="_blank" rel="noopener">Log in ' + MW.icon("external-link", 13) + "</a></span></div></li>" +
      '<li><span class="n">2</span><div><strong>Get your API key</strong><small>Open the page, press “Get API key”, copy it.</small><span class="img-links">' +
      '<a class="btn" href="https://api.imgbb.com/" target="_blank" rel="noopener">Open API page ' + MW.icon("external-link", 13) + "</a></span></div></li>" +
      '<li><span class="n">3</span><div><strong>Paste it here</strong></div></li></ol>' +
      '<label class="sr-only" for="img-key">ImgBB API key</label><span class="key-row"><input id="img-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your API key">' +
      '<button type="button" class="icon-control" id="img-show" aria-label="Show key" title="Show key">' + MW.icon("eye", 16) + "</button>" +
      '<button type="button" class="btn" id="img-save">Save and test</button></span>' +
      '<p class="img-account" id="img-account" hidden><a href="https://imgbb.com/" target="_blank" rel="noopener">Open my ImgBB account ' + MW.icon("external-link", 13) + "</a> to browse or delete your uploads.</p>" +
      '<p class="key-status" id="img-keystatus" role="status"></p>' +
      '<div class="img-summary" id="img-summary"></div>' +
      '<div class="img-queue" id="img-queue"></div>' +
      '<label class="check" id="img-fallback-row"><input type="checkbox" id="img-fallback"><span>If ImgBB keeps failing, save to the <code>content/images</code> folder instead (needs <code>node serve.js</code>).</span></label>' +
      '<div class="dialog-actions"><button type="button" class="btn" id="img-remove">Remove key</button><span class="grow"></span>' +
      '<button type="button" class="btn" id="img-pause"></button><button type="button" class="btn btn-primary" data-close>Done</button></div></div>';
    document.body.appendChild(wrap);

    var $ = function (id) { return wrap.querySelector("#" + id); };
    var keyInput = $("img-key");
    keyInput.value = settings().key || "";
    $("img-fallback").checked = !!settings().fallbackLocal;
    $("img-fallback-row").hidden = !MW.server.available;

    function paint() {
      var s = settings();
      var sum = API.summary();
      var status = $("img-keystatus");
      if (s.keyError) { status.textContent = "ImgBB rejected this key: " + s.keyError; status.className = "key-status bad"; }
      else if (s.key) { status.textContent = "A key is saved. Uploads run in the background."; status.className = "key-status ok"; }
      else { status.textContent = "No key yet. Images wait on this device until you add one."; status.className = "key-status"; }
      $("img-summary").textContent = sum.waiting + " waiting · " + sum.failed + " failed · " + sum.done + " uploaded";
      $("img-pause").textContent = s.paused ? "Resume uploads" : sum.waiting || sum.failed ? "Upload now" : "Pause uploads";
      $("img-pause").disabled = !s.key;
      $("img-remove").hidden = !s.key;
      $("img-account").hidden = !s.key;
      var rows = API.list().filter(function (r) { return r.status !== "done"; });
      $("img-queue").innerHTML = rows.length ? rows.map(function (r) {
        var label = r.status === "uploading" ? "Uploading…" : r.status === "failed" ? "Failed" : r.nextAt > Date.now() ? "Retrying soon" : s.key ? "Waiting" : "Needs a key";
        return '<div class="img-row" data-id="' + r.id + '"><img src="' + MW.esc(blobUrls[r.id] || "") + '" alt=""><div><strong>' + label + "</strong><small>" +
          kb(r.size) + (r.error ? " · " + MW.esc(r.error) : "") + "</small></div>" +
          (r.status === "failed" ? '<button type="button" class="btn" data-retry>Retry</button>' : "") +
          '<button type="button" class="icon-control" data-discard aria-label="Remove this image from the queue" title="Remove from queue">' + MW.icon("x", 14) + "</button></div>";
      }).join("") : "";
    }
    paint();
    API.on(paint);
    var ta = document.querySelector("#f-body");
    if (ta) ta.dispatchEvent(new Event("blur"));

    $("img-save").addEventListener("click", function () {
      var key = keyInput.value.trim();
      if (!key) return;
      var status = $("img-keystatus");
      status.textContent = "Checking the key…";
      status.className = "key-status";
      testKey(key).then(function (res) {
        if (res.ok) {
          saveSettings({ key: key, keyError: "", paused: false });
          MW.toast("Key works. Uploading your waiting images.");
          API.kick();
        } else {
          status.textContent = res.message;
          status.className = "key-status bad";
        }
        paint();
      });
    });
    $("img-pause").addEventListener("click", function () {
      var s = settings();
      if (s.paused) API.kick();
      else if (API.summary().waiting || API.summary().failed) {
        Object.keys(records).forEach(function (k) { if (records[k].status === "failed" && records[k].blob) API.retry(k); });
        API.kick();
      } else saveSettings({ paused: true });
      paint();
    });
    $("img-remove").addEventListener("click", function () {
      saveSettings({ key: "", keyError: "" });
      keyInput.value = "";
      paint();
    });
    $("img-show").addEventListener("click", function () {
      var show = keyInput.type === "password";
      keyInput.type = show ? "text" : "password";
      this.setAttribute("aria-label", show ? "Hide key" : "Show key");
    });
    keyInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("img-save").click(); } });
    $("img-fallback").addEventListener("change", function (e) { saveSettings({ fallbackLocal: e.target.checked }); });
    $("img-queue").addEventListener("click", function (e) {
      var row = e.target.closest(".img-row");
      if (!row) return;
      if (e.target.closest("[data-retry]")) API.retry(row.getAttribute("data-id"));
      if (e.target.closest("[data-discard]") && confirm("Remove this image? Articles that use it will show a broken image.")) API.discard(row.getAttribute("data-id"));
    });

    function close() {
      var i = listeners.indexOf(paint);
      if (i >= 0) listeners.splice(i, 1);
      wrap.remove();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    wrap.querySelector("[data-close]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    keyInput.focus();
  };

  /* ---------- Top bar indicator ---------- */

  API.mountBadge = function (host) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "img-badge";
    b.hidden = true;
    b.addEventListener("click", API.settingsDialog);
    host.insertBefore(b, host.firstChild);
    function paint() {
      var s = API.summary();
      var n = s.waiting + s.failed;
      b.hidden = !n;
      if (!n) return;
      b.classList.toggle("busy", s.uploading > 0);
      b.classList.toggle("bad", s.failed > 0 || !!settings().keyError);
      b.innerHTML = MW.icon("upload", 15) + "<span>" + n + (n === 1 ? " image" : " images") + (API.hasKey() ? (s.uploading ? " uploading" : " waiting") : " · add key") + "</span>";
      b.title = API.hasKey() ? "Images waiting to upload to ImgBB" : "Images are stored on this device. Add an ImgBB key to upload them.";
    }
    API.on(paint);
    paint();
  };

  /* ---------- Lightbox ---------- */

  document.addEventListener("click", function (e) {
    var img = e.target.closest && e.target.closest(".prose img");
    if (!img || img.closest("a") || e.defaultPrevented || img.closest(".ve-surface")) return;
    var box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Image");
    box.tabIndex = -1;
    var big = document.createElement("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    box.appendChild(big);
    if (img.alt) {
      var cap = document.createElement("p");
      cap.textContent = img.alt;
      box.appendChild(cap);
    }
    function close() { box.classList.remove("in"); setTimeout(function () { box.remove(); }, 160); document.removeEventListener("keydown", onKey, true); }
    function onKey(ev) { if (ev.key === "Escape") { ev.stopPropagation(); close(); } }
    box.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add("in"); });
    box.focus();
  });
})();
