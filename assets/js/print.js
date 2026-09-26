/*
 * Print view: one or several articles laid out like a journal article
 * (print.html?a=id1,id2,…). Options live in the toolbar and are remembered.
 * The sheet on screen is a continuous preview; page breaks and margins are
 * applied by the browser when you print or save as PDF.
 */
(function () {
  var MW = window.MedWiki;
  var KEY = "medwiki:print";
  var DEFAULTS = { size: "10.5", cols: "1", margin: "narrow", numbered: true, contents: true, breaks: true, images: true, tint: true };
  var MARGINS = { narrow: 10, standard: 15, wide: 20 };
  var IMPORTANCE = { high: "High yield", medium: "Medium yield", low: "Low yield" };
  var STATUS = { draft: "Draft", review: "To revise", revised: "Revised" };

  var ids = (new URLSearchParams(location.search).get("a") || "").split(",").filter(Boolean);
  var opts = Object.assign({}, DEFAULTS, MW.store.get(KEY, {}));
  var sheet, toolbar, pageStyle;

  function esc(s) { return MW.esc(s); }

  function pages() {
    var out = [];
    ids.forEach(function (id) { var p = MW.page(id); if (p && out.indexOf(p) === -1) out.push(p); });
    return out;
  }

  function crumb(p) {
    var s = MW.subject(p.subject);
    var c = MW.chapter(p.subject, p.chapter);
    return esc((s ? s.title : "") + (c ? "  ›  " + c.title : ""));
  }

  function articleHtml(p) {
    var r = MW.md.render(p.body || "");
    var meta = [];
    if (p.kind) meta.push(esc(p.kind));
    if (p.edited) meta.push("Edited " + MW.fmtDate(p.edited));
    if (IMPORTANCE[p.importance]) meta.push(IMPORTANCE[p.importance]);
    if (STATUS[p.status]) meta.push(STATUS[p.status]);
    return '<article class="jr-article" id="art-' + esc(p.id) + '">' +
      '<header class="jr-head">' +
      '<p class="jr-crumb">' + crumb(p) + "</p>" +
      "<h1>" + esc(p.title) + "</h1>" +
      (p.aliases.length ? '<p class="jr-aliases">Also known as ' + p.aliases.map(esc).join(", ") + "</p>" : "") +
      (meta.length ? '<p class="jr-meta">' + meta.join('<span aria-hidden="true"> · </span>') + "</p>" : "") +
      (p.tags.length ? '<p class="jr-tags">' + p.tags.map(function (t) { return "#" + esc(t); }).join("  ") + "</p>" : "") +
      "</header>" +
      '<div class="prose jr-text">' + (p.body.trim() ? r.html : '<p class="jr-empty">This article is empty.</p>') + "</div></article>";
  }

  function contentsHtml(list) {
    var groups = [];
    MW.subjects().forEach(function (s) {
      var inSubject = list.filter(function (p) { return p.subject === s.id; });
      if (!inSubject.length) return;
      var chapters = s.chapters.map(function (c) {
        var items = inSubject.filter(function (p) { return p.chapter === c.id; });
        return items.length
          ? '<li><span class="jr-toc-ch">' + esc(c.title) + "</span><ol>" + items.map(function (p) {
            return '<li><a href="#art-' + esc(p.id) + '">' + esc(p.title) + "</a></li>";
          }).join("") + "</ol></li>"
          : "";
      }).join("");
      groups.push('<section class="jr-toc-group"><h2>' + esc(s.title) + "</h2><ul>" + chapters + "</ul></section>");
    });
    var d = new Date();
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return '<section class="jr-cover"><p class="jr-brand">MedWiki</p><h1>Study notes</h1>' +
      '<p class="jr-date">' + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear() + " · " + list.length + (list.length === 1 ? " article" : " articles") + "</p>" +
      '<nav class="jr-toc" aria-label="Contents"><h2 class="jr-toc-title">Contents</h2>' + groups.join("") + "</nav></section>";
  }

  function applyPrefs() {
    var root = document.documentElement;
    root.removeAttribute("data-mode");
    root.removeAttribute("data-recall");
    root.setAttribute("data-theme", "light");
    sheet.setAttribute("data-cols", opts.cols);
    sheet.setAttribute("data-numbered", String(opts.numbered));
    sheet.setAttribute("data-breaks", String(opts.breaks));
    sheet.setAttribute("data-images", String(opts.images));
    sheet.setAttribute("data-tint", String(opts.tint));
    var mm = MARGINS[opts.margin] || MARGINS.narrow;
    sheet.style.setProperty("--jr-size", opts.size + "pt");
    sheet.style.setProperty("--jr-margin", mm + "mm");
    var list = pages();
    var footer = list.length === 1 ? list[0].title : "MedWiki study notes";
    pageStyle.textContent =
      "@page { size: A4; margin: " + mm + "mm " + mm + "mm " + (mm + 6) + "mm;" +
      ' @bottom-left { content: "' + footer.replace(/["\\\n]/g, " ") + '"; font: 8pt "DM Sans", sans-serif; color: #666; }' +
      ' @bottom-right { content: counter(page); font: 8pt "DM Sans", sans-serif; color: #666; } }';
  }

  /*
   * Fetching every image at once (a long atlas has hundreds) makes the image host throttle and drop most of
   * them, so they show as broken. Load them a few at a time, retry the ones that fail, and let print() wait
   * for the queue instead of guessing.
   */
  var IMG_POOL = 6;
  var IMG_TRIES = 4;
  var imgQueue = { total: 0, done: 0, waiters: [] };

  function imgProgress() {
    var note = document.getElementById("jr-note");
    if (imgQueue.done < imgQueue.total && note) note.textContent = "Loading images " + imgQueue.done + " of " + imgQueue.total + "…";
    if (imgQueue.done >= imgQueue.total) {
      imgQueue.waiters.splice(0).forEach(function (fn) { fn(); });
      if (note && imgQueue.total) note.textContent = "Tip: turn off “Headers and footers” in the print dialog and keep scale at 100%.";
    }
  }

  function queueImages() {
    var imgs = [].slice.call(sheet.querySelectorAll("img"));
    var todo = [];
    imgQueue = { total: 0, done: 0, waiters: [] };
    var q = imgQueue;
    imgs.forEach(function (img) {
      var src = img.getAttribute("src");
      if (!src || img.complete && img.naturalWidth) return;
      img.removeAttribute("loading");
      img.referrerPolicy = "no-referrer";
      img.removeAttribute("src");
      todo.push({ img: img, src: src, tries: 0 });
    });
    q.total = todo.length;
    var active = 0;
    function next() {
      if (q !== imgQueue) return;
      while (active < IMG_POOL && todo.length) start(todo.shift());
      imgProgress();
    }
    function start(job) {
      active++;
      var img = job.img;
      function settle(ok) {
        img.onload = img.onerror = null;
        if (!ok && job.tries < IMG_TRIES) {
          job.tries++;
          setTimeout(function () { active--; todo.push(job); next(); }, 500 * job.tries);
          return;
        }
        active--;
        q.done++;
        next();
      }
      img.onload = function () { settle(true); };
      img.onerror = function () { settle(false); };
      img.src = job.tries ? job.src + (job.src.indexOf("?") === -1 ? "?" : "&") + "r=" + job.tries : job.src;
    }
    next();
  }

  function renderSheet() {
    var list = pages();
    var html = "";
    if (list.length > 1 && opts.contents) html += contentsHtml(list);
    html += list.map(articleHtml).join("");
    sheet.innerHTML = html;
    queueImages();
    var n = document.getElementById("jr-count");
    if (n) n.textContent = list.length + (list.length === 1 ? " article" : " articles");
  }

  function check(id, label, key) {
    return '<label class="jr-check"><input type="checkbox" id="' + id + '"' + (opts[key] ? " checked" : "") + "><span>" + label + "</span></label>";
  }

  function select(id, label, key, values) {
    return '<label class="jr-select"><span>' + label + '</span><select id="' + id + '">' + values.map(function (v) {
      return '<option value="' + v[0] + '"' + (String(opts[key]) === v[0] ? " selected" : "") + ">" + v[1] + "</option>";
    }).join("") + "</select></label>";
  }

  function renderToolbar() {
    toolbar.innerHTML =
      '<div class="jr-bar-main">' +
      '<a class="btn" href="' + (ids.length === 1 && MW.page(ids[0]) ? MW.pageUrl(ids[0]) : "index.html") + '">' + MW.icon("chevron-right", 15).replace("<svg", '<svg style="transform:rotate(180deg)"') + "<span>Back</span></a>" +
      '<strong class="jr-bar-title">Print view</strong><span class="jr-bar-count" id="jr-count"></span>' +
      '<span class="grow"></span>' +
      '<button type="button" class="btn" id="jr-pick">' + MW.icon("plus", 15) + "<span>Choose articles</span></button>" +
      '<button type="button" class="btn btn-primary" id="jr-print">' + MW.icon("printer", 15) + '<span>Print / Save as PDF</span></button></div>' +
      '<div class="jr-bar-opts">' +
      select("jr-size", "Text", "size", [["9.5", "9.5 pt"], ["10", "10 pt"], ["10.5", "10.5 pt"], ["11", "11 pt"], ["12", "12 pt"]]) +
      select("jr-cols", "Columns", "cols", [["1", "One"], ["2", "Two"]]) +
      select("jr-margin", "Margins", "margin", [["narrow", "Narrow"], ["standard", "Standard"], ["wide", "Wide"]]) +
      check("jr-numbered", "Section numbers", "numbered") +
      check("jr-contents", "Contents page", "contents") +
      check("jr-breaks", "New page per article", "breaks") +
      check("jr-tint", "Tinted study blocks", "tint") +
      check("jr-images", "Images", "images") +
      "</div>" +
      '<p class="jr-bar-note" id="jr-note" role="status">Preview is one continuous sheet. Margins and page breaks apply in the printed PDF. In the print dialog, turn off “Headers and footers” and leave scale at 100%.</p>';

    var map = { "jr-size": "size", "jr-cols": "cols", "jr-margin": "margin" };
    var checks = { "jr-numbered": "numbered", "jr-contents": "contents", "jr-breaks": "breaks", "jr-tint": "tint", "jr-images": "images" };
    Object.keys(map).forEach(function (id) {
      toolbar.querySelector("#" + id).addEventListener("change", function (e) { opts[map[id]] = e.target.value; save(); });
    });
    Object.keys(checks).forEach(function (id) {
      toolbar.querySelector("#" + id).addEventListener("change", function (e) { opts[checks[id]] = e.target.checked; save(); });
    });
    toolbar.querySelector("#jr-pick").addEventListener("click", function () { MW.printDialog({ preselect: ids }); });
    toolbar.querySelector("#jr-print").addEventListener("click", print);
  }

  function save() {
    MW.store.set(KEY, opts);
    applyPrefs();
    if (pages().length) renderSheet();
  }

  function print() {
    var note = document.getElementById("jr-note");
    var wait = new Promise(function (res) {
      if (imgQueue.done >= imgQueue.total) return res();
      imgQueue.waiters.push(res);
      imgProgress();
    });
    Promise.race([wait, new Promise(function (r) { setTimeout(r, 90000); })]).then(function () {
      return document.fonts && document.fonts.ready;
    }).then(function () {
      if (note) note.textContent = "Tip: turn off “Headers and footers” in the print dialog and keep scale at 100%.";
      window.print();
    });
  }

  function init() {
    sheet = document.getElementById("sheet");
    toolbar = document.getElementById("toolbar");
    sheet.addEventListener("click", function (e) {
      if (e.target.tagName === "IMG") e.stopPropagation();
    });
    pageStyle = document.createElement("style");
    document.head.appendChild(pageStyle);
    renderToolbar();
    applyPrefs();
    if (!pages().length) {
      sheet.innerHTML = '<div class="jr-none"><h1>Nothing to print yet</h1><p>Choose one or more articles to build a print-ready document.</p>' +
        '<button type="button" class="btn btn-primary" id="jr-none-pick">Choose articles</button></div>';
      sheet.querySelector("#jr-none-pick").addEventListener("click", function () { MW.printDialog({}); });
      document.getElementById("jr-count").textContent = "";
      if (MW.pages.length) MW.printDialog({});
      return;
    }
    renderSheet();
    document.title = (pages().length === 1 ? pages()[0].title : "Study notes") + " — MedWiki";
  }

  document.addEventListener("medwiki:ready", init);
})();
