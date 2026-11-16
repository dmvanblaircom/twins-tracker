// Two phones, the REAL app (index.html + firebase-store.js) against the Auth + Firestore emulators and the real rules:
// sign up, start a family, join with the code, set up fictional babies, then milk sources through the screens —
// version gate, sync between phones, and both phones offline editing the same feed (the conflict review).
// Runs inside `npm test` (firebase emulators:exec). Screenshots: tests/shots/b2-two-phones/. Fictional data only.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, getDoc } = require("firebase/firestore");

const ROOT = path.join(__dirname, "../.."), FB = path.dirname(require.resolve("firebase/package.json"));
const CHART = [path.join(ROOT, "tests/node_modules/chart.js/dist/chart.umd.js")].find(f => fs.existsSync(f));
const OUT = path.join(ROOT, "tests/shots/b2-two-phones"); fs.mkdirSync(OUT, { recursive: true });
const PROJECT = "demo-twins", EMU = { host: "127.0.0.1", firestore: 8080, auth: 9099 };
let pass = 0, fail = 0;
const t = async (name, fn) => { try { const r = await fn(); if (r === false) throw new Error("check returned false"); pass++; console.log("✓", name); } catch (e) { fail++; console.log("✗", name, "—", e.message); } };
const config = `export const firebaseConfig = { apiKey: "demo-key", authDomain: "localhost", projectId: "${PROJECT}", appId: "demo" };`;
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split("?")[0]); if (u === "/") u = "/index.html";
  if (u === "/firebase-config.js") { r.writeHead(200, { "content-type": "text/javascript" }); return r.end(config); }
  const f = path.join(ROOT, u); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch {} await new Promise(r => setTimeout(r, 200)); } throw new Error("timed out"); };

