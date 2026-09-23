/*
 * "Help me choose": four small games that pick what to work on next.
 *   Wheel of fortune · Slot machine · Lucky cookie · Pick a chit
 * Candidates are the articles still in progress (all articles if fewer than two).
 * MW.chooseDialog() opens it; Ctrl+K → "Help me choose" does too.
 */
(function () {
  var MW = window.MedWiki;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function crumb(p) {
    var s = MW.subject(p.subject);
    var c = s && MW.chapter(p.subject, p.chapter);
    return (s ? s.title : "") + (c ? " › " + c.title : "");
  }

  MW.chooseDialog = function () {
    var wip = MW.inProgress();
    var pool = wip.length >= 2 ? wip : MW.pages.slice();
    if (!pool.length) return MW.toast("Write an article first, then I can help you choose.");

    var lastId = null;
    var timers = [];
    var current = "wheel";
    var lastFocus = document.activeElement;

    var wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.innerHTML =
      '<div class="dialog choose-dialog" role="dialog" aria-modal="true" aria-labelledby="ch-title">' +
      '<h2 id="ch-title">Help me choose</h2>' +
      '<p class="dialog-hint" id="ch-note"></p>' +
      '<div class="choose-tabs" role="tablist" aria-label="Ways to choose">' +
      '<button type="button" role="tab" data-game="wheel">Wheel</button>' +
      '<button type="button" role="tab" data-game="slots">Slots</button>' +
      '<button type="button" role="tab" data-game="cookie">Cookie</button>' +
      '<button type="button" role="tab" data-game="chits">Chits</button></div>' +
      '<div class="choose-stage" id="ch-stage"></div>' +
      '<div class="choose-result" id="ch-result" hidden></div>' +
      '<div class="dialog-actions" style="justify-content:space-between">' +
      '<button type="button" class="btn" data-surprise>' + MW.icon("shuffle", 15) + "<span>Surprise me</span></button>" +
      '<button type="button" class="btn" data-close>Close</button></div></div>';
    document.body.appendChild(wrap);

    var stage = wrap.querySelector("#ch-stage");
    var resultEl = wrap.querySelector("#ch-result");
    wrap.querySelector("#ch-note").textContent = wip.length >= 2
      ? "Choosing between " + pool.length + " articles still in progress. Let luck decide."
      : "Choosing between all " + pool.length + " articles. Let luck decide.";

    function later(fn, ms) { var t = setTimeout(fn, reduce ? Math.min(ms, 60) : ms); timers.push(t); return t; }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function draw(list) {
      var from = list || pool;
      var options = from.filter(function (p) { return p.id !== lastId; });
      var p = (options.length ? options : from)[Math.floor(Math.random() * (options.length || from.length))];
      lastId = p.id;
      return p;
    }

    function reveal(p, line) {
      resultEl.hidden = false;
      resultEl.innerHTML =
        '<p class="choose-line">' + MW.esc(line) + "</p>" +
        '<a class="choose-pick" href="' + MW.pageUrl(p.id) + '"><strong>' + MW.esc(p.title) + "</strong><small>" + MW.esc(crumb(p)) + "</small></a>" +
        '<div class="choose-result-actions"><a class="btn btn-primary" href="' + MW.pageUrl(p.id) + '">Open it</a>' +
        '<button type="button" class="btn" data-again>Not feeling it, go again</button></div>';
      resultEl.classList.remove("pop");
      void resultEl.offsetWidth;
      resultEl.classList.add("pop");
    }

    /* ---------- Wheel of fortune ---------- */

    function wheel() {
      var slices = shuffle(pool).slice(0, 10);
      var n = slices.length;
      var step = 360 / n;
      var fills = ["#2e63a8", "#5b8fc4", "#1f8f5f", "#3d6f9e", "#4fae86", "#274f86"];
      function pt(a, r) { var rad = a * Math.PI / 180; return [150 + r * Math.sin(rad), 150 - r * Math.cos(rad)]; }
      var svg = "";
      slices.forEach(function (p, i) {
        var a1 = i * step, a2 = (i + 1) * step;
        var s = pt(a1, 140), e = pt(a2, 140);
        var path = n === 1
          ? '<circle cx="150" cy="150" r="140" fill="' + fills[0] + '"/>'
          : '<path d="M150 150 L' + s[0].toFixed(2) + " " + s[1].toFixed(2) + " A140 140 0 " + (step > 180 ? 1 : 0) + " 1 " + e[0].toFixed(2) + " " + e[1].toFixed(2) + ' Z" fill="' + fills[i % fills.length] + '" stroke="#fff" stroke-width="2"/>';
        var mid = a1 + step / 2;
        var flip = mid > 180 && n > 1; // keep labels on the left half upright
        svg += path + '<text x="' + (flip ? 150 - 128 : 150 + 128) + '" y="154" text-anchor="' + (flip ? "start" : "end") + '" transform="rotate(' + (flip ? mid + 90 : mid - 90) + ' 150 150)" class="wheel-label">' + MW.esc(clip(p.title, n > 7 ? 14 : 18)) + "</text>";
      });
      stage.innerHTML =
        '<div class="wheel-wrap"><span class="wheel-pointer" aria-hidden="true"></span>' +
        '<svg class="wheel" viewBox="0 0 300 300" role="img" aria-label="Wheel with ' + n + ' articles"><g class="wheel-rot">' + svg + '</g>' +
        '<circle cx="150" cy="150" r="140" fill="none" stroke="#163669" stroke-width="5"/><circle cx="150" cy="150" r="20" fill="#fff" stroke="#163669" stroke-width="4"/></svg></div>' +
        '<button type="button" class="btn btn-primary choose-go" data-go>Spin the wheel</button>' +
        (pool.length > 10 ? '<p class="choose-foot">10 random picks out of ' + pool.length + "</p>" : "");
      var rot = stage.querySelector(".wheel-rot");
      var btn = stage.querySelector("[data-go]");
      var total = 0;
      var spinning = false;
      function spin() {
        if (spinning) return;
        spinning = true;
        resultEl.hidden = true;
        btn.disabled = true;
        var winner = draw(slices);
        var i = slices.indexOf(winner);
        var center = i * step + step / 2 + (Math.random() - 0.5) * step * 0.7;
        total = Math.ceil(total / 360) * 360 + 360 * 5 + (360 - center);
        rot.style.transition = reduce ? "none" : "transform 4.8s cubic-bezier(0.12, 0.62, 0.08, 1)";
        rot.style.transform = "rotate(" + total + "deg)";
        later(function () {
          spinning = false;
          btn.disabled = false;
          btn.textContent = "Spin again";
          reveal(winner, "The wheel has spoken.");
        }, 4900);
      }
      btn.addEventListener("click", spin);
      return { start: spin };
    }

    /* ---------- Slot machine ---------- */

    function slots() {
      var H = 62;
      stage.innerHTML =
        '<div class="slot-machine"><div class="slot-top">JACKPOT<span class="slot-flash" aria-hidden="true"></span></div>' +
        '<div class="slot-body"><div class="slot-reels">' +
        [0, 1, 2].map(function () { return '<div class="reel"><div class="reel-strip"></div></div>'; }).join("") +
        '</div><button type="button" class="slot-lever" data-go aria-label="Pull the lever"><span class="lever-arm"></span><span class="lever-ball"></span></button></div></div>' +
        '<p class="choose-foot">Pull the lever</p>';
      var reels = [].slice.call(stage.querySelectorAll(".reel-strip"));
      var machine = stage.querySelector(".slot-machine");
      var lever = stage.querySelector(".slot-lever");
      var running = false;

      function fill(strip, winner) {
        var items = [];
        while (items.length < 24) items = items.concat(shuffle(pool));
        items = items.slice(0, 24);
        items.push(winner, winner);
        strip.innerHTML = items.map(function (p) { return '<div class="reel-item" style="height:' + H + 'px"><span>' + MW.esc(clip(p.title, 34)) + "</span></div>"; }).join("");
        return items.length - 2;
      }

      function pull() {
        if (running) return;
        running = true;
        resultEl.hidden = true;
        machine.classList.remove("jackpot");
        lever.classList.add("pulled");
        var winner = draw();
        var done = 0;
        reels.forEach(function (strip, i) {
          var target = fill(strip, winner);
          strip.style.transition = "none";
          strip.style.transform = "translateY(0)";
          void strip.offsetWidth;
          strip.parentNode.classList.add("spinning");
          var dur = reduce ? 0 : 1.6 + i * 0.75;
          strip.style.transition = reduce ? "none" : "transform " + dur + "s cubic-bezier(0.2, 0.75, 0.25, 1)";
          strip.style.transform = "translateY(" + (-target * H) + "px)";
          later(function () {
            strip.parentNode.classList.remove("spinning");
            if (++done === 3) {
              running = false;
              lever.classList.remove("pulled");
              machine.classList.add("jackpot");
              later(function () { reveal(winner, "Jackpot. Three of a kind."); }, 450);
            }
          }, dur * 1000 + 60);
        });
        later(function () { lever.classList.remove("pulled"); }, 500);
      }
      lever.addEventListener("click", pull);
      // show a starting row so the reels are not empty
      var start = draw(); lastId = null;
      reels.forEach(function (strip) { strip.innerHTML = '<div class="reel-item" style="height:' + H + 'px"><span>' + MW.esc(clip(start.title, 34)) + "</span></div>"; });
      return { start: pull };
    }

    /* ---------- Lucky cookie ---------- */

    var FORTUNES = [
      function (t) { return "A calm mind will finish “" + t + "” before the week ends."; },
      function (t) { return "You will soon open “" + t + "”. Do not resist."; },
      function (t) { return "Fortune says: today belongs to “" + t + "”."; },
      function (t) { return "The answer was always “" + t + "”."; },
      function (t) { return "Lucky numbers: " + [4, 17, 23].join(", ") + ". Lucky article: “" + t + "”."; },
      function (t) { return "Those who start “" + t + "” early are remembered fondly by their future selves."; },
    ];

    function cookie() {
      stage.innerHTML =
        '<div class="cookie-stage"><div class="slip" aria-live="polite"><span></span></div>' +
        '<svg class="cookie" viewBox="0 0 220 150" role="img" aria-label="Fortune cookie">' +
        '<defs><linearGradient id="ck" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0c476"/><stop offset="1" stop-color="#c98634"/></linearGradient></defs>' +
        '<g class="half half-l"><path d="M110 30 C58 18 14 50 16 92 C18 126 68 136 110 126 Z" fill="url(#ck)"/><path d="M110 30 C86 44 78 92 110 126" fill="none" stroke="#a96d22" stroke-width="3" stroke-linecap="round" opacity=".55"/></g>' +
        '<g class="half half-r"><path d="M110 30 C162 18 206 50 204 92 C202 126 152 136 110 126 Z" fill="url(#ck)"/><path d="M110 30 C134 44 142 92 110 126" fill="none" stroke="#a96d22" stroke-width="3" stroke-linecap="round" opacity=".55"/></g></svg></div>' +
        '<button type="button" class="btn btn-primary choose-go" data-go>Crack the cookie</button>';
      var box = stage.querySelector(".cookie-stage");
      var slip = stage.querySelector(".slip span");
      var btn = stage.querySelector("[data-go]");
      var cracked = false;
      function crack() {
        if (cracked) return;
        cracked = true;
        resultEl.hidden = true;
        btn.disabled = true;
        var winner = draw();
        slip.textContent = FORTUNES[Math.floor(Math.random() * FORTUNES.length)](winner.title);
        box.classList.add("cracked");
        later(function () { reveal(winner, "Your fortune has been decided."); }, 1300);
      }
      btn.addEventListener("click", crack);
      stage.querySelector(".cookie").addEventListener("click", crack);
      return { start: crack };
    }

    /* ---------- Pick a chit ---------- */

    function chits() {
      var sample = shuffle(pool).slice(0, 8);
      var shown = shuffle(sample);
      stage.innerHTML =
        '<div class="chit-table" role="group" aria-label="Folded chits">' + shown.map(function (p, i) {
          var tilt = (Math.random() * 12 - 6).toFixed(1);
          return '<button type="button" class="chit" data-i="' + i + '" style="--tilt:' + tilt + "deg;--hue:" + [48, 205, 95, 30][i % 4] + '" aria-label="Folded chit ' + (i + 1) + '">' +
            '<span class="chit-face"><i></i></span><span class="chit-open"><b>' + MW.esc(clip(p.title, 40)) + "</b></span></button>";
        }).join("") + "</div>" +
        '<button type="button" class="btn choose-go" data-shake>Shake the bowl</button>' +
        '<p class="choose-foot">' + (pool.length > 8 ? "8 random picks out of " + pool.length + ". " : "") + "Pick any chit.</p>";
      var table = stage.querySelector(".chit-table");
      var picked = false;
      function choose(btn) {
        if (picked) return;
        picked = true;
        resultEl.hidden = true;
        var winner = shown[Number(btn.getAttribute("data-i"))];
        lastId = winner.id;
        [].forEach.call(table.children, function (c) { if (c !== btn) c.classList.add("faded"); });
        btn.classList.add("open");
        later(function () { reveal(winner, "You picked well."); }, 900);
      }
      table.addEventListener("click", function (e) {
        var b = e.target.closest(".chit");
        if (b) choose(b);
      });
      stage.querySelector("[data-shake]").addEventListener("click", function () {
        if (picked) return;
        table.classList.remove("shake");
        void table.offsetWidth;
        table.classList.add("shake");
      });
      return { start: function () { var all = table.querySelectorAll(".chit"); choose(all[Math.floor(Math.random() * all.length)]); } };
    }

    /* ---------- Wiring ---------- */

    var games = { wheel: wheel, slots: slots, cookie: cookie, chits: chits };
    var running = null;

    function show(name) {
      current = name;
      clearTimers();
      resultEl.hidden = true;
      wrap.querySelectorAll(".choose-tabs button").forEach(function (b) {
        var on = b.getAttribute("data-game") === name;
        b.setAttribute("aria-selected", String(on));
        b.classList.toggle("on", on);
      });
      running = games[name]();
    }

    if (pool.length === 1) {
      wrap.querySelector(".choose-tabs").hidden = true;
      wrap.querySelector("[data-surprise]").hidden = true;
      stage.innerHTML = '<p class="choose-foot">Only one article to choose from, so no gambling needed.</p>';
      reveal(pool[0], "It has to be this one.");
      resultEl.querySelector("[data-again]").hidden = true;
    } else {
      wrap.querySelector(".choose-tabs").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-game]");
        if (b) show(b.getAttribute("data-game"));
      });
      wrap.querySelector("[data-surprise]").addEventListener("click", function () {
        var names = Object.keys(games);
        var next = names[Math.floor(Math.random() * names.length)];
        show(next);
        later(function () { running.start(); }, 250);
      });
      resultEl.addEventListener("click", function (e) {
        if (e.target.closest("[data-again]")) show(current);
      });
      show("wheel");
    }

    function close() {
      clearTimers();
      wrap.remove();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    wrap.querySelector("[data-close]").addEventListener("click", close);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  };

  if (MW.palette && MW.palette.register) {
    MW.palette.register({
      label: "Help me choose", icon: "dices", hint: "Wheel, slots, cookie, chits",
      keywords: "random pick decide what to work on next spin gamble lucky",
      run: function () { MW.chooseDialog(); },
    });
  }
})();
