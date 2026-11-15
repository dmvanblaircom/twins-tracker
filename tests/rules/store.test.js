// Integration test: the REAL firebase-store.js (not the stub) against the Auth + Firestore emulators and the real
// firestore.rules. Covers the Phase 1 lifecycle: private data, patch, removal cleanup, leave, account deletion.
//   cd tests/rules && npm test        (runs rules.test.js, then this file, inside `firebase emulators:exec`)
// Uses fictional accounts only. Needs Playwright + Chromium (preinstalled in this environment).
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection } = require("firebase/firestore");

const ROOT = path.join(__dirname, "../.."), FB = path.dirname(require.resolve("firebase/package.json"));
const PROJECT = "demo-twins", EMU = { host: "127.0.0.1", firestore: 8080, auth: 9099 };
let pass = 0, fail = 0;
const t = async (name, fn) => { try { const r = await fn(); if (r === false) throw new Error("check returned false"); pass++; console.log("✓", name); } catch (e) { fail++; console.log("✗", name, "—", e.message); } };

const harness = `<!doctype html><meta charset="utf-8"><script>window.__FIREBASE_EMULATORS__=${JSON.stringify(EMU)};</script><script type="module" src="/firebase-store.js"></script>`;
const config = `export const firebaseConfig = { apiKey: "demo-key", authDomain: "localhost", projectId: "${PROJECT}", appId: "demo" };`;
const srv = http.createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u === "/" || u === "/harness.html") { r.writeHead(200, { "content-type": "text/html" }); return r.end(harness); }
  if (u === "/firebase-config.js") { r.writeHead(200, { "content-type": "text/javascript" }); return r.end(config); }
  if (u === "/firebase-store.js") { r.writeHead(200, { "content-type": "text/javascript" }); return r.end(fs.readFileSync(path.join(ROOT, "firebase-store.js"))); }
  r.writeHead(404); r.end();
});

