# MedWiki

A personal medical textbook. Static site, no build step, plus an optional tiny local server that saves your edits straight into your files.

## Run it

```
npm start          # or: node serve.js   → http://localhost:5173
npm test           # end-to-end smoke test (needs Chrome; uses a temp copy, never your content/)
```

You can also just open `index.html`. Everything works that way too, but edits are then kept **in this browser only** (see "Saving").

## Layout

```
index.html            home: welcome, continue editing, recently written (also ?tag=<name> and ?tags=all)
print.html            journal-style print view for one or many articles (?a=id1,id2)
article.html          reader and editor for every article (?a=<id>)
pyq.html              PYQ bank: every ::: pyq block, filterable
content/              one file per article, in Markdown  ← your textbook
  _chapters.js        chapters you created in the editor
assets/css/           tokens · base · layout · article · edit · preview · home · print · journal
assets/js/            data (structure + manifest) · core · markdown · search · palette · chrome ·
                      article · editor · preview · home · pyq · print · dialogs
serve.js              local server: static files + save/delete/image endpoints (no dependencies)
tests/smoke.mjs       automated end-to-end test
_legacy/              the original single-file build
```

## Saving

| How you run it | What Save does |
|---|---|
| `node serve.js` | Writes `content/<id>.js`, adds new articles to the manifest in `assets/js/data.js`, and new chapters in `content/_chapters.js`. Nothing is left only in the browser. |
| Opening the files directly | Keeps the edit in this browser (localStorage). The editor says so. Use palette → **Export this article as a content file** to move it into `content/`, or **Export backup** for everything. |

If you edited in browser-only mode and later start the server, the palette offers **Write browser edits to files**. The server only accepts writes from localhost.

## Images (ImgBB)

Paste, drop or pick an image while editing. It is resized, kept on your device (IndexedDB) and inserted as `![caption](img:<id>)` immediately, so writing never waits on the network.

- Add a free key from https://api.imgbb.com/ in palette → **Image uploads (ImgBB)…** (or click the "images · add key" badge). Waiting images then upload in the background: one at a time, a pause between uploads and a longer rest every 4, exponential backoff with `Retry-After` support on rate limits or network errors, paused on a bad key, and resumed when you come back online. Only one tab uploads at a time.
- When an upload finishes, every article using the image is rewritten to the hosted URL (and saved to `content/` if the server is running). Nothing is lost if it never uploads: the image stays in the browser until it does.
- Optional fallback: save to `content/images/` if ImgBB keeps failing (needs `node serve.js`).
- Sizing: put the caret on an image line and use the bar (25 / 33 / 50 / 75 / Full, Left / Center / Right) with a live mini preview. It writes `![caption](src){50% right}`. Click an image in an article to view it full size.
- Browser storage is per browser: use **Export backup** before clearing site data if images are still waiting.

## Structure vs tags

Navigation is **Subject → Chapter → Article → Heading**. It comes from `subject` and `chapter` in each article's front matter (ids in `assets/js/data.js`; chapters made in the editor are added automatically) and from `##` headings. **Tags** (`drug`, `organism`, `LAQ`, `PYQ`, `must-revise`…) are separate and only add cross-cutting relationships (`index.html?tag=drug`).

## Article format

```
---
title: Rapidly progressive glomerulonephritis
subject: pathology
chapter: kidney
kind: Disease
aliases: RPGN, Crescentic GN
tags: disease, must-revise
importance: high            # high | medium | low
status: draft               # draft | review | revised
edited: 2026-09-19
---
::: definition
Text. Link pages with [[Tuberculosis]], [[Page|label]], [[Page#Heading]]. ==Highlight== key facts.
:::

## Heading
Paragraph, **bold**, *italic*, lists, tables, images.
```

- **Study blocks** (`::: name`) are yours to define: press Ctrl+K → **Manage block types…** (or use the last entry of any block menu) to add, rename, recolour or delete them. `::: pyq` blocks (title them `::: pyq LAQ · 2024`) feed the PYQ bank. `::: flow` with `A -> B -> C` makes a horizontal flowchart; `::: flow vertical` stacks the steps top to bottom; add `center` or `right` to place the chart in the column (`::: flow vertical center`). Each line is one chain, so several lines give several chains. In the visual editor the Insert menu has both, and a Horizontal | Vertical switch sits on the chart.
- In a table cell, write a piped link as `[[Page\|label]]`.
- Links to pages that don't exist show red; click to create. Each page ends with "Referenced by …" (backlinks), and hovering any link shows a preview card.

## Editing

