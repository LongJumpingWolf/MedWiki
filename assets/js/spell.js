/*
 * Medical spell checker for the visual editor. The browser's own spellcheck is
 * switched off everywhere; this replaces it with a medical dictionary
 * (assets/dict/medical.txt, ~97k terms) on top of a standard English one
 * (assets/dict/en.*, Hunspell en_US, run by assets/vendor/nspell.min.js).
 *
 *   var sc = MW.spell.attach(surface);   sc.rescan();   sc.destroy();
 *
 * Unknown words get a red wavy underline drawn with the CSS Custom Highlight
 * API, so the article DOM (and its Markdown round trip) is never touched.
 * Hover an underlined word to pick a correction. Esc closes the popover and
 * leaves the word as it is. "Add to dictionary" is remembered in this browser.
 */
(function () {
  var MW = window.MedWiki;
  var HL = "mw-spell";
  var USER_KEY = "medwiki:dict";
  var WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g;
  var SKIP = "code, pre, kbd, samp, script, style, [contenteditable='false']";
  var ALPHA = "abcdefghijklmnopqrstuvwxyz";

  /* ---------- Dictionaries (loaded once, shared) ---------- */

  var dict = null; // { med: Set, en: nspell }
  var loading = null;
  var user = new Set();
  try {
    (JSON.parse(localStorage.getItem(USER_KEY)) || []).forEach(function (w) { user.add(String(w).toLowerCase()); });
  } catch (e) {}

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      if (window.nspell) return ok();
      var s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  function text(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url);
      return r.text();
    });
  }

  function load() {
    if (!loading) {
      loading = Promise.all([
        loadScript("assets/vendor/nspell.min.js"),
        text("assets/dict/en.aff"),
        text("assets/dict/en.dic"),
        text("assets/dict/medical.txt"),
      ]).then(function (r) {
        dict = { en: window.nspell(r[1], r[2]), med: new Set(r[3].split("\n")) };
        return dict;
      });
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  var verdicts = new Map();

  function known(lower) {
    return dict.med.has(lower) || user.has(lower) || dict.en.correct(lower);
  }

  function plainOk(word) {
    var lower = word.toLowerCase().replace(/’/g, "'");
    if (known(lower) || dict.en.correct(word)) return true;
    if (/'s$/.test(lower) && known(lower.slice(0, -2))) return true;
    return false;
  }

  /* True when the token should carry no underline. */
  function isOk(token) {
    if (token.length < 3) return true;
    if (/[A-Z]/.test(token.slice(1))) return true; // pH, mRNA, ALL CAPS acronyms
    var cached = verdicts.get(token);
    if (cached !== undefined) return cached;
    var ok;
    if (token.indexOf("-") < 0) ok = plainOk(token);
    else ok = dict.med.has(token.toLowerCase()) || token.split("-").every(function (p) { return p.length < 3 || plainOk(p); });
    verdicts.set(token, ok);
    return ok;
  }

  /* ---------- Suggestions ---------- */

  function distance(a, b) {
    var i, j, d = [];
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  function edits1(w) {
    var out = [], i, k;
    for (i = 0; i <= w.length; i++) {
      var l = w.slice(0, i), r = w.slice(i);
      if (r) out.push(l + r.slice(1));
      if (r.length > 1) out.push(l + r[1] + r[0] + r.slice(2));
      for (k = 0; k < 26; k++) {
        if (r) out.push(l + ALPHA[k] + r.slice(1));
        out.push(l + ALPHA[k] + r);
      }
    }
    return out;
  }

  function suggest(token) {
    var lower = token.toLowerCase().replace(/’/g, "'");
    var found = new Map();
    function add(w) {
      if (w === lower || found.has(w) || !/^[a-z][a-z'-]*$/i.test(w)) return;
      found.set(w, distance(lower, w.toLowerCase()));
    }
    edits1(lower).forEach(function (w) { if (known(w)) add(w); });
    if (found.size < 5 && lower.length > 3 && lower.length < 14) {
      edits1(lower).forEach(function (w) {
        edits1(w).forEach(function (x) { if (dict.med.has(x) || dict.en.correct(x)) add(x); });
      });
    }
    try { dict.en.suggest(token).slice(0, 4).forEach(add); } catch (e) {}
    var list = [];
    found.forEach(function (d, w) { list.push({ w: w, d: d, same: w[0] === lower[0] ? 0 : 1, med: dict.med.has(w) ? 0 : 1 }); });
    list.sort(function (a, b) { return a.d - b.d || a.same - b.same || a.med - b.med || a.w.length - b.w.length; });
    var cap = token[0] !== token[0].toLowerCase();
    return list.slice(0, 5).map(function (s) { return cap ? s.w[0].toUpperCase() + s.w.slice(1) : s.w; });
  }

  /* ---------- Attach to an editing surface ---------- */

  function attach(surface) {
    var spelt = []; // { node, start, end, word }
    var timer = 0, hoverTimer = 0, hideTimer = 0, raf = 0;
    var pop = null, popHit = null, dismissed = null, active = -1;
    var cleanups = [];
    var dead = false;
    var canPaint = !!(window.CSS && CSS.highlights && window.Highlight);

    function on(target, type, fn, o) {
      target.addEventListener(type, fn, o);
      cleanups.push(function () { target.removeEventListener(type, fn, o); });
    }

    /* Finds the misspellings and paints them. The word being typed is left alone. */
    function scan() {
      if (dead || !dict) return;
      var caret = null;
      var sel = window.getSelection();
      if (sel.rangeCount && sel.isCollapsed && surface.contains(sel.anchorNode) && document.activeElement === surface) {
        caret = { node: sel.anchorNode, off: sel.anchorOffset };
      }
      var found = [];
      var walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          return n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      var n;
      while ((n = walker.nextNode())) {
        var s = n.nodeValue, m;
        WORD.lastIndex = 0;
        while ((m = WORD.exec(s))) {
          var start = m.index, end = start + m[0].length;
          var before = s[start - 1], after = s[end];
          if (before && /[\d/@._#\\]/.test(before)) continue;
          if (after && /[\d@_]/.test(after)) continue;
          if (isOk(m[0])) continue;
          if (caret && caret.node === n && caret.off >= start && caret.off <= end) continue;
          found.push({ node: n, start: start, end: end, word: m[0] });
        }
      }
      spelt = found;
      if (!canPaint) return;
      var ranges = found.map(function (f) {
        var r = document.createRange();
        r.setStart(f.node, f.start);
        r.setEnd(f.node, f.end);
        return r;
      });
      CSS.highlights.set(HL, new Highlight(...ranges));
    }

    function schedule(ms) {
      clearTimeout(timer);
      timer = setTimeout(scan, ms);
    }

    /* ---------- Hover popover ---------- */

    function hitAt(x, y) {
      var node, off;
      if (document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (p) { node = p.offsetNode; off = p.offset; }
      } else if (document.caretRangeFromPoint) {
        var cr = document.caretRangeFromPoint(x, y);
        if (cr) { node = cr.startContainer; off = cr.startOffset; }
      }
      if (!node || node.nodeType !== 3) return null;
      for (var i = 0; i < spelt.length; i++) {
        var f = spelt[i];
        if (f.node !== node || off < f.start || off > f.end) continue;
        var r = document.createRange();
        r.setStart(f.node, f.start);
        r.setEnd(f.node, f.end);
        var rects = r.getClientRects();
        for (var k = 0; k < rects.length; k++) {
          var q = rects[k];
          if (x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 2 && y <= q.bottom + 2) return { f: f, rect: q };
        }
      }
      return null;
    }

    function closePop() {
      clearTimeout(hoverTimer);
      clearTimeout(hideTimer);
      if (pop) { pop.remove(); pop = null; }
      popHit = null;
      active = -1;
    }

    function sameWord(a, b) {
      return a && b && a.node === b.node && a.start === b.start && a.end === b.end;
    }

    function replace(f, value) {
      closePop();
      var r = document.createRange();
      try {
        r.setStart(f.node, f.start);
        r.setEnd(f.node, f.end);
      } catch (e) { return; }
      surface.focus({ preventScroll: true });
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand("insertText", false, value);
    }

    function addToDictionary(f) {
      closePop();
      var lower = f.word.toLowerCase();
      user.add(lower);
      verdicts.clear();
      try { localStorage.setItem(USER_KEY, JSON.stringify(Array.from(user))); } catch (e) {}
      scan();
    }

    function setActive(i) {
      var items = pop ? pop.querySelectorAll("[data-sug]") : [];
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach(function (b, k) { b.classList.toggle("is-active", k === active); });
    }

    function openPop(hit) {
      closePop();
      popHit = hit.f;
      var options = suggest(hit.f.word);
      pop = document.createElement("div");
      pop.className = "spell-pop";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "Spelling suggestions");
      pop.innerHTML =
        '<div class="spell-title">' + (options.length ? "Did you mean" : "No suggestion for") + (options.length ? "" : " “" + esc(hit.f.word) + "”") + "</div>" +
        options.map(function (o, i) { return '<button type="button" class="spell-opt" data-sug="' + i + '">' + esc(o) + "</button>"; }).join("") +
        '<div class="spell-foot"><button type="button" class="spell-add">Add to dictionary</button><small>Esc to ignore</small></div>';
      document.body.appendChild(pop);
      var w = pop.offsetWidth, h = pop.offsetHeight;
      var top = hit.rect.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, hit.rect.top - h - 6);
      pop.style.top = top + "px";
      pop.style.left = Math.max(8, Math.min(hit.rect.left, window.innerWidth - w - 8)) + "px";
      pop.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the caret in the article
      pop.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
      pop.addEventListener("mouseleave", function () { armHide(); });
      pop.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        if (b.classList.contains("spell-add")) addToDictionary(popHit);
        else replace(popHit, options[+b.dataset.sug]);
      });
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    }

    function armHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(closePop, 350);
    }

    on(surface, "mousemove", function (e) {
      if (raf) return;
      var x = e.clientX, y = e.clientY;
      raf = requestAnimationFrame(function () {
        raf = 0;
        if (dead || e.buttons) return;
        var hit = hitAt(x, y);
        if (!hit) {
          clearTimeout(hoverTimer);
          dismissed = null;
          if (pop) armHide();
          return;
        }
        clearTimeout(hideTimer);
        if (sameWord(hit.f, dismissed)) return; // Esc was pressed on this word
        if (pop && sameWord(hit.f, popHit)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () { if (!dead) openPop(hit); }, pop ? 60 : 180);
      });
    });
    on(surface, "mouseleave", function () { clearTimeout(hoverTimer); if (pop) armHide(); });
    on(surface, "mousedown", closePop);
    on(surface, "scroll", closePop);
    on(window, "scroll", closePop, true);
    on(window, "resize", closePop);

    /* Esc ignores; arrows + Enter pick a suggestion without touching the mouse. */
    on(document, "keydown", function (e) {
      if (!pop) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismissed = popHit;
        closePop();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.ctrlKey && !e.metaKey && pop.querySelector("[data-sug]")) {
        e.preventDefault();
        e.stopPropagation();
        setActive(active < 0 ? (e.key === "ArrowDown" ? 0 : -1) : active + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pop.querySelectorAll("[data-sug]")[active].click();
      } else if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
        closePop();
      }
    }, true);

    /* ---------- Keep the underlines current ---------- */

    var mo = new MutationObserver(function () { closePop(); schedule(350); });
    mo.observe(surface, { childList: true, characterData: true, subtree: true });
    on(document, "selectionchange", function () { if (surface.contains(window.getSelection().anchorNode)) schedule(500); });
    on(surface, "blur", function () { schedule(50); });

    load().then(function () { scan(); }).catch(function () {});

    return {
      rescan: function () { schedule(0); },
      destroy: function () {
        dead = true;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        closePop();
        mo.disconnect();
        cleanups.forEach(function (fn) { fn(); });
        if (canPaint) CSS.highlights.delete(HL);
      },
    };
  }

  MW.spell = { attach: attach, load: load, suggest: function (w) { return dict ? suggest(w) : []; }, isOk: function (w) { return !dict || isOk(w); } };
})();
