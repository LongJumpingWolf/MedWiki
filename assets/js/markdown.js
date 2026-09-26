/*
 * Markdown renderer for MedWiki articles.
 *
 * Supported: ## / ### headings, paragraphs, **bold**, *italic*, ==highlight==,
 * `code`, [links](url), [[wikilinks]] ([[Page]], [[Page|label]], [[Page#Heading]]),
 * quick bites ({{Term}}, {{Term|label}}: hover for a one-glance definition),
 * bullet / numbered lists (nested by indent), > quotes, --- rules, pipe tables,
 * images (![caption](src), src may be img:<key>), and study blocks:
 *
 *   ::: definition
 *   text
 *   :::
 *   ::: pyq LAQ · 2019, 2022
 *   ::: flow
 *   Step 1 -> Step 2 -> Step 3
 *
 * Block types are user-defined (MW.blockTypes, in core.js): each has a label
 * and a colour, editable from the block menu. Blocks can nest and contain
 * any Markdown.
 */
(function () {
  var MW = window.MedWiki;
  var esc = MW.esc;

  var RE = {
    heading: /^(#{1,4})\s+(.*?)\s*#*\s*$/,
    fence: /^```/,
    open: /^:::\s*([a-z]+)\s*(.*)$/i,
    close: /^:::\s*$/,
    hr: /^(-{3,}|\*{3,}|_{3,})\s*$/,
    list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    quote: /^>\s?/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
    image: /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/,
  };

  /* ---------- Inline ---------- */

  function safeHref(u) {
    return /^\s*(javascript|data|vbscript):/i.test(MW.unesc(u)) ? "#" : u;
  }

  function imageSrc(u) {
    var raw = MW.unesc(u);
    var m = /^img:([a-z0-9]+)$/.exec(raw);
    if (m) return esc(MW.images.get(m[1]) || "");
    if (/^data:image\//i.test(raw) || /^(https?:|\.{0,2}\/|[\w-]+\/)/i.test(raw)) return u;
    return "";
  }

  /* <img> for an image reference; img:<key> refs carry their upload state. */
  function imgTag(altEsc, uEsc) {
    var m = /^img:([a-z0-9]+)$/.exec(MW.unesc(uEsc));
    var extra = "";
    if (m) {
      var st = MW.images.state(m[1]);
      extra = ' data-key="' + m[1] + '"' + (st === "done" ? "" : ' data-state="' + st + '"');
    }
    return '<img src="' + imageSrc(uEsc) + '" alt="' + altEsc + '" loading="lazy" decoding="async"' + extra + ">";
  }

  /* {50%}, {right}, {40% left}: width and alignment after a block image. */
  function figureOpts(spec) {
    var o = { w: 0, align: "" };
    (spec || "").split(/[\s,]+/).forEach(function (t) {
      var n = /^(\d{1,3})%?$/.exec(t);
      if (n) o.w = Math.max(10, Math.min(100, Number(n[1])));
      else if (/^(left|right|center)$/i.test(t)) o.align = t.toLowerCase();
    });
    return o;
  }

  function wiki(_, target, heading, label) {
    var t = MW.unesc(target).trim();
    var page = MW.resolve(t);
    var text = label || target.trim();
    var data = ' data-target="' + esc(t) + '"' + (heading ? ' data-heading="' + heading + '"' : "");
    if (page) {
      var hash = heading ? MW.slug(MW.unesc(heading)) : "";
      return '<a class="wikilink"' + data + ' href="' + MW.pageUrl(page.id, hash) + '">' + text + "</a>";
    }
    return (
      '<a class="wikilink missing"' + data + ' href="#" data-create="' + esc(t) + '" title="This page does not exist yet. Click to create it.">' +
      text + "</a>"
    );
  }

  /* {{Term}} or {{Term|label}}: a quick bite. Turns into a hover definition (red dashed when no such bite exists yet). */
  function bite(_, target, label) {
    var t = MW.unesc(target).trim();
    var found = MW.bites && MW.bites.resolve(t);
    return '<span class="bite' + (found ? "" : " missing") + '" data-bite="' + esc(t) + '" tabindex="0">' + (label || target.trim()) + "</span>";
  }

  function inline(src) {
    var codes = [];
    src = src.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    src = esc(src);
    src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, u) {
      return imgTag(alt, u);
    });
    src = src.replace(/\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|([^\]]+?))?\]\]/g, wiki);
    src = src.replace(/\{\{([^{}|]+?)(?:\|([^{}]+?))?\}\}/g, bite);
    src = src.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      var ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : "";
      return '<a href="' + safeHref(u) + '"' + ext + ">" + t + "</a>";
    });
    src = src.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    src = src.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    src = src.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
    src = src.replace(/==(.+?)==/g, "<mark>$1</mark>");
    return src.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return "<code>" + esc(codes[i]) + "</code>";
    }).replace(/\u0001/g, "<br>");
  }

  function plainInline(s) {
    return s
      .replace(/\{\{([^{}|]+?)\|([^{}]+?)\}\}/g, "$2")
      .replace(/\{\{([^{}|]+?)\}\}/g, "$1")
      .replace(/\[\[([^\]|#]+?)(?:#[^\]|]+?)?\|([^\]]+?)\]\]/g, "$2")
      .replace(/\[\[([^\]|#]+?)(?:#[^\]|]+?)?\]\]/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*`=]/g, "")
      .trim();
  }

  /* ---------- Blocks ---------- */

  function isBlockStart(lines, i) {
    var l = lines[i];
    return (
      RE.heading.test(l) || RE.fence.test(l) || RE.open.test(l) || RE.close.test(l) || RE.hr.test(l) ||
      RE.list.test(l) || RE.quote.test(l) ||
      (l.indexOf("|") !== -1 && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]))
    );
  }

  function splitRow(line) {
    /* A pipe inside a cell is written \| (needed for [[Page\|label]] in tables). */
    return line.trim().replace(/^\|/, "").replace(/(^|[^\\])\|$/, "$1").split(/(?<!\\)\|/).map(function (c) {
      return c.trim().replace(/\\\|/g, "|");
    });
  }

  function renderTable(lines, ctx) {
    var head = splitRow(lines[0]);
    var align = splitRow(lines[1]).map(function (c) {
      return /^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : "";
    });
    function cell(tag, text, i) {
      var st = align[i] ? ' style="text-align:' + align[i] + '"' : "";
      return "<" + tag + st + ">" + inline(text) + "</" + tag + ">";
    }
    var html = '<div class="table-wrap"><table><thead><tr>' + head.map(function (c, i) { return cell("th", c, i); }).join("") + "</tr></thead><tbody>";
    for (var r = 2; r < lines.length; r++) {
      html += "<tr>" + splitRow(lines[r]).map(function (c, i) { return cell("td", c, i); }).join("") + "</tr>";
    }
    return html + "</tbody></table></div>";
  }

  function renderList(lines) {
    var rootNode = { indent: -1, kids: [] };
    var stack = [rootNode];
    lines.forEach(function (line) {
      var m = RE.list.exec(line);
      if (!m) {
        var top = stack[stack.length - 1];
        if (top.text != null) top.text += " " + line.trim();
        return;
      }
      var node = { indent: m[1].replace(/\t/g, "  ").length, ordered: /\d/.test(m[2]), text: m[3], kids: [] };
      while (stack.length > 1 && stack[stack.length - 1].indent >= node.indent) stack.pop();
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    });
    function out(kids) {
      if (!kids.length) return "";
      var tag = kids[0].ordered ? "ol" : "ul";
      return "<" + tag + ">" + kids.map(function (k) {
        return "<li>" + inline(k.text) + out(k.kids) + "</li>";
      }).join("") + "</" + tag + ">";
    }
    return out(rootNode.kids);
  }

  /* "::: flow vertical" (or down / v) stacks the steps top to bottom; the default is left to right. */
  function flowDir(title) {
    return /\b(vertical|down|v)\b/i.test(title || "") ? "vertical" : "horizontal";
  }

  /* "center" or "right" places the chart in the column; the default is left. */
  function flowAlign(title) {
    var m = /\b(center|centre|right)\b/i.exec(title || "");
    return !m ? "left" : /^right$/i.test(m[1]) ? "right" : "center";
  }

  function renderFlow(lines, ctx, title) {
    var dir = flowDir(title);
    var align = flowAlign(title);
    var rows = lines.filter(function (l) { return l.trim(); });
    var chart = '<div class="flow' + (dir === "vertical" ? " flow-vertical" : "") + (align !== "left" ? " flow-" + align : "") + '">' + rows.map(function (l) {
      var steps = l.split(/\s*(?:->|→)\s*/);
      /* each arrow travels with the box before it, so a wrapped chain never starts a line with an arrow */
      return '<div class="flow-row">' + steps.map(function (step, i) {
        var box = "<span>" + inline(step) + "</span>";
        return i < steps.length - 1 ? '<em class="flow-unit">' + box + '<i class="flow-arrow" aria-hidden="true"></i></em>' : box;
      }).join("") + "</div>";
    }).join("") + "</div>";
    if (ctx && ctx.edit) {
      return '<div class="flow-src" data-type="flow" data-dir="' + dir + '" data-align="' + align + '"><div class="block-head" contenteditable="false"><span class="block-label">Flowchart</span>' +
        '<span class="flow-dir" role="group" aria-label="Direction"><button type="button" data-act="dir-h" aria-pressed="' + (dir === "horizontal") + '">Horizontal</button>' +
        '<button type="button" data-act="dir-v" aria-pressed="' + (dir === "vertical") + '">Vertical</button></span>' +
        '<span class="flow-dir" role="group" aria-label="Alignment"><button type="button" data-act="al-left" aria-pressed="' + (align === "left") + '">Left</button>' +
        '<button type="button" data-act="al-center" aria-pressed="' + (align === "center") + '">Centre</button>' +
        '<button type="button" data-act="al-right" aria-pressed="' + (align === "right") + '">Right</button></span>' +
        '<span class="block-hint">one chain per line, steps joined by -&gt;</span>' + BLOCK_CTL + '</div><div class="flow-lines">' +
        (rows.map(function (l) { return "<div>" + esc(l) + "</div>"; }).join("") || "<div><br></div>") + "</div>" +
        '<div class="flow-preview" contenteditable="false">' + chart + "</div></div>";
    }
    return chart;
  }

  /* "::: html" passes its contents through untouched — real markup, not the Markdown DSL.
     In edit mode it shows as a read-only code block (Source mode is where it's actually edited); in
     the published article it is injected exactly as written. The raw text lives in data-src so no
     amount of contenteditable churn around it can ever mangle it. */
  function renderHtml(lines, ctx) {
    var raw = lines.join("\n");
    if (ctx && ctx.edit) {
      return (
        '<div class="html-src" data-type="html" contenteditable="false" data-src="' + esc(raw) + '">' +
        '<div class="block-head"><span class="block-label">Raw HTML</span>' +
        '<span class="block-hint">edited in Source mode</span>' + BLOCK_CTL + "</div>" +
        "<pre class=\"html-code\">" + esc(raw) + "</pre></div>"
      );
    }
    return raw;
  }

  var BLOCK_CTL =
    '<span class="block-ctl"><button type="button" data-act="up" title="Move up" aria-label="Move up">\u2191</button>' +
    '<button type="button" data-act="down" title="Move down" aria-label="Move down">\u2193</button>' +
    '<button type="button" data-act="del" title="Delete" aria-label="Delete">\u2715</button></span>';

  function uniqueId(ctx, text) {
    var base = MW.slug(text);
    var id = base;
    var n = 2;
    while (ctx.ids[id]) id = base + "-" + n++;
    ctx.ids[id] = true;
    return id;
  }

  function blocks(lines, ctx) {
    var html = "";
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      var m;
      if (RE.fence.test(line)) {
        var code = [];
        i++;
        while (i < lines.length && !RE.fence.test(lines[i])) code.push(lines[i++]);
        i++;
        html += "<pre><code>" + esc(code.join("\n")) + "</code></pre>";
        continue;
      }

      if ((m = RE.open.exec(line))) {
        var depth = 1;
        var inner = [];
        i++;
        while (i < lines.length) {
          if (RE.close.test(lines[i])) { if (--depth === 0) break; }
          else if (RE.open.test(lines[i])) depth++;
          inner.push(lines[i++]);
        }
        i++;
        html += renderBlock(m[1].toLowerCase(), m[2].trim(), inner, ctx);
        continue;
      }

      if ((m = RE.heading.exec(line))) {
        var level = Math.max(2, m[1].length);
        var id = uniqueId(ctx, plainInline(m[2]));
        if (level <= 3) ctx.headings.push({ level: level, text: plainInline(m[2]), id: id });
        html += "<h" + level + ' id="' + id + '">' + inline(m[2]) + (ctx.edit ? "" : '<a class="h-anchor" href="#' + id + '" aria-label="Link to this section">#</a>') + "</h" + level + ">";
        i++;
        continue;
      }

      if (RE.hr.test(line)) { html += "<hr>"; i++; continue; }

      if (line.indexOf("|") !== -1 && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        var rows = [line, lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) rows.push(lines[i++]);
        html += renderTable(rows, ctx);
        continue;
      }

      if (RE.list.test(line)) {
        var items = [];
        while (i < lines.length && lines[i].trim() && (RE.list.test(lines[i]) || /^\s+\S/.test(lines[i]))) items.push(lines[i++]);
        html += renderList(items);
        continue;
      }

      if (RE.quote.test(line)) {
        var q = [];
        while (i < lines.length && RE.quote.test(lines[i])) q.push(lines[i++].replace(RE.quote, ""));
        html += "<blockquote>" + blocks(q, ctx) + "</blockquote>";
        continue;
      }

      var para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines, i))) para.push(lines[i++]);
      /* a line ending in "\" or two spaces is a hard line break; other line ends join with a space */
      var text = para.map(function (l, i) {
        if (i === para.length - 1) return l;
        if (/\\\s*$/.test(l)) return l.replace(/\\\s*$/, "") + "\u0001";
        if (/ {2,}$/.test(l)) return l.replace(/\s+$/, "") + "\u0001";
        return l + " ";
      }).join("").trim();
      if ((m = RE.image.exec(text))) {
        var fo = figureOpts(m[3]);
        if (ctx.edit) {
          html += '<figure contenteditable="false" data-src="' + esc(m[2]) + '"' + (fo.w ? ' data-w="' + fo.w + '"' : "") + (fo.align ? ' data-align="' + fo.align + '"' : "") +
            (fo.align ? ' class="fig-' + fo.align + '"' : "") + (fo.w ? ' style="--w:' + fo.w + '%"' : "") + ">" + imgTag(esc(m[1]), esc(m[2])) +
            '<figcaption contenteditable="true" data-placeholder="Add a caption">' + (m[1] ? inline(m[1]) : "") + "</figcaption></figure>";
          continue;
        }
        html += "<figure" + (fo.align ? ' class="fig-' + fo.align + '"' : "") + (fo.w ? ' style="--w:' + fo.w + '%"' : "") + ">" +
          imgTag(esc(m[1]), esc(m[2])) +
          (m[1] ? "<figcaption>" + inline(m[1]) + "</figcaption>" : "") + "</figure>";
      } else {
        html += "<p" + (text.indexOf("==") !== -1 ? ' class="keep"' : "") + ">" + inline(text) + "</p>";
      }
    }
    return html;
  }

  function renderBlock(type, title, inner, ctx) {
    if (type === "flow") return renderFlow(inner, ctx, title);
    if (type === "html") return renderHtml(inner, ctx);
    if (type === "pyq") ctx.pyq++;
    var bt = MW.blockTypes.get(type);
    var label = bt ? bt.label : type.charAt(0).toUpperCase() + type.slice(1);
    var tone = bt && bt.color ? ' style="--tone:' + esc(bt.color) + '"' : "";
    if (ctx.edit) {
      return (
        '<aside class="block block-' + type + '" data-type="' + type + '"' + tone + '><div class="block-head" contenteditable="false">' +
        '<span class="block-label" data-act="type" title="Change block type">' + esc(label) + "</span>" +
        '<span class="block-title" contenteditable="true" data-placeholder="Title (optional)">' + (title ? inline(title) : "") + "</span>" + BLOCK_CTL +
        '</div><div class="block-body">' + (blocks(inner, ctx) || "<p><br></p>") + "</div></aside>"
      );
    }
    return (
      '<aside class="block block-' + type + '"' + tone + '><div class="block-head"><span class="block-label">' + esc(label) + "</span>" +
      (title ? '<span class="block-title">' + inline(title) + "</span>" : "") +
      '</div><div class="block-body">' + blocks(inner, ctx) + "</div></aside>"
    );
  }

  /* ---------- Public API ---------- */

  MW.md = {
    inline: inline,

    /* → { html, headings:[{level,text,id}], pyq, words } */
    render: function (body, opts) {
      var ctx = { ids: {}, headings: [], pyq: 0, edit: !!(opts && opts.edit) };
      var html = blocks(body.replace(/\r\n?/g, "\n").split("\n"), ctx);
      return { html: html, headings: ctx.headings, pyq: ctx.pyq, words: MW.md.plain(body).split(/\s+/).filter(Boolean).length };
    },

    /* Text for search and word counts. Raw HTML blocks are markup, not prose, so they're skipped entirely. */
    plain: function (body) {
      var htmlDepth = 0;
      return body
        .split("\n")
        .filter(function (l) {
          if (htmlDepth) {
            if (RE.close.test(l) && --htmlDepth === 0) return false;
            if (RE.open.test(l) && RE.open.exec(l)[1].toLowerCase() === "html") htmlDepth++;
            return false;
          }
          var m = RE.open.exec(l);
          if (m && m[1].toLowerCase() === "html") { htmlDepth = 1; return false; }
          return !RE.fence.test(l) && !RE.close.test(l) && !RE.tableSep.test(l);
        })
        .map(function (l) {
          var m = RE.open.exec(l);
          if (m) l = m[2];
          return plainInline(l.replace(/^\s*(#{1,4}|>|[-*+]|\d+[.)])\s+/, "").replace(/\|/g, " ").replace(/->|→/g, " "));
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    },

    headings: function (body) {
      return MW.md.render(body).headings;
    },
  };
})();
