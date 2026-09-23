/*
 * Full-text search over titles, aliases, abbreviations, tags, headings and
 * body text. Accent/dash-insensitive, every word must match, small typos in
 * titles are tolerated. Searching an alias (e.g. "RPGN") finds its article.
 */
(function () {
  var MW = window.MedWiki;
  var index = null;

  MW.onChange(function (kind) {
    if (!kind) index = null;
  });

  function words(s) {
    return MW.norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  function build() {
    index = MW.pages.map(function (p) {
      var plain = MW.md.plain(p.body);
      return {
        page: p,
        title: MW.norm(p.title),
        titleWords: words(p.title),
        aliases: p.aliases.map(MW.norm),
        aliasWords: [].concat.apply([], p.aliases.map(words)),
        tags: p.tags.map(MW.norm),
        headings: MW.md.headings(p.body).map(function (h) { return { text: h.text, id: h.id, norm: MW.norm(h.text) }; }),
        plain: plain,
        plainNorm: MW.norm(plain),
      };
    });
  }

  /* true when the edit distance between a and b is at most max */
  function within(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      var low = i;
      for (var k = 1; k <= b.length; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
        if (cur[k] < low) low = cur[k];
      }
      if (low > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }

  function snippet(entry, tokens) {
    var at = -1;
    for (var i = 0; i < tokens.length && at < 0; i++) at = entry.plainNorm.indexOf(tokens[i]);
    if (at < 0) return "";
    var start = Math.max(0, at - 45);
    var text = entry.plain.slice(start, at + 110);
    var out = MW.esc(text);
    tokens.forEach(function (t) {
      out = out.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<mark>$1</mark>");
    });
    return (start > 0 ? "…" : "") + out + "…";
  }

  /* → [{ page, score, via, heading, snippet }] best first */
  MW.search = function (query, limit) {
    var q = MW.norm(query).trim();
    if (!q) return [];
    if (!index) build();
    var tokens = words(query);
    if (!tokens.length) return [];
    var results = [];

    index.forEach(function (e) {
      var score = 0;
      var via = "body";
      var heading = null;

      if (e.title === q) { score += 100; via = "title"; }
      else if (e.aliases.indexOf(q) !== -1) { score += 95; via = "alias"; }
      else if (e.title.indexOf(q) === 0) { score += 70; via = "title"; }
      else if (e.aliases.some(function (a) { return a.indexOf(q) === 0; })) { score += 65; via = "alias"; }

      var ok = true;
      var best = 0;
      tokens.forEach(function (t) {
        var s = 0;
        var v = "";
        if (e.title.indexOf(t) !== -1) { s = 10; v = "title"; }
        else if (e.aliases.some(function (a) { return a.indexOf(t) !== -1; })) { s = 9; v = "alias"; }
        else if (e.tags.some(function (g) { return g.indexOf(t) !== -1; })) { s = 6; v = "tag"; }
        else if (e.headings.some(function (h) { return h.norm.indexOf(t) !== -1; })) { s = 5; v = "heading"; }
        else if (e.plainNorm.indexOf(t) !== -1) { s = 1; v = "body"; }
        else if (t.length >= 4 && e.titleWords.concat(e.aliasWords).some(function (w) { return within(t, w, t.length >= 8 ? 2 : 1); })) { s = 3; v = "title"; }
        if (!s) ok = false;
        score += s;
        if (s > best) { best = s; if (score < 60) via = v; }
      });
      if (!ok) return;

      /* Nearest heading that contains all the words. */
      for (var i = 0; i < e.headings.length; i++) {
        if (tokens.every(function (t) { return e.headings[i].norm.indexOf(t) !== -1; })) {
          heading = e.headings[i];
          score += 4;
          if (via === "body") via = "heading";
          break;
        }
      }

      results.push({
        page: e.page,
        score: score,
        via: via,
        heading: heading,
        snippet: via === "body" || via === "heading" ? snippet(e, tokens) : "",
      });
    });

    results.sort(function (a, b) { return b.score - a.score || a.page.title.localeCompare(b.page.title); });
    return results.slice(0, limit || 8);
  };
})();
