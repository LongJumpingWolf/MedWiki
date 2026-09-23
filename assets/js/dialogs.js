/* Small shared UI: toasts, the "new page" dialog, file download, backup/restore. */
(function () {
  var MW = window.MedWiki;

  /* ---------- Toast ---------- */

  var toastEl, toastTimer;
  MW.toast = function (message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3200);
  };

  /* ---------- Files ---------- */

  MW.download = function (filename, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  MW.exportBackup = function () {
    var pages = MW.store.get("medwiki:pages", {});
    var keys = [];
    Object.keys(pages).forEach(function (id) { keys = keys.concat(MW.images.refs(pages[id])); });
    MW.images.dataFor(keys).then(function (images) {
      var data = { version: 3, exported: new Date().toISOString(), pages: pages, chapters: MW.store.get("medwiki:chapters", {}), blocktypes: MW.store.get("medwiki:blocktypes", null), structure: MW.store.get("medwiki:structure", null), images: images };
      MW.download("medwiki-backup-" + MW.today() + ".json", JSON.stringify(data), "application/json");
      MW.store.set("medwiki:lastBackup", Date.now());
      MW.toast("Backup downloaded (" + Object.keys(pages).length + " pages).");
    });
  };

  MW.importBackup = function () {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try {
          var data = JSON.parse(text);
          if (!data.pages) throw new Error("bad file");
          var pages = MW.store.get("medwiki:pages", {});
          Object.keys(data.pages).forEach(function (id) { pages[id] = data.pages[id]; });
          MW.store.set("medwiki:pages", pages);
          var chapters = MW.store.get("medwiki:chapters", {});
          Object.keys(data.chapters || {}).forEach(function (s) {
            var have = (chapters[s] = chapters[s] || []);
            data.chapters[s].forEach(function (c) {
              if (!have.some(function (h) { return h.id === c.id; })) have.push(c);
            });
          });
          MW.store.set("medwiki:chapters", chapters);
          if (Array.isArray(data.blocktypes)) MW.store.set("medwiki:blocktypes", data.blocktypes);
          if (Array.isArray(data.structure)) MW.store.set("medwiki:structure", data.structure);
          var restored = Object.keys(data.images || {}).map(function (k) { return MW.images.restore(k, data.images[k]); });
          MW.rebuild();
          MW.toast("Imported " + Object.keys(data.pages).length + " pages.");
          Promise.all(restored).then(function () { setTimeout(function () { location.reload(); }, 600); });
        } catch (e) {
          MW.toast("That file is not a MedWiki backup.");
        }
      });
    });
    input.click();
  };

  /* ---------- New page dialog ---------- */

  /* defaults: { title, subject, chapter } */
  MW.newPageDialog = function (defaults) {
    defaults = defaults || {};
    var subjects = MW.subjects();
    var subjectId = defaults.subject || (subjects[0] && subjects[0].id);
    var lastFocus = document.activeElement;

    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<form class="dialog" role="dialog" aria-modal="true" aria-labelledby="np-title">' +
      '<h2 id="np-title">New page</h2>' +
      '<label>Title<input name="title" required autocomplete="off" value="' + MW.esc(defaults.title || "") + '"></label>' +
      '<div class="dialog-row">' +
      '<label>Subject<select name="subject">' +
      subjects.map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === subjectId ? " selected" : "") + ">" + MW.esc(s.title) + "</option>";
      }).join("") +
      "</select></label>" +
      '<label>Chapter<select name="chapter"></select></label></div>' +
      '<label class="new-chapter" hidden>New chapter name<input name="newChapter" autocomplete="off"></label>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">Create and edit</button></div></form>';
    document.body.appendChild(wrap);

    var form = wrap.querySelector("form");
    var subjectSel = form.elements.subject;
    var chapterSel = form.elements.chapter;
    var newWrap = form.querySelector(".new-chapter");

    function fillChapters(selected) {
      var s = MW.subject(subjectSel.value);
      chapterSel.innerHTML =
        s.chapters.map(function (c) {
          return '<option value="' + c.id + '">' + MW.esc(c.title) + "</option>";
        }).join("") + '<option value="__new">New chapter…</option>';
      if (selected && MW.chapter(subjectSel.value, selected)) chapterSel.value = selected;
      syncNew();
    }
    function syncNew() {
      newWrap.hidden = chapterSel.value !== "__new";
      if (!newWrap.hidden) form.elements.newChapter.focus();
    }

    subjectSel.addEventListener("change", function () { fillChapters(); });
    chapterSel.addEventListener("change", syncNew);
    fillChapters(defaults.chapter);

    function close() {
      wrap.remove();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    form.querySelector("[data-cancel]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = form.elements.title.value.trim();
      if (!title) return;
      var chapter = chapterSel.value;
      if (chapter === "__new") {
        var name = form.elements.newChapter.value.trim();
        if (!name) { form.elements.newChapter.focus(); return; }
        chapter = MW.addChapter(subjectSel.value, name);
      }
      var existing = MW.resolve(title);
      if (existing) {
        close();
        location.href = MW.pageUrl(existing.id);
        return;
      }
      var submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      submit.textContent = "Creating…";
      MW.persistChapters()
        .then(function () { return MW.createPage({ title: title, subject: subjectSel.value, chapter: chapter }); })
        .then(function (id) { location.href = MW.pageUrl(id) + "&edit=1"; });
    });

    form.elements.title.focus();
    form.elements.title.select();
  };

  /* ---------- Block types dialog ---------- */

  MW.blockTypesDialog = function () {
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<div class="dialog block-types-dialog" role="dialog" aria-modal="true" aria-labelledby="bt-title">' +
      '<h2 id="bt-title">Block types</h2>' +
      '<p class="dialog-hint">Used for ::: study blocks in an article. Pick a colour and label for each, or remove ones you don’t use.</p>' +
      '<div class="block-type-list"></div>' +
      '<div class="dialog-actions" style="justify-content:space-between">' +
      '<span class="dialog-actions-left"><button type="button" class="btn" data-add>' + MW.icon("plus", 15) + "<span>Add</span></button>" +
      '<button type="button" class="btn" data-reset title="Bring back the starter set">Restore defaults</button></span>' +
      '<button type="button" class="btn btn-primary" data-done>Done</button></div></div>';
    document.body.appendChild(wrap);

    var list = wrap.querySelector(".block-type-list");

    function row(t) {
      var r = document.createElement("div");
      r.className = "block-type-row";
      r.setAttribute("data-key", t.key);
      r.innerHTML =
        '<input type="color" value="' + MW.esc(t.color || "#8a8f98") + '" aria-label="Colour for ' + MW.esc(t.label) + '">' +
        '<input type="text" value="' + MW.esc(t.label) + '" maxlength="40" aria-label="Label for ' + MW.esc(t.label) + '">' +
        '<button type="button" class="btn-icon" data-del title="Delete" aria-label="Delete ' + MW.esc(t.label) + '">' + MW.icon("trash", 15) + "</button>";
      var color = r.querySelector('[type=color]');
      var label = r.querySelector('[type=text]');
      color.addEventListener("input", function () { MW.blockTypes.update(t.key, { color: color.value }); });
      label.addEventListener("input", function () { MW.blockTypes.update(t.key, { label: label.value || t.label }); });
      r.querySelector("[data-del]").addEventListener("click", function () {
        if (!confirm('Delete "' + t.label + '"? Articles already using it keep working, just without a colour.')) return;
        MW.blockTypes.remove(t.key);
        r.remove();
      });
      return r;
    }

    MW.blockTypes.list().forEach(function (t) { list.appendChild(row(t)); });

    wrap.querySelector("[data-add]").addEventListener("click", function () {
      var key = MW.blockTypes.add("New block", "#8a8f98");
      var r = row(MW.blockTypes.get(key));
      list.appendChild(r);
      var label = r.querySelector('[type=text]');
      label.focus();
      label.select();
    });

    wrap.querySelector("[data-reset]").addEventListener("click", function () {
      if (!confirm("Restore the starter block types? Any custom ones will be removed.")) return;
      MW.blockTypes.reset();
      list.innerHTML = "";
      MW.blockTypes.list().forEach(function (t) { list.appendChild(row(t)); });
    });

    function close() { wrap.remove(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    wrap.querySelector("[data-done]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  };

  /* ---------- Print picker ---------- */

  /* opts: { preselect: [ids] }. Opens the print view (print.html) for the chosen articles. */
  MW.printDialog = function (opts) {
    var chosen = {};
    ((opts && opts.preselect) || []).forEach(function (id) { chosen[id] = true; });
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<div class="dialog print-dialog" role="dialog" aria-modal="true" aria-labelledby="pd-title">' +
      '<h2 id="pd-title">Print or save as PDF</h2>' +
      '<p class="dialog-hint">Pick one article or a whole set. They open in a clean, journal-style layout with tight margins.</p>' +
      '<label class="pick-filter">' + MW.icon("search", 14) + '<input type="search" placeholder="Filter articles" autocomplete="off" aria-label="Filter articles"></label>' +
      '<div class="pick-list" role="group" aria-label="Articles"></div>' +
      '<div class="dialog-actions" style="justify-content:space-between"><span class="pick-count" role="status"></span>' +
      '<span class="dialog-actions-left"><button type="button" class="btn" data-cancel>Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-go>Open print view</button></span></div></div>';
    document.body.appendChild(wrap);

    var list = wrap.querySelector(".pick-list");
    var filter = wrap.querySelector("input[type=search]");
    var count = wrap.querySelector(".pick-count");
    var go = wrap.querySelector("[data-go]");

    function order() { return MW.pages.filter(function (p) { return chosen[p.id]; }); }

    function paintCount() {
      var n = order().length;
      count.textContent = n + (n === 1 ? " article" : " articles") + " selected";
      go.disabled = !n;
    }

    function paint() {
      var q = MW.norm(filter.value || "").trim();
      var html = "";
      MW.subjects().forEach(function (s) {
        var chapters = s.chapters.map(function (c) {
          var items = MW.pages.filter(function (p) {
            return p.subject === s.id && p.chapter === c.id &&
              (!q || [p.title].concat(p.aliases || [], p.tags || []).some(function (t) { return MW.norm(t).indexOf(q) !== -1; }));
          });
          if (!items.length) return "";
          var all = items.every(function (p) { return chosen[p.id]; });
          return '<div class="pick-chapter"><label class="pick-head"><input type="checkbox" data-chapter="' + s.id + "/" + c.id + '"' + (all ? " checked" : "") + "><span>" + MW.esc(c.title) + "</span><small>" + items.length + "</small></label>" +
            items.map(function (p) {
              return '<label class="pick-item"><input type="checkbox" data-id="' + p.id + '"' + (chosen[p.id] ? " checked" : "") + "><span>" + MW.esc(p.title) + "</span></label>";
            }).join("") + "</div>";
        }).join("");
        if (chapters) html += '<div class="pick-subject"><p class="pick-subject-title">' + MW.esc(s.title) + "</p>" + chapters + "</div>";
      });
      list.innerHTML = html || '<p class="dialog-hint">' + (MW.pages.length ? "No articles match." : "There are no articles to print yet.") + "</p>";
      paintCount();
    }

    list.addEventListener("change", function (e) {
      var t = e.target;
      if (t.hasAttribute("data-id")) chosen[t.getAttribute("data-id")] = t.checked;
      else if (t.hasAttribute("data-chapter")) {
        var parts = t.getAttribute("data-chapter").split("/");
        MW.pages.forEach(function (p) { if (p.subject === parts[0] && p.chapter === parts[1]) chosen[p.id] = t.checked; });
        var scroll = list.scrollTop;
        paint();
        list.scrollTop = scroll;
        return;
      }
      paintCount();
    });
    filter.addEventListener("input", paint);

    function close() { wrap.remove(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    wrap.querySelector("[data-cancel]").addEventListener("click", close);
    go.addEventListener("click", function () {
      var ids = order().map(function (p) { return p.id; });
      if (!ids.length) return;
      location.href = "print.html?a=" + ids.map(encodeURIComponent).join(",");
    });
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    paint();
    filter.focus();
  };

  /* ---------- Delete an article (type "delete" to confirm) ---------- */

  MW.deleteArticle = function (id) {
    var p = MW.page(id);
    if (!p) return;
    var fileBacked = p.origin === "file" || p.overridden;
    if (fileBacked && !MW.server.available) {
      return MW.toast("This article is a file in content/. Run npm start to delete it, or remove the file and push.");
    }
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<form class="dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title">' +
      '<h2 id="del-title">Delete this article?</h2>' +
      '<p class="del-name">' + MW.esc(p.title) + "</p>" +
      '<p class="dialog-hint">' + (fileBacked ? "Its file in content/ is deleted too. " : "") + "This cannot be undone. Links to it will turn red. Print or back up first if you might want it again.</p>" +
      '<label><span>Type <b>delete</b> to confirm</span><input name="confirm" autocomplete="off" spellcheck="false" placeholder="delete"></label>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancel</button>' +
      '<button type="submit" class="btn btn-danger" disabled>Delete article</button></div></form>';
    document.body.appendChild(wrap);
    var form = wrap.querySelector("form");
    var input = form.elements.confirm;
    var go = form.querySelector("[type=submit]");
    input.addEventListener("input", function () { go.disabled = input.value.trim().toLowerCase() !== "delete"; });
    function close() { wrap.remove(); if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); }
    form.querySelector("[data-cancel]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (go.disabled) return;
      go.disabled = true;
      go.textContent = "Deleting…";
      MW.store.remove("medwiki:draft:" + id);
      if (MW.bookmarks.list().indexOf(id) !== -1) MW.bookmarks.toggle(id);
      var work = fileBacked ? MW.deleteFile(id) : Promise.resolve(MW.discardLocal(id));
      work.then(function () {
        close();
        var here = new URLSearchParams(location.search).get("a") === id;
        if (here) location.href = "index.html";
        else MW.toast("Deleted “" + p.title + "”.");
      }, function () { go.textContent = "Delete article"; go.disabled = false; MW.toast("Could not delete the file."); });
    });
    input.focus();
  };

  /* ---------- Name prompt (add or rename a subject or chapter) ---------- */

  /* opts: { title, label, value, action }. run(name) may return a promise. */
  MW.namePrompt = function (opts, run) {
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<form class="dialog name-dialog" role="dialog" aria-modal="true" aria-labelledby="nm-title">' +
      '<h2 id="nm-title">' + MW.esc(opts.title) + "</h2>" +
      "<label>" + MW.esc(opts.label) + '<input name="name" required maxlength="80" autocomplete="off" value="' + MW.esc(opts.value || "") + '"></label>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn btn-primary">' + MW.esc(opts.action) + "</button></div></form>";
    document.body.appendChild(wrap);
    var form = wrap.querySelector("form");
    function close() { wrap.remove(); if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); }
    form.querySelector("[data-cancel]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      if (!name) return;
      form.querySelector("[type=submit]").disabled = true;
      Promise.resolve(run(name)).then(function () { close(); }, function () { close(); MW.toast("That did not work."); });
    });
    form.elements.name.focus();
    form.elements.name.select();
  };

  /* ---------- Delete a subject or chapter (type "delete" to confirm) ---------- */

  MW.structureDeleteDialog = function (sid, cid) {
    var sub = MW.subject(sid);
    var ch = cid ? MW.chapter(sid, cid) : null;
    if (!sub || (cid && !ch)) return;
    var pages = MW.struct.pagesIn(sid, cid);
    var targets = [];
    MW.subjects().forEach(function (s) {
      if (s.id === sid && !cid) return;
      s.chapters.forEach(function (c) {
        if (s.id === sid && c.id === cid) return;
        targets.push({ value: s.id + "|" + c.id, label: s.title + " › " + c.title });
      });
    });
    var fileBacked = pages.some(function (p) { return p.origin === "file" || p.overridden; });
    var canDelete = !fileBacked || MW.server.available;
    var kind = cid ? "chapter" : "subject";
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<form class="dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sd-title">' +
      '<h2 id="sd-title">Delete this ' + kind + "?</h2>" +
      '<p class="del-name">' + MW.esc(cid ? sub.title + " › " + ch.title : sub.title) + "</p>" +
      (pages.length
        ? '<p class="dialog-hint">It holds ' + pages.length + (pages.length === 1 ? " article" : " articles") + ". Choose what happens to them.</p>" +
          '<div class="del-choices">' +
          (targets.length ? '<label class="del-choice"><input type="radio" name="mode" value="move" checked><span>Move them to <select name="to">' + targets.map(function (t) { return '<option value="' + t.value + '">' + MW.esc(t.label) + "</option>"; }).join("") + "</select></span></label>" : "") +
          '<label class="del-choice"><input type="radio" name="mode" value="delete"' + (targets.length ? "" : " checked") + (canDelete ? "" : " disabled") + "><span>Delete them too" +
          (canDelete ? "" : " (needs npm start, their files are in content/)") + "</span></label></div>"
        : '<p class="dialog-hint">It is empty, so nothing else is affected.</p>') +
      '<label><span>Type <b>delete</b> to confirm</span><input name="confirm" autocomplete="off" spellcheck="false" placeholder="delete"></label>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn btn-danger" disabled>Delete ' + kind + "</button></div></form>";
    document.body.appendChild(wrap);
    var form = wrap.querySelector("form");
    var input = form.elements.confirm;
    var go = form.querySelector("[type=submit]");
    input.addEventListener("input", function () { go.disabled = input.value.trim().toLowerCase() !== "delete"; });
    function close() { wrap.remove(); if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); }
    form.querySelector("[data-cancel]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (go.disabled) return;
      go.disabled = true;
      go.textContent = "Deleting…";
      var mode = pages.length ? form.elements.mode.value : "delete";
      var opts = mode === "move" ? { move: { subject: form.elements.to.value.split("|")[0], chapter: form.elements.to.value.split("|")[1] } } : { deletePages: true };
      var here = new URLSearchParams(location.search).get("a");
      var hereDeleted = mode === "delete" && pages.some(function (p) { return p.id === here; });
      MW.struct.remove(sid, cid, opts).then(function () {
        close();
        if (hereDeleted) location.href = "index.html";
        else MW.toast("Deleted the " + kind + ".");
      }, function () { close(); MW.toast("Could not finish deleting. Some files may remain."); });
    });
    input.focus();
  };

  /* ---------- Settings ---------- */

  function ago(ts) {
    if (!ts) return "never";
    var days = Math.floor((Date.now() - ts) / 86400000);
    return days < 1 ? "today" : days === 1 ? "yesterday" : days + " days ago";
  }

  MW.settingsDialog = function () {
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    var sum = MW.images.summary();
    var hasKey = MW.images.hasKey();
    var pages = Object.keys(MW.store.get("medwiki:pages", {})).length;
    wrap.innerHTML =
      '<div class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="st-title">' +
      '<h2 id="st-title">Settings</h2>' +
      '<div class="set-list">' +
      '<div class="set-row"><div><strong>Image hosting</strong><small>' + (hasKey ? "ImgBB key saved" : "No ImgBB key yet") +
      (sum.waiting || sum.failed ? " · " + (sum.waiting + sum.failed) + " waiting" : "") + '</small></div><button type="button" class="btn" data-images>' + (hasKey ? "Manage" : "Set up") + "</button></div>" +
      '<div class="set-row"><div><strong>Study blocks</strong><small>Your block types, their labels and colours</small></div><button type="button" class="btn" data-blocks>Customise</button></div>' +
      '<div class="set-row"><div><strong>Print or save as PDF</strong><small>One article or a whole set, journal layout</small></div><button type="button" class="btn" data-print>Print…</button></div>' +
      '<div class="set-row"><div><strong>Backup</strong><small>' + (MW.server.available ? "Saved straight to your files while the server runs." : pages + (pages === 1 ? " page" : " pages") + " stored in this browser · last backup " + ago(MW.store.get("medwiki:lastBackup", 0))) +
      '</small></div><span class="set-btns"><button type="button" class="btn" data-export>Export</button><button type="button" class="btn" data-import>Import</button></span></div>' +
      "</div>" +
      '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div></div>';
    document.body.appendChild(wrap);

    function close() { wrap.remove(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    function open(fn) { return function () { close(); fn(); }; }
    wrap.querySelector("[data-images]").addEventListener("click", open(function () { MW.images.settingsDialog(); }));
    wrap.querySelector("[data-blocks]").addEventListener("click", open(function () { MW.blockTypesDialog(); }));
    wrap.querySelector("[data-print]").addEventListener("click", open(function () {
      var cur = MW.currentPage();
      MW.printDialog({ preselect: cur ? [cur.id] : [] });
    }));
    wrap.querySelector("[data-export]").addEventListener("click", function () { MW.exportBackup(); close(); });
    wrap.querySelector("[data-import]").addEventListener("click", function () { MW.importBackup(); });
    wrap.querySelector("[data-close]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    wrap.querySelector("[data-close]").focus();
  };

  /* ---------- Keyboard shortcuts ---------- */

  MW.shortcutsDialog = function () {
    var rows = [
      ["Ctrl / Cmd + K", "Search, jump to a chapter, run a command"],
      ["/", "Open the palette (when not typing)"],
      ["E", "Edit the current article"],
      ["P", "Print the current article (journal layout)"],
      ["R", "Toggle revision mode"],
      ["Ctrl / Cmd + S", "Save while editing"],
      ["/ or ~ (editing)", "Insert a table, image, quote, flowchart or study block: ~image, ~table, ~quote…"],
      ["Ctrl / Cmd + K (editing)", "Link to a page or web address"],
      ["[[ (editing)", "Link to another page"],
      ["## , - , 1. , > then space", "Heading, bulleted list, numbered list, quote"],
      ["Ctrl + B / Ctrl + I", "Bold / italic"],
      ["Ctrl + Shift + H", "Highlight a high-yield fact"],
      ["Tab / Shift + Tab", "Next / previous table cell, or indent a list item"],
      ["Esc", "Close a dialog or menu"],
      ["?", "Show this list"],
    ];
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title"><h2 id="sc-title">Keyboard shortcuts</h2>' +
      '<dl class="shortcuts">' + rows.map(function (r) { return "<div><dt><kbd>" + MW.esc(r[0]) + "</kbd></dt><dd>" + MW.esc(r[1]) + "</dd></div>"; }).join("") + "</dl>" +
      '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div></div>';
    document.body.appendChild(wrap);
    function close() { wrap.remove(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    wrap.querySelector("[data-close]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    wrap.querySelector("[data-close]").focus();
  };
})();
