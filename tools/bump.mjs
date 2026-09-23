// Adds/refreshes a ?v=<stamp> on every local script and stylesheet in the HTML pages,
// so browsers (and Live Server) fetch the newest files. Run after changing any JS or CSS: npm run bump
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = Date.now().toString(36);
for (const f of readdirSync(root).filter((n) => n.endsWith(".html"))) {
  const p = join(root, f);
  const before = readFileSync(p, "utf8");
  const after = before.replace(/((?:src|href)="assets\/(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g, `$1?v=${stamp}"`);
  if (after !== before) writeFileSync(p, after);
}
console.log("Asset version:", stamp);