(async () => {
  await new Promise(res => srv.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8"), host: EMU.host, port: EMU.firestore } });
  await env.clearFirestore();
  const get = async p => { let out; await env.withSecurityRulesDisabled(async c => { const s = await getDoc(doc(c.firestore(), p)); out = s.exists() ? s.data() : null; }); return out; };
  const browser = await chromium.launch();
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: "America/New_York", hasTouch: true, isMobile: true });
    await ctx.addInitScript(e => { window.__FIREBASE_EMULATORS__ = e; }, EMU);
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z]+\.js)/, route => { const f = route.request().url().match(/(firebase-[a-z]+\.js)$/)[1]; route.fulfill({ path: path.join(FB, f), contentType: "text/javascript" }); });
    await ctx.route("https://cdnjs.cloudflare.com/**/chart.umd.min.js", r => CHART ? r.fulfill({ path: CHART, contentType: "text/javascript" }) : r.fulfill({ body: "window.Chart=function(){};", contentType: "text/javascript" }));
    const p = await ctx.newPage(); p.errs = []; p.on("pageerror", e => p.errs.push(e.message)); p.on("dialog", d => d.accept());
    await p.goto(base); await p.waitForSelector("#lEmail", { state: "visible" }); return p;
  };
  const signUp = async (p, email) => { await p.click("#lMode"); await p.fill("#lEmail", email); await p.fill("#lPw", "pw-test-1"); await p.click("#lGo"); await p.waitForSelector("#family", { state: "visible" }); };
  const tab = (p, id) => p.$eval(`#tabbar button[data-tab=${id}]`, b => b.click()).then(() => p.waitForTimeout(300));
  const care = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="care"]'); await p.waitForTimeout(300); };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + ".png") });

  const A = await phone(), B = await phone();
  const run = Date.now().toString(36), EA = `ann-${run}@example.net`, EB = `ben-${run}@example.net`;   // unique: earlier suites share the Auth emulator
  await signUp(A, EA); await signUp(B, EB);
  await A.click("#fmNew"); await A.waitForSelector("#setup", { state: "visible" });
  const born = new Date(Date.now() - 9 * 864e5), z = n => String(n).padStart(2, "0");
  await A.fill("#suBorn", `${born.getFullYear()}-${z(born.getMonth() + 1)}-${z(born.getDate())}`);
  await A.fill("#suN0", "Ada"); await A.fill("#suW0", "2600"); await A.fill("#suN1", "Bea"); await A.fill("#suW1", "2800");
  await A.click("#suSave"); await A.waitForSelector("#main", { state: "visible" });
  const code = await A.evaluate(() => Store.familyInfo().then(f => f.code));
  await B.fill("#fmCode", code); await B.click("#fmJoin"); await B.waitForSelector("#main", { state: "visible" });
  const hid = await A.evaluate(() => Store.familyInfo().then(f => f.hid)), H = `households/${hid}`;
  const [ua, ub] = await Promise.all([A, B].map(p => p.evaluate(() => Store.uid())));

  await t("both phones record their app version (only v and t, keyed by the account's random id)", async () => {
    await until(async () => (await get(`${H}/clients/${ua}`)) && (await get(`${H}/clients/${ub}`)));
    const c = await get(`${H}/clients/${ua}`); return Object.keys(c).sort().join() === "t,v"; });
  await t("with both phones updated, Care on phone A offers usual milk", async () => { await care(A); await until(() => A.$('#srcCare [data-se="edit"]')); return true; });
  await shot(A, "01-phoneA-care-ready");
  // phone A sets Bea's usual milk; phone B sees it and tracking switches on there too
  await A.click('#srcCare .srow:has(b:text("Bea")) [data-se="edit"]'); await A.click('#srcCare .srow:has(b:text("Bea")) [data-se="pick"][data-k="donor"]');
  await A.click('#srcCare .srow:has(b:text("Bea")) [data-se="save"]');
  await t("phone A's first setting turns tracking on for the family", async () => until(async () => ((await get(`${H}/config/sources`)) || {}).on === true));
  await t("phone B shows Bea's usual milk set on phone A", async () => { await care(B); await until(async () => (await B.textContent("#srcCare")).includes("Donor milk")); return true; });
  await shot(B, "02-phoneB-sees-usual");
  await t("phone B's Today shows the milk line once tracking is on", async () => { await tab(B, "feed"); await until(() => B.$('.nx[data-tw="Ada"] [data-act="src"]')); return true; });

  // both phones offline, both change the same feed's milk
  await tab(A, "feed");
  await until(() => A.$('.nx[data-tw="Ada"] [data-act="src"]'));
  const slot = await A.$eval('.nx[data-tw="Ada"]', n => n.dataset.day + "|" + n.dataset.i);
  await t("both phones have the same next feed for Ada", async () => slot === await B.$eval('.nx[data-tw="Ada"]', n => n.dataset.day + "|" + n.dataset.i));
  await A.context().setOffline(true); await B.context().setOffline(true);
  await A.click('.nx[data-tw="Ada"] [data-act="src"]'); await A.click('#sCard [data-sa="one"][data-k="formula"]'); await A.waitForTimeout(1800);
  await B.click('.nx[data-tw="Ada"] [data-act="src"]'); await B.click('#sCard [data-sa="one"][data-k="donor"]'); await B.waitForTimeout(1800);
  await t("offline, each phone says its change is saved on the phone and will sync", async () => (await A.textContent("#banner")).includes("will sync when you're back online") && (await B.textContent("#banner")).includes("will sync when you're back online"));
  await shot(B, "03-phoneB-offline-saved");
  const slotId = await A.evaluate(() => { const n = document.querySelector('.nx[data-tw="Ada"]'); return n.dataset.day + "|" + n.dataset.i; });
  await A.context().setOffline(false);
  let AL;
  await t("phone A reconnects first: its formula choice reaches the family's data", async () => {
    await until(async () => { const ids = await A.evaluate(() => Object.keys(__nicu.src.state().alloc)); AL = ids.find(i => i.startsWith("b0-")); return AL && ((await get(`${H}/slotMilk/${AL}`)) || {}).mL10?.formula > 0; });
    return true; });
  await B.context().setOffline(false);
  await t("phone B reconnects: its stale change is refused by the server and kept for review (nothing overwritten)", async () => {
    await until(async () => (await B.textContent("#srcNote")).includes("needs your review"), 30000);
    const s = await get(`${H}/slotMilk/${AL}`); return s.mL10.formula > 0 && s.editBy === EA; });
  await shot(B, "04-phoneB-review-notice");
  await B.$eval('#srcNote [data-sn="conflict"]', b => b.click()); await B.waitForTimeout(400);
  await t("phone B's review shows phone A's choice (formula) and its own (donor)", async () => { const s = (await B.innerText("#sCard")).replace(/\s+/g, " "); return s.includes("Saved now (theirs) Formula") && s.includes("Your change Donor milk") && s.includes("The other parent changed the milk for Ada"); });
  await shot(B, "05-phoneB-review");
  await t("Use mine on phone B replaces it with a guarded write", async () => {
    await until(async () => { await B.click('#sCard [data-sa="mine"]').catch(() => {}); await B.waitForTimeout(600); const s = await get(`${H}/slotMilk/${AL}`); return s.mL10.donor > 0 && s.editBy === EB; });
    return true; });
  await t("phone A then shows phone B's choice", async () => { await until(async () => (await A.textContent('.nx[data-tw="Ada"] [data-act="src"]')).includes("Donor milk")); return true; });
  await shot(A, "06-phoneA-sees-resolution");
  await t("no page errors on either phone", () => A.errs.length === 0 && B.errs.length === 0 || (console.log(A.errs, B.errs), false));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); await env.cleanup(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
