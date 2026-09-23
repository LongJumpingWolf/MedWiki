/*
 * End-to-end smoke test. Copies the project to a temp folder, starts serve.js
 * there, and drives headless Chrome through the main flows (reading, search,
 * revision/recall, editing, saving to files, creating pages, image paste,
 * drafts, mobile drawer, browser-only fallback).
 *
 *   node tests/smoke.mjs            (set CHROME=/path/to/chrome if it isn't found)
 *
 * Requires Node 22+ (global WebSocket/fetch). Never touches your real content/.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const TMP = mkdtempSync(join(tmpdir(), "medwiki-test-"));
const SITE = join(TMP, "site");
cpSync(SRC, SITE, { recursive: true, filter: (p) => !/[\\/](_legacy|tests|node_modules|\.git)([\\/]|$)/.test(p) });

/* The real content/ is empty; the tests run against sample articles kept in tests/fixtures. */
const FIXTURES = join(SRC, "tests", "fixtures", "content");
const fixtureIds = readdirSync(FIXTURES).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));
for (const id of fixtureIds) cpSync(join(FIXTURES, id + ".js"), join(SITE, "content", id + ".js"));
const dataFile = join(SITE, "assets", "js", "data.js");
const manifest = "MedWiki.manifest = [\n" + fixtureIds.map((id) => `  "${id}",\n`).join("") + "];";
writeFileSync(dataFile, readFileSync(dataFile, "utf8").replace(/MedWiki\.manifest\s*=\s*\[[\s\S]*?\];/, () => manifest));

const PORT = 5199;
const DEBUG = 9344;
const BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => existsSync(p));
if (!CHROME) { console.error("Chrome not found. Set CHROME=/path/to/chrome"); process.exit(2); }

