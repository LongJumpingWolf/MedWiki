/*
 * Quick bites page: every bite in one place. Filter by text or tag, edit or
 * delete, and see which articles use each one. A #id in the address opens
 * the page scrolled to that bite.
 */
(function () {
  var MW = window.MedWiki;
  var state = { q: "", tag: "" };
  var root;

  function matches(b) {
    if (state.tag && (b.tags || []).indexOf(state.tag) === -1) return false;
    if (!state.q.trim()) return true;
    return MW.bites.search(state.q, 500).indexOf(b) !== -1;
  }

  function usageHtml(b) {
    var pages = MW.bites.usage(b);
    if (!pages.length) return '<p class="bt-use">Not used in an article yet. Write <code>{{' + MW.esc(b.term) + "}}</code> in one.</p>";
    var links = pages.slice(0, 5).map(function (p) { return '<a href="' + MW.pageUrl(p.id) + '">' + MW.esc(p.title) + "</a>"; }).join(", ");
    return '<p class="bt-use">Used in ' + links + (pages.length > 5 ? " and " + (pages.length - 5) + " more" : "") + ".</p>";
  }

  function tile(b) {
    var more = b.more && MW.resolve(b.more);
    return '<article class="bite-tile" id="bite-' + MW.esc(b.id) + '">' +
      '<div class="bite-card bite-card-static">' + MW.bites.cardHtml(b, { preview: true }) + "</div>" +
      usageHtml(b) +
      '<div class="bt-foot"><span class="bc-tags">' + (b.tags || []).map(function (t) { return '<button type="button" data-tag="' + MW.esc(t) + '">#' + MW.esc(t) + "</button>"; }).join(" ") + "</span>" +
      '<span class="bc-acts">' + (more ? '<a href="' + MW.pageUrl(more.id) + '">Read more →</a>' : "") +
      '<button type="button" data-edit="' + MW.esc(b.id) + '">Edit</button></span></div></article>';
  }

  function paintList() {
    var rows = MW.bites.list().filter(matches);
    document.getElementById("bt-count").textContent = rows.length + (rows.length === 1 ? " quick bite" : " quick bites");
    var list = document.getElementById("bt-list");
    if (rows.length) list.innerHTML = rows.map(tile).join("");
    else if (MW.bites.list().length) list.innerHTML = '<p class="empty-state">No quick bites match.</p>';
    else list.innerHTML = '<p class="empty-state">No quick bites yet. While writing, select a word and press <code>Alt+B</code>, or type <code>{{</code>, to define it on the spot.</p>';
  }

  function paintTags() {
    var tags = MW.bites.tags();
    document.getElementById("bt-tags").innerHTML = tags.length
      ? '<button type="button" class="chip" data-tag="" aria-pressed="' + (!state.tag) + '">All</button>' +
        tags.map(function (t) { return '<button type="button" class="chip" data-tag="' + MW.esc(t.tag) + '" aria-pressed="' + (state.tag === t.tag) + '">' + MW.esc(t.tag) + " <small>" + t.count + "</small></button>"; }).join("")
      : "";
  }

  function focusHash() {
    var id = decodeURIComponent(location.hash.replace(/^#bite-?/, "").replace(/^#/, ""));
    var el = id && document.getElementById("bite-" + id);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 1800);
  }

  function repaint() { paintTags(); paintList(); }

  /* One bite in full: ?b=<id>. This is where the hover card's "Open full bite" leads. */
  function detail(id) {
    var b = MW.bites.get(id);
    if (!b) {
      root.innerHTML = '<header class="home-hero"><p class="kicker">Quick bite</p><h1>Not found</h1><p>There is no quick bite with that address. <a href="bites.html">See all quick bites</a>.</p></header>';
      return;
    }
    document.title = b.term + " — Quick bites — MedWiki";
    var more = b.more && MW.resolve(b.more);
    var pic = MW.bites.cover(b);
    root.innerHTML =
      '<header class="home-hero"><p class="kicker"><a href="bites.html">Quick bites</a></p><h1>' + MW.esc(b.term) + "</h1>" +
      ((b.aliases || []).length ? "<p>Also called " + MW.esc(b.aliases.join(", ")) + "</p>" : "") + "</header>" +
      '<div class="bite-full">' + (pic ? '<img class="bf-cover" src="' + MW.esc(pic) + '" alt="">' : "") +
      '<div class="prose">' + MW.bites.bodyHtml(b) + "</div>" +
      (b.key ? '<p class="bc-row"><span class="bc-tag">Key</span><span>' + MW.bites.fmt(b.key) + "</span></p>" : "") +
      (b.hook ? '<p class="bc-row bc-hook"><span class="bc-tag">Hook</span><span>' + MW.bites.fmt(b.hook) + "</span></p>" : "") +
      usageHtml(b) +
      '<div class="bt-foot"><span class="bc-tags">' + (b.tags || []).map(function (t) { return '<a href="bites.html">#' + MW.esc(t) + "</a>"; }).join(" ") + "</span>" +
      '<span class="bc-acts">' + (more ? '<a href="' + MW.pageUrl(more.id) + '">Read the article →</a>' : "") +
      '<button type="button" data-edit="' + MW.esc(b.id) + '">Edit</button></span></div></div>';
    root.onclick = function (e) {
      var ed = e.target.closest("[data-edit]");
      if (ed) MW.bites.open({ id: id, onSaved: function () { detail(id); }, onDeleted: function () { location.href = "bites.html"; } });
    };
  }

  function render() {
    root = document.getElementById("bites-root");
    var one = new URLSearchParams(location.search).get("b");
    if (one) return detail(one);
    root.innerHTML =
      '<header class="home-hero"><p class="kicker">Glossary</p><h1>Quick bites</h1>' +
      "<p>Short definitions for words you keep meeting. Link one anywhere with <code>{{term}}</code>, or select a word while writing and press <code>Alt+B</code>. Hover it to get the definition without leaving the page.</p>" +
      '<p><button type="button" class="btn btn-primary" data-new>' + MW.icon("plus", 15) + "<span>New quick bite</span></button></p></header>" +
      '<div class="pyq-filters bt-filters" role="group" aria-label="Filter quick bites"><div id="bt-tags" class="bt-tags"></div>' +
      '<input id="bt-text" type="search" placeholder="Search terms, meanings, tags" aria-label="Search quick bites" autocomplete="off"></div>' +
      '<p class="pyq-count" id="bt-count" aria-live="polite"></p><div id="bt-list" class="bite-grid"></div>';

    root.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tag]");
      if (t) { state.tag = state.tag === t.getAttribute("data-tag") ? "" : t.getAttribute("data-tag"); repaint(); return; }
      var ed = e.target.closest("[data-edit]");
      if (ed) return MW.bites.open({ id: ed.getAttribute("data-edit"), onSaved: repaint, onDeleted: repaint });
      if (e.target.closest("[data-new]")) MW.bites.open({ onSaved: repaint });
    });
    root.querySelector("#bt-text").addEventListener("input", function (e) { state.q = e.target.value; paintList(); });
    repaint();
    focusHash();
  }

  window.addEventListener("hashchange", focusHash);
  document.addEventListener("medwiki:ready", render);
})();
