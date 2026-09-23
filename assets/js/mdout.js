/*
 * DOM → Markdown: turns the visual editor's content back into the article's
 * Markdown source. It is the inverse of MW.md.render(body, { edit: true }).
 *
 *   MW.md.fromDom(rootElement) → Markdown string
 *
 * It only reads structure it understands (headings, paragraphs, lists, tables,
 * quotes, study blocks, flowcharts, figures, links, bold/italic/highlight/code),
 * so pasted junk from other programs cannot leak into an article.
 */
(function () {
  var MW = window.MedWiki;

  var BLOCK_TAGS = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE|TABLE|ASIDE|FIGURE|LI|SECTION|ARTICLE)$/;
  var BLOCK_START = /^(#{1,4}\s|[-*+]\s|\d+[.)]\s|>|:::|\||-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|```)/;

  function cls(el, name) { return el.classList && el.classList.contains(name); }
  function isBlockEl(n) { return n.nodeType === 1 && BLOCK_TAGS.test(n.tagName); }
  /* An inline wrapper (<b>, <span>…) around real blocks, as pasted from Google Docs or Word. */
  function hasBlocks(n) {
    return n.nodeType === 1 && !!n.querySelector("p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, figure, aside, pre, hr, div, li");
  }

  /* Merge neighbouring <strong><strong> style runs so the output is **ab** not **a****b**. */
  function mergeRuns(node) {
    var kid = node.firstChild;
    while (kid) {
      var next = kid.nextSibling;
      if (kid.nodeType === 1 && /^(STRONG|B|EM|I|MARK|CODE)$/.test(kid.tagName) && next && next.nodeType === 1 && next.tagName === kid.tagName) {
        while (next.firstChild) kid.appendChild(next.firstChild);
        next.remove();
        continue; /* look at the same node again */
      }
      if (kid.nodeType === 1) mergeRuns(kid);
      kid = next;
    }
  }

  function wrapMark(open, close, inner) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    return m[2] ? m[1] + open + m[2] + close + m[3] : inner;
  }

  function styleMarks(el, inner) {
    var st = el.style || {};
    var bold = st.fontWeight === "bold" || Number(st.fontWeight) >= 600;
    var ital = st.fontStyle === "italic";
    if (bold) inner = wrapMark("**", "**", inner);
    if (ital) inner = wrapMark("*", "*", inner);
    return inner;
  }

  function inlineOut(node) {
    var out = "";
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) {
        out += n.nodeValue.replace(/[\u200b\ufeff]/g, "").replace(/\u00a0/g, " ").replace(/\s*\n\s*/g, " ");
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.getAttribute("contenteditable") === "false" && !cls(n, "wikilink")) return;
      var tag = n.tagName;
      var inner;
      if (tag === "BR") { out += "\u0001"; return; }
      if (tag === "STRONG" || tag === "B") {
        /* Google Docs wraps whole pastes in <b style="font-weight:normal"> */
        out += n.style && n.style.fontWeight === "normal" ? inlineOut(n) : wrapMark("**", "**", inlineOut(n));
        return;
      }
      if (tag === "EM" || tag === "I") { out += wrapMark("*", "*", inlineOut(n)); return; }
      if (tag === "MARK") { out += wrapMark("==", "==", inlineOut(n)); return; }
      if (tag === "CODE") { var c = n.textContent.replace(/`/g, ""); out += c ? "`" + c + "`" : ""; return; }
      if (tag === "IMG") {
        var key = n.getAttribute("data-key");
        var src = key ? "img:" + key : n.getAttribute("src") || "";
        if (src) out += "![" + (n.getAttribute("alt") || "") + "](" + src + ")";
        return;
      }
      if (tag === "A") {
        var label = inlineOut(n);
        var target = n.getAttribute("data-target");
        if (target != null) {
          var text = n.textContent.replace(/\u00a0/g, " ").trim();
          var heading = n.getAttribute("data-heading");
          if (!text) return;
          if (!heading && text === target) out += "[[" + target + "]]";
          else out += "[[" + target + (heading ? "#" + heading : "") + "|" + text + "]]";
          return;
        }
        var href = n.getAttribute("href");
        out += href && label.trim() && href !== "#" ? "[" + label + "](" + href + ")" : label;
        return;
      }
      inner = inlineOut(n);
      out += n.style ? styleMarks(n, inner) : inner;
    });
    return out;
  }

  function paragraph(text) {
    text = text.replace(/[ \t]+/g, " ").replace(/^[\s\u0001]+|[\s\u0001]+$/g, "");
    if (!text) return "";
    text = text.replace(/ ?\u0001[ \u0001]*/g, "\\\n");
    /* a line after a hard break must not look like the start of a list, heading or block */
    text = text.split("\n").map(function (l, i) { return i && BLOCK_START.test(l) ? "\u200b" + l : l; }).join("\n");
    return BLOCK_START.test(text) ? "\u200b" + text : text;
  }

  /*
   * A paragraph with line breaks. Lines after a break that start with "- ", "* " or "1. " were typed as list
   * items, so they become a real list; everything else stays a paragraph.
   */
  function paragraphs(raw) {
    var LISTLINE = /^([-*+]|\d+[.)])\s+(.*)$/;
    var out = [];
    var cur = [];
    var list = [];
    function flushPara() {
      if (!cur.length) return;
      var t = paragraph(cur.join("\u0001"));
      if (t) out.push(t);
      cur = [];
    }
    function flushList() {
      if (list.length) out.push(list.join("\n"));
      list = [];
    }
    raw.split("\u0001").forEach(function (seg, i) {
      seg = seg.replace(/[ \t\u200b]+/g, " ").trim();
      var m = i > 0 && LISTLINE.exec(seg);
      if (m) {
        flushPara();
        list.push((/\d/.test(m[1]) ? m[1].replace(/\)$/, ".") : "-") + " " + m[2]);
      } else {
        flushList();
        cur.push(seg);
      }
    });
    flushPara();
    flushList();
    return out;
  }

  function listOut(list, depth) {
    var lines = [];
    var ordered = list.tagName === "OL";
    var n = 0;
    list.childNodes.forEach(function (li) {
      if (li.nodeType !== 1) return;
      if (li.tagName === "UL" || li.tagName === "OL") { lines = lines.concat(listOut(li, depth + 1)); return; }
      if (li.tagName !== "LI") return;
      n++;
      var text = "";
      var nested = [];
      li.childNodes.forEach(function (c) {
        if (c.nodeType === 1 && (c.tagName === "UL" || c.tagName === "OL")) nested = nested.concat(listOut(c, depth + 1));
        else if (c.nodeType === 1 && c.tagName === "P") text += " " + inlineOut(c);
        else if (c.nodeType === 1 && c.tagName === "DIV") text += " " + inlineOut(c);
        else if (c.nodeType === 3) text += inlineOut({ childNodes: [c] });
        else if (c.nodeType === 1) text += inlineOut({ childNodes: [c] });
      });
      lines.push(new Array(depth + 1).join("  ") + (ordered ? n + "." : "-") + " " + (text.replace(/[\s\u0001]+/g, " ").trim() || " "));
      lines = lines.concat(nested);
    });
    return lines;
  }

  function cellText(cell) {
    return inlineOut(cell).replace(/[\s\u0001]+/g, " ").trim().replace(/\|/g, "\\|");
  }

  function tableOut(table) {
    var rows = [].slice.call(table.querySelectorAll("tr")).map(function (tr) {
      return [].slice.call(tr.children).filter(function (c) { return /^(TD|TH)$/.test(c.tagName); });
    }).filter(function (r) { return r.length; });
    if (!rows.length) return "";
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    function line(cells) {
      var out = [];
      for (var i = 0; i < cols; i++) out.push(cells[i] ? cellText(cells[i]) : "");
      return "| " + out.join(" | ") + " |";
    }
    var sep = [];
    for (var i = 0; i < cols; i++) {
      var a = rows[0][i] && rows[0][i].style.textAlign;
      sep.push(a === "center" ? ":---:" : a === "right" ? "---:" : "---");
    }
    var lines = [line(rows[0]), "| " + sep.join(" | ") + " |"];
    rows.slice(1).forEach(function (r) { lines.push(line(r)); });
    return lines.join("\n");
  }

  function figureOut(fig) {
    var src = fig.getAttribute("data-src");
    if (!src) {
      var img = fig.querySelector("img");
      var key = img && img.getAttribute("data-key");
      src = key ? "img:" + key : (img && img.getAttribute("src")) || "";
    }
    if (!src) return "";
    var cap = fig.querySelector("figcaption");
    var alt = cap ? cap.textContent.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim() : "";
    var w = Number(fig.getAttribute("data-w")) || 0;
    var align = fig.getAttribute("data-align") || "";
    var parts = [];
    if (w && w < 100) parts.push(w + "%");
    if (/^(left|right|center)$/.test(align)) parts.push(align);
    return "![" + alt + "](" + src + ")" + (parts.length ? "{" + parts.join(" ") + "}" : "");
  }

  function blockOut(aside) {
    var type = aside.getAttribute("data-type") || "note";
    var titleEl = aside.querySelector(":scope > .block-head > .block-title");
    var title = titleEl ? inlineOut(titleEl).replace(/[\s\u0001]+/g, " ").trim() : "";
    var body = aside.querySelector(":scope > .block-body");
    var inner = body ? blocksOut(body).join("\n\n") : "";
    return "::: " + type + (title ? " " + title : "") + "\n" + (inner ? inner + "\n" : "") + ":::";
  }

  function flowOut(el) {
    var lines = [];
    var box = el.querySelector(".flow-lines");
    (box ? [].slice.call(box.children) : []).forEach(function (row) {
      var t = row.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    });
    var align = el.getAttribute("data-align");
    return "::: flow" + (el.getAttribute("data-dir") === "vertical" ? " vertical" : "") + (align === "center" || align === "right" ? " " + align : "") + "\n" + (lines.length ? lines.join("\n") + "\n" : "") + ":::";
  }

  /* → array of Markdown blocks for the children of `el` */
  function blocksOut(el) {
    var out = [];
    var run = null; /* consecutive inline nodes make one paragraph */
    function flush() {
      if (!run) return;
      out = out.concat(paragraphs(inlineOut({ childNodes: run })));
      run = null;
    }
    [].slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !isBlockEl(n) && !hasBlocks(n))) {
        if (n.nodeType === 1 && n.getAttribute("contenteditable") === "false" && !cls(n, "wikilink")) return;
        (run = run || []).push(n);
        return;
      }
      if (n.nodeType !== 1) return;
      flush();
      var tag = n.tagName;
      var t;
      if (tag === "ASIDE" && cls(n, "block")) out.push(blockOut(n));
      else if (cls(n, "flow-src")) out.push(flowOut(n));
      else if (tag === "FIGURE") { t = figureOut(n); if (t) out.push(t); }
      else if (/^H[1-6]$/.test(tag)) {
        var level = Math.max(2, Math.min(4, Number(tag[1])));
        t = inlineOut(n).replace(/[\s\u0001]+/g, " ").trim();
        if (t) out.push(new Array(level + 1).join("#") + " " + t);
      } else if (tag === "UL" || tag === "OL") out.push(listOut(n, 0).join("\n"));
      else if (tag === "BLOCKQUOTE") {
        t = blocksOut(n).join("\n\n");
        if (t) out.push(t.split("\n").map(function (l) { return l ? "> " + l : ">"; }).join("\n"));
      } else if (tag === "HR") out.push("---");
      else if (tag === "PRE") out.push("```\n" + n.textContent.replace(/\n$/, "") + "\n```");
      else if (tag === "TABLE") { t = tableOut(n); if (t) out.push(t); }
      else if (tag === "P" || tag === "LI") {
        /* Browsers sometimes nest a list or paragraph inside a <p>: treat that as a container. */
        if (hasBlocks(n)) out = out.concat(blocksOut(n));
        else out = out.concat(paragraphs(inlineOut(n)));
      }
      else if (cls(n, "table-wrap")) { var tb = n.querySelector("table"); t = tb ? tableOut(tb) : ""; if (t) out.push(t); }
      else {
        /* DIV, SECTION…: a wrapper the browser added. Dive in if it holds blocks, else treat as a paragraph. */
        var holds = hasBlocks(n);
        if (holds) out = out.concat(blocksOut(n));
        else out = out.concat(paragraphs(inlineOut(n)));
      }
    });
    flush();
    return out;
  }

  MW.md.fromDom = function (root) {
    var copy = root.cloneNode(true);
    mergeRuns(copy);
    var md = blocksOut(copy).join("\n\n").replace(/\u0001/g, " ");
    return md ? md + "\n" : "";
  };
})();
