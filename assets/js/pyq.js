/*
 * PYQ bank: every ::: pyq block from every article, filterable by type,
 * subject, year and text. Each question links back to its source section.
 */
(function () {
  var MW = window.MedWiki;
  var state = { type: "", subject: "", year: "", q: "" };
  var all = [];

  function options(values, current, allLabel) {
    return '<option value="">' + allLabel + "</option>" + values.map(function (v) {
      return '<option value="' + MW.esc(v.value) + '"' + (v.value === current ? " selected" : "") + ">" + MW.esc(v.label) + "</option>";
    }).join("");
  }

  function years() {
    var seen = {};
    all.forEach(function (r) {
      (r.years.match(/\b(19|20)\d{2}\b/g) || []).forEach(function (y) { seen[y] = true; });
    });
    return Object.keys(seen).sort().reverse();
  }

  function visible() {
    var q = MW.norm(state.q).trim();
    return all.filter(function (r) {
      if (state.type && r.type !== state.type) return false;
      if (state.subject && r.page.subject !== state.subject) return false;
      if (state.year && r.years.indexOf(state.year) === -1) return false;
      if (q && MW.norm(r.html.replace(/<[^>]+>/g, " ") + " " + r.page.title).indexOf(q) === -1) return false;
      return true;
    });
  }

  function paintList() {
    var rows = visible();
    document.getElementById("pyq-count").textContent = rows.length + (rows.length === 1 ? " question" : " questions");
    document.getElementById("pyq-list").innerHTML = rows.length
      ? rows.map(function (r) {
        var s = MW.subject(r.page.subject);
        var hash = r.heading ? r.heading.id : "";
        return '<div class="pyq-row"><span class="pyq-type">' + MW.esc(r.type || "PYQ") + '</span><div class="pyq-q">' + r.html +
          '</div><span class="pyq-year">' + MW.esc(r.years) + "</span>" +
          '<div class="pyq-src">' + MW.esc(s ? s.title + " › " : "") + '<a href="' + MW.pageUrl(r.page.id, hash) + '">' + MW.esc(r.page.title) +
          (r.heading ? " › " + MW.esc(r.heading.text) : "") + "</a></div></div>";
      }).join("")
      : '<p class="empty-state">No questions match these filters. Add one to any article with <code>/pyq</code> in the editor.</p>';
  }

  function render() {
    var root = document.getElementById("pyq-root");
    all = MW.pyqs();
    var types = [];
    all.forEach(function (r) { if (r.type && types.indexOf(r.type) === -1) types.push(r.type); });
    types.sort();
    var subjects = MW.subjects().filter(function (s) { return all.some(function (r) { return r.page.subject === s.id; }); })
      .map(function (s) { return { value: s.id, label: s.title }; });

    root.innerHTML =
      '<header class="home-hero"><p class="kicker">Exam practice</p><h1>PYQ bank</h1>' +
      "<p>Every previous-year question you have written into an article, in one place. Each links back to the section that answers it.</p></header>" +
      '<div class="pyq-filters" role="group" aria-label="Filter questions">' +
      '<button type="button" class="chip" data-type="" aria-pressed="true">All</button>' +
      types.map(function (t) { return '<button type="button" class="chip" data-type="' + MW.esc(t) + '" aria-pressed="false">' + MW.esc(t) + "</button>"; }).join("") +
      '<select id="pyq-subject" aria-label="Subject">' + options(subjects, "", "All subjects") + "</select>" +
      '<select id="pyq-year" aria-label="Year">' + options(years().map(function (y) { return { value: y, label: y }; }), "", "Any year") + "</select>" +
      '<input id="pyq-text" type="search" placeholder="Filter by text or topic" aria-label="Filter by text"></div>' +
      '<p class="pyq-count" id="pyq-count" aria-live="polite"></p><div id="pyq-list"></div>';

    root.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      state.type = chip.getAttribute("data-type");
      root.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
      paintList();
    });
    root.querySelector("#pyq-subject").addEventListener("change", function (e) { state.subject = e.target.value; paintList(); });
    root.querySelector("#pyq-year").addEventListener("change", function (e) { state.year = e.target.value; paintList(); });
    root.querySelector("#pyq-text").addEventListener("input", function (e) { state.q = e.target.value; paintList(); });
    paintList();
  }

  document.addEventListener("medwiki:ready", render);
})();
