// Fails when an app-shell file changed since main but sw.js still has the same CACHE name, which would leave
// installed phones on the old copy. Compares with origin/main (run `git fetch origin main` first); skips on main itself.
const { execSync } = require("child_process"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), git = c => execSync(`git ${c}`, { cwd: ROOT, encoding: "utf8" }).trim();
let base;
try { base = git("merge-base HEAD origin/main"); } catch { console.log("- cache check skipped: no origin/main to compare with"); process.exit(0); }
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(f => !/^(\.\/|https?:)/.test(f));
const changed = git(`diff --name-only ${base} -- ${shell.join(" ")}`).split("\n").filter(Boolean);
const cacheOf = s => (s.match(/const CACHE = "([^"]+)"/) || [])[1];
const was = cacheOf(git(`show ${base}:sw.js`)), now = cacheOf(sw);
if (changed.length && was === now) { console.log(`✗ shell files changed since main (${changed.join(", ")}) but sw.js CACHE is still "${now}" — bump it`); process.exit(1); }
console.log(`✓ cache check: ${changed.length ? `shell changed, CACHE ${was} → ${now}` : "no shell file changed"}`);
