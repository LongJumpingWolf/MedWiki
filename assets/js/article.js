/*
 * Article page: reads ?a=<id>, renders the Markdown, builds the info strip,
 * table of contents, backlinks and prev/next, and switches the article into
 * edit mode in place (title, metadata and body become editable).
 */
(function () {
  var MW = window.MedWiki;
  var params = new URLSearchParams(location.search);
  var id = params.get("a");
  var root, ctx, fab, dock;
  var mode = "read";
  var dirty = false;
  var previewing = false;
  var spy = null;
  var saving = false;

  var STATUS = {
    draft: "Draft",
    review: "To revise",
    revised: "Revised",
  };
  var STATUS_ORDER = ["draft", "review", "revised"];
  var IMPORTANCE = { high: "High yield", medium: "Medium yield", low: "Low yield" };

  function csv(s) {
    return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* ---------- Read mode ---------- */

  function infoStrip(page, r) {
    var level = { high: 3, medium: 2, low: 1 }[page.importance] || 2;
    var dots = "";
    for (var i = 1; i <= 3; i++) dots += '<i class="' + (i <= level ? "on" : "") + '"></i>';
    var mins = Math.max(1, Math.round(r.words / 200));
    var status = STATUS[page.status] ? page.status : "draft";
    var tagsLi = page.tags.length
      ? '<li class="tags">' + page.tags.map(function (t) {
        return '<a href="index.html?tag=' + encodeURIComponent(t) + '">#' + MW.esc(t) + "</a>";
      }).join(" ") + "</li>"
      : "";
    return (
      '<ul class="info-strip" aria-label="Article information">' +
      '<li class="imp" title="Importance"><span class="dots" aria-hidden="true">' + dots + "</span>" + IMPORTANCE[page.importance] + "</li>" +
      (r.pyq ? "<li>PYQ ×" + r.pyq + "</li>" : "") +
      "<li>" + mins + " min read</li>" +
      (page.edited ? "<li>Edited " + MW.fmtDate(page.edited) + "</li>" : "") +
      '<li><button type="button" class="status status-' + status + '" data-status title="Click to change revision status"><i></i>' + STATUS[status] + "</button></li>" + tagsLi + "</ul>"
    );
  }

  function crumbs(page) {
    var s = MW.subject(page.subject);
    var c = MW.chapter(page.subject, page.chapter);
    return (
      '<nav class="breadcrumbs" aria-label="Breadcrumb">' +
      (s ? '<a href="index.html#' + s.id + '">' + MW.esc(s.title) + "</a>" : "") +
      (c ? MW.icon("chevron-right") + '<a href="index.html#' + s.id + "-" + c.id + '">' + MW.esc(c.title) + "</a>" : "") +
      "</nav>"
    );
  }

  function topicNav(page) {
    var sibs = MW.pages.filter(function (p) { return p.subject === page.subject && p.chapter === page.chapter; });
    var i = sibs.findIndex(function (p) { return p.id === page.id; });
    var prev = sibs[i - 1];
    var next = sibs[i + 1];
    if (!prev && !next) return "";
    function cell(p, cls, label, text) {
      return p ? '<a class="' + cls + '" href="' + MW.pageUrl(p.id) + '"><small>' + label + "</small><strong>" + text + "</strong></a>" : "";
    }
    return '<nav class="topic-nav" aria-label="Topic navigation">' +
      cell(prev, "prev", "Previous", "← " + MW.esc(prev ? prev.title : "")) +
      cell(next, "next", "Next", MW.esc(next ? next.title : "") + " →") + "</nav>";
  }

  function renderRead() {
    if (root._editor) { root._editor.destroy(); root._editor = null; }
    if (root._visual) { root._visual.destroy(); root._visual = null; }
    if (MW.editing) MW.suspendStudyModes(false);
    mode = "read";
    dirty = false;
    previewing = false;
    var page = MW.page(id);
    var r = MW.md.render(page.body);
    var back = MW.backlinks(id);
    var y = window.scrollY;

    root.innerHTML =
      crumbs(page) +
      '<header class="article-head">' +
      (page.kind ? '<p class="article-kicker">' + MW.esc(page.kind) + "</p>" : "") +
      '<div class="title-row"><h1>' + MW.esc(page.title) + "</h1>" +
      '<span class="head-actions"><a class="bookmark-control" href="print.html?a=' + encodeURIComponent(page.id) + '" title="Print or save as PDF (P)">' + MW.icon("printer") + "<span>Print</span></a>" +
      '<button class="bookmark-control" type="button" data-bookmark aria-pressed="false">' + MW.icon("bookmark") + "<span>Save</span></button></span></div>" +
      (page.aliases.length ? '<p class="aliases">Also known as ' + page.aliases.slice(0, 4).map(MW.esc).join(", ") + (page.aliases.length > 4 ? "…" : "") + "</p>" : "") +
      infoStrip(page, r) +
      "</header>" +
      '<div class="revision-banner"><span>Revision mode: plain paragraphs are hidden so only the key facts show.</span>' +
      '<button type="button" class="banner-btn" data-show-all>Show everything</button>' +
      '<button type="button" class="recall-toggle" data-recall aria-pressed="' + MW.isRecall() + '">' + (MW.isRecall() ? "Recall on: click a highlight to reveal" : "Test myself") + "</button></div>" +
      (page.body.trim()
        ? '<div class="prose">' + r.html + "</div>"
        : '<p class="empty-page">This page is empty. Press <kbd>E</kbd> to start writing.</p>') +
      (back.length
        ? '<p class="backlinks"><span>Referenced by</span> ' + back.map(function (p) {
          return '<a href="' + MW.pageUrl(p.id) + '">' + MW.esc(p.title) + "</a>";
        }).join(", ") + "</p>"
        : "") +
      topicNav(page);

    var showAll = root.querySelector("[data-show-all]");
    if (showAll) showAll.addEventListener("click", function () { MW.toggleRevision(); });
    var prose = root.querySelector(".prose");
    if (MW.isRevision() && prose && page.body.trim() && [].every.call(prose.children, function (c) { return getComputedStyle(c).display === "none"; })) {
      var note = document.createElement("p");
      note.className = "empty-page";
      note.textContent = "Nothing to show in revision mode: this page has only plain paragraphs. Use “Show everything” above to read it.";
      prose.after(note);
    }

    renderContext(r, page);
    paintBookmark(page);
    setChrome();
    window.scrollTo({ top: y, behavior: "instant" });
  }

  function renderContext(r, page) {
    var html = "";
    var heads = r.headings;
    if (heads.length) {
      html += '<nav class="toc" aria-label="On this page"><p>On this page</p><ul>' + heads.map(function (h) {
        return '<li class="lvl-' + h.level + '"><a href="#' + h.id + '">' + MW.esc(h.text) + "</a></li>";
      }).join("") + "</ul></nav>";
    }
    html += '<p class="rail-hint"><kbd>E</kbd> edit · <kbd>R</kbd> revision<br><kbd>Ctrl</kbd> <kbd>K</kbd> search &amp; commands</p>';
    ctx.innerHTML = html;
    startSpy();
  }

  function startSpy() {
    var links = [].slice.call(ctx.querySelectorAll(".toc a"));
    var heads = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    if (spy) window.removeEventListener("scroll", spy);
    if (!links.length) return;
    var ticking = false;
    function update() {
      var active = 0;
      heads.forEach(function (h, i) { if (h && h.getBoundingClientRect().top <= 140) active = i; });
      links.forEach(function (a, i) {
        a.classList.toggle("active", i === active);
        if (i === active) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
      ticking = false;
    }
    spy = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", spy, { passive: true });
    update();
  }

  function paintBookmark(page) {
    var btn = root.querySelector("[data-bookmark]");
    if (!btn) return;
    var saved = MW.bookmarks.has(page.id);
    btn.classList.toggle("saved", saved);
    btn.setAttribute("aria-pressed", String(saved));
    btn.querySelector("span").textContent = saved ? "Saved" : "Save";
  }

  /* ---------- Floating controls ---------- */

  function setChrome() {
    var editing = mode === "edit";
    fab.hidden = editing;
    dock.hidden = !editing;
    if (editing) {
      dock.querySelector("[data-preview] span").textContent = previewing ? "Edit" : "Preview";
      dock.querySelector("[data-preview] svg").outerHTML = MW.icon(previewing ? "pencil" : "eye", 16);
    }
  }

  function setDockState(text) {
    var el = dock && dock.querySelector("[data-state]");
    if (el) el.textContent = text;
  }

  function buildControls() {
    fab = document.createElement("button");
    fab.className = "fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Edit this article");
    fab.title = "Edit (E)";
    fab.innerHTML = MW.icon("pencil") + "<span>Edit</span>";
    fab.addEventListener("click", enterEdit);

    dock = document.createElement("div");
    dock.className = "edit-dock";
    dock.hidden = true;
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", "Editing");
    dock.innerHTML =
      '<span class="dock-state" data-state role="status"></span>' +
      '<button type="button" class="btn" data-cancel>Cancel</button>' +
      '<button type="button" class="btn" data-preview>' + MW.icon("eye", 16) + "<span>Preview</span></button>" +
      '<button type="button" class="btn btn-primary" data-save>' + MW.icon("check", 16) + "<span>Save</span></button>";
    dock.querySelector("[data-cancel]").addEventListener("click", cancelEdit);
    dock.querySelector("[data-preview]").addEventListener("click", togglePreview);
    dock.querySelector("[data-save]").addEventListener("click", save);
    document.body.appendChild(fab);
    document.body.appendChild(dock);
  }

  /* ---------- Edit mode ---------- */

  function option(value, label, selected) {
    return '<option value="' + value + '"' + (selected ? " selected" : "") + ">" + MW.esc(label) + "</option>";
  }

  function draftKey() { return "medwiki:draft:" + id; }

  function enterEdit() {
    var page = MW.page(id);
    if (!page || mode === "edit") return;
    mode = "edit";
    previewing = false;
    MW.suspendStudyModes(true);
    var draft = MW.store.get(draftKey(), null);
    var d = draft || {
      title: page.title, subject: page.subject, chapter: page.chapter, importance: page.importance,
      status: page.status, aliases: page.aliases.join(", "), tags: page.tags.join(", "), body: page.body,
    };
    if (draft) MW.toast("Restored your unsaved draft.");

    root.innerHTML =
      crumbs(page) +
      '<header class="article-head editing">' +
      '<input class="title-input" id="f-title" aria-label="Title" placeholder="Title" autocomplete="off" value="' + MW.esc(d.title) + '">' +
      '<details class="meta-details"><summary>Page details <small>subject, chapter, importance, status, aliases, tags</small></summary><div class="meta-form">' +
      '<label>Subject<select id="f-subject">' + MW.subjects().map(function (s) { return option(s.id, s.title, s.id === d.subject); }).join("") + "</select></label>" +
      '<label>Chapter<select id="f-chapter"></select></label>' +
      '<label>Importance<select id="f-importance">' + Object.keys(IMPORTANCE).map(function (k) { return option(k, IMPORTANCE[k], k === d.importance); }).join("") + "</select></label>" +
      '<label>Status<select id="f-status">' + STATUS_ORDER.map(function (k) { return option(k, STATUS[k], k === d.status); }).join("") + "</select></label>" +
      '<label class="wide">Aliases and abbreviations<input id="f-aliases" placeholder="e.g. RPGN, crescentic GN" autocomplete="off" value="' + MW.esc(d.aliases) + '"></label>' +
      '<label class="wide">Tags<input id="f-tags" placeholder="e.g. drug, PYQ, must-revise" autocomplete="off" value="' + MW.esc(d.tags) + '"></label>' +
      "</div></details></header>" +
      '<div class="editor-wrap">' +
      '<div class="ve-modebar"><div class="ve-mode" role="group" aria-label="Editing mode">' +
      '<button type="button" data-mode="visual" aria-pressed="true">Visual</button><button type="button" data-mode="source" aria-pressed="false">Source</button></div>' +
      '<small>Write it as it will read. Switch to Source to edit the Markdown.</small></div>' +
      '<div class="pane-visual"><div class="prose ve-surface" id="f-visual"></div></div>' +
      '<div class="pane-source" hidden><div class="editor-stack"><div class="editor-backdrop" aria-hidden="true"></div><textarea class="editor" id="f-body" spellcheck="true" aria-label="Article body (Markdown)" placeholder="Start writing. Use the toolbar above, or type / on a new line for blocks."></textarea></div></div>' +
      '<div class="prose preview" id="f-preview" hidden></div></div>' +
      '<p class="editor-hint"><kbd>~</kbd> or <kbd>/</kbd> for tables, images, quotes and study blocks (try <kbd>~image</kbd>) · <kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>[[</kbd> to link a page · <kbd>Tab</kbd> in a table for the next cell · paste or drop images (they upload to ImgBB in the background).<br>' +
      (MW.server.available
        ? "Saving writes to <code>content/" + MW.esc(id) + ".js</code>."
        : "Saved in this browser only. Run <code>node serve.js</code> to save straight into your <code>content/</code> folder.") + "</p>";

    var f = {
      title: root.querySelector("#f-title"), subject: root.querySelector("#f-subject"), chapter: root.querySelector("#f-chapter"),
      importance: root.querySelector("#f-importance"), status: root.querySelector("#f-status"),
      aliases: root.querySelector("#f-aliases"), tags: root.querySelector("#f-tags"), body: root.querySelector("#f-body"),
    };
    f.body.value = d.body;

    function fillChapters(selected) {
      var s = MW.subject(f.subject.value);
      f.chapter.innerHTML = s.chapters.map(function (c) { return option(c.id, c.title, c.id === selected); }).join("");
    }
    fillChapters(d.chapter);
    f.subject.addEventListener("change", function () { fillChapters(); });

    var editor = MW.editor.attach(f.body);
    root._fields = f;
    root._editor = editor;

    var editMode = MW.store.get("medwiki:editorMode", "visual") === "source" ? "source" : "visual";
    var vdirty = false;
    var ve = MW.visual.attach(root.querySelector("#f-visual"), {
      onChange: function () { vdirty = true; touched(); },
    });
    root._visual = ve;

    function paneState() {
      root.querySelector(".pane-visual").hidden = previewing || editMode !== "visual";
      root.querySelector(".pane-source").hidden = previewing || editMode !== "source";
      root.querySelector(".ve-modebar").hidden = previewing;
      root.querySelectorAll(".ve-mode button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === editMode)); });
    }

    root._pull = function () {
      if (editMode === "visual" && vdirty) { f.body.value = ve.getMarkdown(); vdirty = false; }
    };

    function setEditMode(m) {
      if (m === editMode) return;
      if (m === "source") root._pull();
      else { ve.load(f.body.value); vdirty = false; }
      editMode = m;
      MW.store.set("medwiki:editorMode", m);
      paneState();
      if (m === "source") { editor.repaint(); editor.fit(); f.body.focus(); }
      else ve.focus();
      setChrome();
    }
    root.querySelectorAll(".ve-mode button").forEach(function (b) {
      b.addEventListener("click", function () { setEditMode(b.getAttribute("data-mode")); });
    });
    if (editMode === "visual") ve.load(f.body.value);
    paneState();

    var timer;
    function touched() {
      dirty = true;
      setDockState("Unsaved changes");
      clearTimeout(timer);
      timer = setTimeout(function () { MW.store.set(draftKey(), collect()); }, 400);
      root._touchTimer = timer;
    }
    root.querySelectorAll("input, select, textarea").forEach(function (el) {
      el.addEventListener("input", touched);
      el.addEventListener("change", touched);
    });

    ctx.innerHTML = '<p class="rail-hint"><strong>Editing</strong><br><kbd>Ctrl</kbd> <kbd>S</kbd> save<br><kbd>/</kbd> blocks<br><kbd>[[</kbd> link a page</p>';
    if (spy) { window.removeEventListener("scroll", spy); spy = null; }
    setChrome();
    if (!page.body.trim()) f.title.focus();
    else if (editMode === "visual") ve.focus();
    else f.body.focus();
    if (params.get("edit")) history.replaceState(null, "", MW.pageUrl(id));
    if (editMode === "source") editor.fit();
  }

  function collect() {
    var f = root._fields;
    if (root._pull) root._pull();
    return {
      title: f.title.value.trim(), subject: f.subject.value, chapter: f.chapter.value, importance: f.importance.value,
      status: f.status.value, aliases: f.aliases.value, tags: f.tags.value, body: f.body.value,
    };
  }

  function save() {
    if (mode !== "edit" || saving) return;
    var d;
    try {
      d = collect();
    } catch (err) {
      console.error(err);
      MW.toast("Could not read the editor content (" + err.message + "). Switch to Source, copy your text, and try again.");
      return;
    }
    if (!d.title) {
      MW.toast("Give the page a title first.");
      root._fields.title.focus();
      return;
    }
    saving = true;
    setDockState("Saving…");
    MW.commit(id, {
      title: d.title, subject: d.subject, chapter: d.chapter, importance: d.importance,
      status: d.status, aliases: csv(d.aliases), tags: csv(d.tags),
    }, d.body).then(function (where) {
      saving = false;
      clearTimeout(root._touchTimer);
      if (where === "failed") {
        setDockState("Could not save");
        MW.toast("Could not save: browser storage is full or blocked. Your text is still in the editor.");
        return;
      }
      MW.store.remove(draftKey());
      MW.store.set("medwiki:revision", false);
      MW.store.set("medwiki:recall", false);
      document.title = d.title + " — MedWiki";
      renderRead();
      MW.toast(where === "file"
        ? "Saved to content/" + id + ".js"
        : MW.server.available
          ? "The server did not respond, so this was saved in your browser only."
          : browserSaveNote());
    }, function (err) {
      saving = false;
      console.error(err);
      setDockState("Could not save");
      MW.toast("Could not save: " + (err && err.message ? err.message : "unknown error") + ". Your text is still in the editor.");
    });
  }

  /* The long explanation once per session; afterwards just "Saved". */
  function browserSaveNote() {
    var seen = false;
    try { seen = !!sessionStorage.getItem("medwiki:saveNote"); sessionStorage.setItem("medwiki:saveNote", "1"); } catch (e) {}
    return seen ? "Saved." : "Saved in this browser only. To also write it into your content folder, run “npm start” and open the site from that address.";
  }

  function cancelEdit() {
    if (dirty && !confirm("Discard your changes to this page?")) return;
    clearTimeout(root._touchTimer);
    MW.store.remove(draftKey());
    renderRead();
  }

  function togglePreview() {
    var f = root._fields;
    previewing = !previewing;
    var pv = root.querySelector("#f-preview");
    if (previewing) {
      root._editor.closeMenu();
      root._pull();
      pv.innerHTML = MW.md.render(f.body.value).html || '<p class="empty-page">Nothing to preview yet.</p>';
    }
    pv.hidden = !previewing;
    root.querySelector(".ve-modebar").hidden = previewing;
    var visual = root.querySelector(".pane-visual");
    var source = root.querySelector(".pane-source");
    var mode = root.querySelector('.ve-mode [aria-pressed="true"]').getAttribute("data-mode");
    visual.hidden = previewing || mode !== "visual";
    source.hidden = previewing || mode !== "source";
    if (!previewing && mode === "source") root._editor.fit();
    setChrome();
  }

  /* ---------- Missing page ---------- */

  function renderMissing() {
    var title = (id || "").replace(/-/g, " ");
    root.innerHTML =
      '<div class="not-found"><h1>No page called “' + MW.esc(title) + "”</h1>" +
      "<p>It may have been renamed, or it has not been written yet.</p>" +
      '<p><button class="btn btn-primary" type="button" data-create-missing>Create this page</button> ' +
      '<a class="btn" href="index.html">Back to library</a></p></div>';
    root.querySelector("[data-create-missing]").addEventListener("click", function () { MW.newPageDialog({ title: title }); });
    ctx.innerHTML = "";
    fab.hidden = true;
  }

  /* ---------- Commands ---------- */

  function registerCommands() {
    var P = MW.palette;
    function exists() { return !!MW.page(id); }
    P.register({ label: "Edit this article", icon: "pencil", hint: "E", when: function () { return exists() && mode === "read"; }, run: enterEdit });
    P.register({ label: "Save changes", icon: "check", hint: "Ctrl S", when: function () { return mode === "edit"; }, run: save });
    P.register({ label: "Export this article as a content file", icon: "download", keywords: "download save js", when: exists, run: function () {
      MW.exportSource(id).then(function (text) {
        MW.download(id + ".js", text, "text/javascript");
        MW.toast("Downloaded " + id + ".js. Put it in content/ and list the id in data.js.");
      });
    } });
    P.register({ label: "Revert this article to the original file", icon: "undo", keywords: "discard local edits", when: function () { var p = MW.page(id); return p && p.overridden; }, run: function () {
      if (!confirm("Discard your local edits and restore the original version of this article?")) return;
      MW.discardLocal(id);
      location.reload();
    } });
    P.register({ label: "Delete this page", icon: "trash", keywords: "remove", when: function () { var p = MW.page(id); return p && (p.origin === "local" || MW.server.available) && !(p.overridden && !MW.server.available); }, run: function () {
      var p = MW.page(id);
      var fromFile = p.origin === "file" || p.overridden;
      if (!confirm(fromFile ? "Delete this page and its file in content/? This cannot be undone. Links to it will become red links." : "Delete this page permanently? Links to it will become red links.")) return;
      MW.store.remove(draftKey());
      if (fromFile && MW.server.available) {
        MW.deleteFile(id).then(function () { location.href = "index.html"; }, function () { MW.toast("Could not delete the file."); });
        return;
      }
      MW.discardLocal(id);
      location.href = "index.html";
    } });
  }

  /* ---------- Reading progress ---------- */

  function initProgress() {
    var bar = document.createElement("div");
    bar.className = "reading-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.prepend(bar);
    var ticking = false;
    function update() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ")";
      ticking = false;
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- Boot ---------- */

  function init() {
    root = document.getElementById("article");
    ctx = document.getElementById("context");
    buildControls();
    registerCommands();
    initProgress();

    root.addEventListener("click", function (e) {
      var missing = e.target.closest(".wikilink.missing");
      if (missing) {
        e.preventDefault();
        var cur = MW.page(id);
        MW.newPageDialog({ title: missing.getAttribute("data-create"), subject: cur && cur.subject, chapter: cur && cur.chapter });
        return;
      }
      var st = e.target.closest("[data-status]");
      if (st && mode === "read") {
        var page = MW.page(id);
        var next = STATUS_ORDER[(STATUS_ORDER.indexOf(page.status) + 1) % STATUS_ORDER.length];
        MW.commit(id, { status: next }, null, { touch: false }).then(function () { renderRead(); });
        return;
      }
      var rc = e.target.closest(".recall-toggle");
      if (rc) { MW.toggleRecall(); return; }
      var mk = e.target.closest(".prose mark");
      if (mk && MW.isRevision() && MW.isRecall()) { mk.classList.toggle("revealed"); return; }
      var bm = e.target.closest("[data-bookmark]");
      if (bm) { MW.bookmarks.toggle(id); paintBookmark(MW.page(id)); }
    });

    if (!MW.page(id)) return renderMissing();

    MW.setCurrent(id);
    MW.recents.push(id);
    document.title = MW.page(id).title + " — MedWiki";
    if (params.get("edit") === "1") enterEdit();
    else renderRead();

    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (mode === "edit" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if (mode === "read" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e" && !document.querySelector(".overlay, .palette-overlay:not([hidden])")) {
        e.preventDefault();
        enterEdit();
      }
    });

    window.addEventListener("beforeunload", function (e) {
      if (mode === "edit" && dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    MW.onChange(function (kind) {
      if (kind === "recall" || kind === "revision") {
        var rb = root.querySelector("[data-recall]");
        if (rb) {
          rb.setAttribute("aria-pressed", String(MW.isRecall()));
          rb.textContent = MW.isRecall() ? "Recall on: click a highlight to reveal" : "Test myself";
        }
        root.querySelectorAll(".prose mark.revealed").forEach(function (m) { m.classList.remove("revealed"); });
      }
      /* Wikilink targets may change (e.g. a page was created) — refresh read view. */
      if (!kind && mode === "read" && MW.page(id)) renderRead();
    });
  }

  document.addEventListener("medwiki:ready", init);
})();
