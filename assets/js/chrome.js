/*
 * Site chrome: top bar and library rail, plus page boot.
 * Pages provide empty <header data-topbar> and <aside data-rail>; this fills
 * them. Page scripts listen for the "medwiki:ready" event.
 */
(function () {
  var MW = window.MedWiki;
  var page = document.body.getAttribute("data-page");
  var currentId = null; // set by the article page via MW.setCurrent()

  MW.currentPage = function () {
    return currentId ? MW.page(currentId) : null;
  };

  MW.setCurrent = function (id) {
    currentId = id;
    renderRail();
  };

  /* ---------- Top bar ---------- */

  function renderTopbar(el) {
    el.classList.add("topbar");
    el.innerHTML =
      '<button class="icon-control mobile-menu" type="button" aria-label="Open library" aria-expanded="false" aria-controls="library-rail">' + MW.icon("menu") + "</button>" +
      '<a class="wordmark" href="index.html" aria-label="MedWiki home"><span class="wordmark-mark">M</span><span>MedWiki</span></a>' +
      '<button class="search-launcher" type="button" aria-label="Search or run a command" aria-haspopup="dialog">' + MW.icon("search") +
      "<span>Search, jump to a chapter, or run a command…</span><kbd>Ctrl K</kbd></button>" +
      '<div class="top-actions">' +
      (page === "article"
        ? '<button class="revision-toggle" type="button" aria-pressed="false" title="Revision mode (R): hide explanatory text">' + MW.icon("layers") + "<span>Revision</span></button>"
        : "") +
      '<button class="icon-control settings-btn" type="button" aria-label="Settings" title="Settings">' + MW.icon("settings") + "</button>" +
      '<button class="icon-control theme-toggle" type="button" aria-label="Toggle dark mode"></button></div>';

    var themeBtn = el.querySelector(".theme-toggle");
    var revBtn = el.querySelector(".revision-toggle");

    function paint() {
      themeBtn.innerHTML = MW.icon(MW.isDark() ? "sun" : "moon");
      themeBtn.setAttribute("aria-pressed", String(MW.isDark()));
      if (revBtn) {
        revBtn.setAttribute("aria-pressed", String(MW.isRevision()));
        revBtn.classList.toggle("on", MW.isRevision());
      }
    }
    paint();
    MW.onChange(function (kind) { if (kind === "theme" || kind === "revision") paint(); });

    themeBtn.addEventListener("click", MW.toggleTheme);
    el.querySelector(".settings-btn").addEventListener("click", function () { MW.settingsDialog(); });
    if (revBtn) revBtn.addEventListener("click", MW.toggleRevision);
    MW.images.mountBadge(el.querySelector(".top-actions"));
    el.querySelector(".search-launcher").addEventListener("click", function () { MW.palette.open(); });
    el.querySelector(".mobile-menu").addEventListener("click", function () { setRailOpen(true); });
  }

  /* ---------- Library rail ---------- */

  var rail, scrim, menuBtn;

  function setRailOpen(open) {
    if (!rail) return;
    rail.classList.toggle("open", open);
    scrim.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) rail.querySelector(".mobile-rail-head button").focus();
    else if (rail.contains(document.activeElement)) menuBtn.focus();
  }
  MW.closeRail = function () { setRailOpen(false); };

  function railLink(href, label, icon, active) {
    return '<a class="rail-link' + (active ? " active" : "") + '" href="' + href + '"' + (active ? ' aria-current="page"' : "") + ">" +
      (icon ? MW.icon(icon) : "") + "<span>" + MW.esc(label) + "</span></a>";
  }

  var STATUS_LABEL = { draft: "Draft", review: "To revise", revised: "Revised" };

  function leaf(p) {
    var st = p.status || "draft";
    return '<a class="leaf' + (p.id === currentId ? " active" : "") + '" href="' + MW.pageUrl(p.id) + '" title="' + MW.esc(p.title) + " · " + (STATUS_LABEL[st] || "Draft") + '"' +
      (p.id === currentId ? ' aria-current="page"' : "") + '><i class="dot dot-' + st + '"></i><span class="t">' + MW.esc(p.title) + "</span></a>";
  }

  function node(kind, key, title, count, isOpen, inner, extra) {
    return '<div class="node ' + kind + '" data-key="' + key + '"><div class="node-row">' +
      '<button class="node-trigger" type="button" aria-expanded="' + isOpen + '">' + MW.icon("chevron-right") + '<span class="t">' + MW.esc(title) + "</span>" +
      '<span class="node-count">' + count + "</span></button>" + (extra || "") + "</div>" +
      '<div class="tree-children"' + (isOpen ? "" : " hidden") + ">" + inner + "</div></div>";
  }

  /* HTML for the subject → chapter → article tree. query filters by title, alias or tag and opens every match. */
  function treeHtml(query) {
    var current = currentId && MW.page(currentId);
    var stored = MW.store.get("medwiki:rail", {});
    var q = MW.norm(query || "").trim();
    var html = "";
    function hit(p) {
      return !q || [p.title].concat(p.aliases || [], p.tags || []).some(function (t) { return MW.norm(t).indexOf(q) !== -1; });
    }

    MW.subjects().forEach(function (s) {
      var inSubject = MW.pages.filter(function (p) { return p.subject === s.id; });
      if (!inSubject.length) return;
      var subjectHits = 0;
      var chapters = s.chapters.map(function (c) {
        var all = inSubject.filter(function (p) { return p.chapter === c.id; });
        var items = all.filter(hit);
        if (!items.length) return "";
        subjectHits += items.length;
        var key = s.id + "/" + c.id;
        var onPath = !!(current && current.subject === s.id && current.chapter === c.id);
        var open = q ? true : onPath || (key in stored ? stored[key] : false);
        var add = '<button class="node-add" type="button" data-subject="' + s.id + '" data-chapter="' + c.id + '" title="New page in ' + MW.esc(c.title) + '" aria-label="New page in ' + MW.esc(c.title) + '">' + MW.icon("plus", 13) + "</button>";
        return node("chapter-node" + (onPath ? " on-path" : ""), key, c.title, q ? items.length + "/" + all.length : all.length, open, items.map(leaf).join(""), add);
      }).join("");
      if (!chapters) return;
      var onSubject = !!(current && current.subject === s.id);
      var sOpen = q ? true : onSubject || (s.id in stored ? stored[s.id] : true);
      html += node("subject" + (onSubject ? " on-path" : ""), s.id, s.title, q ? subjectHits : inSubject.length, sOpen, chapters);
    });
    return html || '<p class="tree-empty">' + (q ? "No articles match “" + MW.esc(query) + "”." : "No articles yet.") + "</p>";
  }

  /* Right-click an article in the tree: open, print or delete. */
  var leafMenu = null;
  function closeLeafMenu() {
    if (!leafMenu) return;
    leafMenu.remove();
    leafMenu = null;
    document.removeEventListener("mousedown", onAway, true);
    document.removeEventListener("keydown", onEsc, true);
    window.removeEventListener("scroll", closeLeafMenu, true);
  }
  function onAway(e) { if (leafMenu && !leafMenu.contains(e.target)) closeLeafMenu(); }
  function onEsc(e) { if (e.key === "Escape") { e.stopPropagation(); closeLeafMenu(); } }

  function openLeafMenu(pid, x, y) {
    closeLeafMenu();
    var p = MW.page(pid);
    if (!p) return;
    leafMenu = document.createElement("div");
    leafMenu.className = "ctx-menu";
    leafMenu.setAttribute("role", "menu");
    leafMenu.innerHTML =
      '<p class="ctx-title">' + MW.esc(p.title) + "</p>" +
      '<button type="button" role="menuitem" data-a="open">' + MW.icon("file", 15) + "<span>Open</span></button>" +
      '<button type="button" role="menuitem" data-a="print">' + MW.icon("printer", 15) + "<span>Print / PDF</span></button>" +
      '<button type="button" role="menuitem" class="danger" data-a="delete">' + MW.icon("trash", 15) + "<span>Delete…</span></button>";
    document.body.appendChild(leafMenu);
    var w = leafMenu.offsetWidth, h = leafMenu.offsetHeight;
    leafMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
    leafMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + "px";
    leafMenu.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-a]");
      if (!b) return;
      var act = b.getAttribute("data-a");
      closeLeafMenu();
      setRailOpen(false);
      if (act === "open") location.href = MW.pageUrl(pid);
      else if (act === "print") location.href = "print.html?a=" + encodeURIComponent(pid);
      else MW.deleteArticle(pid);
    });
    document.addEventListener("mousedown", onAway, true);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("scroll", closeLeafMenu, true);
    leafMenu.querySelector("button").focus();
  }

  function renderRail() {
    if (!rail) return;
    var current = currentId && MW.page(currentId);
    var keepFilter = rail.querySelector(".tree-filter input");
    var filterValue = keepFilter ? keepFilter.value : "";

    rail.innerHTML =
      '<div class="mobile-rail-head"><strong>Library</strong><button class="icon-control" type="button" aria-label="Close library">' + MW.icon("x") + "</button></div>" +
      '<div class="rail-top">' +
      railLink("index.html", "Home", "house", page === "home" && !location.search) +
      railLink("index.html#bookmarks", "Saved", "bookmark") +
      railLink("pyq.html", "PYQ bank", "file", page === "pyq") +
      railLink("index.html?tags=all", "Tags", "tag", page === "home" && /tags=all/.test(location.search)) +
      '<button class="rail-link" type="button" data-print>' + MW.icon("printer") + "<span>Print articles</span></button>" +
      '<button class="rail-link rail-new" type="button" data-new>' + MW.icon("plus") + "<span>New page</span></button>" +
      '<div class="tree-head"><p class="rail-label">Library</p><span class="tree-tools">' +
      '<button type="button" data-expand title="Expand all">Expand</button><button type="button" data-collapse title="Collapse all">Collapse</button></span></div>' +
      '<label class="tree-filter">' + MW.icon("search", 14) + '<input type="search" placeholder="Filter articles" aria-label="Filter articles" autocomplete="off"></label></div>' +
      '<div class="tree-scroll"><div class="tree" role="tree" aria-label="Subjects and chapters"></div><div class="rail-recent"></div></div>';

    var tree = rail.querySelector(".tree");
    var input = rail.querySelector(".tree-filter input");
    input.value = filterValue;
    tree.innerHTML = treeHtml(filterValue);

    var recents = MW.recents.list().map(MW.page).filter(Boolean).slice(0, 3);
    if (recents.length) {
      rail.querySelector(".rail-recent").innerHTML = '<p class="rail-label section-label">Recently viewed</p>' +
        recents.map(function (p) { return railLink(MW.pageUrl(p.id), p.title, "clock", false); }).join("");
    }

    function setAll(open) {
      var state = {};
      tree.querySelectorAll(".node").forEach(function (n) { state[n.getAttribute("data-key")] = open; });
      MW.store.set("medwiki:rail", state);
      input.value = "";
      tree.innerHTML = treeHtml("");
    }
    rail.querySelector("[data-expand]").addEventListener("click", function () { setAll(true); });
    rail.querySelector("[data-collapse]").addEventListener("click", function () { setAll(false); });

    input.addEventListener("input", function () { tree.innerHTML = treeHtml(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && input.value) { e.stopPropagation(); input.value = ""; tree.innerHTML = treeHtml(""); }
      else if (e.key === "Enter") { var first = tree.querySelector(".leaf"); if (first) location.href = first.getAttribute("href"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); var f = tree.querySelector(".leaf, .node-trigger"); if (f) f.focus(); }
    });

    tree.addEventListener("contextmenu", function (e) {
      var leafEl = e.target.closest(".leaf");
      if (!leafEl) return;
      e.preventDefault();
      var pid = new URLSearchParams(leafEl.getAttribute("href").split("?")[1] || "").get("a");
      if (pid) openLeafMenu(pid, e.clientX, e.clientY);
    });

    tree.addEventListener("click", function (e) {
      var add = e.target.closest(".node-add");
      if (add) {
        setRailOpen(false);
        MW.newPageDialog({ subject: add.getAttribute("data-subject"), chapter: add.getAttribute("data-chapter") });
        return;
      }
      var btn = e.target.closest(".node-trigger");
      if (!btn) return;
      toggle(btn, btn.getAttribute("aria-expanded") !== "true");
    });

    function toggle(btn, open) {
      var wrap = btn.closest(".node");
      wrap.querySelector(":scope > .tree-children").hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (input.value.trim()) return; /* filtering: don't overwrite the saved layout */
      var state = MW.store.get("medwiki:rail", {});
      state[wrap.getAttribute("data-key")] = open;
      MW.store.set("medwiki:rail", state);
    }

    /* Arrow keys walk the tree; Right/Left open/close (or step into/out of a group). */
    tree.addEventListener("keydown", function (e) {
      var el = document.activeElement;
      if (!/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)$/.test(e.key) || !tree.contains(el)) return;
      var items = [].slice.call(tree.querySelectorAll(".node-trigger, .leaf")).filter(function (n) { return n.offsetParent !== null; });
      var i = items.indexOf(el);
      if (i < 0) return;
      var isNode = el.classList.contains("node-trigger");
      var next = null;
      if (e.key === "ArrowDown") next = items[i + 1];
      else if (e.key === "ArrowUp") next = i === 0 ? input : items[i - 1];
      else if (e.key === "Home") next = items[0];
      else if (e.key === "End") next = items[items.length - 1];
      else if (e.key === "ArrowRight" && isNode) {
        if (el.getAttribute("aria-expanded") !== "true") toggle(el, true);
        else next = items[i + 1];
      } else if (e.key === "ArrowLeft") {
        if (isNode && el.getAttribute("aria-expanded") === "true") toggle(el, false);
        else {
          var parent = el.closest(".tree-children");
          next = parent && parent.parentElement.querySelector(":scope > .node-row .node-trigger");
        }
      }
      e.preventDefault();
      if (next) next.focus();
    });

    rail.querySelector("[data-new]").addEventListener("click", function () {
      setRailOpen(false);
      MW.newPageDialog(current ? { subject: current.subject, chapter: current.chapter } : {});
    });
    rail.querySelector("[data-print]").addEventListener("click", function () {
      setRailOpen(false);
      MW.printDialog({ preselect: current ? [current.id] : [] });
    });
    rail.querySelector(".mobile-rail-head button").addEventListener("click", function () { setRailOpen(false); });

    /* Bring the open article into view without moving the page. */
    var active = tree.querySelector(".leaf.active");
    var scroller = rail.querySelector(".tree-scroll");
    if (active && scroller.scrollHeight > scroller.clientHeight) {
      var a = active.getBoundingClientRect();
      var s = scroller.getBoundingClientRect();
      if (a.top < s.top + 30 || a.bottom > s.bottom - 30) scroller.scrollTop += a.top - s.top - s.height / 3;
    }
  }

  function initRail(el) {
    rail = el;
    el.id = "library-rail";
    el.classList.add("library-rail");
    el.setAttribute("aria-label", "Library");
    scrim = document.createElement("button");
    scrim.className = "mobile-scrim";
    scrim.type = "button";
    scrim.hidden = true;
    scrim.setAttribute("aria-label", "Close library");
    scrim.addEventListener("click", function () { setRailOpen(false); });
    el.after(scrim);
    menuBtn = document.querySelector(".mobile-menu");
    el.addEventListener("click", function (e) { if (e.target.closest("a")) setRailOpen(false); });
    renderRail();
    MW.onChange(function (kind) { if (!kind) renderRail(); });
  }

  /* ---------- Boot ---------- */

  function isTyping(el) {
    return el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  }

  function boot() {
    MW.rebuild();
    var topbar = document.querySelector("[data-topbar]");
    var railEl = document.querySelector("[data-rail]");
    if (topbar) renderTopbar(topbar);
    if (railEl) initRail(railEl);
    MW.hydrateIcons(document);

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        MW.palette.open();
      } else if (e.key === "Escape") {
        setRailOpen(false);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(document.activeElement) && !document.querySelector(".overlay, .palette-overlay:not([hidden])")) {
        if (e.key === "/") { e.preventDefault(); MW.palette.open(); }
        else if (e.key === "?") { e.preventDefault(); MW.shortcutsDialog(); }
        else if (e.key.toLowerCase() === "r" && page === "article") MW.toggleRevision();
        else if (e.key.toLowerCase() === "p" && page === "article" && currentId) { e.preventDefault(); location.href = "print.html?a=" + encodeURIComponent(currentId); }
      }
    });

    /* Learn whether the local server is running before pages render, so Save behaves correctly. */
    Promise.all([MW.detectServer(), MW.images.init().catch(function () {})]).then(function () {
      document.dispatchEvent(new CustomEvent("medwiki:ready"));
      var pending = MW.localEditCount();
      if (MW.server.available && pending && !sessionStorage.getItem("medwiki:syncHint")) {
        try { sessionStorage.setItem("medwiki:syncHint", "1"); } catch (e) {}
        MW.toast(pending + (pending === 1 ? " page is" : " pages are") + " only saved in this browser. Open the palette (Ctrl+K) and choose “Write browser edits to files”.");
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
