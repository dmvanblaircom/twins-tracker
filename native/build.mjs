// Copies the web app into native/www for the iOS wrapper, with Chart.js and Firebase bundled locally
// so the app opens with no signal (iOS app web views don't run the service worker).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, ".."), out = path.join(here, "www");
const FB = "10.12.2";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
const copy = (rel, to = rel) => fs.cpSync(path.join(root, rel), path.join(out, to), { recursive: true });
["firebase-config.js", "milk-sources.js", "mychart.js", "privacy.html", "manifest.webmanifest", "fonts", "icons"].forEach(f => copy(f));

const must = (s, from, to) => { if (!s.includes(from)) throw new Error(`build: expected to find ${from}`); return s.split(from).join(to); };
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = must(html, "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", "vendor/chart.umd.js");
fs.writeFileSync(path.join(out, "index.html"), html);
fs.copyFileSync(path.join(here, "node_modules/chart.js/dist/chart.umd.js"), path.join(out, "vendor/chart.umd.js"));

let store = fs.readFileSync(path.join(root, "firebase-store.js"), "utf8");
for (const m of ["app", "auth", "firestore", "app-check"]) {
  store = must(store, `https://www.gstatic.com/firebasejs/${FB}/firebase-${m}.js`, `./vendor/firebase-${m}.js`);
  let lib = fs.readFileSync(path.join(here, `node_modules/firebase/firebase-${m}.js`), "utf8");
  if (m !== "app") lib = must(lib, `https://www.gstatic.com/firebasejs/${FB}/firebase-app.js`, "./firebase-app.js");
  fs.writeFileSync(path.join(out, `vendor/firebase-${m}.js`), lib.replace(/\n\/\/# sourceMappingURL=.*$/m, ""));
}
fs.writeFileSync(path.join(out, "firebase-store.js"), store);
console.log("native/www ready");