(async () => {
  await new Promise(res => srv.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8"), host: EMU.host, port: EMU.firestore } });
  const admin = async fn => { let out; await env.withSecurityRulesDisabled(async c => { out = await fn(c.firestore()); }); return out; };
  const exists = p => admin(d => getDoc(doc(d, p)).then(s => s.exists()));
  const count = p => admin(d => getDocs(collection(d, p)).then(s => s.size));
  const browser = await chromium.launch();
  const open = async () => {
    const ctx = await browser.newContext();
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z]+\.js)/, (route) => {
      const f = route.request().url().match(/(firebase-[a-z]+\.js)$/)[1];
      route.fulfill({ path: path.join(FB, f), contentType: "text/javascript" });
    });
    const p = await ctx.newPage(); p.errs = []; p.on("pageerror", e => p.errs.push(e.message));
    await p.goto(base + "harness.html"); await p.waitForFunction(() => !!window.Store);
    return p;
  };
  const S = (p, fn, arg) => p.evaluate(fn, arg);
  const uidOf = p => S(p, () => new Promise(res => { const un = Store.onAuth(u => { if (u) { un && un(); res(u.uid); } }); }));

  const A = await open(), B = await open(), C = await open();
  await S(A, () => Store.signUp("owner@example.net", "pw-owner-1"));
  await S(B, () => Store.signUp("partner@example.net", "pw-partner-1"));
  await S(C, () => Store.signUp("third@example.net", "pw-third-1"));
  const ua = await uidOf(A), ub = await uidOf(B), uc = await uidOf(C);
  await t("a new account has no family yet", async () => (await S(A, () => Store.family())) === null);
  const { hid } = await S(A, () => Store.createFamily());
  const code1 = (await S(A, () => Store.familyInfo())).code;
  await t("the partner joins with the invite code", async () => (await S(B, c => Store.joinFamily(c), code1)).hid === hid);

  // ---- private data ----
  await S(B, () => Store.putPrivate("checkins", "p1", { mood: 3 }));
  await S(A, () => Store.putPrivate("checkins", "a1", { mood: 4 }));
  await t("putPrivate writes under the signer's own uid, with by", async () =>
    await exists(`households/${hid}/private/${ub}/checkins/p1`) && !(await exists(`households/${hid}/private/${ua}/checkins/p1`)) &&
    (await admin(d => getDoc(doc(d, `households/${hid}/private/${ub}/checkins/p1`)).then(s => s.data().by))) === "partner@example.net");
  await t("watchPrivate sees only the signer's own private data", async () =>
    (await S(B, () => new Promise(res => { const un = Store.watchPrivate("checkins", l => { if (l.length) { un(); res(l.map(x => x[0]).join()); } }); }))) === "p1");

  // ---- patch ----
  await S(A, () => Store.put("events", "e1", { title: "a", note: "keep" }));
  await S(B, () => Store.patch("events", "e1", { title: "b", by: "intruder" }));
  await new Promise(r => setTimeout(r, 300));
  await t("patch merges one field, keeps the rest and the original author", async () => {
    const e = await admin(d => getDoc(doc(d, `households/${hid}/events/e1`)).then(s => s.data()));
    return e.title === "b" && e.note === "keep" && e.by === "owner@example.net";
  });
  await t("patch on a deleted record fails instead of recreating it", async () => {
    // Online it rejects at once; offline the rejection arrives later as a "store-error" event. Either way: an error, no document.
    const r = await S(B, () => { window.__errs = []; addEventListener("store-error", e => window.__errs.push(String(e.detail && e.detail.code)));
      return Store.patch("events", "gone", { title: "x" }).then(() => "resolved", e => String(e.code)); });
    await new Promise(res => setTimeout(res, 1500));
    return !(await exists(`households/${hid}/events/gone`)) && (r === "not-found" || (await S(B, () => window.__errs.join())).includes("not-found"));
  });

  // ---- removal by the owner ----
  await S(A, u => Store.removeMember(u), ub);
  const code2 = (await S(A, () => Store.familyInfo())).code;
  await t("removal revokes membership and replaces the invite code", async () => !(await exists(`households/${hid}/members/${ub}`)) && code2 !== code1 && !(await exists(`invites/${code1}`)));
  await t("the removed parent can't rejoin with the old code", async () => { try { await S(B, c => Store.joinFamily(c), code1); return false; } catch { return true; } });
  await B.context().setOffline(true);
  await t("offline, a removed parent's app deletes nothing (can't confirm removal)", async () => {
    const r = await S(B, () => Store.family());
    return r && r.hid === hid && await exists(`households/${hid}/private/${ub}/checkins/p1`) && await exists(`users/${ub}`);
  });
  await B.context().setOffline(false);
  await t("back online, the removed parent's app deletes their private data, then their family pointer", async () => {
    const r = await S(B, () => Store.family());
    return r === null && (await count(`households/${hid}/private/${ub}/checkins`)) === 0 && !(await exists(`users/${ub}`));
  });
  await t("the owner's private data is untouched by the removal", () => exists(`households/${hid}/private/${ua}/checkins/a1`));

  // ---- voluntary leave ----
  await S(C, c => Store.joinFamily(c), code2);
  await S(C, () => Store.putPrivate("checkins", "c1", { mood: 2 }));
  await t("leaving deletes the leaver's private data, membership and pointer", async () => {
    await S(C, () => Store.leave());
    return (await count(`households/${hid}/private/${uc}/checkins`)) === 0 && !(await exists(`households/${hid}/members/${uc}`)) && !(await exists(`users/${uc}`));
  });
  await t("leaving doesn't touch shared data or anyone else's private data", async () => await exists(`households/${hid}/events/e1`) && await exists(`households/${hid}/private/${ua}/checkins/a1`));

  // ---- account deletion by the last member ----
  await S(A, () => Store.put("needs", "n1", { text: "meals" }));
  await t("the last member's account deletion removes shared data (incl. events, needs), their private data and the family", async () => {
    await S(A, () => Store.deleteAccount("pw-owner-1"));
    return (await count(`households/${hid}/events`)) === 0 && (await count(`households/${hid}/needs`)) === 0 &&
      (await count(`households/${hid}/private/${ua}/checkins`)) === 0 && !(await exists(`households/${hid}`)) && !(await exists(`users/${ua}`));
  });
  await t("no page errors in the real Store", async () => { const e = [...A.errs, ...B.errs, ...C.errs]; if (e.length) throw new Error(e.join(" | ")); });

  await browser.close(); await env.cleanup(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
