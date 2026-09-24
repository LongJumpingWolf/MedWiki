/*
 * Hover previews for wiki links (like Wikipedia's page previews): the target's
 * opening text, first image, and where it lives. Works on hover and keyboard
 * focus; on touch screens a tap simply follows the link.
 */
(function () {
  var MW = window.MedWiki;
  var card, showTimer, hideTimer, current;

  /* First useful sentence-ish text: prefer a definition/summary block, else the first paragraph. */
  function excerpt(page) {
    var lines = page.body.split("\n");
    var text = "";
    for (var i = 0; i < lines.length && !text; i++) {
      if (/^:::\s*(definition|summary)\b/i.test(lines[i])) {
        for (var j = i + 1; j < lines.length && !/^:::\s*$/.test(lines[j]); j++) {
          var l = lines[j].trim();
          if (l && !/^:::/.test(l) && !/->|→/.test(l)) { text = l; break; }
        }
      }
    }
    if (!text) {
      var inCode = false;
      for (var k = 0; k < lines.length; k++) {
        var t = lines[k].trim();
        if (/^```/.test(t)) inCode = !inCode;
        if (inCode || !t) continue;
        if (/^(#|:::|\||[-*+>]\s|\d+[.)]\s|!\[)/.test(t)) continue;
        text = t;
        break;
      }
    }
    if (text.length > 340) text = text.slice(0, 340).replace(/\s+\S*$/, "") + "…";
    /* Keep bold/italic/highlight but drop nested links. */
    return MW.md.inline(text).replace(/<a\b[^>]*>(.*?)<\/a>/g, "$1").replace(/<span class="bite[^"]*"[^>]*>(.*?)<\/span>/g, "$1");
  }

  function firstImage(page) {
    var m = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(page.body);
    if (!m) return "";
    var img = /^img:([a-z0-9]+)$/.exec(m[1]);
    if (img) return MW.images.get(img[1]) || "";
    return /^(https?:|data:image\/)/i.test(m[1]) ? m[1] : "";
  }

  function crumb(page) {
    var s = MW.subject(page.subject);
    var c = MW.chapter(page.subject, page.chapter);
    return [s && s.title, c && c.title].filter(Boolean).join(" › ");
  }

  function ensureCard() {
    if (card) return card;
    card = document.createElement("div");
    card.className = "page-preview";
    card.setAttribute("role", "tooltip");
    card.hidden = true;
    card.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
    card.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(card);
    return card;
  }

  function content(link) {
    if (link.classList.contains("missing")) {
      return '<div class="pp-body"><p class="pp-missing">“' + MW.esc(link.getAttribute("data-create")) +
        "” does not exist yet.</p></div><div class=\"pp-foot\">Click to create this page</div>";
    }
    var m = /[?&]a=([^&#]+)/.exec(link.getAttribute("href") || "");
    var page = m && MW.page(decodeURIComponent(m[1]));
    if (!page) return "";
    var img = firstImage(page);
    var text = excerpt(page);
    return (img ? '<img class="pp-image" src="' + MW.esc(img) + '" alt="">' : "") +
      '<div class="pp-body"><p class="pp-title">' + MW.esc(page.title) + "</p>" +
      (text ? '<p class="pp-text">' + text + "</p>" : '<p class="pp-missing">This page is empty.</p>') + "</div>" +
      '<div class="pp-foot">' + MW.esc(crumb(page)) + "</div>";
  }

  function place(link, x, y) {
    var rects = [].slice.call(link.getClientRects());
    var r = rects.filter(function (q) { return x >= q.left - 2 && x <= q.right + 2 && y >= q.top - 2 && y <= q.bottom + 2; })[0] || rects[0];
    var w = card.offsetWidth;
    var h = card.offsetHeight;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    var below = r.bottom + 8;
    var top = below + h > window.innerHeight - 12 && r.top - h - 8 > 12 ? r.top - h - 8 : below;
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function show(link, x, y) {
    var html = content(link);
    if (!html) return;
    ensureCard();
    current = link;
    card.innerHTML = html;
    card.hidden = false;
    place(link, x, y);
  }

  function hide() {
    if (card) card.hidden = true;
    current = null;
  }

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 220);
  }

  function linkOf(e) {
    return e.target.closest && e.target.closest(".wikilink");
  }

  document.addEventListener("mouseover", function (e) {
    var link = linkOf(e);
    if (!link || link === current) { if (link) clearTimeout(hideTimer); return; }
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(function () { show(link, e.clientX, e.clientY); }, 280);
  });

  document.addEventListener("mouseout", function (e) {
    if (linkOf(e)) scheduleHide();
  });

  document.addEventListener("focusin", function (e) {
    var link = linkOf(e);
    if (link) show(link, 0, 0);
  });
  document.addEventListener("focusout", function (e) { if (linkOf(e)) scheduleHide(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
  document.addEventListener("scroll", hide, { passive: true, capture: true });
})();
