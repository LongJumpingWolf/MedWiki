/*
 * Core: helpers, local storage, subject structure, the page catalogue
 * (built-in files + local edits), wikilink resolution, backlinks, images,
 * bookmarks, recents, theme and revision mode.
 */
window.MedWiki = window.MedWiki || {};

(function () {
  var MW = window.MedWiki;

  /* ---------- Helpers ---------- */

  MW._files = {};
  MW.define = function (id, src) {
    MW._files[id] = src;
  };

  MW.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  MW.unesc = function (s) {
    return String(s).replace(/&(amp|lt|gt|quot|#39);/g, function (_, k) {
      return { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[k];
    });
  };

  /* Lowercase, strip accents, unify dashes. Used for matching and slugs. */
  MW.norm = function (s) {
    return String(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[‐-―−]/g, "-");
  };

  MW.slug = function (s) {
    return MW.norm(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "page";
  };

  MW.pageUrl = function (id, hash) {
    return "article.html?a=" + encodeURIComponent(id) + (hash ? "#" + hash : "");
  };

  MW.today = function () {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };

  MW.fmtDate = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return Number(m[3]) + " " + months[Number(m[2]) - 1] + " " + m[1];
  };

  /* localStorage with an in-memory fallback (private mode, blocked storage). */
  var memory = {};
  MW.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return key in memory ? memory[key] : fallback;
      }
    },
    set: function (key, value) {
      memory[key] = value;
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove: function (key) {
      delete memory[key];
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    },
  };

  /* ---------- Structure: subjects and chapters ---------- */

  /* Chapters from content/_chapters.js (saved by serve.js) plus any kept in this browser. */
  function extraChapters() {
    var merged = {};
    [MW.extraChapters || {}, MW.store.get("medwiki:chapters", {})].forEach(function (src) {
      Object.keys(src).forEach(function (sid) {
        merged[sid] = merged[sid] || [];
        src[sid].forEach(function (c) {
          if (!merged[sid].some(function (h) { return h.id === c.id; })) merged[sid].push(c);
        });
      });
    });
    return merged;
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* localhost, 127.0.0.1 (Live Server) or a file: page. The public site hides empty preset subjects and chapters. */
  MW.isLocal = location.protocol === "file:" || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);

  /* Once you add, rename or delete a subject or chapter, the whole tree lives in content/_structure.js
     (or in this browser until the server writes it) and replaces the defaults in data.js. */
  MW.structureOverride = function () {
    var local = MW.store.get("medwiki:structure", null);
    return Array.isArray(local) ? local : Array.isArray(MW.structure) ? MW.structure : null;
  };

  MW.subjects = function () {
    var over = MW.structureOverride();
    if (over) return clone(over);
    var extra = extraChapters();
    return (MW.subjectData || []).map(function (s) {
      return { id: s.id, title: s.title, chapters: s.chapters.concat(extra[s.id] || []) };
    });
  };

  MW.subject = function (id) {
    return MW.subjects().filter(function (s) { return s.id === id; })[0] || null;
  };

  MW.chapter = function (subjectId, chapterId) {
    var s = MW.subject(subjectId);
    return (s && s.chapters.filter(function (c) { return c.id === chapterId; })[0]) || null;
  };

  function uniqueId(taken, title) {
    var base = MW.slug(title);
    var id = base;
    var n = 2;
    while (taken.indexOf(id) !== -1) id = base + "-" + n++;
    return id;
  }

  MW.addChapter = function (subjectId, title) {
    var extra = MW.store.get("medwiki:chapters", {});
    var s = MW.subject(subjectId);
    var id = uniqueId(s.chapters.map(function (c) { return c.id; }), title);
    if (MW.structureOverride()) {
      var st = MW.subjects();
      st.filter(function (x) { return x.id === subjectId; })[0].chapters.push({ id: id, title: title });
      MW.store.set("medwiki:structure", st);
      return id;
    }
    (extra[subjectId] = extra[subjectId] || []).push({ id: id, title: title });
    MW.store.set("medwiki:chapters", extra);
    return id;
  };

  /* ---------- Page source format (front matter + Markdown body) ---------- */

  var FIELDS = ["title", "subject", "chapter", "kind", "aliases", "tags", "importance", "status", "finished", "edited", "summary"];

  function csv(s) {
    return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }

  MW.parseSource = function (src) {
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
    var meta = {};
    if (!m) return { meta: meta, body: src };
    m[1].split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return { meta: meta, body: m[2].replace(/^\s*\n/, "") };
  };

  MW.buildSource = function (f, body) {
    var lines = FIELDS.map(function (k) {
      var v = f[k];
      if (Array.isArray(v)) v = v.join(", ");
      return v ? k + ": " + v : null;
    }).filter(Boolean);
    return "---\n" + lines.join("\n") + "\n---\n" + body.replace(/\s+$/, "") + "\n";
  };

  function makePage(id, src, origin, overridden) {
    var p = MW.parseSource(src);
    var m = p.meta;
    return {
      id: id,
      title: m.title || id,
      subject: m.subject || "",
      chapter: m.chapter || "",
      kind: m.kind || "",
      aliases: csv(m.aliases),
      tags: csv(m.tags),
      importance: m.importance || "medium",
      status: m.status || "draft",
      finished: m.finished || "",
      edited: m.edited || "",
      summary: m.summary || "",
      body: p.body,
      origin: origin,
      overridden: !!overridden,
    };
  }

  /* ---------- Catalogue ---------- */

  var listeners = [];
  var byKey = {};
  var backlinks = {};
  MW.pages = [];

  MW.onChange = function (fn) {
    listeners.push(fn);
  };

  /* [[Target]], [[Target#Heading]], [[Target|label]]; in tables the pipe is written \| */
  var WIKILINK = /\[\[([^\]|#\n\\]+?)(?:#[^\]|\n\\]+?)?(?:\\?\|[^\]\n]+?)?\]\]/g;

  MW.rebuild = function () {
    var local = MW.store.get("medwiki:pages", {});
    var pages = [];
    var seen = {};
    var fileIds = (MW.manifest || []).filter(function (id) { return id in MW._files; });
    Object.keys(MW._files).forEach(function (id) {
      if (fileIds.indexOf(id) === -1) fileIds.push(id);
    });
    fileIds.forEach(function (id) {
      var over = id in local;
      pages.push(makePage(id, over ? local[id] : MW._files[id], over ? "local" : "file", over));
      seen[id] = true;
    });
    Object.keys(local).forEach(function (id) {
      if (!seen[id]) pages.push(makePage(id, local[id], "local", false));
    });
    MW.pages = pages;

    byKey = {};
    pages.forEach(function (p) {
      [p.title].concat(p.aliases).forEach(function (t) {
        var k = MW.norm(t).trim();
        if (k && !(k in byKey)) byKey[k] = p;
      });
    });

    backlinks = {};
    pages.forEach(function (p) {
      var m;
      WIKILINK.lastIndex = 0;
      while ((m = WIKILINK.exec(p.body))) {
        var target = MW.resolve(m[1]);
        if (target && target.id !== p.id) {
          (backlinks[target.id] = backlinks[target.id] || {})[p.id] = true;
        }
      }
    });

    listeners.forEach(function (fn) { fn(); });
  };

  MW.page = function (id) {
    return MW.pages.filter(function (p) { return p.id === id; })[0] || null;
  };

  /* Resolve a wikilink target (title or alias, case/accent/dash-insensitive). */
  MW.resolve = function (text) {
    return byKey[MW.norm(text).trim()] || null;
  };

  MW.backlinks = function (id) {
    return Object.keys(backlinks[id] || {}).map(MW.page).filter(Boolean);
  };

  MW.allTags = function () {
    var counts = {};
    MW.pages.forEach(function (p) {
      p.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.keys(counts).sort().map(function (t) { return { tag: t, count: counts[t] }; });
  };

  /* ---------- Local server (node serve.js): saves straight into content/ ---------- */

  MW.server = { available: false };

  MW.api = function (endpoint, body) {
    return fetch("api/" + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || "Server error");
        return j;
      });
    });
  };

  /* Resolves quickly either way; sets MW.server.available. */
  MW.detectServer = function () {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve(false);
    return fetch("api/ping")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { MW.server.available = !!(j && j.ok); return MW.server.available; })
      .catch(function () { return false; });
  };

  /* ---------- Saving, creating, exporting ---------- */

  function fieldsOf(p) {
    return {
      title: p.title, subject: p.subject, chapter: p.chapter, kind: p.kind, aliases: p.aliases,
      tags: p.tags, importance: p.importance, status: p.status, finished: p.finished, edited: p.edited, summary: p.summary,
    };
  }

  function defineText(id, src) {
    return 'MedWiki.define("' + id + '", `' + src.replace(/[`\\]|\$\{/g, "\\$&") + "`);\n";
  }

  /* Writes a page to content/<id>.js through the server. */
  MW.persist = function (id) {
    var p = MW.page(id);
    var src = MW.buildSource(fieldsOf(p), p.body);
    return MW.api("save", { id: id, source: defineText(id, src) }).then(function () {
      MW._files[id] = src;
      var local = MW.store.get("medwiki:pages", {});
      delete local[id];
      MW.store.set("medwiki:pages", local);
      MW.rebuild();
    });
  };

  /* Local write only. changes: partial front-matter fields. opts.touch === false keeps the edited date. */
  MW.savePage = function (id, changes, body, opts) {
    var p = MW.page(id);
    var f = fieldsOf(p);
    Object.keys(changes || {}).forEach(function (k) { f[k] = changes[k]; });
    if (!opts || opts.touch !== false) f.edited = MW.today();
    var local = MW.store.get("medwiki:pages", {});
    var text = body == null ? p.body : body;
    local[id] = MW.buildSource(f, MW.images ? MW.images.normalize(text) : text);
    var ok = MW.store.set("medwiki:pages", local);
    MW.rebuild();
    return ok;
  };

  /*
   * Save a page the best available way. Resolves to "file" (written to content/),
   * "browser" (kept in this browser only) or "failed".
   */
  MW.commit = function (id, changes, body, opts) {
    if (!MW.savePage(id, changes, body, opts)) return Promise.resolve("failed");
    if (!MW.server.available) return Promise.resolve("browser");
    return MW.persist(id).then(function () { return "file"; }, function () { return "browser"; });
  };

  /* An article stays "in progress" until it is marked finished (front matter: finished: <date>). */
  MW.inProgress = function () {
    return MW.pages.filter(function (p) { return !p.finished; });
  };

  MW.setFinished = function (id, done) {
    return MW.commit(id, { finished: done ? MW.today() : "" }, null, { touch: false });
  };

  /* Resolves to the new page id. */
  MW.createPage = function (f) {
    var id = MW.slug(f.title);
    var n = 2;
    while (MW.page(id)) id = MW.slug(f.title) + "-" + n++;
    var local = MW.store.get("medwiki:pages", {});
    local[id] = MW.buildSource(
      { title: f.title, subject: f.subject, chapter: f.chapter, importance: "medium", status: "draft", edited: MW.today() },
      "## Overview\n\n"
    );
    MW.store.set("medwiki:pages", local);
    MW.rebuild();
    if (!MW.server.available) return Promise.resolve(id);
    return MW.persist(id).then(function () { return id; }, function () { return id; });
  };

  /* Chapters created in the editor live in this browser until the server writes them out. */
  MW.persistStructure = function () {
    var st = MW.structureOverride();
    if (!st || !MW.server.available) return Promise.resolve(false);
    return MW.api("structure", { structure: st }).then(function () {
      MW.structure = st;
      MW.store.remove("medwiki:structure");
      return true;
    }, function () { return false; });
  };

  MW.saveStructure = function (st) {
    MW.store.set("medwiki:structure", st);
    return MW.persistStructure().then(function (written) { MW.rebuild(); return written; });
  };

  /* Add, rename and delete subjects and chapters. Articles in a deleted chapter or subject are moved or deleted. */
  MW.struct = {
    pagesIn: function (sid, cid) {
      return MW.pages.filter(function (p) { return p.subject === sid && (!cid || p.chapter === cid); });
    },
    addSubject: function (title) {
      var st = MW.subjects();
      var id = uniqueId(st.map(function (s) { return s.id; }), title);
      st.push({ id: id, title: title, chapters: [] });
      return MW.saveStructure(st).then(function () { return id; });
    },
    addChapter: function (sid, title) {
      var st = MW.subjects();
      var s = st.filter(function (x) { return x.id === sid; })[0];
      var id = uniqueId(s.chapters.map(function (c) { return c.id; }), title);
      s.chapters.push({ id: id, title: title });
      return MW.saveStructure(st).then(function () { return id; });
    },
    rename: function (sid, cid, title) {
      var st = MW.subjects();
      var s = st.filter(function (x) { return x.id === sid; })[0];
      if (!cid) s.title = title;
      else s.chapters.filter(function (c) { return c.id === cid; })[0].title = title;
      return MW.saveStructure(st);
    },
    /* opts: { move: {subject, chapter} } moves the articles first; { deletePages: true } deletes them. */
    remove: function (sid, cid, opts) {
      var affected = MW.struct.pagesIn(sid, cid);
      var chain = Promise.resolve();
      affected.forEach(function (p) {
        chain = chain.then(function () {
          if (opts.move) return MW.commit(p.id, { subject: opts.move.subject, chapter: opts.move.chapter }, null, { touch: false });
          MW.store.remove("medwiki:draft:" + p.id);
          if (MW.bookmarks.list().indexOf(p.id) !== -1) MW.bookmarks.toggle(p.id);
          return p.origin === "file" || p.overridden ? MW.deleteFile(p.id) : MW.discardLocal(p.id);
        });
      });
      return chain.then(function () {
        var st = MW.subjects();
        if (!cid) st = st.filter(function (s) { return s.id !== sid; });
        else st.filter(function (s) { return s.id === sid; })[0].chapters = st.filter(function (s) { return s.id === sid; })[0].chapters.filter(function (c) { return c.id !== cid; });
        return MW.saveStructure(st);
      });
    },
  };

  MW.persistChapters = function () {
    if (MW.structureOverride()) return MW.persistStructure();
    if (!MW.server.available) return Promise.resolve(false);
    return MW.api("chapters", { extra: extraChapters() }).then(function () {
      MW.extraChapters = extraChapters();
      MW.store.remove("medwiki:chapters");
      return true;
    }, function () { return false; });
  };

  /* Removes the local copy. A built-in article reverts; a local-only page is deleted. */
  MW.discardLocal = function (id) {
    var local = MW.store.get("medwiki:pages", {});
    delete local[id];
    MW.store.set("medwiki:pages", local);
    MW.rebuild();
  };

  /* Deletes content/<id>.js (server only). */
  MW.deleteFile = function (id) {
    return MW.api("delete", { id: id }).then(function () {
      delete MW._files[id];
      MW.manifest = (MW.manifest || []).filter(function (x) { return x !== id; });
      MW.discardLocal(id);
    });
  };

  MW.localEditCount = function () {
    return Object.keys(MW.store.get("medwiki:pages", {})).length;
  };

  /* Writes every locally kept page to content/ (server only). Resolves to the number written. */
  MW.syncLocal = function () {
    var ids = Object.keys(MW.store.get("medwiki:pages", {}));
    var done = 0;
    return MW.persistChapters().then(function () {
      return ids.reduce(function (chain, id) {
        return chain.then(function () { return MW.persist(id).then(function () { done++; }, function () {}); });
      }, Promise.resolve());
    }).then(function () { return done; });
  };

  /* Promise of the source for a downloadable content/<id>.js file; images still held locally are inlined as data URLs. */
  MW.exportSource = function (id) {
    var p = MW.page(id);
    var body = MW.images.normalize(p.body);
    return MW.images.dataFor(MW.images.refs(body)).then(function (data) {
      body = body.replace(/\(img:([a-z0-9]+)\)/g, function (m, key) { return data[key] ? "(" + data[key] + ")" : m; });
      return defineText(id, MW.buildSource(fieldsOf(p), body));
    });
  };

  /* ---------- Previous-year questions, gathered from ::: pyq blocks ---------- */

  /* → [{ page, type, years, html, heading }] */
  MW.pyqs = function () {
    var out = [];
    MW.pages.forEach(function (p) {
      var heads = MW.md.headings(p.body);
      var lines = p.body.split("\n");
      var hi = -1;
      var fence = false;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (/^```/.test(l)) fence = !fence;
        if (fence) continue;
        if (/^#{1,3}\s/.test(l)) hi++;
        var m = /^:::\s*pyq\b\s*(.*)$/i.exec(l);
        if (!m) continue;
        var depth = 1;
        var inner = [];
        for (i = i + 1; i < lines.length; i++) {
          if (/^:::\s*$/.test(lines[i])) { if (--depth === 0) break; }
          else if (/^:::\s*[a-z]/i.test(lines[i])) depth++;
          inner.push(lines[i]);
        }
        var parts = m[1].split(/\s*[·|]\s*/);
        var head = /^[A-Za-z]{2,6}$/.test(parts[0] || "") ? parts[0].toUpperCase() : "";
        out.push({
          page: p,
          type: head,
          years: (head ? parts.slice(1) : parts).join(", ").trim(),
          html: MW.md.render(inner.join("\n")).html,
          heading: hi >= 0 ? heads[hi] || null : null,
        });
      }
    });
    return out;
  };

  /* ---------- Bookmarks and recents ---------- */

  MW.bookmarks = {
    list: function () { return MW.store.get("medwiki:bookmarks", []); },
    has: function (id) { return this.list().indexOf(id) !== -1; },
    toggle: function (id) {
      var list = this.list();
      var i = list.indexOf(id);
      if (i === -1) list.push(id);
      else list.splice(i, 1);
      MW.store.set("medwiki:bookmarks", list);
      return i === -1;
    },
  };

  MW.recents = {
    list: function () { return MW.store.get("medwiki:recents", []); },
    push: function (id) {
      var list = this.list().filter(function (x) { return x !== id; });
      list.unshift(id);
      MW.store.set("medwiki:recents", list.slice(0, 8));
    },
  };

  /* ---------- Study block types (::: type … :::) ---------- */
  /* User-owned: add, rename, recolour or delete freely. A block whose type has
     since been deleted still renders fine, just with a plain label and no tint. */

  var DEFAULT_BLOCK_TYPES = [
    { key: "summary", label: "In 30 seconds", color: "#3357c8" },
    { key: "definition", label: "Definition", color: "#3357c8" },
    { key: "classification", label: "Classification", color: "#8a8f98" },
    { key: "mechanism", label: "Mechanism", color: "#8a8f98" },
    { key: "morphology", label: "Morphology", color: "#8a8f98" },
    { key: "clinical", label: "Clinical features", color: "#8a8f98" },
    { key: "diagnosis", label: "Diagnosis", color: "#8a8f98" },
    { key: "treatment", label: "Treatment", color: "#1f8f5f" },
    { key: "pyq", label: "PYQ", color: "#3357c8" },
    { key: "pearl", label: "Exam pearl", color: "#1f8f5f" },
    { key: "mistake", label: "Common mistake", color: "#c23a3a" },
    { key: "note", label: "Note", color: "#8a8f98" },
  ];

  MW.blockTypes = {
    list: function () {
      return MW.store.get("medwiki:blocktypes", DEFAULT_BLOCK_TYPES);
    },
    get: function (key) {
      return this.list().filter(function (t) { return t.key === key; })[0] || null;
    },
    add: function (label, color) {
      var list = this.list();
      var base = MW.slug(label) || "block";
      var key = base;
      var n = 2;
      while (list.some(function (t) { return t.key === key; })) key = base + "-" + n++;
      list.push({ key: key, label: label, color: color });
      MW.store.set("medwiki:blocktypes", list);
      return key;
    },
    update: function (key, changes) {
      var list = this.list();
      var t = list.filter(function (t) { return t.key === key; })[0];
      if (!t) return;
      if (changes.label != null) t.label = changes.label;
      if (changes.color != null) t.color = changes.color;
      MW.store.set("medwiki:blocktypes", list);
    },
    remove: function (key) {
      MW.store.set("medwiki:blocktypes", this.list().filter(function (t) { return t.key !== key; }));
    },
    reset: function () {
      MW.store.remove("medwiki:blocktypes");
    },
  };

  /* ---------- Theme and revision mode ---------- */

  var root = document.documentElement;

  MW.isDark = function () {
    return root.getAttribute("data-theme") === "dark";
  };

  MW.toggleTheme = function () {
    var dark = !MW.isDark();
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    MW.store.set("medwiki:theme", dark ? "dark" : "light");
    listeners.forEach(function (fn) { fn("theme"); });
  };

  MW.isRevision = function () {
    return root.getAttribute("data-mode") === "revision";
  };

  /* While editing, revision/recall must not hide or blank the text being written. */
  MW.suspendStudyModes = function (suspend) {
    MW.editing = !!suspend;
    if (suspend) {
      root.setAttribute("data-editing", "1");
      root.removeAttribute("data-mode");
      root.removeAttribute("data-recall");
    } else {
      root.removeAttribute("data-editing");
      if (MW.store.get("medwiki:revision", false)) root.setAttribute("data-mode", "revision");
      if (MW.store.get("medwiki:recall", false)) root.setAttribute("data-recall", "on");
    }
    listeners.forEach(function (fn) { fn("revision"); });
  };

  MW.toggleRevision = function () {
    if (MW.editing) return;
    var on = !MW.isRevision();
    if (on) root.setAttribute("data-mode", "revision");
    else root.removeAttribute("data-mode");
    MW.store.set("medwiki:revision", on);
    listeners.forEach(function (fn) { fn("revision"); });
  };

  /* Recall: in revision mode, blank out ==highlights== until clicked. */
  MW.isRecall = function () {
    return root.getAttribute("data-recall") === "on";
  };

  MW.toggleRecall = function () {
    if (MW.editing) return;
    var on = !MW.isRecall();
    if (on) root.setAttribute("data-recall", "on");
    else root.removeAttribute("data-recall");
    MW.store.set("medwiki:recall", on);
    listeners.forEach(function (fn) { fn("recall"); });
  };
  /* MW.rebuild() is called by chrome.js once article files have loaded. */
})();
