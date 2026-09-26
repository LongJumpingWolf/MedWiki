/*
 * Quick bites: tiny one-glance definitions that live apart from the articles.
 *
 * Write {{Term}} (or {{Term|the words you typed}}) anywhere in an article and
 * hover it to get the bite. Every bite has the same fixed shape so the hover
 * card is always scannable:
 *
 *   term       what it is called                     (required)
 *   aliases    abbreviations and other names         (each one resolves too)
 *   means      what it is, written in the full editor (required; any length, images, lists, tables)
 *   key        the one number, cut-off or rule
 *   hook       a mnemonic or picture
 *   image      one picture (img:<key> or a web address); else the first image of the full article
 *   more       title of the full article, if there is one
 *   tags       for filtering on the Quick bites page
 *
 * Bites are stored in content/_bites.js (written by serve.js) or, without the
 * server, in this browser (localStorage "medwiki:bites") until the server runs.
 */
(function () {
  var MW = window.MedWiki;
  var KEY = "medwiki:bites";
  var LIMIT = { term: 60 };
  var BAD_TERM = /[{}|\[\]\\#]/;
  var cache = null;
  var index = null;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function key(s) { return MW.norm(s).replace(/\s+/g, " ").trim(); }
  function csv(s) {
    var seen = {};
    return String(s || "").split(/[,;]/).map(function (x) { return x.trim(); }).filter(function (x) {
      var k = key(x);
      if (!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function all() {
    if (!cache) {
      var local = MW.store.get(KEY, null);
      cache = clone(Array.isArray(local) ? local : Array.isArray(MW.bitesData) ? MW.bitesData : []);
    }
    return cache;
  }

  function idx() {
    if (index) return index;
    index = {};
    all().forEach(function (b) {
      [b.term].concat(b.aliases || []).forEach(function (t) {
        var k = key(t);
        if (k && !(k in index)) index[k] = b;
      });
    });
    return index;
  }

  /* Inline formatting allowed inside a bite: **bold**, *italic*, ==highlight==. Nothing else. */
  function fmt(s) {
    return MW.esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/==(.+?)==/g, "<mark>$1</mark>");
  }

  /* A displayable address for a stored picture (img:<key> refs come from the local image store). */
  function imgSrc(v) {
    var m = /^img:([a-z0-9]+)$/.exec(v || "");
    if (m) {
      var done = MW.images.normalize("(" + v + ")");
      return done !== "(" + v + ")" ? done.slice(1, -1) : MW.images.get(m[1]) || "";
    }
    return /^(https?:|\.{0,2}\/|[\w-]+\/)/i.test(v || "") ? v : "";
  }

  /* The bite's own picture, else the first image in its full article. */
  function pictureOf(b, meansHtml) {
    var own = imgSrc(b.image);
    if (own) return own;
    var inMeans = /<img [^>]*src="([^"]+)"/.exec(meansHtml || "");
    if (inMeans && inMeans[1]) return MW.unesc(inMeans[1]);
    var page = b.more && MW.resolve(b.more);
    var m = page && /!\[[^\]]*\]\(([^)\s]+)\)/.exec(page.body);
    return m ? imgSrc(m[1]) : "";
  }

  function shorten(s, n) {
    s = MW.md.plain(String(s || ""));
    return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s;
  }

  /* ---------- Store ---------- */

  function persist(list) {
    if (!MW.requireWriter()) return Promise.reject(new Error("Not an authorized writer"));
    cache = list;
    index = null;
    var kept = MW.store.set(KEY, list);
    if (!MW.server.available) return Promise.resolve(kept ? "browser" : "failed");
    return MW.api("bites", { bites: list }).then(function () {
      MW.bitesData = list;
      MW.store.remove(KEY);
      return "file";
    }, function () { return kept ? "browser" : "failed"; });
  }

  var bites = (MW.bites = {
    LIMIT: LIMIT,
    csv: csv,
    fmt: fmt,

    list: function () { return all().slice(); },
    get: function (id) { return all().filter(function (b) { return b.id === id; })[0] || null; },

    /* A bite by its term or any alias (case, accent and dash-insensitive). */
    resolve: function (text) { return idx()[key(text)] || null; },

    tags: function () {
      var counts = {};
      all().forEach(function (b) { (b.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
      return Object.keys(counts).sort().map(function (t) { return { tag: t, count: counts[t] }; });
    },

    /* Articles that use this bite, by term or alias. */
    usage: function (b) {
      var re = /\{\{([^{}|\\]+?)(?:\\?\|[^{}]+?)?\}\}/g;
      return MW.pages.filter(function (p) {
        var m;
        re.lastIndex = 0;
        while ((m = re.exec(p.body))) if (bites.resolve(m[1]) === b) return true;
        return false;
      });
    },

    /*
     * What would clash if this term and these aliases were saved.
     *   exact    another bite has this very term (or alias)     → blocks saving
     *   alias    an alias belongs to another bite               → blocks saving
     *   similar  near matches worth a look                      → warning only
     *   article  an article has the same title                  → note only
     */
    conflicts: function (term, aliases, exceptId) {
      var out = { exact: null, alias: null, similar: [], article: null };
      var tk = key(term);
      if (!tk) return out;
      var hit = idx()[tk];
      if (hit && hit.id !== exceptId) out.exact = hit;
      (aliases || []).forEach(function (a) {
        var h = idx()[key(a)];
        if (h && h.id !== exceptId && !out.alias) out.alias = { name: a, bite: h };
      });
      if (tk.length >= 3) {
        all().forEach(function (b) {
          if (b.id === exceptId || (out.exact && out.exact.id === b.id) || out.similar.length >= 3) return;
          var bk = key(b.term);
          var short = Math.min(bk.length, tk.length);
          if (short >= 3 && (bk.indexOf(tk) !== -1 || tk.indexOf(bk) !== -1)) out.similar.push(b);
        });
      }
      out.article = MW.resolve(term);
      return out;
    },

    search: function (query, limit) {
      var tokens = key(query).split(" ").filter(Boolean);
      if (!tokens.length) return [];
      var scored = [];
      all().forEach(function (b) {
        var names = [b.term].concat(b.aliases || []).map(key);
        var hay = key([b.term, (b.aliases || []).join(" "), b.means, b.key, b.hook, (b.tags || []).join(" ")].join(" "));
        if (!tokens.every(function (t) { return hay.indexOf(t) !== -1; })) return;
        var q = tokens.join(" ");
        var s = 1;
        if (names.indexOf(q) !== -1) s = 100;
        else if (names.some(function (n) { return n.indexOf(q) === 0; })) s = 60;
        else if (names.some(function (n) { return n.indexOf(q) !== -1; })) s = 30;
        scored.push({ b: b, s: s });
      });
      scored.sort(function (a, c) { return c.s - a.s || a.b.term.localeCompare(c.b.term); });
      return scored.slice(0, limit || 8).map(function (x) { return x.b; });
    },

    /* data: { id?, term, aliases, means, key, hook, more, tags }. Resolves { bite, where: "file" | "browser" | "failed" }. */
    save: function (data) {
      var list = clone(all());
      var old = data.id && list.filter(function (b) { return b.id === data.id; })[0];
      var b = {
        id: old ? old.id : "",
        term: data.term.trim(),
        aliases: csv((data.aliases || []).join(",")),
        means: data.means.trim(),
        key: (data.key || "").trim(),
        hook: (data.hook || "").trim(),
        more: (data.more || "").trim(),
        image: MW.images.normalize("(" + (data.image || "").trim() + ")").slice(1, -1),
        tags: csv((data.tags || []).join(",")),
        edited: MW.today(),
      };
      /* renaming keeps the old name as an alias, so links already written in articles still work */
      if (old && key(old.term) !== key(b.term)) b.aliases.push(old.term);
      b.aliases = b.aliases.filter(function (a) { return key(a) !== key(b.term); });
      if (!b.id) {
        var taken = list.map(function (x) { return x.id; });
        var base = MW.slug(b.term);
        var id = base;
        var n = 2;
        while (taken.indexOf(id) !== -1) id = base + "-" + n++;
        b.id = id;
        list.push(b);
      } else list[list.indexOf(old)] = b;
      list.sort(function (a, c) { return a.term.localeCompare(c.term); });
      return persist(list).then(function (where) { return { bite: b, where: where }; });
    },

    remove: function (id) {
      return persist(clone(all()).filter(function (b) { return b.id !== id; }));
    },

    /* Merge a list from a backup: same id replaces, new ids are added. */
    merge: function (incoming) {
      var list = clone(all());
      incoming.forEach(function (b) {
        var i = list.map(function (x) { return x.id; }).indexOf(b.id);
        if (i === -1) list.push(b); else list[i] = b;
      });
      list.sort(function (a, c) { return a.term.localeCompare(c.term); });
      return persist(list);
    },

    /* Re-mark every {{link}} on the page after bites were added, edited or removed. */
    refreshDom: function (root) {
      (root || document).querySelectorAll(".bite").forEach(function (el) {
        el.classList.toggle("missing", !bites.resolve(el.getAttribute("data-bite") || ""));
      });
    },

    /* The hover card body. opts.preview leaves out the footer (used inside the editor window). */
    /* The cover picture: its own, else the first in the description, else in the full article. */
    cover: function (b) { return pictureOf(b, ""); },

    /* The whole description, rendered like an article. */
    bodyHtml: function (b) { return MW.md.render(b.means || "").html; },

    cardHtml: function (b, opts) {
      var more = b.more && MW.resolve(b.more);
      var foot = "";
      var full = MW.md.render(b.means || "").html;
      /* the card shows the text; the first picture goes on top, other figures and nested bite links are left out */
      var text = full.replace(/<figure[\s\S]*?<\/figure>/g, "").replace(/<span class="bite[^"]*"[^>]*>(.*?)<\/span>/g, "$1").replace(/<a class="h-anchor"[^>]*>.*?<\/a>/g, "");
      if (!opts || !opts.preview) {
        foot = '<div class="bc-foot"><span class="bc-tags">' + (b.tags || []).map(function (t) { return "#" + MW.esc(t); }).join(" ") + '</span><span class="bc-acts">' +
          '<a class="bc-open" href="bites.html?b=' + encodeURIComponent(b.id) + '" target="_blank" rel="noopener">Open full bite ↗</a>' +
          (more ? '<a href="' + MW.pageUrl(more.id) + '" target="_blank" rel="noopener">Article →</a>' : "") +
          '<button type="button" data-bite-edit="' + MW.esc(b.id) + '">Edit</button></span></div>';
      }
      var pic = pictureOf(b, full);
      return (pic ? '<img class="bc-image" src="' + MW.esc(pic) + '" alt="">' : "") +
        '<div class="bc-head"><span class="bc-term">' + MW.esc(b.term) + "</span>" +
        ((b.aliases || []).length ? '<span class="bc-aka">also ' + MW.esc(b.aliases.join(", ")) + "</span>" : "") + "</div>" +
        '<div class="bc-body">' + (text || '<p class="bc-none">What it means…</p>') + "</div>" +
        (b.key ? '<p class="bc-row"><span class="bc-tag">Key</span><span>' + fmt(b.key) + "</span></p>" : "") +
        (b.hook ? '<p class="bc-row bc-hook"><span class="bc-tag">Hook</span><span>' + fmt(b.hook) + "</span></p>" : "") + foot;
    },

    shorten: shorten,
    open: function (opts) { if (MW.requireWriter()) openDialog(opts || {}); },
  });

  /* ---------- Hover card ---------- */

  var card, showTimer, hideTimer, current;

  function ensureCard() {
    if (card) return card;
    card = document.createElement("div");
    card.className = "bite-card";
    card.setAttribute("role", "tooltip");
    card.hidden = true;
    card.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
    card.addEventListener("mouseleave", scheduleHide);
    card.addEventListener("click", function (e) {
      if (card.getAttribute("data-id") && !e.target.closest("a, button")) { window.open("bites.html?b=" + encodeURIComponent(card.getAttribute("data-id")), "_blank", "noopener"); return; }
      var edit = e.target.closest("[data-bite-edit]");
      var make = e.target.closest("[data-bite-create]");
      if (edit) { hide(); bites.open({ id: edit.getAttribute("data-bite-edit"), onSaved: after, onDeleted: after }); }
      else if (make) { hide(); bites.open({ term: make.getAttribute("data-bite-create"), onSaved: after }); }
    });
    document.body.appendChild(card);
    return card;
  }

  function after() { bites.refreshDom(document); }

  function contentFor(el) {
    var term = el.getAttribute("data-bite") || "";
    var b = bites.resolve(term);
    if (b) return bites.cardHtml(b);
    return '<div class="bc-head"><span class="bc-term">' + MW.esc(term) + '</span></div><p class="bc-means bc-none">Not a quick bite yet.</p>' +
      '<div class="bc-foot"><span></span><span class="bc-acts"><button type="button" data-bite-create="' + MW.esc(term) + '">Write it now</button></span></div>';
  }

  function place(el, x, y) {
    var rects = [].slice.call(el.getClientRects());
    var r = rects.filter(function (q) { return x >= q.left - 2 && x <= q.right + 2 && y >= q.top - 2 && y <= q.bottom + 2; })[0] || rects[0] || el.getBoundingClientRect();
    var w = card.offsetWidth;
    var h = card.offsetHeight;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    var below = r.bottom + 6;
    var top = below + h > window.innerHeight - 12 && r.top - h - 6 > 12 ? r.top - h - 6 : below;
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function show(el, x, y) {
    ensureCard();
    current = el;
    card.innerHTML = contentFor(el);
    var found = bites.resolve(el.getAttribute("data-bite") || "");
    if (found) card.setAttribute("data-id", found.id); else card.removeAttribute("data-id");
    card.hidden = false;
    var body = card.querySelector(".bc-body");
    if (body) body.classList.toggle("is-cut", body.scrollHeight > body.clientHeight + 4);
    place(el, x || 0, y || 0);
  }

  function hide() {
    if (card) card.hidden = true;
    current = null;
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 240);
  }

  function biteOf(e) { return e.target.closest && e.target.closest(".bite"); }
  function editable(el) { return !!el.closest("[contenteditable=true]"); }

  document.addEventListener("mouseover", function (e) {
    var el = biteOf(e);
    if (!el || el === current) { if (el) clearTimeout(hideTimer); return; }
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(function () { show(el, e.clientX, e.clientY); }, 220);
  });
  document.addEventListener("mouseout", function (e) { if (biteOf(e)) scheduleHide(); });
  document.addEventListener("focusin", function (e) { var el = biteOf(e); if (el && !editable(el)) show(el); });
  document.addEventListener("focusout", function (e) { if (biteOf(e)) scheduleHide(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") hide();
    else if (e.key === "Enter" && !editable(e.target) && biteOf(e) && !bites.resolve(biteOf(e).getAttribute("data-bite"))) { e.preventDefault(); biteOf(e).click(); }
  });
  document.addEventListener("scroll", hide, { passive: true, capture: true });

  /* A tap or click: show the card at once (touch has no hover); on a missing bite in a read-only page, offer to write it. */
  document.addEventListener("click", function (e) {
    var el = biteOf(e);
    if (!el) { if (card && !card.hidden && !card.contains(e.target)) hide(); return; }
    if (editable(el)) return;
    e.preventDefault();
    if (!bites.resolve(el.getAttribute("data-bite"))) {
      hide();
      bites.open({ term: el.getAttribute("data-bite"), onSaved: after });
      return;
    }
    clearTimeout(showTimer);
    show(el, e.clientX, e.clientY);
  });

  /* ---------- The window: write or edit a quick bite ---------- */

  function openDialog(opts) {
    var editing = opts.id ? bites.get(opts.id) : null;
    var draft = editing ? clone(editing) : { term: opts.term || "", aliases: [], means: "", key: "", hook: "", more: "", image: "", tags: opts.tags || [] };
    var image = draft.image || "";
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "overlay";
    var articles = MW.pages.map(function (p) { return '<option value="' + MW.esc(p.title) + '">'; }).join("");
    wrap.innerHTML =
      '<form class="dialog bite-dialog" role="dialog" aria-modal="true" aria-labelledby="bd-title">' +
      '<div class="bd-top"><h2 id="bd-title">' + (editing ? "Edit quick bite" : "New quick bite") + '</h2>' +
      '<p class="dialog-hint">One-glance definition. It pops up wherever you link the term with <code>{{' + MW.esc(draft.term || "term") + "}}</code>.</p></div>" +
      '<div class="dialog-row"><label><span>Term</span><input name="term" required maxlength="' + LIMIT.term + '" autocomplete="off" spellcheck="false"></label>' +
      '<label><span>Also called <em>(comma separated)</em></span><input name="aliases" autocomplete="off" spellcheck="false" placeholder="abbreviation, other name"></label></div>' +
      '<div class="bd-warn" role="status" aria-live="polite" hidden></div>' +
      '<div class="bd-means"><span class="bd-lab">What it means <em>(write it like an article: lists, images, tables, links all work)</em></span>' +
      '<div class="bd-tools"></div><div class="prose ve-surface bd-surface"></div></div>' +
      '<div class="dialog-row"><label><span>Key fact</span><input name="key" autocomplete="off" placeholder="The number, cut-off or rule to remember"></label>' +
      '<label><span>Memory hook</span><input name="hook" autocomplete="off" placeholder="Mnemonic or picture"></label></div>' +
      '<div class="dialog-row"><label><span>Full article <em>(optional)</em></span><input name="more" list="bd-articles" autocomplete="off" placeholder="Title of the article"></label>' +
      '<label><span>Tags <em>(comma separated)</em></span><input name="tags" autocomplete="off" placeholder="drug, lab, sign"></label></div>' +
      '<datalist id="bd-articles">' + articles + "</datalist>" +
      '<div class="bd-pic"><span class="bd-pic-box" data-pic></span><span class="bd-pic-text"><strong>Picture</strong> <em>(optional)</em>' +
      '<small>A cover picture for the card. Without one, the card uses the first image in the description, then in the full article.</small>' +
      '<span class="bd-pic-btns"><button type="button" class="btn" data-pick>Choose picture…</button><button type="button" class="btn" data-unpic hidden>Remove</button></span></span></div>' +
      '<div class="bd-tagpick" aria-label="Existing tags"></div>' +
      '<div class="bd-preview"><p class="bd-label">Hover preview</p><div class="bite-card bite-card-static"></div></div>' +
      '<div class="dialog-actions bd-actions"><span class="dialog-actions-left">' +
      (editing ? '<button type="button" class="btn btn-danger" data-del>Delete</button>' : "") + "</span>" +
      '<span class="dialog-actions-left"><button type="button" class="btn" data-cancel>Cancel</button>' +
      '<button type="submit" class="btn btn-primary" data-save>Save quick bite</button></span></div></form>';
    document.body.appendChild(wrap);

    var form = wrap.querySelector("form");
    var el = form.elements;
    var warn = wrap.querySelector(".bd-warn");
    var preview = wrap.querySelector(".bite-card-static");
    var pick = wrap.querySelector(".bd-tagpick");
    var save = wrap.querySelector("[data-save]");
    el.term.value = draft.term;
    el.aliases.value = (draft.aliases || []).join(", ");
    var surface = wrap.querySelector(".bd-surface");
    var ve = MW.visual.attach(surface, { toolbarHost: wrap.querySelector(".bd-tools"), onChange: function () { check(); } });
    ve.load(draft.means || "");
    function meansMd() { return ve.getMarkdown().trim(); }
    el.key.value = draft.key || "";
    el.hook.value = draft.hook || "";
    el.more.value = draft.more || "";
    el.tags.value = (draft.tags || []).join(", ");

    function read() {
      return {
        id: editing ? editing.id : "",
        term: el.term.value.trim(),
        aliases: csv(el.aliases.value),
        means: meansMd(),
        key: el.key.value.trim(),
        hook: el.hook.value.trim(),
        more: el.more.value.trim(),
        image: image,
        tags: csv(el.tags.value),
      };
    }

    function paintTags(d) {
      var have = d.tags.map(key);
      var all = bites.tags().filter(function (t) { return have.indexOf(key(t.tag)) === -1; }).slice(0, 12);
      pick.innerHTML = all.map(function (t) { return '<button type="button" data-tag="' + MW.esc(t.tag) + '">+ ' + MW.esc(t.tag) + "</button>"; }).join("");
    }

    function check() {
      var d = read();
      var c = bites.conflicts(d.term, d.aliases, editing && editing.id);
      var blocked = !d.term || !d.means;
      var msgs = [];
      if (BAD_TERM.test(d.term)) {
        blocked = true;
        msgs.push('<p class="bd-bad">A term can’t contain <code>{ } | [ ] # \\</code></p>');
      }
      if (c.exact) {
        blocked = true;
        msgs.push('<p class="bd-bad">“' + MW.esc(c.exact.term) + '” is already a quick bite: ' + MW.esc(shorten(c.exact.means, 90)) + ' <button type="button" data-open="' + MW.esc(c.exact.id) + '">Edit that one instead</button></p>');
      }
      if (c.alias) {
        blocked = true;
        msgs.push('<p class="bd-bad">“' + MW.esc(c.alias.name) + '” already belongs to “' + MW.esc(c.alias.bite.term) + '”. <button type="button" data-open="' + MW.esc(c.alias.bite.id) + '">Open it</button></p>');
      }
      if (c.similar.length) {
        msgs.push('<p class="bd-soft">Similar: ' + c.similar.map(function (b) { return '<button type="button" data-open="' + MW.esc(b.id) + '">' + MW.esc(b.term) + "</button>"; }).join(" ") + " Same thing? Add this as an alias there instead.</p>");
      }
      if (c.article && !c.exact) {
        msgs.push('<p class="bd-soft">An article called “' + MW.esc(c.article.title) + '” exists too. A bite is separate; you can point to the article below.</p>');
      }
      if (d.more && !MW.resolve(d.more)) msgs.push('<p class="bd-soft">No article called “' + MW.esc(d.more) + '” yet, so “Read more” will not show.</p>');
      warn.innerHTML = msgs.join("");
      warn.hidden = !msgs.length;
      save.disabled = blocked;
      preview.innerHTML = bites.cardHtml({ id: "", term: d.term || "Term", aliases: d.aliases, means: d.means, key: d.key, hook: d.hook, more: d.more, image: d.image, tags: d.tags }, { preview: true });
      var box = wrap.querySelector("[data-pic]");
      var src = imgSrc(image);
      box.innerHTML = src ? '<img src="' + MW.esc(src) + '" alt="">' : MW.icon("image", 22);
      wrap.querySelector("[data-unpic]").hidden = !image;
      paintTags(d);
    }

    form.addEventListener("input", check);

    function addFile(file) {
      if (!file || !/^image\//.test(file.type)) return;
      MW.images.add(file).then(function (ref) { image = ref; check(); }, function (err) { MW.toast(err.message); });
    }
    var picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.addEventListener("change", function () { addFile(picker.files[0]); });
    wrap.querySelector("[data-pick]").addEventListener("click", function () { picker.click(); });
    wrap.querySelector("[data-unpic]").addEventListener("click", function () { image = ""; check(); });
    wrap.addEventListener("paste", function (e) {
      if (e.target.closest(".bd-surface")) return; /* pictures pasted into the description belong to the description */
      var f = [].slice.call((e.clipboardData && e.clipboardData.files) || []).filter(function (x) { return /^image\//.test(x.type); })[0];
      if (f) { e.preventDefault(); addFile(f); }
    });
    wrap.addEventListener("dragover", function (e) { e.preventDefault(); });
    wrap.addEventListener("drop", function (e) {
      if (e.target.closest(".bd-surface")) return;
      e.preventDefault();
      addFile([].slice.call((e.dataTransfer && e.dataTransfer.files) || [])[0]);
    });
    pick.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tag]");
      if (!b) return;
      el.tags.value = csv(el.tags.value + "," + b.getAttribute("data-tag")).join(", ");
      check();
    });
    warn.addEventListener("click", function (e) {
      var b = e.target.closest("[data-open]");
      if (!b) return;
      close(true);
      openDialog({ id: b.getAttribute("data-open"), onSaved: opts.onSaved, onDeleted: opts.onDeleted });
    });

    function close(keepFocus) {
      ve.destroy();
      wrap.remove();
      if (keepFocus !== true && lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    }
    wrap.querySelector("[data-cancel]").addEventListener("click", function () { close(); if (opts.onCancel) opts.onCancel(); });
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) { close(); if (opts.onCancel) opts.onCancel(); } });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); if (opts.onCancel) opts.onCancel(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
      else if (e.key === "Enter" && !e.shiftKey && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "file") {
        /* Enter moves to the next field; the last one moves to Save (Ctrl+Enter saves from anywhere) */
        e.preventDefault();
        var order = [el.term, el.aliases, surface, el.key, el.hook, el.more, el.tags];
        var at = order.indexOf(e.target);
        (order[at + 1] || save).focus();
      }
    });

    var del = wrap.querySelector("[data-del]");
    if (del) del.addEventListener("click", function () {
      var n = bites.usage(editing).length;
      if (!confirm("Delete “" + editing.term + "”?" + (n ? " It is used in " + n + (n === 1 ? " article" : " articles") + "; those links will turn red." : ""))) return;
      bites.remove(editing.id).then(function () {
        close();
        MW.toast("Quick bite deleted.");
        if (opts.onDeleted) opts.onDeleted(editing);
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      check();
      if (save.disabled) return;
      save.disabled = true;
      bites.save(read()).then(function (r) {
        close();
        MW.toast(r.where === "file" ? "Quick bite saved to content/." : r.where === "browser" ? "Quick bite saved (in this browser; run npm start to keep it in your files too)." : "Could not save the quick bite.");
        if (r.where !== "failed" && opts.onSaved) opts.onSaved(r.bite);
      });
    });

    check();
    var first = draft.term ? surface : el.term;
    first.focus();
    if (first === el.term) first.select();
  }

  /* ---------- Palette and sync ---------- */

  MW.palette.register({ label: "New quick bite…", icon: "zap", hint: "Definition", keywords: "define term glossary add write", run: function () { bites.open({}); } });
  MW.palette.register({ label: "Browse quick bites", icon: "zap", hint: "Glossary", keywords: "definitions terms glossary", run: function () { location.href = "bites.html"; } });

  /* Bites written while the server was off are kept in this browser; write them out once it is on. */
  document.addEventListener("medwiki:ready", function () {
    var local = MW.store.get(KEY, null);
    if (MW.server.available && Array.isArray(local)) persist(local);
  });
})();