const server = spawn(process.execPath, [join(SITE, "serve.js")], { env: { ...process.env, PORT: String(PORT), MEDWIKI_ROOT: SITE }, stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG}`, "--window-size=1440,1000",
  "--user-data-dir=" + mkdtempSync(join(tmpdir(), "medwiki-chrome-")), "about:blank"], { stdio: "ignore" });

let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); if (targets.length) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id); }
  else if (d.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true });
  else if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("eval failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + "\n  in: " + expr.slice(0, 120));
  return r.result?.value;
};
const waitFor = async (expr, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(80); } return false; };
const go = async (url) => { await send("Page.navigate", { url }); await sleep(150); await waitFor("document.readyState==='complete' && !!document.querySelector('.topbar')", 6000); await sleep(150); };
const key = async (k, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers: mods }); };
const text = (t) => send("Input.insertText", { text: t });
/* a real Enter (the plain key() helper only reaches JS handlers, not the browser's own text editing) */
const enter = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", text: String.fromCharCode(13), windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
};
const viewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });

await send("Runtime.enable"); await send("Page.enable");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✗ " + name + "\n      " + String(e.message).split("\n").join("\n      ")); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
const file = (rel) => join(SITE, rel);
const read = (rel) => readFileSync(file(rel), "utf8");

console.log("\nMedWiki smoke test (http, with server)\n");
await go(BASE + "index.html");
await ev("localStorage.clear(); sessionStorage.clear()");
await ev("localStorage.setItem('medwiki:editorMode', '\"source\"')"); /* Markdown-editor tests first; the visual tests switch it */

await test("server detected", async () => { await go(BASE + "index.html"); ok(await ev("MedWiki.server.available === true")); });

await test("home shows a welcome, the article to continue, and recently written ones", async () => {
  ok(await ev("!!document.querySelector('.welcome-head h1')"), "welcome heading missing");
  ok(await ev("!!document.querySelector('.continue-card') && document.querySelector('.continue-card strong').textContent.length > 0"), "continue card missing");
  ok(await ev("document.querySelectorAll('.recent-item').length >= 3"), "recent list missing");
  ok(await ev("document.querySelectorAll('.recent-item').length <= 4"), "recent list should stay short");
  ok(!(await ev("document.body.innerText.includes('No articles yet')")), "empty state should not show");
});

await test("print view: journal layout, numbered sections, contents page for several articles", async () => {
  await go(BASE + "print.html?a=tuberculosis,digoxin");
  await waitFor("!!document.querySelector('.jr-article')", 5000);
  ok(await ev("document.querySelectorAll('.jr-article').length === 2"), "both articles should render");
  ok(await ev("!!document.querySelector('.jr-cover .jr-toc a[href=\"#art-digoxin\"]')"), "contents page missing");
  ok(await ev("!document.querySelector('.jr-sheet .h-anchor') || getComputedStyle(document.querySelector('.jr-sheet .h-anchor')).display === 'none'"), "heading anchors should be hidden");
  ok(await ev("getComputedStyle(document.querySelector('.jr-text h2'), '::before').content.length > 2"), "section numbers missing");
  ok(await ev("document.querySelectorAll('.jr-sheet .block').length > 3"), "study blocks missing");
  await go(BASE + "print.html?a=digoxin");
  await waitFor("!!document.querySelector('.jr-article')", 5000);
  ok(await ev("!document.querySelector('.jr-cover')"), "a single article needs no contents page");
  ok(await ev("document.getElementById('jr-cols').value === '1'"), "toolbar option missing");
  await ev("(()=>{const s=document.getElementById('jr-cols'); s.value='2'; s.dispatchEvent(new Event('change'))})()");
  ok(await ev("document.getElementById('sheet').getAttribute('data-cols') === '2'"), "column option not applied");
  await ev("localStorage.removeItem('medwiki:print')");
});

await test("settings and print picker open; block types can be added and removed", async () => {
  await go(BASE + "index.html");
  await ev("document.querySelector('.settings-btn').click()");
  ok(await ev("!!document.querySelector('.settings-dialog')"), "settings dialog missing");
  await key("Escape");
  await ev("MedWiki.printDialog({preselect:['digoxin']})");
  ok(await ev("document.querySelectorAll('.pick-item input:checked').length === 1"), "preselect not applied");
  await ev("document.querySelector('.print-dialog [data-cancel]').click()");
  await ev("MedWiki.blockTypesDialog()");
  const before = await ev("document.querySelectorAll('.block-type-row').length");
  await ev("document.querySelector('.block-types-dialog [data-add]').click()");
  ok((await ev("document.querySelectorAll('.block-type-row').length")) === before + 1, "block type not added");
  await ev("window.confirm = () => true; document.querySelector('.block-type-row:last-child [data-del]').click()");
  ok((await ev("document.querySelectorAll('.block-type-row').length")) === before, "block type not removed");
  await ev("document.querySelector('.block-types-dialog [data-done]').click(); MedWiki.blockTypes.reset()");
});

await test("finishing an article: seal, saved to the file, home count drops, reopen restores it", async () => {
  await go(BASE + "article.html?a=digoxin");
  ok(await ev("!!document.querySelector('.end-mark.wip [data-finish]') && document.querySelector('.progress-chip').textContent.includes('In progress')"), "in-progress end mark missing");
  await ev("document.querySelector('[data-finish]').click()");
  ok(await waitFor("!!document.querySelector('.end-mark.done .end-title')", 4000), "finished seal did not appear");
  ok(await ev("document.querySelector('.end-title').textContent === 'The End' && document.querySelector('.progress-chip').textContent.includes('Finished')"), "finished state missing");
  await sleep(400);
  ok(/^finished: \d{4}-\d{2}-\d{2}$/m.test(read("content/digoxin.js")), "finished date not written to the file");
  await go(BASE + "index.html");
  ok(await ev("document.querySelector('.progress-count strong').textContent === '" + (fixtureIds.length - 1) + "'"), "in-progress count should drop by one");
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('[data-reopen]').click()");
  ok(await waitFor("!!document.querySelector('.end-mark.wip')", 4000), "reopen did not restore in-progress");
  await sleep(400);
  ok(!/^finished:/m.test(read("content/digoxin.js")), "finished should be removed from the file");
});

await test("help me choose: all four games land on an article you can open", async () => {
  await go(BASE + "index.html");
  await ev("document.querySelector('[data-choose]').click()");
  ok(await ev("!!document.querySelector('.choose-dialog .wheel')"), "wheel missing");
  await ev("document.querySelector('.choose-stage [data-go]').click()");
  ok(await waitFor("!!document.querySelector('.choose-result:not([hidden]) .choose-pick')", 8000), "wheel never finished");
  ok(await ev("document.querySelector('.choose-pick').getAttribute('href').startsWith('article.html?a=')"), "wheel result not a link");
  await ev("document.querySelector('[data-game=slots]').click()");
  ok(await ev("document.querySelectorAll('.reel').length === 3"), "slot reels missing");
  await ev("document.querySelector('.slot-lever').click()");
  ok(await waitFor("!!document.querySelector('.choose-result:not([hidden]) .choose-pick')", 9000), "slots never finished");
  ok(await ev("document.querySelector('.slot-machine').classList.contains('jackpot')"), "jackpot state missing");
  await ev("document.querySelector('[data-game=cookie]').click()");
  await ev("document.querySelector('.choose-stage [data-go]').click()");
  ok(await waitFor("!!document.querySelector('.choose-result:not([hidden]) .choose-pick')", 4000), "cookie never cracked");
  ok(await ev("document.querySelector('.slip span').textContent.length > 10"), "fortune text missing");
  await ev("document.querySelector('[data-game=chits]').click()");
  ok(await ev("document.querySelectorAll('.chit').length === 8"), "chits missing");
  await ev("document.querySelector('.chit').click()");
  ok(await waitFor("!!document.querySelector('.choose-result:not([hidden]) .choose-pick')", 4000), "chit never opened");
  await ev("document.querySelector('[data-again]').click()");
  ok(await ev("document.querySelector('.choose-result').hidden === true"), "go again should reset");
  await ev("document.querySelector('.choose-dialog [data-close]').click()");
  ok(await ev("!document.querySelector('.choose-dialog')"), "dialog should close");
});

await test("article renders with study blocks, header strip and no raw markup", async () => {
  await go(BASE + "article.html?a=tuberculosis");
  ok((await ev("document.querySelector('h1').textContent")) === "Tuberculosis");
  ok(await ev("document.querySelectorAll('.block').length >= 5"));
  ok(await ev("!!document.querySelector('.info-strip .tags')"), "tags should be inside the info strip");
  ok(!(await ev("/:::|\\*\\*|\\[\\[/.test(document.querySelector('.prose').innerText)")), "raw markup leaked");
});

await test("classification block lays out as columns", async () => {
  await go(BASE + "article.html?a=ace-inhibitors");
  ok(await ev("getComputedStyle(document.querySelector('.block-classification .block-body > ul')).display === 'grid'"));
});

await test("backlinks, wikilinks and hover preview", async () => {
  await go(BASE + "article.html?a=tuberculosis");
  ok(await ev("document.querySelector('.backlinks')?.innerText.includes('Granulomatous inflammation')"));
  await ev("document.querySelector('.wikilink:not(.missing)').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))");
  ok(await waitFor("!!document.querySelector('.page-preview') && !document.querySelector('.page-preview').hidden", 2000), "preview card did not appear");
});

await test("search: alias, abbreviation, typo, body text", async () => {
  ok((await ev("MedWiki.search('RPGN')[0].page.id")) === "rapidly-progressive-glomerulonephritis");
  ok((await ev("MedWiki.search('glomerulonefritis')[0].page.id")) === "rapidly-progressive-glomerulonephritis");
  ok((await ev("MedWiki.search('xanthopsia')[0].page.id")) === "digoxin");
});

await test("command palette opens, finds an alias, closes on Escape", async () => {
  await ev("MedWiki.palette.open('ccf')");
  ok(await waitFor("document.querySelector('.palette-item.is-selected')?.innerText.includes('Heart failure')", 2000));
  await key("Escape");
  ok(await ev("document.querySelector('.palette-overlay').hidden === true"));
});

await test("PYQ bank collects questions and filters by type", async () => {
  await go(BASE + "pyq.html");
  const all = await ev("document.querySelectorAll('.pyq-row').length");
  ok(all >= 5, "expected at least 5 questions, got " + all);
  await ev("[...document.querySelectorAll('.chip')].find(c=>c.dataset.type==='SAQ').click()");
  const saq = await ev("document.querySelectorAll('.pyq-row').length");
  ok(saq > 0 && saq < all, "SAQ filter did not narrow the list");
});

await test("revision mode hides text; recall blanks highlights until clicked", async () => {
  await go(BASE + "article.html?a=ace-inhibitors");
  await ev("document.querySelector('.revision-toggle').click()");
  ok(await ev("document.documentElement.dataset.mode === 'revision'"), "revision attribute not set");
  ok(await ev("getComputedStyle(document.querySelector('.prose > p:not(.keep)')).display === 'none'"), "paragraph still visible in revision mode");
  await ev("document.querySelector('[data-recall]').click()");
  ok(await ev("getComputedStyle(document.querySelector('.prose mark')).color === 'rgba(0, 0, 0, 0)'"), "highlight not blanked");
  await ev("document.querySelector('.prose mark').click()");
  ok(await ev("document.querySelector('.prose mark').classList.contains('revealed')"), "click did not reveal the highlight");
  await ev("MedWiki.toggleRecall(); MedWiki.toggleRevision();");
});

await test("markdown: [[Page\\|label]] works inside a table", async () => {
  ok(await ev("(()=>{const h=MedWiki.md.render('| A | B |\\n|---|---|\\n| [[Tuberculosis\\\\|TB]] | x |').html; return h.includes('class=\"wikilink\"') && h.includes('>TB</a>')})()"));
});

await test("mobile: library drawer opens and closes", async () => {
  await viewport(420, 900);
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('.mobile-menu').click()");
  ok(await ev("document.querySelector('.library-rail').classList.contains('open')"));
  await key("Escape");
  ok(await ev("!document.querySelector('.library-rail').classList.contains('open')"));
  await viewport(1440, 1000);
});

console.log("\nEditing\n");

await test("edit mode: live styling, slash menu, wiki suggestions, selection toolbar", async () => {
  await go(BASE + "article.html?a=ace-inhibitors");
  await ev("document.querySelector('.fab').click()");
  ok(await waitFor("!!document.getElementById('f-body')"));
  await ev("(()=>{const t=document.getElementById('f-body'); t.focus(); t.setSelectionRange(t.value.length,t.value.length)})()");
  await text("\n\n## Smoke heading\n\nSome ==key fact== here.\n\n");
  ok(await ev("document.querySelectorAll('.editor-backdrop .hl').length >= 1"), "backdrop highlight missing");
  ok(await ev("document.querySelectorAll('.editor-backdrop .ln.in').length > 5"), "block bands missing");
  await text("/tab");
  ok(await waitFor("!document.querySelector('.slash-menu').hidden && document.querySelector('.slash-menu').innerText.includes('Table')", 2000), "slash menu missing");
  await key("Enter");
  ok(await ev("document.getElementById('f-body').value.includes('| Column 1 |')"), "table not inserted");
  await text("[[rapid");
  ok(await waitFor("document.querySelector('.slash-menu').innerText.includes('Rapidly progressive')", 2000), "wiki suggestions missing");
  await key("Enter");
  ok(await ev("document.getElementById('f-body').value.includes('[[Rapidly progressive glomerulonephritis]]')"));
  ok(await ev("(()=>{const t=document.getElementById('f-body'); const i=t.value.indexOf('key fact'); t.focus(); t.setSelectionRange(i,i+8); t.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return true})()"));
  ok(await waitFor("!document.querySelector('.sel-bar').hidden", 1500), "selection toolbar missing");
  await ev("document.querySelector('.sel-bar [data-act=bold]').click()");
  ok(await ev("document.getElementById('f-body').value.includes('**key fact**')"), "bold not applied");
});

await test("save writes content/<id>.js and survives reload", async () => {
  await key("s", 2);
  ok(await waitFor("document.querySelector('.toast')?.textContent.includes('Saved to content/ace-inhibitors.js')", 4000), "no file-save toast");
  ok(read("content/ace-inhibitors.js").includes("Smoke heading"), "file on disk not updated");
  ok((await ev("JSON.stringify(localStorage.getItem('medwiki:pages'))")) === "null" || (await ev("!Object.keys(JSON.parse(localStorage.getItem('medwiki:pages')||'{}')).includes('ace-inhibitors')")), "browser override should be cleared");
  await go(BASE + "article.html?a=ace-inhibitors");
  ok(await ev("document.querySelector('.prose').innerText.includes('Smoke heading')"));
});

await test("draft autosaves and is restored after a reload", async () => {
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.getElementById('f-body')");
  await ev("(()=>{const t=document.getElementById('f-body'); t.focus(); t.setSelectionRange(t.value.length,t.value.length)})()");
  await text("\n\nUNSAVED-DRAFT-MARKER");
  await sleep(700);
  await go(BASE + "article.html?a=ace-inhibitors");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.getElementById('f-body')");
  ok(await ev("document.getElementById('f-body').value.includes('UNSAVED-DRAFT-MARKER')"), "draft not restored");
  await ev("document.querySelector('[data-cancel]').click()");
  await ev("window.confirm = () => true");
});

await test("create page through the dialog: new chapter, file and manifest written", async () => {
  await go(BASE + "index.html");
  await ev("MedWiki.newPageDialog({title:'Smoke Test Page', subject:'pathology'})");
  await ev("(()=>{const f=document.querySelector('.dialog'); const c=f.elements.chapter; c.value='__new'; c.dispatchEvent(new Event('change')); f.elements.newChapter.value='Smoke Chapter'; f.querySelector('[type=submit]').click()})()");
  ok(await waitFor("location.search.includes('edit=1')", 5000), "did not navigate to the editor");
  ok(existsSync(file("content/smoke-test-page.js")), "page file missing");
  ok(read("assets/js/data.js").includes('"smoke-test-page"'), "manifest not updated");
  ok(read("content/_chapters.js").includes("Smoke Chapter"), "chapter not persisted");
});

await test("editor toolbar formats: heading and table", async () => {
  await waitFor("!!document.getElementById('f-body')");
  ok(await ev("document.querySelectorAll('.editor-toolbar button').length >= 10"), "toolbar missing");
  await ev("(()=>{const t=document.getElementById('f-body'); t.focus(); t.setSelectionRange(t.value.length,t.value.length)})()");
  await text("\nToolbar heading");
  await ev("document.querySelector('[data-tool=h2]').click()");
  ok(await ev("document.getElementById('f-body').value.includes('## Toolbar heading')"), "heading not applied");
  await ev("document.querySelector('[data-tool=table]').click()");
  ok(await ev("document.getElementById('f-body').value.includes('| Column 1 |')"), "table not inserted");
});

await test("pasting an image keeps it on this device and shows the size bar", async () => {
  await ev(`(async()=>{
    const c=document.createElement('canvas'); c.width=40; c.height=30; c.getContext('2d').fillRect(0,0,40,30);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    const dt=new DataTransfer(); dt.items.add(new File([blob],'x.png',{type:'image/png'}));
    const t=document.getElementById('f-body'); t.focus();
    t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  })()`);
  ok(await waitFor("/!\\[\\]\\(img:[a-z0-9]+\\)/.test(document.getElementById('f-body').value)", 4000), "img: reference not inserted");
  ok(await waitFor("!document.querySelector('.img-bar').hidden", 2000), "image bar not shown");
  await ev("document.querySelector('.img-bar [data-w=\"50\"]').click()");
  await ev("document.querySelector('.img-bar [data-align=\"right\"]').click()");
  ok(await ev("/\\)\\{50% right\\}/.test(document.getElementById('f-body').value)"), "size and alignment not written");
  ok(!existsSync(file("content/images")) || readdirSync(file("content/images")).length === 0, "image must not be written locally");
});

await test("ImgBB: bad key pauses, good key uploads in the background and rewrites the article", async () => {
  await key("s", 2);
  ok(await waitFor("document.querySelector('.article .prose figure.fig-right') !== null", 4000), "figure not rendered with alignment");
  ok(await ev("document.querySelector('.prose figure').style.getPropertyValue('--w') === '50%'"), "width not applied");
  ok(await ev("document.querySelector('.prose img').getAttribute('data-state') === 'pending'"), "pending state missing");
  ok(read("content/smoke-test-page.js").includes("img:"), "saved source should hold the local reference");
  await ev(`(()=>{
    window.__orig = window.fetch;
    window.__mode = 'bad';
    window.fetch = (u, o) => {
      if (!String(u).startsWith('https://api.imgbb.com')) return window.__orig(u, o);
      if (window.__mode === 'bad') return Promise.resolve(new Response(JSON.stringify({ status_code: 400, error: { message: 'Invalid API v1 key.', code: 100 } }), { status: 400 }));
      return Promise.resolve(new Response(JSON.stringify({ success: true, status: 200, data: { url: 'https://i.ibb.co/aaa/pic.png', image: { url: 'https://i.ibb.co/aaa/pic.png' }, thumb: { url: 'https://i.ibb.co/aaa/pic-t.png' }, delete_url: 'https://ibb.co/del' } }), { status: 200 }));
    };
    localStorage.setItem('medwiki:imgbb', JSON.stringify({ key: 'wrong' }));
    MedWiki.images.kick();
  })()`);
  ok(await waitFor("JSON.parse(localStorage.getItem('medwiki:imgbb')).keyError === 'Invalid API v1 key.'", 5000), "bad key not flagged");
  ok(await ev("MedWiki.images.summary().pending === 1"), "image must stay queued when the key is bad");
  await ev("window.__mode = 'good'; localStorage.setItem('medwiki:imgbb', JSON.stringify({ key: 'right' })); MedWiki.images.kick();");
  ok(await waitFor("MedWiki.images.summary().done === 1", 8000), "upload did not complete");
  ok(await waitFor("MedWiki.page('smoke-test-page').body.includes('https://i.ibb.co/aaa/pic.png')", 4000), "article not rewritten");
  await sleep(500);
  const saved = read("content/smoke-test-page.js");
  ok(saved.includes("https://i.ibb.co/aaa/pic.png") && !saved.includes("img:"), "file should hold the hosted URL");
  ok(saved.includes("{50% right}"), "size should be kept");
});

await test("delete removes the file and manifest entry", async () => {
  await ev("MedWiki.deleteFile('smoke-test-page')");
  await sleep(300);
  ok(!existsSync(file("content/smoke-test-page.js")));
  ok(!read("assets/js/data.js").includes('"smoke-test-page"'));
});

console.log("\nVisual editor\n");

await test("every article round-trips: Markdown → editor DOM → Markdown renders identically", async () => {
  await go(BASE + "article.html?a=digoxin");
  const bad = await ev(`(()=>{
    const bad = [];
    MedWiki.pages.forEach((p) => {
      const div = document.createElement('div');
      div.innerHTML = MedWiki.md.render(p.body, { edit: true }).html;
      div.querySelectorAll('li, td, th, p').forEach((n) => { if (!n.firstChild) n.appendChild(document.createElement('br')); });
      const md = MedWiki.md.fromDom(div);
      if (MedWiki.md.render(p.body).html !== MedWiki.md.render(md).html) bad.push(p.id);
      const div2 = document.createElement('div');
      div2.innerHTML = MedWiki.md.render(md, { edit: true }).html;
      if (MedWiki.md.fromDom(div2) !== md) bad.push(p.id + " (unstable)");
    });
    return bad;
  })()`);
  ok(bad.length === 0, "round trip differs for: " + bad.join(", "));
});

await test("visual mode is the default: toolbar, styled surface, no raw markup", async () => {
  await ev("localStorage.removeItem('medwiki:editorMode')");
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('.fab').click()");
  ok(await waitFor("!!document.querySelector('.ve-surface') && !document.querySelector('.pane-visual').hidden", 3000), "visual pane not shown");
  ok(await ev("document.querySelector('.pane-source').hidden"), "source pane should be hidden");
  ok(await ev("document.querySelectorAll('.ve-toolbar button').length >= 10"), "toolbar missing");
  ok(await ev("!!document.querySelector('.ve-surface .block-definition, .ve-surface .block-summary')"), "study blocks not rendered");
  ok(!(await ev("/:::|\\*\\*|\\[\\[/.test(document.querySelector('.ve-surface').innerText)")), "raw markup visible in the visual editor");
});

await test("typing, style, bold, highlight, slash table, block insert, link", async () => {
  const S = "document.querySelector('.ve-surface')";
  const caretEnd = `(()=>{ const s=${S}; s.focus(); let p=s.lastElementChild; if(!p||p.tagName!=='P'){ p=document.createElement('p'); p.innerHTML='<br>'; s.appendChild(p);} const r=document.createRange(); r.selectNodeContents(p); r.collapse(false); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`;
  await ev(caretEnd);
  await text("Visual typing works");
  ok(await ev(`${S}.lastElementChild.textContent.includes('Visual typing works')`), "typed text missing");
  /* heading via the style menu */
  await ev("(()=>{const sel=document.querySelector('.ve-toolbar select'); sel.value='h2'; sel.dispatchEvent(new Event('change',{bubbles:true}));})()");
  ok(await ev(`${S}.lastElementChild.tagName === 'H2'`), "style menu did not make a heading");
  await key("Enter");
  await text("Some important fact here");
  /* select a word and bold / highlight it */
  const select = (word) => ev(`(()=>{ const p=${S}.lastElementChild; const n=[...p.childNodes].find(x=>x.nodeType===3 && x.nodeValue.includes('${word}')); const i=n.nodeValue.indexOf('${word}'); const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+'${word}'.length); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`);
  await select("important");
  await ev("document.querySelector('[data-cmd=bold]').click()");
  ok(await ev(`!!${S}.lastElementChild.querySelector('b, strong')`), "bold not applied");
  await select("fact");
  await ev("document.querySelector('[data-cmd=mark]').click()");
  ok(await ev(`!!${S}.lastElementChild.querySelector('mark')`), "highlight not applied");
  /* slash menu → table */
  await ev(caretEnd);
  await key("Enter");
  await text("/table");
  ok(await waitFor("!!document.querySelector('.ve-menu') && document.querySelector('.ve-menu').innerText.includes('Table')", 2000), "slash menu missing");
  await key("Enter");
  ok(await waitFor(`!!${S}.querySelector('table')`, 2000), "table not inserted");
  await text("Cell A");
  await key("Tab");
  await text("Cell B");
  const LAST = `[...${S}.querySelectorAll('table')].pop()`;
  ok(await ev(`(()=>{ const t=${LAST}; const h=t.querySelectorAll('th'); return h[0].textContent === 'Cell A' && h[1].textContent === 'Cell B'; })()`), "Tab did not move between cells");
  ok(await waitFor("!document.querySelector('.ve-ctx').hidden && document.querySelector('.ve-ctx').innerText.includes('Row below')", 1500), "table bar missing");
  await ev("document.querySelector('.ve-ctx [data-t=rowBelow]').click()");
  ok(await ev(`${LAST}.querySelectorAll('tr').length === 4`), "row not added");
  /* insert menu → study block */
  await ev("document.querySelector('[data-cmd=insert]').click()");
  ok(await waitFor("!!document.querySelector('.ve-menu')", 1000), "insert menu missing");
  await ev("[...document.querySelectorAll('.ve-menu-item')].find(b=>b.innerText.includes('Exam pearl')).click()");
  const PEARL = `[...${S}.querySelectorAll('.block-pearl')].pop()`;
  ok(await waitFor(`${S}.querySelectorAll('.block-pearl').length === 2`, 1500), "study block not inserted");
  await text("Pearl body text");
  ok(await ev(`${PEARL}.querySelector('.block-body').textContent.includes('Pearl body text')`), "typing inside block failed");
  /* Ctrl+K link */
  await ev(`(()=>{ const p=${PEARL}.querySelector('.block-body p'); const r=document.createRange(); r.selectNodeContents(p); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`);
  await key("k", 2);
  ok(await waitFor("!!document.querySelector('.ve-pop input')", 1500), "link popover missing");
  ok(!(await ev("!!document.querySelector('.palette-overlay:not([hidden])')")), "Ctrl+K should link here, not open the palette");
  await ev("document.querySelector('.ve-pop input').value=''");
  await text("rapid");
  await sleep(200);
  await key("Enter");
  ok(await waitFor(`!!${S}.querySelector('a.wikilink[data-target="Rapidly progressive glomerulonephritis"]')`, 2000), "link not inserted");
});

await test("visual edits save as Markdown and reload correctly", async () => {
  await key("s", 2);
  ok(await waitFor("document.querySelector('.toast')?.textContent.includes('Saved to content/digoxin.js')", 4000), "no save toast");
  const src = read("content/digoxin.js");
  ok(/## Visual typing works/.test(src), "heading not written");
  ok(src.includes("Some **important** ==fact== here"), "bold/highlight not written: " + src.slice(-500));
  ok(src.includes("| Cell A | Cell B |"), "table not written");
  ok(src.includes("::: pearl"), "study block not written");
  ok(src.includes("[[Rapidly progressive glomerulonephritis"), "link not written");
  await go(BASE + "article.html?a=digoxin");
  ok(await ev("document.querySelector('.prose').innerText.includes('Visual typing works')"), "saved page does not show the edit");
});

await test("images in the visual editor: paste, resize bar, caption, saved as sized figure", async () => {
  await ev("localStorage.removeItem('medwiki:imgbb')"); /* keep this test off the network */
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  await ev(`(()=>{ const s=document.querySelector('.ve-surface'); s.focus(); const p=s.lastElementChild; const r=document.createRange(); r.selectNodeContents(p); r.collapse(false); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`);
  await ev(`(async()=>{
    const c=document.createElement('canvas'); c.width=60; c.height=40; c.getContext('2d').fillRect(0,0,60,40);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    const dt=new DataTransfer(); dt.items.add(new File([blob],'x.png',{type:'image/png'}));
    document.querySelector('.ve-surface').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  })()`);
  ok(await waitFor("!!document.querySelector('.ve-surface figure img')", 4000), "figure not inserted");
  ok(await waitFor("!document.querySelector('.ve-ctx').hidden && !!document.querySelector('.ve-ctx [data-w]')", 1500), "image bar missing");
  await ev("document.querySelector('.ve-ctx [data-w=\"50\"]').click()");
  await ev("document.querySelector('.ve-ctx [data-align=\"right\"]').click()");
  ok(await ev("(()=>{const f=document.querySelector('.ve-surface figure'); return f.getAttribute('data-w')==='50' && f.classList.contains('fig-right')})()"), "size/alignment not applied");
  await ev(`(()=>{ const c=document.querySelector('.ve-surface figcaption'); c.focus(); c.textContent='Digoxin ECG'; c.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await key("s", 2);
  ok(await waitFor("document.querySelector('.toast')?.textContent.includes('Saved to content/digoxin.js')", 4000), "no save toast");
  ok(/!\[Digoxin ECG\]\(img:[a-z0-9]+\)\{50% right\}/.test(read("content/digoxin.js")), "sized figure not written: " + read("content/digoxin.js").slice(-300));
});

await test("revision mode never hides text while editing; clearing the page then typing gives a paragraph", async () => {
  await ev("localStorage.setItem('medwiki:revision', 'true'); localStorage.removeItem('medwiki:editorMode')");
  await go(BASE + "article.html?a=tuberculosis");
  ok(await ev("document.documentElement.getAttribute('data-mode') === 'revision'"), "revision should be on for reading");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  ok(await ev("!document.documentElement.hasAttribute('data-mode')"), "revision must be suspended while editing");
  ok(await ev("[...document.querySelectorAll('.ve-surface > p')].some(p => getComputedStyle(p).display !== 'none' && p.textContent.trim())"), "paragraphs hidden in the editor");
  await ev("document.querySelector('.ve-surface').focus(); document.execCommand('selectAll'); document.execCommand('delete')");
  await text("fresh text");
  ok(await ev("document.querySelector('.ve-surface').firstElementChild.tagName === 'P'"), "typing after clearing should make a paragraph, not a heading");
  await ev("document.querySelector('[data-cancel]').click()");
  ok(await ev("document.documentElement.getAttribute('data-mode') === 'revision'"), "revision should come back after editing");
  await ev("localStorage.removeItem('medwiki:revision'); document.documentElement.removeAttribute('data-mode'); localStorage.setItem('medwiki:editorMode', '\"source\"')");
});

await test("a bulleted list started on an empty line is kept and saved as a list", async () => {
  await ev("localStorage.removeItem('medwiki:editorMode')");
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  await ev(`(()=>{ const s=document.querySelector('.ve-surface'); s.focus(); const p=document.createElement('p'); p.innerHTML='<br>'; s.appendChild(p); const r=document.createRange(); r.selectNodeContents(p); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`);
  await ev("document.querySelector('[data-cmd=ul]').click()");
  await text("item three");
  await enter();
  await text("item four");
  await enter();
  await enter();
  await text("after the list");
  ok(await ev("!document.querySelector('.ve-surface p > ul, .ve-surface p > p')"), "list is nested inside a paragraph");
  const md = await ev("MedWiki.md.fromDom(document.querySelector('.ve-surface'))");
  ok(md.includes("- item three" + String.fromCharCode(10) + "- item four" + String.fromCharCode(10, 10) + "after the list"), "list not serialised as a list: " + md.slice(-120));
  await ev("document.querySelector('[data-cancel]').click()");
});

await test("line breaks: a trailing backslash renders <br>, Shift+Enter content is kept, plain newlines still join", async () => {
  await go(BASE + "article.html?a=digoxin");
  const NL = String.fromCharCode(10);
  const BSL = String.fromCharCode(92);
  const md = "one" + BSL + NL + "two";
  ok((await ev(`MedWiki.md.render(${JSON.stringify(md)}).html`)) === "<p>one<br>two</p>", "hard break not rendered");
  const back = await ev(`(()=>{ const d=document.createElement('div'); d.innerHTML=MedWiki.md.render(${JSON.stringify(md)},{edit:true}).html; return MedWiki.md.fromDom(d); })()`);
  ok(back === md + NL, "hard break did not round-trip: " + JSON.stringify(back));
  ok((await ev(`MedWiki.md.render("one"+String.fromCharCode(10)+"two").html`)) === "<p>one two</p>", "plain newline should still join");
  const typed = await ev(`(()=>{ const d=document.createElement('div'); d.innerHTML='<p>this is aditya and<br>this is his car</p>'; return MedWiki.md.fromDom(d); })()`);
  ok(typed === "this is aditya and" + BSL + NL + "this is his car" + NL, "Shift+Enter content not kept: " + JSON.stringify(typed));
});

await test("dash lines after a line break become a real list (typed or already saved)", async () => {
  await ev("localStorage.removeItem('medwiki:editorMode')");
  await go(BASE + "article.html?a=digoxin");
  const NL = String.fromCharCode(10);
  /* saved content: text, break, "- a", break, "- b" */
  const md = await ev(`(()=>{ const d=document.createElement('div'); d.innerHTML='<p>intro<br>- one<br>- two<br>after</p>'; return MedWiki.md.fromDom(d); })()`);
  ok(md.includes("intro" + NL + NL + "- one" + NL + "- two" + NL + NL + "after"), "dash lines not converted to a list: " + JSON.stringify(md));
  /* typing: Shift+Enter then "- " starts a bullet list */
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  await ev(`(()=>{ const s=document.querySelector('.ve-surface'); s.focus(); const p=document.createElement('p'); p.innerHTML='<br>'; s.appendChild(p); const r=document.createRange(); r.selectNodeContents(p); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`);
  await text("heading line");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", modifiers: 8, text: String.fromCharCode(13), windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", modifiers: 8, windowsVirtualKeyCode: 13 });
  await text("-");
  await text(" ");
  ok(await ev("[...document.querySelectorAll('.ve-surface ul li')].some(li => li.parentElement.previousElementSibling && li.parentElement.previousElementSibling.textContent.includes('heading line'))"), "typing '- ' after a line break did not start a list");
  await text("first");
  await enter();
  await text("second");
  const out = await ev("MedWiki.md.fromDom(document.querySelector('.ve-surface'))");
  ok(out.includes("heading line" + NL + NL + "- first" + NL + "- second"), "typed list not saved as a list: " + JSON.stringify(out.slice(-80)));
  await ev("document.querySelector('[data-cancel]').click()");
});

await test("flowcharts: vertical option renders stacked, round-trips, and the editor switch changes it", async () => {
  await go(BASE + "article.html?a=digoxin");
  const NL = String.fromCharCode(10);
  const md = "::: flow vertical" + NL + "A -> B -> C" + NL + ":::" + NL;
  const html = await ev(`MedWiki.md.render(${JSON.stringify(md)}).html`);
  ok(html.includes('class="flow flow-vertical"'), "vertical class missing");
  ok((await ev(`MedWiki.md.render(${JSON.stringify(md.replace(" vertical", ""))}).html`)).includes('class="flow"'), "horizontal should stay the default");
  const back = await ev(`(()=>{ const d=document.createElement('div'); d.innerHTML=MedWiki.md.render(${JSON.stringify(md)},{edit:true}).html; return MedWiki.md.fromDom(d); })()`);
  ok(back === md, "vertical did not round-trip: " + JSON.stringify(back));
  await ev("localStorage.removeItem('medwiki:editorMode')");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  await ev(`(()=>{ const s=document.querySelector('.ve-surface'); s.focus(); const p=document.createElement('p'); p.innerHTML='<br>'; s.appendChild(p); const r=document.createRange(); r.selectNodeContents(p); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`);
  await ev("document.querySelector('[data-cmd=insert]').click()");
  await ev("[...document.querySelectorAll('.ve-menu-item')].find(b=>b.innerText.includes('Flowchart (vertical)')).click()");
  ok(await waitFor("!!document.querySelector('.ve-surface .flow-src[data-dir=vertical] .flow-preview .flow-vertical')", 1500), "vertical flowchart not inserted with preview");
  const LASTFLOW = "[...document.querySelectorAll('.ve-surface .flow-src')].pop()";
  await ev(`${LASTFLOW}.querySelector('[data-act=dir-h]').click()`);
  ok(await ev(`!${LASTFLOW}.querySelector('.flow-vertical') && ${LASTFLOW}.getAttribute('data-dir') === 'horizontal'`), "direction switch did not update the preview");
  ok((await ev("MedWiki.md.fromDom(document.querySelector('.ve-surface'))")).trimEnd().endsWith("::: flow" + NL + "Step 1 -> Step 2 -> Step 3" + NL + ":::"), "switched chart should save as horizontal");
  await ev("document.querySelector('[data-cancel]').click()");
});

await test("flowchart alignment: center/right classes, round-trip, and the editor switch", async () => {
  await go(BASE + "article.html?a=digoxin");
  const NL = String.fromCharCode(10);
  for (const al of ["center", "right"]) {
    const md = "::: flow vertical " + al + NL + "A -> B" + NL + ":::" + NL;
    ok((await ev(`MedWiki.md.render(${JSON.stringify(md)}).html`)).includes("flow-vertical flow-" + al), al + " class missing");
    const back = await ev(`(()=>{ const d=document.createElement('div'); d.innerHTML=MedWiki.md.render(${JSON.stringify(md)},{edit:true}).html; return MedWiki.md.fromDom(d); })()`);
    ok(back === md, al + " did not round-trip: " + JSON.stringify(back));
  }
  ok((await ev(`MedWiki.md.render("::: flow"+String.fromCharCode(10)+"A -> B"+String.fromCharCode(10)+":::").html`)).includes('class="flow"'), "default should stay left");
  const w = await ev(`(()=>{ const d=document.createElement('div'); d.className='prose'; d.innerHTML=MedWiki.md.render("::: flow"+String.fromCharCode(10)+"A -> B"+String.fromCharCode(10)+":::").html; document.body.appendChild(d); const a=d.querySelector('.flow-arrow').getBoundingClientRect().width; d.remove(); return a; })()`);
  ok(w >= 24, "the drawn arrow should be a clear connector (>= 24px wide), got " + w);
});

await test("~ inserts things: ~table on an empty line, ~quote inside a sentence, ~image alias, plain '~5 mg' is left alone", async () => {
  await ev("localStorage.removeItem('medwiki:editorMode')");
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  const S = "document.querySelector('.ve-surface')";
  const caretInNew = `(()=>{ const s=${S}; s.focus(); const p=document.createElement('p'); p.innerHTML='<br>'; s.appendChild(p); const r=document.createRange(); r.selectNodeContents(p); const g=getSelection(); g.removeAllRanges(); g.addRange(r); })()`;
  const tablesBefore = await ev(`${S}.querySelectorAll('table').length`);
  await ev(caretInNew);
  await text("~table");
  ok(await waitFor("!!document.querySelector('.ve-menu') && document.querySelector('.ve-menu').innerText.includes('Table')", 1500), "~ menu missing");
  await key("Enter");
  ok(await waitFor(`${S}.querySelectorAll('table').length === ${tablesBefore + 1}`, 1500), "~table did not insert a table");
  ok(await ev(`![...${S}.querySelectorAll('p')].some(p => p.textContent.includes('~table'))`), "typed ~table should be removed");
  /* inside a sentence: text stays, the quote is added after it */
  await ev(caretInNew);
  await text("keep this sentence ~quo");
  ok(await waitFor("!!document.querySelector('.ve-menu')", 1500), "~ menu missing mid-sentence");
  await key("Enter");
  ok(await waitFor(`!!${S}.querySelector('blockquote')`, 1500), "~quote did not insert a quote");
  ok(await ev(`[...${S}.querySelectorAll('p')].some(p => p.textContent.trim() === 'keep this sentence')`), "sentence should stay without the typed ~quo");
  /* alias */
  await ev(caretInNew);
  await text("~hr");
  ok(await waitFor("!!document.querySelector('.ve-menu') && document.querySelector('.ve-menu').innerText.includes('Divider')", 1500), "~hr alias should find Divider");
  await key("Escape");
  /* numbers after ~ are ordinary text: no menu */
  await ev(caretInNew);
  await text("dose ~5 mg");
  ok(await ev("!document.querySelector('.ve-menu')"), "~5 should not open a menu");
  await ev("document.querySelector('[data-cancel]').click()");
});

await test("Source editor: ~table also opens the insert menu", async () => {
  await ev("localStorage.setItem('medwiki:editorMode', '\"source\"')");
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.getElementById('f-body')");
  await ev("(()=>{const t=document.getElementById('f-body'); t.focus(); t.setSelectionRange(t.value.length,t.value.length)})()");
  await enter();
  await enter();
  await text("~tab");
  ok(await waitFor("!document.querySelector('.slash-menu').hidden && document.querySelector('.slash-menu').innerText.includes('Table')", 2000), "~ menu missing in source");
  await key("Enter");
  ok(await ev("document.getElementById('f-body').value.includes('| Column 1 |')"), "table not inserted from source");
  await ev("document.querySelector('[data-cancel]').click()");
});

await test("Source tab shows the Markdown and switching back keeps the content", async () => {
  await go(BASE + "article.html?a=digoxin");
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.querySelector('.ve-surface')");
  await ev("document.querySelector('.ve-mode [data-mode=source]').click()");
  ok(await ev("!document.querySelector('.pane-source').hidden && document.getElementById('f-body').value.includes('## Visual typing works')"), "source view missing content");
  await ev("document.querySelector('.ve-mode [data-mode=visual]').click()");
  ok(await ev("!document.querySelector('.pane-visual').hidden && document.querySelector('.ve-surface').innerText.includes('Visual typing works')"), "visual view missing content");
  await ev("localStorage.setItem('medwiki:editorMode', '\"source\"')");
  await ev("document.querySelector('[data-cancel]').click()");
});

console.log("\nBrowser-only mode (no server)\n");

await test("file:// falls back to saving in the browser", async () => {
  await go("file:///" + SITE.replace(/\\/g, "/") + "/article.html?a=digoxin");
  ok((await ev("MedWiki.server.available")) === false);
  await ev("document.querySelector('.fab').click()");
  await waitFor("!!document.getElementById('f-body')");
  await ev("(()=>{const t=document.getElementById('f-body'); t.focus(); t.setSelectionRange(t.value.length,t.value.length)})()");
  await text("\n\nBrowser-only note.");
  await key("s", 2);
  ok(await waitFor("document.querySelector('.toast')?.textContent.includes('in this browser')", 4000), "no browser-save toast");
  ok(await ev("Object.keys(JSON.parse(localStorage.getItem('medwiki:pages')||'{}')).includes('digoxin')"));
  ok(!read("content/digoxin.js").includes("Browser-only note"), "file should be untouched");
});

console.log("\nErrors during the run\n");
await test("no uncaught exceptions or console errors", async () => { ok(errors.length === 0, errors.join("\n")); });

console.log(`\n${passed} passed, ${failed} failed\n`);
ws.close(); chrome.kill(); server.kill();
try { rmSync(TMP, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
