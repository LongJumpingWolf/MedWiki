/* Library home: welcome, continue editing, recently written. Also ?tag=<name>. */
(function () {
  var MW = window.MedWiki;

  function link(p) {
    var s = MW.subject(p.subject);
    return '<a href="' + MW.pageUrl(p.id) + '"><span>' + MW.esc(p.title) + "</span><small>" + MW.esc(s ? s.title : "") + "</small></a>";
  }

  function section(id, title, note, body) {
    return '<section class="home-section" id="' + id + '"><h2>' + title + (note ? "<small>" + note + "</small>" : "") + "</h2>" + body + "</section>";
  }

  function list(pages, empty) {
    return pages.length ? '<div class="page-list">' + pages.map(link).join("") + "</div>" : '<p class="empty-state">' + empty + "</p>";
  }

  function render() {
    var el = document.getElementById("home-root");
    var tag = new URLSearchParams(location.search).get("tag");
    var html = "";

    if (tag) {
      var tagged = MW.pages.filter(function (p) { return p.tags.indexOf(tag) !== -1; });
      html += '<header class="home-hero"><p class="kicker">Tag</p><h1>#' + MW.esc(tag) + '</h1><p><a href="index.html">← All articles</a></p></header>';
      html += section("tagged", "Articles", tagged.length + "", list(tagged, "No articles have this tag."));
      el.innerHTML = html;
      return;
    }

    if (new URLSearchParams(location.search).get("tags") === "all") {
      var all = MW.allTags();
      html += '<header class="home-hero"><p class="kicker">Tags</p><h1>All tags</h1><p><a href="index.html">← Home</a></p></header>';
      html += section("tag-index", "Tags", all.length + "", all.length
        ? '<p class="tag-cloud">' + all.map(function (t) {
          return '<a href="index.html?tag=' + encodeURIComponent(t.tag) + '">#' + MW.esc(t.tag) + " <small>" + t.count + "</small></a>";
        }).join("") + "</p>"
        : '<p class="empty-state">No tags yet. Add tags in the article details while editing.</p>');
      el.innerHTML = html;
      return;
    }

    var hour = new Date().getHours();
    var greeting = hour < 5 ? "Late night study" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    if (!MW.pages.length) {
      el.innerHTML =
        '<header class="dash-head"><p class="kicker">Welcome</p><h1>Your textbook is empty</h1>' +
        '<p class="dash-sub">Create your first page and start writing. Add an ImgBB key in Settings (gear icon) to host your images, and shape your study blocks under Ctrl+K → Manage block types.</p>' +
        '<div class="dash-actions"><button class="btn btn-primary" type="button" data-new>' + MW.icon("plus", 16) + "<span>Write the first page</span></button></div></header>";
      el.querySelector("[data-new]").addEventListener("click", function () { MW.newPageDialog({}); });
      return;
    }

    var viewed = MW.recents.list();
    var byEdited = MW.pages.slice().sort(function (a, b) {
      var d = (b.edited || "").localeCompare(a.edited || "");
      if (d) return d;
      var ia = viewed.indexOf(a.id);
      var ib = viewed.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var written = byEdited.filter(function (p) { return p.body.trim(); });
    var latest = written[0] || byEdited[0];
    var recent = byEdited.filter(function (p) { return p !== latest; }).slice(0, 4);

    var localCount = Object.keys(MW.store.get("medwiki:pages", {})).length;
    var lastBackup = MW.store.get("medwiki:lastBackup", 0);
    var needsBackup = !MW.server.available && localCount > 0 && Date.now() - lastBackup > 7 * 86400000 && Date.now() > MW.store.get("medwiki:backupSnooze", 0);

    function meta(p) {
      var s = MW.subject(p.subject);
      var c = s && MW.chapter(p.subject, p.chapter);
      return MW.esc((s ? s.title : "") + (c ? " › " + c.title : ""));
    }

    function recentRow(p) {
      return '<a class="recent-item" href="' + MW.pageUrl(p.id) + '"><span class="t">' + MW.esc(p.title) + "</span>" +
        '<span class="m">' + (p.edited ? MW.fmtDate(p.edited) : "") + "</span></a>";
    }

    html +=
      '<header class="welcome-head"><p class="kicker">' + greeting + "</p><h1>Welcome back.</h1></header>";

    if (needsBackup) {
      html += '<div class="backup-note" role="status"><span>' + (lastBackup ? "It has been " + Math.floor((Date.now() - lastBackup) / 86400000) + " days since your last backup." : "Your " + localCount + (localCount === 1 ? " page lives" : " pages live") + " only in this browser and haven't been backed up.") +
        '</span><span class="backup-actions"><button type="button" class="btn btn-primary" data-backup>Back up now</button><button type="button" class="btn" data-snooze>Later</button></span></div>';
    }

    if (latest) {
      html += '<a class="continue-card" href="' + MW.pageUrl(latest.id) + '">' +
        '<div class="label">Continue editing</div>' +
        '<div class="row"><div><strong>' + MW.esc(latest.title) + "</strong>" +
        '<span>' + meta(latest) + (latest.edited ? " · last edited " + MW.fmtDate(latest.edited) : "") + "</span></div>" +
        '<span class="arrow">' + MW.icon("chevron-right", 16) + "</span></div></a>";
    }

    if (recent.length) {
      html += section("recent", "Recently written", "", '<div class="recent-list">' + recent.map(recentRow).join("") + "</div>");
    }

    el.innerHTML = html;
    var bk = el.querySelector("[data-backup]");
    if (bk) bk.addEventListener("click", function () { MW.exportBackup(); el.querySelector(".backup-note").remove(); });
    var sn = el.querySelector("[data-snooze]");
    if (sn) sn.addEventListener("click", function () { MW.store.set("medwiki:backupSnooze", Date.now() + 3 * 86400000); el.querySelector(".backup-note").remove(); });
    el.querySelectorAll("[data-new]").forEach(function (b) { b.addEventListener("click", function () { MW.newPageDialog({}); }); });
  }

  document.addEventListener("medwiki:ready", render);
})();
