/*
 * Command palette (Ctrl/Cmd+K, or /). One box for: searching articles
 * (titles, aliases, headings, body), jumping to chapters, creating pages and
 * running commands. Prefix with ">" to show commands only.
 *
 * Pages add their own commands with MW.palette.register({ label, icon, hint,
 * when(): bool, run() }).
 */
(function () {
  var MW = window.MedWiki;
  var commands = [];
  var overlay, input, list, countEl, items = [], selected = 0, lastFocus;

  var palette = (MW.palette = {});

  palette.register = function (cmd) {
    commands.push(cmd);
  };

  function chapterMatches(tokens) {
    var out = [];
    MW.subjects().forEach(function (s) {
      s.chapters.forEach(function (c) {
        var hay = MW.norm(s.title + " " + c.title);
        if (tokens.every(function (t) { return hay.indexOf(t) !== -1; })) {
          out.push({ subject: s, chapter: c });
        }
      });
    });
    return out;
  }

  function hasText(cmd, tokens) {
    var hay = MW.norm(cmd.label + " " + (cmd.keywords || ""));
    return tokens.every(function (t) { return hay.indexOf(t) !== -1; });
  }

  function build(raw) {
    var commandsOnly = raw.charAt(0) === ">";
    var q = commandsOnly ? raw.slice(1).trim() : raw.trim();
    var tokens = MW.norm(q).split(/\s+/).filter(Boolean);
    var out = [];
    var active = commands.filter(function (c) { return !c.when || c.when(); });

    if (!tokens.length) {
      if (!commandsOnly) {
        MW.recents.list().map(MW.page).filter(Boolean).slice(0, 5).forEach(function (p) {
          out.push({ group: "Recent", icon: "clock", label: p.title, hint: crumb(p), href: MW.pageUrl(p.id) });
        });
      }
      active.forEach(function (c) { out.push({ group: "Commands", icon: c.icon, label: c.label, hint: c.hint, run: c.run }); });
      return out;
    }

    if (!commandsOnly) {
      MW.search(q, 8).forEach(function (r) {
        var p = r.page;
        var hint = crumb(p);
        if (r.via === "alias") {
          var hit = p.aliases.filter(function (a) { return MW.norm(a).indexOf(MW.norm(q)) !== -1; })[0];
          if (hit) hint = "Also known as " + hit + " · " + hint;
        } else if (r.via === "tag") hint = "#" + p.tags.join(" #") + " · " + hint;
        out.push({
          group: "Articles",
          icon: "file",
          label: p.title,
          hint: hint,
          heading: r.heading && r.via !== "title" ? r.heading.text : "",
          snippet: r.snippet,
          href: MW.pageUrl(p.id, r.heading && r.via !== "title" && r.via !== "alias" ? r.heading.id : ""),
        });
      });
      chapterMatches(tokens).slice(0, 4).forEach(function (m) {
        out.push({ group: "Chapters", icon: "folder", label: m.chapter.title, hint: m.subject.title, href: "index.html#" + m.subject.id + "-" + m.chapter.id });
      });
      MW.allTags().filter(function (t) { return tokens.every(function (k) { return MW.norm(t.tag).indexOf(k) !== -1; }); }).slice(0, 3).forEach(function (t) {
        out.push({ group: "Tags", icon: "hash", label: "#" + t.tag, hint: t.count + (t.count === 1 ? " article" : " articles"), href: "index.html?tag=" + encodeURIComponent(t.tag) });
      });
    }

    active.filter(function (c) { return hasText(c, tokens); }).forEach(function (c) {
      out.push({ group: "Commands", icon: c.icon, label: c.label, hint: c.hint, run: c.run });
    });

    if (!commandsOnly && q.length > 1 && !MW.resolve(q)) {
      var cur = MW.currentPage();
      out.push({
        group: "Create",
        icon: "plus",
        label: "Create page “" + q + "”",
        hint: "New page",
        run: function () { MW.newPageDialog({ title: q, subject: cur && cur.subject, chapter: cur && cur.chapter }); },
      });
    }
    return out;
  }

  function crumb(p) {
    var s = MW.subject(p.subject);
    var c = MW.chapter(p.subject, p.chapter);
    return [s && s.title, c && c.title].filter(Boolean).join(" › ");
  }

  function paint() {
    var html = "";
    var lastGroup = "";
    items.forEach(function (it, i) {
      if (it.group !== lastGroup) {
        html += '<div class="palette-group">' + it.group + "</div>";
        lastGroup = it.group;
      }
      var inner =
        '<span class="palette-icon">' + MW.icon(it.icon || "terminal") + "</span>" +
        '<span class="palette-text"><strong>' + MW.esc(it.label) + "</strong>" +
        (it.heading ? '<span class="palette-heading">› ' + MW.esc(it.heading) + "</span>" : "") +
        (it.snippet ? '<span class="palette-snippet">' + it.snippet + "</span>" : "") +
        (it.hint ? "<small>" + MW.esc(it.hint) + "</small>" : "") + "</span>";
      var cls = "palette-item" + (i === selected ? " is-selected" : "");
      html += it.href
        ? '<a class="' + cls + '" role="option" id="pi-' + i + '" href="' + it.href + '" data-i="' + i + '">' + inner + "</a>"
        : '<button class="' + cls + '" type="button" role="option" id="pi-' + i + '" data-i="' + i + '">' + inner + "</button>";
    });
    list.innerHTML = html || '<p class="palette-empty">Nothing found.</p>';
    countEl.textContent = items.length ? items.length + (items.length === 1 ? " result" : " results") : "";
    input.setAttribute("aria-activedescendant", items.length ? "pi-" + selected : "");
  }

  function refresh() {
    items = build(input.value);
    selected = 0;
    paint();
  }

  function move(delta) {
    if (!items.length) return;
    selected = (selected + delta + items.length) % items.length;
    list.querySelectorAll(".palette-item").forEach(function (el, i) { el.classList.toggle("is-selected", i === selected); });
    var el = document.getElementById("pi-" + selected);
    input.setAttribute("aria-activedescendant", "pi-" + selected);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    var it = items[i];
    if (!it) return;
    close(true);
    if (it.href) location.href = it.href;
    else if (it.run) it.run();
  }

  function create() {
    overlay = document.createElement("div");
    overlay.className = "palette-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">' +
      '<div class="palette-input">' + MW.icon("search") +
      '<input type="text" placeholder="Search articles, run a command…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-label="Search">' +
      '<kbd>Esc</kbd></div>' +
      '<div class="palette-list" id="palette-list" role="listbox"></div>' +
      '<div class="palette-foot"><span class="palette-count" aria-live="polite"></span><span>↑↓ move · Enter open · &gt; commands</span></div></div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector("input");
    list = overlay.querySelector(".palette-list");
    countEl = overlay.querySelector(".palette-count");

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); choose(selected); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    list.addEventListener("click", function (e) {
      var el = e.target.closest(".palette-item");
      if (!el) return;
      if (el.tagName === "A") { close(true); return; }
      e.preventDefault();
      choose(Number(el.getAttribute("data-i")));
    });
    list.addEventListener("mousemove", function (e) {
      var el = e.target.closest(".palette-item");
      if (!el) return;
      var i = Number(el.getAttribute("data-i"));
      if (i !== selected) { selected = i; move(0); }
    });
  }

  palette.open = function (prefill) {
    if (!overlay) create();
    lastFocus = document.activeElement;
    input.value = prefill || "";
    overlay.hidden = false;
    refresh();
    input.focus();
  };

  function close(skipFocus) {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (skipFocus !== true && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  palette.close = close;

  /* ---------- Built-in commands ---------- */

  function randomArticle() {
    var others = MW.pages.filter(function (p) { return !MW.currentPage() || p.id !== MW.currentPage().id; });
    if (!others.length) return MW.toast("No other articles yet.");
    location.href = MW.pageUrl(others[Math.floor(Math.random() * others.length)].id);
  }

  [
    { label: "Create new page", icon: "plus", hint: "New page", keywords: "add write", run: function () {
      var cur = MW.currentPage();
      MW.newPageDialog(cur ? { subject: cur.subject, chapter: cur.chapter } : {});
    } },
    { label: "Toggle revision mode", icon: "layers", hint: "R", keywords: "cram hide", run: MW.toggleRevision },
    { label: "Toggle dark mode", icon: "moon", keywords: "theme light", run: MW.toggleTheme },
    { label: "Open random article", icon: "shuffle", run: randomArticle },
    { label: "Go to home", icon: "house", run: function () { location.href = "index.html"; } },
    { label: "Open the PYQ bank", icon: "file", keywords: "previous year questions exam", run: function () { location.href = "pyq.html"; } },
    { label: "Print this article", icon: "printer", hint: "P", keywords: "pdf save export paper", when: function () { return !!MW.currentPage(); }, run: function () { location.href = "print.html?a=" + encodeURIComponent(MW.currentPage().id); } },
    { label: "Print articles…", icon: "printer", keywords: "pdf save export paper compile group set", run: function () {
      var cur = MW.currentPage();
      MW.printDialog({ preselect: cur ? [cur.id] : [] });
    } },
    { label: "Settings…", icon: "settings", keywords: "preferences images imgbb blocks backup", run: function () { MW.settingsDialog(); } },
    { label: "Manage block types…", icon: "pencil", hint: "Study blocks", keywords: "custom colour color block type customize study", run: function () { MW.blockTypesDialog(); } },
    { label: "Keyboard shortcuts", icon: "terminal", hint: "?", keywords: "help keys", run: function () { MW.shortcutsDialog(); } },
    { label: "Write browser edits to files", icon: "download", keywords: "sync save local", when: function () { return MW.server.available && MW.localEditCount() > 0; }, run: function () {
      MW.syncLocal().then(function (n) { MW.toast(n + (n === 1 ? " page" : " pages") + " written to content/."); setTimeout(function () { location.reload(); }, 900); });
    } },
    { label: "Image uploads (ImgBB)…", icon: "image", hint: "Settings", keywords: "images imgbb api key upload host queue", run: function () { MW.images.settingsDialog(); } },
    { label: "Export backup of my edits", icon: "download", hint: "JSON", keywords: "save", run: MW.exportBackup },
    { label: "Import backup…", icon: "upload", keywords: "restore", run: MW.importBackup },
  ].forEach(palette.register);
})();