Press **E** or the floating Edit button. The article becomes a word-processor style editor (like Wikipedia's VisualEditor): you edit the page exactly as it reads, and it is saved as Markdown behind the scenes.

- **Toolbar:** undo/redo, text style (normal, heading, subheading), bold, italic, highlight, link, lists, indent, and **Insert** (table, image, flowchart, quote, divider, and every study block).
- **On the page:** type `~` (anywhere) or `/` (on an empty line) for the Insert menu, e.g. `~image`, `~table`, `~quote`, `~divider`, `~pearl`; `##`, `-`, `1.`, `>` followed by a space start a heading, list or quote; `[[` or **Ctrl+K** links a page (or a web address); select text and use the toolbar; paste from Word, Google Docs or a web page and it is cleaned up; paste or drop images.
- **Tables:** Tab moves between cells (Tab in the last cell adds a row); a bar above the table adds and removes rows and columns.
- **Images:** click an image for size presets, a width slider, alignment and delete; type the caption underneath it.
- **Study blocks:** click a block's label to change its type, use the arrows to move it, and press Enter twice at the end to step out of it.
- **Source tab:** switch to Visual | Source to edit the raw Markdown instead (the two stay in sync). Your last choice is remembered.
- Drafts are autosaved; if you reload mid-edit you get them back. **Ctrl+S** saves.

## Studying

- **Revision mode** (button, or **R**) hides explanatory paragraphs and keeps headings, study blocks, lists, tables, images, highlights and PYQs.
- **Test myself** (in revision mode) blanks every `==highlight==` until you click it.
- The home page lists a **To revise** queue (anything not marked Revised, highest yield first). Click an article's status chip to move it draft → to revise → revised.
- The **PYQ bank** gathers every PYQ block by type, subject and year, each linking back to its section.

## Keys

`Ctrl/Cmd+K` or `/` palette · `E` edit · `R` revision · `?` all shortcuts · `>` in the palette shows commands only.

## Adding an article by file

Copy `content/_template.js` to `content/<id>.js`, change the id, and add it to `MedWiki.manifest` in `assets/js/data.js`. (The server does this for you when you create pages in the editor.)

## After changing code

Browsers (and VS Code Live Server) cache scripts and styles. If a change doesn't show up, hard-refresh (Ctrl+Shift+R) or run `npm run bump`, which stamps every script/stylesheet link in the HTML pages with a new version. Articles in `content/` are always fetched fresh.

## Tuning the look

Reading density is four variables in `assets/css/tokens.css`: `--prose-size`, `--prose-leading`, `--para-gap`, `--col`.

## Printing and PDF

Press **P** on an article, use the Print button beside Save, or Ctrl+K → **Print articles…** to pick a whole set (grouped by subject and chapter). The print view lays articles out like a journal paper: serif text, numbered sections and figures, ruled tables, tinted study blocks and tight margins. The toolbar sets text size, one or two columns, margin width, section numbers, a contents page, page breaks and images; choices are remembered. Press **Print / Save as PDF** and turn off "Headers and footers" in the browser dialog.

## Settings

The gear in the top bar (or Ctrl+K → **Settings…**) gathers image hosting (guided ImgBB setup with links to sign up, get a key and open your account), block types, printing and backup. On the home page a reminder appears when pages exist only in this browser and have not been backed up for a week. Backups now include your block types (never your ImgBB key).

## Hosting on Vercel

The site is fully static, so there is nothing to build. In Vercel: **Add New → Project → import the GitHub repo**, leave every setting at its default (`vercel.json` already sets framework "Other", no build command, output folder `.`), and deploy. Every push to `main` redeploys.

- Articles live in `content/` (and the manifest in `assets/js/data.js`). Write them locally with `npm start`, which saves to those files, then commit and push. Edits made on the hosted site are stored only in that visitor's browser (there is no server to write files), so treat the hosted copy as read-mostly and use **Export backup** if you do write there.
- Icons: `assets/favicon.svg` and `favicon.ico` (browser tab), `assets/icons/` (home-screen, maskable and Apple icons, the vector `logo.svg`, and `og-image.png` for link previews), `site.webmanifest` (installable app).
- `404.html` is the not-found page; `.vercelignore` keeps tests and tools out of the deployment.
- Link previews need an absolute image URL. Once you know your domain, add `<meta property="og:image" content="https://YOUR-DOMAIN/assets/icons/og-image.png">` to `index.html`.

## Finishing articles and choosing what to write

- Every article is **in progress** until you press **Mark as finished** at its end (a seal stamps the page). **Reopen for editing** puts it back. The date is stored as `finished:` in the front matter. Home shows how many are in progress.
- **Help me choose** (home, or Ctrl+K) picks one of your in-progress articles with a wheel of fortune, a slot machine, a fortune cookie or a bowl of chits. "Surprise me" picks the game too.
