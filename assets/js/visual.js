/*
 * Visual editor: write the article the way you read it, like a word processor
 * or Wikipedia's VisualEditor. The page is a contenteditable surface styled
 * exactly like the published article; it converts to and from Markdown behind
 * the scenes (MW.md.render(…, {edit:true}) in, MW.md.fromDom out).
 *
 *   var ve = MW.visual.attach(surface, { toolbarHost, onChange });
 *   ve.load(markdown);  ve.getMarkdown();  ve.focus();  ve.destroy();
 *
 * Toolbar: undo/redo, text style, bold/italic/highlight, link (Ctrl+K), lists,
 * Insert menu. Type "/" on an empty line for the same menu, "[[" to link a page,
 * "{{" (or Alt+B on a word) to link or write a quick bite,
 * "## ", "- ", "1. ", "> " to start a heading, list or quote. Tables, images and
 * study blocks get their own controls while you are inside them.
 */
(function () {
  var MW = window.MedWiki;

  function studyItems() {
    return MW.blockTypes.list().map(function (t) {
      return { k: t.key, label: t.label, hint: "", color: t.color, group: "Study blocks", block: t.key };
    }).concat([{ k: "__manage", label: "Manage block types…", hint: "Add, recolour or delete", group: "Study blocks", manage: true }]);
  }

  function insertItems() {
    return [
      { k: "heading", label: "Heading", hint: "Section title", group: "Basics", cmd: "h2", alt: "h1 h2 title" },
      { k: "subheading", label: "Subheading", hint: "Smaller title", group: "Basics", cmd: "h3", alt: "h3 minor" },
      { k: "bullets", label: "Bulleted list", hint: "", group: "Basics", cmd: "ul", alt: "ul list bullet" },
      { k: "numbered", label: "Numbered list", hint: "", group: "Basics", cmd: "ol", alt: "ol list number" },
      { k: "table", label: "Table", hint: "Rows and columns", group: "Insert", cmd: "table", alt: "grid rows columns" },
      { k: "image", label: "Image", hint: "Upload, or just paste one", group: "Insert", cmd: "image", alt: "img picture photo figure" },
      { k: "flowchart", label: "Flowchart (horizontal)", hint: "A → B → C", group: "Insert", cmd: "flow", alt: "flow chart diagram arrows" },
      { k: "flowchart-vertical", label: "Flowchart (vertical)", hint: "top to bottom", group: "Insert", cmd: "flowv", alt: "flow chart diagram down" },
      { k: "quote", label: "Quote", hint: "", group: "Insert", cmd: "quote", alt: "blockquote" },
      { k: "divider", label: "Divider", hint: "A horizontal line", group: "Insert", cmd: "hr", alt: "hr line rule separator" },
      { k: "link", label: "Link to a page", hint: "Ctrl+K", group: "Insert", cmd: "link", alt: "wiki page" },
      { k: "bite", label: "Quick bite", hint: "Alt+B", group: "Insert", cmd: "bite", alt: "define definition glossary term word" },
    ].concat(studyItems());
  }

  var TEXT_BLOCK = /^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/;

  function el(html) {
    var t = document.createElement("div");
    t.innerHTML = html;
    return t.firstElementChild;
  }

  function fillEmpty(root) {
    root.querySelectorAll("li, td, th, p, h2, h3, h4, .flow-lines > div").forEach(function (n) {
      if (!n.firstChild) n.appendChild(document.createElement("br"));
    });
  }

  function nodesFromMd(md) {
    var t = document.createElement("div");
    t.innerHTML = MW.md.render(md, { edit: true }).html;
    fillEmpty(t);
    return [].slice.call(t.childNodes);
  }

  function attach(surface, opts) {
    opts = opts || {};
    var cleanups = [];
    var lastRange = null;
    var selFig = null;
    var menu = null; // { el, items, index, pick, anchor }
    var pop = null;

    surface.setAttribute("contenteditable", "true");
    surface.setAttribute("role", "textbox");
    surface.setAttribute("aria-multiline", "true");
    surface.setAttribute("aria-label", "Article text");
    surface.spellcheck = false; // the browser dictionary is never used; MW.spell takes over
    var speller = MW.spell ? MW.spell.attach(surface) : null;
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
      document.execCommand("styleWithCSS", false, false);
    } catch (e) {}

    function on(target, type, fn, o) {
      target.addEventListener(type, fn, o);
      cleanups.push(function () { target.removeEventListener(type, fn, o); });
    }

    /* ---------- Selection helpers ---------- */

    function selRange() {
      var s = window.getSelection();
      return s.rangeCount && surface.contains(s.anchorNode) ? s.getRangeAt(0) : null;
    }

    function within(node, selector) {
      var e = node && (node.nodeType === 3 ? node.parentElement : node);
      var hit = e && e.closest(selector);
      return hit && surface.contains(hit) ? hit : null;
    }

    function here(selector) {
      var r = selRange();
      return r ? within(r.startContainer, selector) : null;
    }

    function restore() {
      surface.focus({ preventScroll: true });
      if (lastRange) {
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(lastRange);
      }
    }

    function caretIn(node, atEnd) {
      var r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(!atEnd);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      lastRange = r.cloneRange();
    }

    /* Selects a cell's contents (typing replaces it, as in a word processor). */
    function selectIn(node) {
      var r = document.createRange();
      r.selectNodeContents(node);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      lastRange = r.cloneRange();
    }

    function caretRect() {
      var r = selRange();
      if (!r) return surface.getBoundingClientRect();
      var rects = r.getClientRects();
      if (rects.length) return rects[0];
      var e = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
      return e.getBoundingClientRect();
    }

    function pathOf(node) {
      var path = [];
      while (node && node !== surface) {
        path.unshift([].indexOf.call(node.parentNode.childNodes, node));
        node = node.parentNode;
      }
      return path;
    }
    function nodeAt(path) {
      var n = surface;
      for (var i = 0; i < path.length && n; i++) n = n.childNodes[path[i]];
      return n;
    }
    function saveSel() {
      var s = window.getSelection();
      if (!s.rangeCount || !surface.contains(s.anchorNode)) return null;
      return { a: pathOf(s.anchorNode), ao: s.anchorOffset, f: pathOf(s.focusNode), fo: s.focusOffset };
    }
    function loadSel(st) {
      if (!st) return;
      try {
        var a = nodeAt(st.a);
        var f = nodeAt(st.f);
        if (!a || !f) return;
        var s = window.getSelection();
        s.setBaseAndExtent(a, Math.min(st.ao, a.nodeType === 3 ? a.length : a.childNodes.length), f, Math.min(st.fo, f.nodeType === 3 ? f.length : f.childNodes.length));
      } catch (e) {}
    }

    /* ---------- Structure upkeep ---------- */

    function newP() {
      var p = document.createElement("p");
      p.appendChild(document.createElement("br"));
      return p;
    }

    /* Chrome can leave a list or paragraph nested inside a <p> (e.g. after "bulleted list" on an empty line). Unwrap it. */
    var NESTED = "p > ul, p > ol, p > p, p > h2, p > h3, p > h4, p > table, p > figure, p > aside, p > blockquote, p > .table-wrap, p > .flow-src";
    function unwrapNested() {
      if (!surface.querySelector(NESTED)) return;
      var sel = saveSel();
      [].slice.call(surface.querySelectorAll("p")).forEach(function (p) {
        if (!p.parentNode || !p.querySelector(":scope > ul, :scope > ol, :scope > p, :scope > h2, :scope > h3, :scope > h4, :scope > table, :scope > figure, :scope > aside, :scope > blockquote, :scope > .table-wrap, :scope > .flow-src")) return;
        while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
        p.remove();
      });
      loadSel(sel);
    }

    function ensureGaps() {
      unwrapNested();
      [surface].concat([].slice.call(surface.querySelectorAll(".block-body"))).forEach(function (box) {
        var first = box.firstElementChild;
        var last = box.lastElementChild;
        if (!first) { box.appendChild(newP()); return; }
        if (box === surface && !TEXT_BLOCK.test(first.tagName)) box.insertBefore(newP(), first);
        if (!TEXT_BLOCK.test(last.tagName)) box.appendChild(newP());
      });
      surface.querySelectorAll("img").forEach(function (i) { i.draggable = false; });
    }

    function updateEmpty() {
      var empty = !surface.textContent.trim() && !surface.querySelector("figure, table, .block, .flow-src, hr, li") && surface.children.length <= 1;
      surface.classList.toggle("is-empty", empty);
    }

    function tidyPlaceholders() {
      surface.querySelectorAll("[data-placeholder]").forEach(function (n) {
        if (!n.textContent.trim() && n.childNodes.length && !n.querySelector("img")) n.innerHTML = "";
      });
    }

    /* ---------- History (own undo so structural edits are undoable too) ---------- */

    var hist = [];
    var hi = -1;
    var snapTimer = null;

    function snap() {
      clearTimeout(snapTimer);
      var html = surface.innerHTML;
      if (hist[hi] && hist[hi].html === html) { hist[hi].sel = saveSel() || hist[hi].sel; return; }
      hist = hist.slice(0, hi + 1);
      hist.push({ html: html, sel: saveSel() });
      if (hist.length > 200) hist.shift();
      hi = hist.length - 1;
    }

    function apply(state) {
      surface.innerHTML = state.html;
      surface.focus({ preventScroll: true });
      loadSel(state.sel);
      clearFigure();
      updateEmpty();
      notify();
      refresh();
    }

    function undo() {
      snap();
      if (hi > 0) apply(hist[--hi]);
    }
    function redo() {
      snap();
      if (hi < hist.length - 1) apply(hist[++hi]);
    }

    function notify() {
      if (opts.onChange) opts.onChange();
    }

    /* Something changed: record it and tell the page. */
    function changed(now) {
      updateEmpty();
      notify();
      if (now) snap();
      else { clearTimeout(snapTimer); snapTimer = setTimeout(snap, 350); }
    }

    /* ---------- Toolbar ---------- */

    var bar = document.createElement("div");
    bar.className = "ve-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Formatting");
    bar.innerHTML =
      '<button type="button" data-cmd="undo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>' +
      '<button type="button" data-cmd="redo" title="Redo (Ctrl+Y)" aria-label="Redo">↷</button><i></i>' +
      '<select data-cmd="style" aria-label="Text style" title="Text style"><option value="p">Normal text</option><option value="h2">Heading</option><option value="h3">Subheading</option></select><i></i>' +
      '<button type="button" data-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>' +
      '<button type="button" data-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic"><em>I</em></button>' +
      '<button type="button" data-cmd="mark" title="Highlight a high-yield fact (Ctrl+Shift+H)" aria-label="Highlight"><span class="sb-hl">Hi</span></button><i></i>' +
      '<button type="button" data-cmd="link" title="Link to a page or website (Ctrl+K)">Link</button>' +
      '<button type="button" data-cmd="bite" title="Quick bite: define the selected word, or the word at the cursor (Alt+B)">Bite</button><i></i>' +
      '<button type="button" data-cmd="ul" title="Bulleted list" aria-label="Bulleted list">•&nbsp;&nbsp;≡</button>' +
      '<button type="button" data-cmd="ol" title="Numbered list" aria-label="Numbered list">1.&nbsp;≡</button>' +
      '<button type="button" data-cmd="outdent" title="Decrease indent (Shift+Tab)" aria-label="Decrease indent">⇤</button>' +
      '<button type="button" data-cmd="indent" title="Increase indent (Tab)" aria-label="Increase indent">⇥</button><i></i>' +
      '<button type="button" data-cmd="insert" class="ve-insert" title="Insert a table, image, study block…" aria-haspopup="listbox">Insert ▾</button>';
    (opts.toolbarHost || surface.parentNode).insertBefore(bar, opts.toolbarHost ? null : surface);
    cleanups.push(function () { bar.remove(); });

    on(bar, "mousedown", function (e) {
      if (e.target.closest("select")) return;
      e.preventDefault();
    });
    on(bar, "click", function (e) {
      var b = e.target.closest("button[data-cmd]");
      if (!b) return;
      hideMenu();
      run(b.getAttribute("data-cmd"), b);
    });
    on(bar.querySelector("select"), "change", function (e) {
      restore();
      var v = e.target.value;
      document.execCommand("formatBlock", false, "<" + v + ">");
      changed(true);
      refresh();
    });

    function refresh() {
      if (!surface.isConnected) return;
      var st = function (c) { try { return document.queryCommandState(c); } catch (e) { return false; } };
      var set = function (cmd, on) {
        var b = bar.querySelector('[data-cmd="' + cmd + '"]');
        if (b) b.setAttribute("aria-pressed", String(!!on));
      };
      var r = selRange();
      set("bold", r && st("bold"));
      set("italic", r && st("italic"));
      set("mark", r && here("mark"));
      set("ul", r && here("ul"));
      set("ol", r && here("ol"));
      var select = bar.querySelector("select");
      var block = r && within(r.startContainer, "h2, h3, h4, p, li");
      var tag = block ? block.tagName.toLowerCase() : "p";
      select.value = tag === "h2" || tag === "h3" ? tag : "p";
      select.disabled = !r || !!here("td, th, figcaption, .block-title, .block-head, .flow-lines, li");
      bar.querySelector('[data-cmd="undo"]').disabled = hi <= 0;
      bar.querySelector('[data-cmd="redo"]').disabled = hi >= hist.length - 1;
      updateContext();
    }

    /* ---------- Commands ---------- */

    function toggleMark() {
      var r = selRange();
      if (!r) return;
      var m = here("mark");
      if (m) {
        var range = document.createRange();
        range.selectNode(m);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        document.execCommand("insertHTML", false, m.innerHTML);
      } else if (!r.collapsed) {
        var holder = document.createElement("div");
        holder.appendChild(r.cloneContents());
        if (holder.querySelector("p, h2, h3, li, table, figure, aside")) return MW.toast("Highlight works within a single paragraph.");
        document.execCommand("insertHTML", false, "<mark>" + holder.innerHTML + "</mark>");
      } else MW.toast("Select some text to highlight.");
    }

    function indentList(dir) {
      if (!here("li")) return;
      document.execCommand(dir, false);
    }

    function run(cmd, button) {
      if (!selRange() && cmd !== "undo" && cmd !== "redo") restore();
      switch (cmd) {
        case "undo": return undo();
        case "redo": return redo();
        case "bold": document.execCommand("bold"); break;
        case "italic": document.execCommand("italic"); break;
        case "mark": toggleMark(); break;
        case "link": return openLink();
        case "bite": return openBite();
        case "ul": if (canList()) document.execCommand("insertUnorderedList"); break;
        case "ol": if (canList()) document.execCommand("insertOrderedList"); break;
        case "indent": indentList("indent"); break;
        case "outdent": indentList("outdent"); break;
        case "h2": case "h3": if (canFormat()) document.execCommand("formatBlock", false, "<" + cmd + ">"); break;
        case "insert": return openInsertMenu(button);
        case "table": insertBlocks(nodesFromMd("| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |"), "cell"); return;
        case "image": return pickImage();
        case "flow": insertBlocks(nodesFromMd("::: flow\nStep 1 -> Step 2 -> Step 3\n:::"), "flow"); return;
        case "flowv": insertBlocks(nodesFromMd("::: flow vertical\nStep 1 -> Step 2 -> Step 3\n:::"), "flow"); return;
        case "quote": insertBlocks([el("<blockquote><p><br></p></blockquote>")], "first"); return;
        case "hr": insertBlocks([document.createElement("hr")], "after"); return;
      }
      changed(true);
      refresh();
    }

    function canFormat() { return !here("td, th, figcaption, .block-title, .block-head, .flow-lines"); }
    function canList() { return canFormat(); }

    /* ---------- Insert blocks at the caret ---------- */

    function topBlock() {
      var r = selRange();
      var n = r && r.startContainer;
      while (n && n.parentNode && n.parentNode !== surface && !(n.parentNode.classList && n.parentNode.classList.contains("block-body"))) n = n.parentNode;
      return n && n !== surface && n.nodeType === 1 ? n : null;
    }

    function isEmptyP(n) {
      return n && n.tagName === "P" && !n.textContent.trim() && !n.querySelector("img");
    }

    /* Puts nodes after the block holding the caret (replacing an empty paragraph) and places the caret. */
    function insertBlocks(nodes, focus) {
      if (!selRange()) restore();
      var host = topBlock();
      var container = host ? host.parentNode : surface;
      var anchor = host;
      if (host && isEmptyP(host)) {
        anchor = host.previousSibling;
        host.remove();
      }
      var ref = anchor ? anchor.nextSibling : container.firstChild;
      nodes.forEach(function (n) { container.insertBefore(n, ref); });
      ensureGaps();
      var first = nodes[0];
      var target = null;
      if (focus === "cell") { selectIn(first.querySelector("th, td")); target = null; }
      else if (focus === "flow") target = first.querySelector(".flow-lines > div");
      else if (focus === "first") target = first.querySelector("p, li, h2, h3") || first;
      else if (focus === "block") target = first.querySelector(".block-body p, .block-body li") || first;
      else if (focus === "after") target = first.nextElementSibling;
      if (target) caretIn(target, focus === "flow");
      if (focus === "figure") selectFigure(first);
      changed(true);
      refresh();
      first.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    function insertStudy(type) {
      insertBlocks(nodesFromMd("::: " + type + "\n:::"), "block");
    }

    /* ---------- Images ---------- */

    function figureNodes(ref) {
      return nodesFromMd("![](" + ref + ")");
    }

    function addImages(files) {
      files.forEach(function (file) {
        MW.images.add(file).then(function (ref) {
          insertBlocks(figureNodes(ref), "figure");
        }, function (err) { MW.toast(err.message); });
      });
    }

    function pickImage() {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.addEventListener("change", function () { restore(); addImages([].slice.call(input.files)); });
      input.click();
    }

    /* ---------- Menus (Insert, slash, page links, block type) ---------- */

    function hideMenu() {
      if (menu) { menu.el.remove(); menu = null; }
    }

    function showMenu(items, rect, pick, empty) {
      if (!items.length) { if (empty) items = []; else return hideMenu(); }
      var same = menu && menu.el.isConnected;
      var m = same ? menu : { el: document.createElement("div"), index: 0 };
      m.items = items;
      m.pick = pick;
      m.index = Math.min(m.index, Math.max(0, items.length - 1));
      m.el.className = "ve-menu";
      m.el.setAttribute("role", "listbox");
      m.el.addEventListener("mousedown", function (e) { e.preventDefault(); });
      var html = "";
      var group = null;
      items.forEach(function (it, i) {
        if (it.group && it.group !== group) { group = it.group; html += '<div class="ve-menu-group">' + MW.esc(group) + "</div>"; }
        var swatch = it.color ? '<i class="swatch" style="background:' + MW.esc(it.color) + '"></i>' : "";
        html += '<button type="button" role="option" class="ve-menu-item' + (i === m.index ? " is-on" : "") + '" data-i="' + i + '" aria-selected="' + (i === m.index) + '">' + swatch + "<strong>" +
          MW.esc(it.label) + "</strong>" + (it.hint ? "<small>" + MW.esc(it.hint) + "</small>" : "") + "</button>";
      });
      m.el.innerHTML = html || '<div class="ve-menu-group">No matches</div>';
      if (!same) document.body.appendChild(m.el);
      m.el.onclick = function (e) {
        var b = e.target.closest(".ve-menu-item");
        if (b) choose(Number(b.getAttribute("data-i")));
      };
      var top = rect.bottom + 6;
      var h = m.el.offsetHeight;
      if (top + h > window.innerHeight - 12) top = Math.max(76, rect.top - h - 6);
      m.el.style.top = top + "px";
      m.el.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - m.el.offsetWidth - 12)) + "px";
      var on = m.el.querySelector(".is-on");
      if (on) on.scrollIntoView({ block: "nearest" });
      menu = m;
    }

    function choose(i) {
      var m = menu;
      if (!m || !m.items[i]) return;
      var it = m.items[i];
      var pick = m.pick;
      hideMenu();
      pick(it);
    }

    function runItem(it) {
      if (it.manage) MW.blockTypesDialog();
      else if (it.block) insertStudy(it.block);
      else run(it.cmd);
    }

    function openInsertMenu(button) {
      showMenu(insertItems(), button.getBoundingClientRect(), runItem);
    }

    /* Insert items matching what was typed after "/" or "~" (name, label or an alias such as "hr", "ul", "chart"). */
    function filterItems(typed) {
      var key = (typed || "").toLowerCase().trim();
      return insertItems().filter(function (it) {
        return !key || it.k.indexOf(key) !== -1 || it.label.toLowerCase().indexOf(key) !== -1 || (it.alt || "").indexOf(key) !== -1;
      });
    }

    /* "/" or "~" on an empty line, "~" anywhere, and "[[" anywhere. */
    function detectMenus() {
      var r = selRange();
      if (!r || !r.collapsed) return hideMenu();
      var node = r.startContainer;

      if (node.nodeType === 3) {
        var before = node.nodeValue.slice(0, r.startOffset);
        var w = /\[\[([^\]\n|#]*)$/.exec(before);
        if (w && !within(node, ".block-title, figcaption")) {
          var q = MW.norm(w[1]).trim();
          var items = pageItems(q, w[1]);
          var span = { node: node, start: w.index, end: r.startOffset };
          return showMenu(items, caretRect(), function (it) { commitLink(it, span); });
        }
      }

      /* "{{": quick bites (pick one, or write a new one on the spot) */
      if (node.nodeType === 3) {
        var bb = /\{\{([^}\n|]*)$/.exec(node.nodeValue.slice(0, r.startOffset));
        if (bb && !within(node, ".block-title, figcaption")) {
          var bspan = { node: node, start: bb.index, end: r.startOffset };
          return showMenu(biteItems(bb[1]), caretRect(), function (it) { commitBite(it, bspan); });
        }
      }

      /* "~image", "~table", "~quote"… anywhere in a line: the typed word is removed and the item inserted */
      if (node.nodeType === 3 && !within(node, ".block-title, figcaption, td, th, .flow-lines")) {
        var tl = /(^|\s| )~([a-z][a-z0-9 -]*)?$/i.exec(node.nodeValue.slice(0, r.startOffset));
        if (tl) {
          var tilde = tl.index + tl[1].length;
          var tend = r.startOffset;
          var found = filterItems(tl[2]);
          if (found.length) {
            return showMenu(found, caretRect(), function (it) {
              node.deleteData(tilde, tend - tilde);
              var host = within(node, "p");
              if (host && !host.textContent.trim()) {
                host.innerHTML = "";
                host.appendChild(document.createElement("br"));
                caretIn(host);
              } else {
                var rg = document.createRange();
                rg.setStart(node, tilde);
                rg.collapse(true);
                var sl = window.getSelection();
                sl.removeAllRanges();
                sl.addRange(rg);
                lastRange = rg.cloneRange();
              }
              runItem(it);
            });
          }
        }
      }

      var p = within(node, "p");
      if (p && (p.parentNode === surface || p.parentNode.classList.contains("block-body"))) {
        var s = /^[\/~]([a-z0-9 -]*)$/i.exec(p.textContent.trim());
        if (s) {
          var list = filterItems(s[1]);
          if (list.length) {
            return showMenu(list, caretRect(), function (it) {
              p.innerHTML = "";
              p.appendChild(document.createElement("br"));
              caretIn(p);
              runItem(it);
            });
          }
        }
      }
      hideMenu();
    }

    function pageItems(q, raw) {
      var pages = MW.pages.filter(function (p) {
        return !q || [p.title].concat(p.aliases).some(function (t) { return MW.norm(t).indexOf(q) !== -1; });
      }).sort(function (a, b) {
        return (MW.norm(a.title).indexOf(q) === 0 ? 0 : 1) - (MW.norm(b.title).indexOf(q) === 0 ? 0 : 1);
      }).slice(0, 7).map(function (p) {
        var s = MW.subject(p.subject);
        return { label: p.title, hint: s ? s.title : "", target: p.title };
      });
      if (raw && raw.trim() && !MW.resolve(raw)) pages.push({ label: "Create “" + raw.trim() + "”", hint: "New page", target: raw.trim() });
      return pages;
    }

    /* Replaces the typed "[[query" with a real link. */
    function commitLink(it, span) {
      var range = document.createRange();
      range.setStart(span.node, span.start);
      range.setEnd(span.node, Math.min(span.end, span.node.length));
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      var next = span.node.nodeValue.slice(span.end, span.end + 2);
      if (next === "]]") range.setEnd(span.node, span.end + 2);
      document.execCommand("insertHTML", false, MW.md.inline("[[" + it.target + "]]") + "&#8203;");
      changed(true);
    }

    /* ---------- Quick bites ({{ or Alt+B) ---------- */

    function biteItems(raw) {
      var q = MW.norm(raw).trim();
      var items = MW.bites.list().filter(function (b) {
        return !q || [b.term].concat(b.aliases || []).some(function (t) { return MW.norm(t).indexOf(q) !== -1; });
      }).sort(function (a, b) {
        return (MW.norm(a.term).indexOf(q) === 0 ? 0 : 1) - (MW.norm(b.term).indexOf(q) === 0 ? 0 : 1);
      }).slice(0, 7).map(function (b) {
        return { label: b.term, hint: MW.bites.shorten(b.means, 60), bite: b };
      });
      if (raw.trim() && !MW.bites.resolve(raw)) items.push({ label: "Write quick bite “" + raw.trim() + "”", hint: "New", create: raw.trim() });
      return items;
    }

    /* the link text for a bite; what you typed is kept as the label when it differs from the term */
    function biteHtml(b, typed) {
      var label = (typed || "").replace(/[{}|]/g, "").trim();
      return MW.md.inline("{{" + b.term + (label && label !== b.term ? "|" + label : "") + "}}");
    }

    /* Inserted as a node, not with insertHTML: inside bold text or list items the browser drops an unstyled <span>. */
    function putBite(range, b, typed) {
      surface.focus({ preventScroll: true });
      var holder = document.createElement("div");
      holder.innerHTML = biteHtml(b, typed);
      var node = holder.firstChild;
      range.deleteContents();
      range.insertNode(node);
      var gap = document.createTextNode(String.fromCharCode(8203)); /* keeps typing outside the link */
      node.after(gap);
      var r = document.createRange();
      r.setStart(gap, 1);
      r.collapse(true);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      lastRange = r.cloneRange();
      MW.bites.refreshDom(surface);
      changed(true);
    }

    /* Replaces the typed "{{query" with a bite link; a new bite is written in a small window first. */
    function commitBite(it, span) {
      var range = document.createRange();
      var end = Math.min(span.end, span.node.length);
      if (span.node.nodeValue.slice(end, end + 2) === "}}") end += 2;
      range.setStart(span.node, span.start);
      range.setEnd(span.node, end);
      if (it.bite) return putBite(range, it.bite, "");
      MW.bites.open({ term: it.create, onSaved: function (b) { putBite(range, b, ""); } });
    }

    /* The selected words, or the word at the cursor, become a quick bite (opened for editing when already one). */
    function openBite() {
      var r = selRange();
      if (!r) { restore(); r = selRange(); }
      if (!r) return;
      var linked = here(".bite");
      if (linked) {
        var term = linked.getAttribute("data-bite");
        var found = MW.bites.resolve(term);
        return MW.bites.open({ id: found && found.id, term: term, onSaved: function () { MW.bites.refreshDom(surface); changed(true); } });
      }
      var range = r.cloneRange();
      if (range.collapsed) {
        var n = range.startContainer;
        if (n.nodeType !== 3 || within(n, "pre")) return MW.toast("Put the cursor in a word, or select the term, then press Alt+B.");
        var text = n.nodeValue;
        /* the cursor inside a known term, even a multi-word one ("Flocked swabs"): take the longest match around it */
        var lower = text.toLowerCase();
        var best = null;
        MW.bites.list().forEach(function (bt) {
          [bt.term].concat(bt.aliases || []).forEach(function (name) {
            var nm = name.toLowerCase();
            var from = lower.indexOf(nm);
            while (from !== -1) {
              if (from <= range.startOffset && range.startOffset <= from + nm.length && (!best || nm.length > best.len)) best = { at: from, len: nm.length };
              from = lower.indexOf(nm, from + 1);
            }
          });
        });
        if (best) {
          range.setStart(n, best.at);
          range.setEnd(n, best.at + best.len);
          var known = MW.bites.resolve(range.toString());
          if (known) return putBite(range, known, range.toString());
        }
        var word = function (c) { return /[\p{L}\p{N}'’-]/u.test(c); };
        var a = range.startOffset;
        var z = a;
        while (a > 0 && word(text[a - 1])) a--;
        while (z < text.length && word(text[z])) z++;
        while (a < z && /['’-]/.test(text[a])) a++;
        while (z > a && /['’-]/.test(text[z - 1])) z--;
        if (a === z) return MW.toast("Put the cursor in a word, or select the term, then press Alt+B.");
        range.setStart(n, a);
        range.setEnd(n, z);
      } else {
        var sc = range.startContainer;
        var ec = range.endContainer;
        while (sc.nodeType === 3 && range.startOffset < sc.length && /\s/.test(sc.nodeValue[range.startOffset]) && (sc !== ec || range.startOffset < range.endOffset)) range.setStart(sc, range.startOffset + 1);
        while (ec.nodeType === 3 && range.endOffset > 0 && /\s/.test(ec.nodeValue[range.endOffset - 1]) && (sc !== ec || range.endOffset > range.startOffset)) range.setEnd(ec, range.endOffset - 1);
        var holder = document.createElement("div");
        holder.appendChild(range.cloneContents());
        if (holder.querySelector("p, h2, h3, h4, li, table, figure, aside")) return MW.toast("Select a word or short phrase within one paragraph.");
      }
      var typed = range.toString().replace(/\s+/g, " ").trim();
      if (!typed) return;
      if (typed.length > MW.bites.LIMIT.term) return MW.toast("A quick bite term is a word or short phrase (up to " + MW.bites.LIMIT.term + " characters).");
      var hit = MW.bites.resolve(typed);
      if (hit) return putBite(range, hit, typed);
      MW.bites.open({ term: typed, onSaved: function (b) { putBite(range, b, typed); } });
    }

    /* ---------- Links (Ctrl+K) ---------- */

    function closePop() {
      if (pop) { pop.remove(); pop = null; }
    }

    function openLink() {
      var r = selRange() || (lastRange && { startContainer: lastRange.startContainer });
      if (!r) { restore(); r = selRange(); }
      var saved = lastRange ? lastRange.cloneRange() : null;
      var existing = here("a");
      var selText = saved ? saved.toString() : "";
      closePop();
      pop = document.createElement("div");
      pop.className = "ve-pop";
      pop.innerHTML =
        '<input type="text" placeholder="Search pages, or paste a web address" aria-label="Link to" autocomplete="off" spellcheck="false">' +
        '<div class="ve-pop-list" role="listbox"></div>' +
        '<div class="ve-pop-foot"><small>Enter to link · Esc to cancel</small>' + (existing ? '<button type="button" data-unlink>Remove link</button>' : "") + "</div>";
      document.body.appendChild(pop);
      var rect = caretRect();
      pop.style.top = Math.min(window.innerHeight - 260, rect.bottom + 8) + "px";
      pop.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 360)) + "px";
      var input = pop.querySelector("input");
      var listEl = pop.querySelector(".ve-pop-list");
      var items = [];
      var idx = 0;
      input.value = existing ? existing.getAttribute("data-target") || existing.getAttribute("href") || "" : selText.trim();

      function paintList() {
        var raw = input.value.trim();
        var q = MW.norm(raw).trim();
        items = pageItems(q, raw);
        if (/^(https?:\/\/|www\.)\S+$/i.test(raw) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw)) {
          items.unshift({ label: "Web address", hint: raw, url: /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^www\./i, "www.") });
        }
        idx = Math.min(idx, Math.max(0, items.length - 1));
        listEl.innerHTML = items.map(function (it, i) {
          return '<button type="button" role="option" class="ve-menu-item' + (i === idx ? " is-on" : "") + '" data-i="' + i + '"><strong>' + MW.esc(it.label) + "</strong><small>" + MW.esc(it.hint || "") + "</small></button>";
        }).join("") || '<p class="ve-pop-empty">Type a page name or paste a web address.</p>';
      }

      function finish(it) {
        closePop();
        surface.focus({ preventScroll: true });
        if (saved) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
        var label = selText.trim();
        if (existing && surface.contains(existing)) {
          var rg = document.createRange();
          rg.selectNodeContents(existing);
          var s2 = window.getSelection();
          s2.removeAllRanges();
          s2.addRange(rg);
          label = existing.textContent;
        }
        var html;
        if (it.url) html = '<a href="' + MW.esc(it.url) + '" target="_blank" rel="noopener">' + MW.esc(label || it.hint) + "</a>";
        else html = MW.md.inline("[[" + it.target + (label && label !== it.target ? "|" + label.replace(/[\]|]/g, "") : "") + "]]");
        if (existing && surface.contains(existing)) {
          var whole = document.createRange();
          whole.selectNode(existing);
          var s3 = window.getSelection();
          s3.removeAllRanges();
          s3.addRange(whole);
        }
        document.execCommand("insertHTML", false, html + (label ? "" : "&#8203;"));
        changed(true);
      }

      paintList();
      input.focus();
      input.select();
      input.addEventListener("input", function () { idx = 0; paintList(); });
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" && items.length) { e.preventDefault(); idx = (idx + 1) % items.length; paintList(); }
        else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; paintList(); }
        else if (e.key === "Enter") { e.preventDefault(); if (items[idx]) finish(items[idx]); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); restore(); }
      });
      listEl.addEventListener("mousedown", function (e) { e.preventDefault(); });
      listEl.addEventListener("click", function (e) {
        var b = e.target.closest(".ve-menu-item");
        if (b) finish(items[Number(b.getAttribute("data-i"))]);
      });
      var unlink = pop.querySelector("[data-unlink]");
      if (unlink) unlink.addEventListener("click", function () {
        closePop();
        var txt = document.createTextNode(existing.textContent);
        existing.replaceWith(txt);
        caretIn(txt, true);
        changed(true);
      });
      input.addEventListener("blur", function () { setTimeout(function () { if (pop && !pop.contains(document.activeElement)) closePop(); }, 120); });
    }

    /* ---------- Study blocks: label menu, move, delete ---------- */

    /* Redraws the live chart under a flowchart's text lines. */
    function refreshFlow(flow) {
      var preview = flow.querySelector(":scope > .flow-preview");
      var box = flow.querySelector(":scope > .flow-lines");
      if (!preview || !box) return;
      var lines = [].map.call(box.children, function (row) { return row.textContent.replace(/ /g, " ").trim(); }).filter(Boolean);
      var dir = flow.getAttribute("data-dir") === "vertical" ? " vertical" : "";
      var al = flow.getAttribute("data-align");
      if (al === "center" || al === "right") dir += " " + al;
      preview.innerHTML = MW.md.render("::: flow" + dir + "\n" + lines.join("\n") + "\n:::").html;
    }

    function blockAction(btn) {
      var block = btn.closest(".block, .flow-src");
      if (!block) return;
      var act = btn.getAttribute("data-act");
      if (/^(dir-|al-)/.test(act)) {
        if (act.indexOf("dir-") === 0) block.setAttribute("data-dir", act === "dir-v" ? "vertical" : "horizontal");
        else block.setAttribute("data-align", act.slice(3));
        btn.parentNode.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        refreshFlow(block);
        changed(true);
        return;
      }
      if (act === "del") {
        if (block.textContent.replace(/[↑↓✕]/g, "").trim().length > 40 && !confirm("Delete this block and everything in it?")) return;
        block.remove();
        ensureGaps();
        changed(true);
      } else if (act === "up" || act === "down") {
        var sib = act === "up" ? block.previousElementSibling : block.nextElementSibling;
        if (!sib) return;
        if (act === "up") sib.before(block); else sib.after(block);
        ensureGaps();
        block.scrollIntoView({ block: "nearest", behavior: "smooth" });
        changed(true);
      } else if (act === "type" && block.classList.contains("block")) {
        var rect = btn.getBoundingClientRect();
        showMenu(studyItems(), rect, function (it) {
          if (it.manage) return MW.blockTypesDialog();
          block.className = "block block-" + it.k;
          block.setAttribute("data-type", it.k);
          block.style.setProperty("--tone", it.color || "");
          btn.textContent = it.label;
          changed(true);
        });
      }
    }

    /* ---------- Tables ---------- */

    function cellInfo() {
      var cell = here("td, th");
      if (!cell) return null;
      var row = cell.parentElement;
      var table = row.closest("table");
      var rows = [].slice.call(table.rows);
      return { cell: cell, row: row, table: table, ri: rows.indexOf(row), ci: [].indexOf.call(row.cells, cell), rows: rows };
    }

    function makeCell(tag) {
      var c = document.createElement(tag);
      c.appendChild(document.createElement("br"));
      return c;
    }

    function tableOp(op) {
      var t = cellInfo();
      if (!t) return;
      var focusCell = t.cell;
      if (op === "rowAbove" || op === "rowBelow") {
        var above = op === "rowAbove" && t.ri > 0;
        var tr = document.createElement("tr");
        for (var i = 0; i < t.row.cells.length; i++) tr.appendChild(makeCell("td"));
        var body = t.table.tBodies[0] || t.table;
        if (above) t.row.before(tr);
        else if (t.row.parentElement.tagName === "THEAD") body.insertBefore(tr, body.firstChild);
        else t.row.after(tr);
        focusCell = tr.cells[Math.min(t.ci, tr.cells.length - 1)];
      } else if (op === "colLeft" || op === "colRight") {
        var at = op === "colLeft" ? t.ci : t.ci + 1;
        t.rows.forEach(function (r) {
          var made = makeCell(r.cells[0].tagName.toLowerCase());
          if (r.cells[at]) r.insertBefore(made, r.cells[at]); else r.appendChild(made);
          if (r === t.row) focusCell = made;
        });
      } else if (op === "delRow") {
        if (t.ri === 0) return MW.toast("The header row can't be removed. Delete the table instead.");
        var nextRow = t.rows[t.ri + 1] || t.rows[t.ri - 1];
        t.row.remove();
        focusCell = nextRow.cells[Math.min(t.ci, nextRow.cells.length - 1)];
      } else if (op === "delCol") {
        if (t.row.cells.length < 2) return MW.toast("A table needs at least one column.");
        t.rows.forEach(function (r) { r.cells[t.ci] && r.cells[t.ci].remove(); });
        focusCell = t.row.cells[Math.min(t.ci, t.row.cells.length - 1)];
      } else if (op === "delTable") {
        var wrap = t.table.closest(".table-wrap") || t.table;
        var after = wrap.nextElementSibling;
        wrap.remove();
        ensureGaps();
        if (after) caretIn(after);
        changed(true);
        refresh();
        return;
      } else if (op === "para") {
        var w = t.table.closest(".table-wrap") || t.table;
        var p = newP();
        w.after(p);
        caretIn(p);
        changed(true);
        refresh();
        return;
      }
      caretIn(focusCell);
      changed(true);
      refresh();
    }

    /* ---------- Figures ---------- */

    function selectFigure(fig) {
      if (selFig === fig) return;
      clearFigure();
      selFig = fig;
      fig.classList.add("is-selected");
      updateContext();
    }

    function clearFigure() {
      if (selFig) selFig.classList.remove("is-selected");
      selFig = null;
    }

    function figureSet(fig, w, align) {
      if (w != null) {
        if (w >= 100) { fig.removeAttribute("data-w"); fig.style.removeProperty("--w"); if (!fig.getAttribute("style")) fig.removeAttribute("style"); }
        else { fig.setAttribute("data-w", String(w)); fig.style.setProperty("--w", w + "%"); }
      }
      if (align != null) {
        [].slice.call(fig.classList).forEach(function (c) { if (/^fig-/.test(c)) fig.classList.remove(c); });
        if (align) { fig.setAttribute("data-align", align); fig.classList.add("fig-" + align); }
        else fig.removeAttribute("data-align");
        if (align && !fig.getAttribute("data-w")) { fig.setAttribute("data-w", "50"); fig.style.setProperty("--w", "50%"); }
      }
    }

    /* ---------- Floating context bar (table / image) ---------- */

    var ctx = document.createElement("div");
    ctx.className = "ve-ctx";
    ctx.setAttribute("role", "toolbar");
    ctx.hidden = true;
    document.body.appendChild(ctx);
    cleanups.push(function () { ctx.remove(); });
    var ctxSig = "";

    on(ctx, "mousedown", function (e) { if (!e.target.closest("input")) e.preventDefault(); });

    var TABLE_BTNS = [
      ["rowAbove", "+ Row above"], ["rowBelow", "+ Row below"], ["colLeft", "+ Column left"], ["colRight", "+ Column right"],
      ["delRow", "− Row"], ["delCol", "− Column"], ["para", "Text below"], ["delTable", "Delete table"],
    ];
    var SIZES = [[25, "25%"], [33, "33%"], [50, "50%"], [75, "75%"], [100, "Full"]];

    function contextTarget() {
      var cell = here("td, th");
      if (cell) return { kind: "table", el: cell.closest(".table-wrap") || cell.closest("table") };
      var fig = selFig || here("figure");
      if (fig) return { kind: "figure", el: fig };
      return null;
    }

    function updateContext() {
      var t = surface.isConnected && (document.activeElement === surface || surface.contains(document.activeElement) || selFig) ? contextTarget() : null;
      if (!t || !t.el.isConnected) { ctx.hidden = true; ctxSig = ""; return; }
      var w = Number(t.el.getAttribute("data-w")) || 100;
      var align = t.el.getAttribute("data-align") || "";
      var sig = t.kind + "|" + w + "|" + align;
      if (sig !== ctxSig || ctx.hidden) {
        ctxSig = sig;
        if (t.kind === "table") {
          ctx.setAttribute("aria-label", "Table");
          ctx.innerHTML = TABLE_BTNS.map(function (b) { return '<button type="button" data-t="' + b[0] + '"' + (b[0] === "delTable" ? ' class="danger"' : "") + ">" + b[1] + "</button>"; }).join("");
        } else {
          ctx.setAttribute("aria-label", "Image");
          ctx.innerHTML =
            '<span class="ve-grp" role="group" aria-label="Width">' + SIZES.map(function (z) { return '<button type="button" data-w="' + z[0] + '" aria-pressed="' + (w === z[0]) + '">' + z[1] + "</button>"; }).join("") + "</span>" +
            '<input type="range" min="10" max="100" step="5" value="' + w + '" aria-label="Image width" data-range>' +
            '<span class="ve-grp" role="group" aria-label="Alignment">' + [["left", "Left"], ["", "Center"], ["right", "Right"]].map(function (a) {
              return '<button type="button" data-align="' + a[0] + '" aria-pressed="' + (align === a[0]) + '">' + a[1] + "</button>";
            }).join("") + "</span>" +
            '<button type="button" data-t="para">Text below</button><button type="button" data-t="delFig" class="danger">Delete</button>';
        }
      }
      var r = t.el.getBoundingClientRect();
      if (r.bottom < 120 || r.top > window.innerHeight - 20) { ctx.hidden = true; return; }
      ctx.hidden = false;
      var top = r.top - ctx.offsetHeight - 8;
      if (top < 118) top = Math.min(r.bottom + 8, window.innerHeight - ctx.offsetHeight - 12);
      ctx.style.top = Math.max(118, top) + "px";
      ctx.style.left = Math.max(12, Math.min(r.left, window.innerWidth - ctx.offsetWidth - 12)) + "px";
    }

    on(ctx, "click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var fig = selFig || here("figure");
      if (b.hasAttribute("data-w") && fig) { figureSet(fig, Number(b.getAttribute("data-w")), null); ctxSig = ""; changed(true); updateContext(); return; }
      if (b.hasAttribute("data-align") && fig) { figureSet(fig, null, b.getAttribute("data-align")); ctxSig = ""; changed(true); updateContext(); return; }
      var t = b.getAttribute("data-t");
      if (t === "delFig" && fig) {
        var next = fig.nextElementSibling || fig.previousElementSibling;
        fig.remove();
        clearFigure();
        ensureGaps();
        if (next) caretIn(next);
        changed(true);
        refresh();
      } else if (t === "para" && fig) {
        var p = newP();
        fig.after(p);
        caretIn(p);
        changed(true);
        refresh();
      } else if (t) tableOp(t);
    });
    on(ctx, "input", function (e) {
      var fig = selFig || here("figure");
      if (e.target.hasAttribute("data-range") && fig) { figureSet(fig, Number(e.target.value), null); notify(); }
    });
    on(ctx, "change", function (e) {
      if (e.target.hasAttribute("data-range")) { ctxSig = ""; changed(true); updateContext(); }
    });
    var scrollTick = false;
    on(window, "scroll", function () {
      if (scrollTick) return;
      scrollTick = true;
      requestAnimationFrame(function () { scrollTick = false; updateContext(); });
    }, { passive: true });
    on(window, "resize", function () { updateContext(); hideMenu(); });

    /* ---------- Events ---------- */

    on(document, "selectionchange", function () {
      var r = selRange();
      if (r) lastRange = r.cloneRange();
      refresh();
    });

    on(surface, "mousedown", function (e) {
      hideMenu();
      var fig = e.target.closest && e.target.closest("figure");
      if (fig && surface.contains(fig)) selectFigure(fig);
      else clearFigure();
    });

    on(surface, "click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (a) {
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && a.getAttribute("href") && a.getAttribute("href") !== "#") window.open(a.href, a.target || "_self");
        return;
      }
      var b = e.target.closest && e.target.closest(".block-ctl button, .flow-dir button, [data-act=type]");
      if (b) { e.preventDefault(); blockAction(b); }
    });

    on(surface, "beforeinput", function (e) {
      if (e.inputType === "historyUndo") { e.preventDefault(); undo(); }
      else if (e.inputType === "historyRedo") { e.preventDefault(); redo(); }
    });

    /* "## ", "- ", "1. ", "> " at the start of a paragraph turn into headings, lists, quotes. */
    function autoformat(e) {
      if (e.inputType !== "insertText" || e.data !== " ") return false;
      var r = selRange();
      var p = r && within(r.startContainer, "p");
      if (!p || !(p.parentNode === surface || p.parentNode.classList.contains("block-body"))) return false;
      var t = p.textContent.replace(/\u00a0/g, " ");
      var k;
      var last = r.startContainer;
      var typed = last.nodeType === 3 ? last.nodeValue.replace(/\u00a0/g, " ") : "";
      if (/^(-|\*|1\.) $/.test(typed) && last.parentNode === p && last === p.lastChild && last.previousSibling && last.previousSibling.nodeName === "BR") {
        /* "- " typed on a new line inside a paragraph (after Shift+Enter): move that line into its own paragraph, then make it a list */
        k = typed.trim();
        last.previousSibling.remove();
        last.remove();
        var np = newP();
        p.after(np);
        caretIn(np);
      } else {
        var m = /^(##?|###|-|\*|1\.|>) $/.exec(t);
        if (!m) return false;
        k = m[1];
        p.innerHTML = "";
        p.appendChild(document.createElement("br"));
        caretIn(p);
      }
      if (k === "#" || k === "##") document.execCommand("formatBlock", false, "<h2>");
      else if (k === "###") document.execCommand("formatBlock", false, "<h3>");
      else if (k === "-" || k === "*") document.execCommand("insertUnorderedList");
      else if (k === "1.") document.execCommand("insertOrderedList");
      else document.execCommand("formatBlock", false, "<blockquote>");
      return true;
    }

    /* Deleting everything can leave an empty heading behind; typing would then create a heading. */
    function resetEmptyDoc() {
      var kids = surface.children;
      if (kids.length === 1 && !surface.textContent.trim() && /^(H[1-6]|BLOCKQUOTE)$/.test(kids[0].tagName)) {
        var p = newP();
        surface.replaceChild(p, kids[0]);
        caretIn(p);
      }
    }

    on(surface, "input", function (e) {
      if (/^delete/.test(e.inputType || "")) resetEmptyDoc();
      tidyPlaceholders();
      var flowBox = here(".flow-lines");
      if (flowBox) refreshFlow(flowBox.parentNode);
      if (!autoformat(e)) detectMenus();
      ensureGaps();
      changed(false);
    });

    function inSingleLine() { return here("td, th, .block-title, figcaption"); }

    on(surface, "paste", function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var files = [].slice.call(cd.files || []).filter(function (f) { return /^image\//.test(f.type); });
      e.preventDefault();
      if (files.length) return addImages(files);
      var html = cd.getData("text/html");
      var text = cd.getData("text/plain");
      if (inSingleLine()) { document.execCommand("insertText", false, text.replace(/\s+/g, " ")); return; }
      var md = "";
      if (html) {
        var tpl = document.createElement("div");
        var doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script, style, meta, link, title").forEach(function (n) { n.remove(); });
        tpl.innerHTML = doc.body.innerHTML;
        md = MW.md.fromDom(tpl);
      }
      if (!md.trim()) md = text;
      if (!md.trim()) return;
      var nodes = nodesFromMd(md);
      if (nodes.length === 1 && nodes[0].tagName === "P") {
        document.execCommand("insertHTML", false, nodes[0].innerHTML);
      } else {
        insertBlocks(nodes, null);
      }
    });

    on(surface, "dragover", function (e) { if (e.dataTransfer && [].some.call(e.dataTransfer.types, function (t) { return t === "Files"; })) e.preventDefault(); });
    on(surface, "drop", function (e) {
      var files = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      if (document.caretRangeFromPoint) {
        var rg = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (rg && surface.contains(rg.startContainer)) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(rg); }
      }
      addImages(files);
    });

    function moveCell(t, delta) {
      var cells = [].slice.call(t.table.querySelectorAll("th, td"));
      var i = cells.indexOf(t.cell) + delta;
      if (i >= cells.length) { tableOp("rowBelow"); return; }
      if (i < 0) return;
      selectIn(cells[i]);
    }

    on(surface, "keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;

      if (menu) {
        var n = menu.items.length;
        if (e.key === "ArrowDown" && n) { e.preventDefault(); menu.index = (menu.index + 1) % n; return showMenu(menu.items, menu.el.getBoundingClientRect(), menu.pick); }
        if (e.key === "ArrowUp" && n) { e.preventDefault(); menu.index = (menu.index - 1 + n) % n; return showMenu(menu.items, menu.el.getBoundingClientRect(), menu.pick); }
        if ((e.key === "Enter" || e.key === "Tab") && n) { e.preventDefault(); return choose(menu.index); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return hideMenu(); }
      }

      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); return openLink(); }
      if (e.altKey && !mod && !e.shiftKey && e.code === "KeyB") { e.preventDefault(); return openBite(); }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); return redo(); }
      if (mod && e.key.toLowerCase() === "u") { e.preventDefault(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "h") { e.preventDefault(); toggleMark(); return changed(true); }

      /* A selected image: Delete removes it, typing dismisses the selection. */
      if (selFig && !here("figcaption")) {
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          var nxt = selFig.nextElementSibling || selFig.previousElementSibling;
          selFig.remove();
          clearFigure();
          ensureGaps();
          if (nxt) caretIn(nxt);
          return changed(true);
        }
        if (e.key.length === 1 && !mod) clearFigure();
      }

      var t = cellInfo();
      if (t && e.key === "Tab") { e.preventDefault(); return moveCell(t, e.shiftKey ? -1 : 1); }
      if (t && e.key === "Enter") {
        e.preventDefault();
        var below = t.rows[t.ri + 1];
        if (below) caretIn(below.cells[Math.min(t.ci, below.cells.length - 1)]); else tableOp("rowBelow");
        return;
      }

      if (e.key === "Tab" && !mod) {
        e.preventDefault();
        if (here("li")) indentList(e.shiftKey ? "outdent" : "indent");
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !mod) {
        var title = here(".block-title");
        if (title) { e.preventDefault(); var b = title.closest(".block").querySelector(".block-body p, .block-body li"); if (b) caretIn(b); return; }
        var cap = here("figcaption");
        if (cap) { e.preventDefault(); var fig = cap.closest("figure"); var p = fig.nextElementSibling; if (!p || !TEXT_BLOCK.test(p.tagName)) { p = newP(); fig.after(p); } caretIn(p); clearFigure(); return; }
        /* Enter on an empty last line inside a study block steps out of it. */
        var para = here("p");
        var body = para && para.parentNode.classList && para.parentNode.classList.contains("block-body") ? para.parentNode : null;
        if (body && isEmptyP(para) && para === body.lastElementChild && body.children.length > 1) {
          e.preventDefault();
          var aside = body.closest(".block");
          para.remove();
          var out = aside.nextElementSibling;
          if (!out || !TEXT_BLOCK.test(out.tagName)) { out = newP(); aside.after(out); }
          caretIn(out);
          return changed(true);
        }
      }
    });

    on(surface, "focus", refresh);
    on(surface, "blur", function () { setTimeout(function () { hideMenu(); }, 150); });

    /* ---------- API ---------- */

    var api = {
      load: function (md) {
        surface.innerHTML = MW.md.render(md || "", { edit: true }).html;
        fillEmpty(surface);
        ensureGaps();
        hist = [];
        hi = -1;
        snap();
        clearFigure();
        updateEmpty();
        refresh();
      },
      getMarkdown: function () { return MW.md.fromDom(surface); },
      focus: function () { surface.focus(); },
      show: function (visible) {
        bar.hidden = !visible;
        surface.hidden = !visible;
        if (!visible) { ctx.hidden = true; hideMenu(); closePop(); }
      },
      toolbar: bar,
      destroy: function () {
        cleanups.forEach(function (fn) { fn(); });
        if (speller) speller.destroy();
        hideMenu();
        closePop();
        clearTimeout(snapTimer);
      },
    };
    return api;
  }

  MW.visual = { attach: attach };
})();
