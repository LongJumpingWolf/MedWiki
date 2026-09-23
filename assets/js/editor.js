/*
 * Editor behaviour for the article textarea:
 *   live styling      → markers dimmed, study blocks tinted, links coloured (a backdrop behind the textarea)
 *   /  at line start  → block menu (table, image, flowchart, study blocks…)
 *   [[                → page suggestions (creates red links for new pages)
 *   select text       → floating toolbar: bold, italic, highlight, link, wrap in a study block
 *   paste / drop an image, Ctrl+B / Ctrl+I, Enter continues lists
 * Attach with MW.editor.attach(textarea). If the textarea sits right after a
 * .editor-backdrop element, that element is used for the live styling.
 */
(function () {
  var MW = window.MedWiki;
  var ZW = "\u200b";

  function block(name, title) {
    return "::: " + name + (title ? " " + title : "") + "\n$|\n:::\n";
  }

  var BASICS = [
    { k: "h2", label: "Heading", hint: "Section heading", t: "## $|" },
    { k: "h3", label: "Subheading", hint: "Smaller heading", t: "### $|" },
    { k: "list", label: "Bulleted list", hint: "- item", t: "- $|" },
    { k: "numbered", label: "Numbered list", hint: "1. item", t: "1. $|" },
    { k: "table", label: "Table", hint: "Rows and columns", t: "| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n| $| | | |\n| | | |\n" },
    { k: "image", label: "Image", hint: "Choose a file (or just paste one)", run: "image" },
    { k: "flowchart", label: "Flowchart", hint: "Step -> Step -> Step", t: "::: flow\nStep 1 -> Step 2 -> Step 3\n:::\n" },
    { k: "highlight", label: "Highlight", hint: "==high-yield text==", t: "==$|==", inline: true },
    { k: "link", label: "Link to page", hint: "[[Page title]]", t: "[[$|]]", inline: true, then: "wiki" },
    { k: "divider", label: "Divider", hint: "Horizontal rule", t: "---\n" },
  ];

  /* Study block entries are user-defined (MW.blockTypes); built fresh each time the menu opens. */
  function studyBlockItems() {
    return MW.blockTypes.list().map(function (bt) {
      return { k: bt.key, label: bt.label, hint: "Study block", t: block(bt.key), color: bt.color };
    }).concat([{ k: "__manage", label: "Manage block types…", hint: "Add, recolour or delete", manage: true }]);
  }

  function slashItems() { return BASICS.concat(studyBlockItems()); }

  /* ---------- Live styling (backdrop) ---------- */

  function toneColor(type) {
    var bt = type && MW.blockTypes.get(type);
    return (bt && bt.color) || "";
  }

  function hlInline(raw) {
    var t = MW.esc(raw);
    t = t.replace(/`([^`]+)`/g, '<span class="cd">`$1`</span>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<span class="mk">**</span><span class="bd">$1</span><span class="mk">**</span>');
    t = t.replace(/==(.+?)==/g, '<span class="mk">==</span><span class="hl">$1</span><span class="mk">==</span>');
    t = t.replace(/\[\[([^\]\n]+?)\]\]/g, function (m, inner) {
      var target = MW.unesc(inner.replace(/<[^>]+>/g, "")).split(/\\?\||#/)[0];
      return '<span class="wl' + (MW.resolve(target) ? "" : " missing") + '">[[' + inner + "]]</span>";
    });
    return t;
  }

  function highlight(text) {
    var stack = [];
    var fence = false;
    return text.split("\n").map(function (line) {
      var cls = "ln";
      var tone = "";
      var inner;
      var m;
      if (/^```/.test(line)) {
        fence = !fence;
        return '<div class="ln cd-line"><span class="mk">' + MW.esc(line) + "</span></div>";
      }
      if (fence) return '<div class="ln cd-line">' + (MW.esc(line) || ZW) + "</div>";

      if ((m = /^(:::)(\s*)([a-z]+)(.*)$/i.exec(line))) {
        var type = m[3].toLowerCase();
        stack.push(type);
        cls += " in ln-open";
        tone = toneColor(type);
        inner = '<span class="mk">:::</span>' + MW.esc(m[2]) + '<span class="ty">' + MW.esc(m[3]) + '</span><span class="ti">' + hlInline(m[4]) + "</span>";
      } else if (/^:::\s*$/.test(line)) {
        cls += " in ln-close";
        tone = toneColor(stack.pop());
        inner = '<span class="mk">' + MW.esc(line) + "</span>";
      } else {
        if (stack.length) { cls += " in"; tone = toneColor(stack[stack.length - 1]); }
        if ((m = /^(#{1,4})(\s+)(.*)$/.exec(line))) {
          inner = '<span class="mk">' + m[1] + "</span>" + MW.esc(m[2]) + '<span class="hd">' + hlInline(m[3]) + "</span>";
        } else if ((m = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line))) {
          inner = MW.esc(m[1]) + '<span class="mk">' + m[2] + "</span>" + MW.esc(m[3]) + hlInline(m[4]);
        } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
          inner = '<span class="mk">' + MW.esc(line) + "</span>";
        } else {
          inner = hlInline(line);
          if (/^\s*\|/.test(line)) inner = inner.replace(/\|/g, '<span class="mk">|</span>');
          if (stack[stack.length - 1] === "flow") inner = inner.replace(/-&gt;/g, '<span class="mk">-&gt;</span>');
        }
      }
      return '<div class="' + cls + '"' + (tone ? ' style="--tone:' + MW.esc(tone) + '"' : "") + '>' + (inner || ZW) + "</div>";
    }).join("");
  }

  /* ---------- Popup menu (slash, wiki links, wrap-in-block) ---------- */

  var menu;

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.className = "slash-menu";
    menu.id = "editor-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    menu.addEventListener("mousedown", function (e) { e.preventDefault(); });
    document.body.appendChild(menu);
    return menu;
  }

  /* Viewport coordinates of text position idx, via a hidden mirror element. */
  function caretXY(ta, idx) {
    var cs = getComputedStyle(ta);
    var mirror = document.createElement("div");
    ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "padding", "borderWidth", "boxSizing", "textIndent"].forEach(function (p) {
      mirror.style[p] = cs[p];
    });
    var r = ta.getBoundingClientRect();
    mirror.style.cssText += ";position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;top:0;left:-9999px;width:" + r.width + "px";
    mirror.textContent = ta.value.slice(0, idx == null ? ta.selectionStart : idx);
    var mark = document.createElement("span");
    mark.textContent = ZW;
    mirror.appendChild(mark);
    document.body.appendChild(mirror);
    var x = mark.offsetLeft;
    var y = mark.offsetTop;
    var lh = parseFloat(cs.lineHeight) || 24;
    mirror.remove();
    return { x: r.left + x, y: r.top + y + lh, lh: lh };
  }

  function insert(ta, from, to, text) {
    ta.focus();
    ta.setSelectionRange(from, to);
    var ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (e) {}
    if (!ok) {
      ta.setRangeText(text, from, to, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function attach(ta) {
    var state = null; // { kind: "slash"|"wiki"|"wrap", from, items, index }
    var prev = ta.previousElementSibling;
    var backdrop = prev && prev.classList.contains("editor-backdrop") ? prev : null;

    ta.setAttribute("aria-autocomplete", "list");
    ta.setAttribute("aria-haspopup", "listbox");
    ta.setAttribute("aria-controls", "editor-menu");
    ta.setAttribute("aria-expanded", "false");

    function paintBackdrop() {
      if (backdrop) backdrop.innerHTML = highlight(ta.value);
    }

    /* ---------- Autosize ---------- */
    function fit() {
      var y = window.scrollY;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + 2 + "px";
      window.scrollTo({ top: y, behavior: "instant" });
    }
    window.addEventListener("resize", fit);
    paintBackdrop();
    requestAnimationFrame(fit);

    /* ---------- Menu ---------- */
    function closeMenu() {
      state = null;
      ta.setAttribute("aria-expanded", "false");
      ta.removeAttribute("aria-activedescendant");
      if (menu) menu.hidden = true;
    }

    function paintMenu(anchorIdx) {
      var m = ensureMenu();
      if (!state || !state.items.length) return closeMenu();
      m.innerHTML = state.items.map(function (it, i) {
        var swatch = it.color ? '<i class="swatch" style="background:' + MW.esc(it.color) + '"></i>' : "";
        return '<button type="button" role="option" id="em-' + i + '" aria-selected="' + (i === state.index) + '" class="slash-item' + (i === state.index ? " is-selected" : "") + '" data-i="' + i + '">' +
          swatch + "<strong>" + MW.esc(it.label) + "</strong><small>" + MW.esc(it.hint || "") + "</small></button>";
      }).join("");
      m.hidden = false;
      ta.setAttribute("aria-expanded", "true");
      ta.setAttribute("aria-activedescendant", "em-" + state.index);
      var p = caretXY(ta, anchorIdx);
      /* Keep the caret clear of the top bar and the floating dock. */
      if (p.y > window.innerHeight - 100 || p.y < 110) {
        window.scrollBy({ top: p.y - window.innerHeight * 0.45, behavior: "instant" });
        p = caretXY(ta, anchorIdx);
      }
      var h = m.offsetHeight;
      var top = p.y + 6;
      if (top + h > window.innerHeight - 12) top = Math.max(12, p.y - h - 30);
      m.style.top = top + "px";
      m.style.left = Math.max(12, Math.min(p.x, window.innerWidth - m.offsetWidth - 12)) + "px";
      var sel = m.querySelector(".is-selected");
      if (sel) sel.scrollIntoView({ block: "nearest" });
    }

    function detect() {
      if (ta.selectionStart !== ta.selectionEnd) return closeMenu();
      var caret = ta.selectionStart;
      var lineStart = ta.value.lastIndexOf("\n", caret - 1) + 1;
      var line = ta.value.slice(lineStart, caret);

      var w = /\[\[([^\]\n|#]*)$/.exec(line);
      if (w) {
        var q = w[1];
        var nq = MW.norm(q).trim();
        var pages = MW.pages
          .filter(function (p) {
            return !nq || [p.title].concat(p.aliases).some(function (t) { return MW.norm(t).indexOf(nq) !== -1; });
          })
          .sort(function (a, b) {
            return (MW.norm(a.title).indexOf(nq) === 0 ? 0 : 1) - (MW.norm(b.title).indexOf(nq) === 0 ? 0 : 1);
          })
          .slice(0, 7)
          .map(function (p) {
            var s = MW.subject(p.subject);
            return { label: p.title, hint: s ? s.title : "", insert: p.title };
          });
        if (q.trim() && !MW.resolve(q)) pages.push({ label: "Create “" + q.trim() + "”", hint: "New page", insert: q.trim() });
        state = { kind: "wiki", from: lineStart + w.index, items: pages, index: 0 };
        return paintMenu();
      }

      var s = /^([ \t]*)[\/~]([a-z0-9-]*)$/i.exec(line);
      if (s) {
        var key = s[2].toLowerCase();
        var items = slashItems().filter(function (it) { return !key || it.k.indexOf(key) !== -1 || MW.norm(it.label).indexOf(key) !== -1; });
        state = { kind: "slash", from: lineStart, items: items, index: 0 };
        return paintMenu();
      }
      closeMenu();
    }

    function wrapBlock(type) {
      var a = ta.selectionStart;
      var b = ta.selectionEnd;
      var ls = ta.value.lastIndexOf("\n", a - 1) + 1;
      var le = ta.value.indexOf("\n", b);
      if (le < 0) le = ta.value.length;
      var before = ta.value.slice(0, ls);
      var prefix = before && !/\n\n$/.test(before) ? "\n" : "";
      insert(ta, ls, le, prefix + "::: " + type + "\n" + ta.value.slice(ls, le) + "\n:::\n");
    }

    function accept(i) {
      var it = state && state.items[i];
      if (!it) return;
      var st = state;
      var caret = ta.selectionStart;
      closeMenu();

      if (it.manage) { MW.blockTypesDialog(); return; }

      if (st.kind === "wrap") {
        wrapBlock(it.k);
        return;
      }

      if (st.kind === "wiki") {
        var to = ta.value.slice(caret, caret + 2) === "]]" ? caret + 2 : caret;
        insert(ta, st.from, to, "[[" + it.insert + "]]");
        return;
      }

      if (it.run === "image") {
        insert(ta, st.from, caret, "");
        pickImage();
        return;
      }

      var before = ta.value.slice(0, st.from);
      var prefix = !it.inline && before && !/\n\n$/.test(before) ? "\n" : "";
      var marker = it.t.indexOf("$|");
      var text = it.t.replace("$|", "");
      insert(ta, st.from, caret, prefix + text);
      var pos = st.from + prefix.length + (marker < 0 ? text.length : marker);
      ta.setSelectionRange(pos, pos);
      if (it.then === "wiki") detect();
    }

    ensureMenu().addEventListener("click", function (e) {
      var b = e.target.closest(".slash-item");
      if (b && state) accept(Number(b.getAttribute("data-i")));
    });

    /* ---------- Selection toolbar ---------- */
    var bar = document.createElement("div");
    bar.className = "sel-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Format selection");
    bar.hidden = true;
    bar.innerHTML =
      '<button type="button" data-act="bold" title="Bold (Ctrl+B)"><b>B</b></button>' +
      '<button type="button" data-act="italic" title="Italic (Ctrl+I)"><i>I</i></button>' +
      '<button type="button" data-act="highlight" title="Highlight as high-yield"><span class="sb-hl">Hi</span></button>' +
      '<button type="button" data-act="link" title="Link to a page">[[ ]]</button>' +
      '<button type="button" data-act="block" title="Wrap in a study block">Block ▾</button>';
    bar.addEventListener("mousedown", function (e) { e.preventDefault(); });
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "bold") wrap("**", "**");
      else if (act === "italic") wrap("*", "*");
      else if (act === "highlight") wrap("==", "==");
      else if (act === "link") wrap("[[", "]]");
      else if (act === "block") {
        var anchor = ta.selectionStart;
        state = { kind: "wrap", from: anchor, items: studyBlockItems(), index: 0 };
        hideBar();
        paintMenu(anchor);
        return;
      }
      hideBar();
    });
    document.body.appendChild(bar);

    function hideBar() { bar.hidden = true; }

    function updateBar() {
      var a = ta.selectionStart;
      var b = ta.selectionEnd;
      if (a === b || b - a > 3000 || (state && state.kind !== "wrap") || document.activeElement !== ta) return hideBar();
      var p = caretXY(ta, a);
      bar.hidden = false;
      var top = p.y - p.lh - bar.offsetHeight - 8;
      if (top < 76) top = p.y + 8;
      bar.style.top = top + "px";
      bar.style.left = Math.max(12, Math.min(p.x, window.innerWidth - bar.offsetWidth - 12)) + "px";
    }

    /* ---------- Images ---------- */
    function addImages(files) {
      files.forEach(function (file) {
        MW.images.add(file).then(function (ref) {
          var at = ta.selectionStart;
          var line = ta.value.lastIndexOf("\n", at - 1) + 1;
          var lead = ta.value.slice(line, at).trim() ? "\n\n" : "";
          insert(ta, at, ta.selectionEnd, lead + "![](" + ref + ")\n\n");
          var pos = ta.selectionStart - ref.length - 5;
          ta.setSelectionRange(pos, pos);
          updateImgBar();
        }, function (err) { MW.toast(err.message); });
      });
    }

    function pickImage() {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.addEventListener("change", function () { addImages([].slice.call(input.files)); });
      input.click();
    }

    ta.addEventListener("paste", function (e) {
      var files = [].slice.call((e.clipboardData && e.clipboardData.files) || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      addImages(files);
    });
    ta.addEventListener("dragover", function (e) { e.preventDefault(); });
    ta.addEventListener("drop", function (e) {
      var files = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      addImages(files);
    });

    /* ---------- Formatting toolbar (always visible) ---------- */
    function linePrefix(prefix) {
      var a = ta.selectionStart;
      var b = ta.selectionEnd;
      var ls = ta.value.lastIndexOf("\n", a - 1) + 1;
      var le = ta.value.indexOf("\n", b);
      if (le < 0) le = ta.value.length;
      var lines = ta.value.slice(ls, le).split("\n");
      var have = prefix === "1. " ? /^\d+\.\s/ : new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      var off = lines.every(function (l) { return have.test(l); });
      var out = lines.map(function (l, i) {
        var bare = l.replace(/^(#{1,6}\s|[-*+]\s|\d+\.\s)/, "");
        return off ? bare : (prefix === "1. " ? i + 1 + ". " : prefix) + bare;
      }).join("\n");
      insert(ta, ls, le, out);
    }

    function blockMenu() {
      var a = ta.selectionStart;
      if (a !== ta.selectionEnd) {
        state = { kind: "wrap", from: a, items: studyBlockItems(), index: 0 };
        return paintMenu(a);
      }
      var le = ta.value.indexOf("\n", a);
      if (le < 0) le = ta.value.length;
      var lineText = ta.value.slice(ta.value.lastIndexOf("\n", a - 1) + 1, le);
      if (lineText.trim()) { ta.setSelectionRange(le, le); a = le; }
      state = { kind: "slash", from: a, items: studyBlockItems(), index: 0 };
      paintMenu(a);
    }

    var tools = {
      h2: function () { linePrefix("## "); },
      h3: function () { linePrefix("### "); },
      bold: function () { wrap("**", "**"); },
      italic: function () { wrap("*", "*"); },
      highlight: function () { wrap("==", "=="); },
      link: function () { wrap("[[", "]]"); detect(); },
      ul: function () { linePrefix("- "); },
      ol: function () { linePrefix("1. "); },
      table: function () {
        var a = ta.selectionStart;
        var before = ta.value.slice(0, a);
        var lead = before && !/\n\n$/.test(before) ? (/\n$/.test(before) ? "\n" : "\n\n") : "";
        var text = "| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n";
        insert(ta, a, ta.selectionEnd, lead + text);
        var pos = a + lead.length + text.indexOf("|  |") + 2;
        ta.setSelectionRange(pos, pos);
      },
      image: function () { pickImage(); },
      block: blockMenu,
    };

    var toolbar = null;
    if (backdrop) {
      toolbar = document.createElement("div");
      toolbar.className = "editor-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "Formatting");
      toolbar.innerHTML =
        '<button type="button" data-tool="h2" title="Section heading">Heading</button>' +
        '<button type="button" data-tool="h3" title="Smaller heading">Subheading</button><i></i>' +
        '<button type="button" data-tool="bold" title="Bold (Ctrl+B)"><b>B</b></button>' +
        '<button type="button" data-tool="italic" title="Italic (Ctrl+I)"><em>I</em></button>' +
        '<button type="button" data-tool="highlight" title="Highlight a high-yield fact"><span class="sb-hl">Highlight</span></button>' +
        '<button type="button" data-tool="link" title="Link to another page">Link</button><i></i>' +
        '<button type="button" data-tool="ul" title="Bulleted list">• List</button>' +
        '<button type="button" data-tool="ol" title="Numbered list">1. List</button>' +
        '<button type="button" data-tool="table" title="Insert a table">Table</button>' +
        '<button type="button" data-tool="image" title="Add an image (or paste one)">Image</button><i></i>' +
        '<button type="button" data-tool="block" class="tool-block" title="Insert a study block: definition, mechanism, PYQ…">Study block ▾</button>';
      toolbar.addEventListener("mousedown", function (e) { e.preventDefault(); });
      toolbar.addEventListener("click", function (e) {
        var b = e.target.closest("[data-tool]");
        if (!b) return;
        closeMenu();
        tools[b.getAttribute("data-tool")]();
      });
      ta.parentNode.parentNode.insertBefore(toolbar, ta.parentNode);
    }

    /* ---------- Image bar: size, alignment and a quick preview for the image line under the caret ---------- */
    var IMG_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/;
    var SIZES = [["25%", 25], ["33%", 33], ["50%", 50], ["75%", 75], ["Full", 100]];
    var ibar = document.createElement("div");
    ibar.className = "img-bar";
    ibar.setAttribute("role", "toolbar");
    ibar.setAttribute("aria-label", "Image size and alignment");
    ibar.hidden = true;
    ibar.addEventListener("mousedown", function (e) { e.preventDefault(); });
    document.body.appendChild(ibar);
    var ibarKey = "";

    function imageLine() {
      var a = ta.selectionStart;
      if (a !== ta.selectionEnd) return null;
      var ls = ta.value.lastIndexOf("\n", a - 1) + 1;
      var le = ta.value.indexOf("\n", a);
      if (le < 0) le = ta.value.length;
      var m = IMG_LINE.exec(ta.value.slice(ls, le));
      if (!m) return null;
      var w = 100;
      var align = "";
      (m[3] || "").split(/[\s,]+/).forEach(function (t) {
        var n = /^(\d{1,3})%?$/.exec(t);
        if (n) w = Math.max(10, Math.min(100, Number(n[1])));
        else if (/^(left|right|center)$/i.test(t)) align = t.toLowerCase();
      });
      return { ls: ls, le: le, alt: m[1], src: m[2], w: w, align: align };
    }

    function applyImage(cur, w, align) {
      var parts = [];
      if (w < 100) parts.push(w + "%");
      if (align) parts.push(align);
      var line = "![" + cur.alt + "](" + cur.src + ")" + (parts.length ? "{" + parts.join(" ") + "}" : "");
      insert(ta, cur.ls, cur.le, line);
      ta.setSelectionRange(cur.ls + 2, cur.ls + 2);
      updateImgBar();
    }

    function imageStatus(src) {
      var m = /^img:([a-z0-9]+)$/.exec(src);
      if (!m) return "Hosted image";
      var st = MW.images.state(m[1]);
      if (st === "done") return "Hosted on ImgBB";
      if (st === "uploading") return "Uploading to ImgBB…";
      if (st === "failed") return "Upload failed (see Image hosting)";
      return MW.images.hasKey() ? "Waiting to upload" : "Kept on this device. Add an ImgBB key to upload";
    }

    function imageThumb(src) {
      var m = /^img:([a-z0-9]+)$/.exec(src);
      return m ? MW.images.thumb(m[1]) : src;
    }

    function updateImgBar() {
      var cur = document.activeElement === ta && ta.offsetParent && !document.querySelector(".overlay") ? imageLine() : null;
      if (!cur) { ibar.hidden = true; ibarKey = ""; return; }
      var sig = [cur.src, cur.w, cur.align].join("|");
      if (sig !== ibarKey) {
        ibarKey = sig;
        ibar.innerHTML =
          '<span class="img-mini" aria-hidden="true"><i></i><i></i><i></i><img alt="" src="' + MW.esc(imageThumb(cur.src)) + '" style="width:' + cur.w + '%;' +
          (cur.align === "left" ? "float:left;margin-right:4px" : cur.align === "right" ? "float:right;margin-left:4px" : "display:block;margin:0 auto") + '"><i></i><i></i><i></i><i></i></span>' +
          '<span class="img-ctl"><span class="img-row-btns" role="group" aria-label="Width">' +
          SIZES.map(function (z) { return '<button type="button" data-w="' + z[1] + '" aria-pressed="' + (cur.w === z[1]) + '">' + z[0] + "</button>"; }).join("") +
          '</span><span class="img-row-btns" role="group" aria-label="Alignment">' +
          [["left", "Left"], ["", "Center"], ["right", "Right"]].map(function (a) {
            return '<button type="button" data-align="' + a[0] + '" aria-pressed="' + (cur.align === a[0]) + '">' + a[1] + "</button>";
          }).join("") + "</span><small>" + MW.esc(imageStatus(cur.src)) + " · the caption is the text inside [ ]</small></span>";
      }
      var p = caretXY(ta, cur.ls);
      ibar.hidden = false;
      var top = p.y + 6;
      if (top + ibar.offsetHeight > window.innerHeight - 70) top = Math.max(76, p.y - p.lh - ibar.offsetHeight - 6);
      ibar.style.top = top + "px";
      ibar.style.left = Math.max(12, Math.min(p.x, window.innerWidth - ibar.offsetWidth - 12)) + "px";
    }

    ibar.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      var cur = imageLine();
      if (!b || !cur) return;
      if (b.hasAttribute("data-w")) {
        var w = Number(b.getAttribute("data-w"));
        applyImage(cur, w, w === 100 ? "" : cur.align);
      } else if (b.hasAttribute("data-align")) {
        var al = b.getAttribute("data-align");
        applyImage(cur, al && cur.w === 100 ? 50 : cur.w, al);
      }
    });
    ta.addEventListener("keyup", updateImgBar);
    ta.addEventListener("click", updateImgBar);
    ta.addEventListener("focus", updateImgBar);
    ta.addEventListener("input", updateImgBar);
    ta.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== ta) { ibar.hidden = true; ibarKey = ""; } }, 150); });
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ibar.hidden || ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; updateImgBar(); });
    }, { passive: true });
    window.addEventListener("resize", function () { if (!ibar.hidden) updateImgBar(); });
    MW.images.on(function () { ibarKey = ""; if (!ibar.hidden) updateImgBar(); });

    /* ---------- Typing ---------- */
    function wrap(open, close) {
      var a = ta.selectionStart;
      var b = ta.selectionEnd;
      var sel = ta.value.slice(a, b);
      insert(ta, a, b, open + sel + close);
      if (a === b) ta.setSelectionRange(a + open.length, a + open.length);
    }

    ta.addEventListener("input", function (e) {
      paintBackdrop();
      fit();
      hideBar();
      if (e.inputType === "insertText" && e.data === "[") {
        var c = ta.selectionStart;
        if (ta.value.slice(c - 2, c) === "[[" && ta.value.slice(c, c + 2) !== "]]") {
          insert(ta, c, c, "]]");
          ta.setSelectionRange(c, c);
        }
      }
      detect();
    });
    ta.addEventListener("click", detect);
    ta.addEventListener("mouseup", function () { setTimeout(updateBar, 0); });
    ta.addEventListener("blur", function () { setTimeout(function () { closeMenu(); hideBar(); }, 150); });
    ta.addEventListener("keyup", function (e) {
      if (/^(ArrowLeft|ArrowRight|Home|End|Backspace)$/.test(e.key)) detect();
      if (e.shiftKey || /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(e.key)) updateBar();
    });
    window.addEventListener("scroll", hideBar, { passive: true });

    ta.addEventListener("keydown", function (e) {
      if (state && state.items.length) {
        var n = state.items.length;
        var anchor = state.kind === "wrap" ? state.from : undefined;
        if (e.key === "ArrowDown") { e.preventDefault(); state.index = (state.index + 1) % n; return paintMenu(anchor); }
        if (e.key === "ArrowUp") { e.preventDefault(); state.index = (state.index - 1 + n) % n; return paintMenu(anchor); }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return accept(state.index); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return closeMenu(); }
      }
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); return wrap("**", "**"); }
      if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); return wrap("*", "*"); }

      if (e.key === "Enter" && !e.shiftKey && !mod && ta.selectionStart === ta.selectionEnd) {
        var caret = ta.selectionStart;
        var ls = ta.value.lastIndexOf("\n", caret - 1) + 1;
        var m = /^(\s*)([-*+]|(\d+)\.)\s(.*)$/.exec(ta.value.slice(ls, caret));
        if (m) {
          e.preventDefault();
          if (!m[4].trim()) return insert(ta, ls, caret, "");
          var marker = m[3] ? Number(m[3]) + 1 + "." : m[2];
          insert(ta, caret, caret, "\n" + m[1] + marker + " ");
        }
      }
    });

    return {
      fit: fit, closeMenu: closeMenu, repaint: paintBackdrop,
      destroy: function () { ibar.remove(); bar.remove(); if (toolbar) toolbar.remove(); },
    };
  }

  MW.editor = { attach: attach, highlight: highlight };
})();
