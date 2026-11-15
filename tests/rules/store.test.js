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
  await env.clearFirestore();   // rules.test.js runs first against the same emulator; start from empty data
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
  const setFail = (p, steps) => p.evaluate(a => { window.__FIREBASE_EMULATORS__.fail = a; }, steps);
  // Run fn in the page and report "ok" or the error's code (Playwright would drop .code if the error crossed back).
  const attempt = (p, fn, arg) => p.evaluate(async ([src, a]) => { try { await (0, eval)("(" + src + ")")(a); return "ok"; } catch (e) { return String(e && (e.code || e.message) || e); } }, [fn.toString(), arg]);
  // Does this sign-in still exist? Asks the Auth emulator directly (independent of any page state).
  const accountExists = async (email, password) => (await fetch(`http://${EMU.host}:${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).ok;
  const reopen = async p => { await p.reload(); await p.waitForFunction(() => !!window.Store); await uidOf(p); };
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

  // ---- correction 1: removing an allowlisted member of the original family is permanent ----
  const L1 = await open(), L2 = await open();
  await S(L1, () => Store.signUp("parent1@example.com", "pw-legacy-1")); await S(L2, () => Store.signUp("parent2@example.com", "pw-legacy-2"));
  const ul2 = await uidOf(L2);
  await t("both allowlisted parents land in the original family", async () => (await S(L1, () => Store.family())).hid === "main" && (await S(L2, () => Store.family())).hid === "main");
  await S(L2, () => Store.putPrivate("checkins", "l2", { mood: 2 }));
  await S(L1, u => Store.removeMember(u), ul2);
  await t("removal records a revocation for the allowlisted email and deletes the membership", async () =>
    await exists("households/main/revoked/parent2@example.com") && !(await exists(`households/main/members/${ul2}`)));
  await t("the revoked parent's next open cleans their private data and drops the pointer", async () =>
    (await S(L2, () => Store.family())) === null && (await count(`households/main/private/${ul2}/checkins`)) === 0 && !(await exists(`users/${ul2}`)));
  await reopen(L2);
  await t("after an app reload the allowlist does not let them back in", async () => (await S(L2, () => Store.family())) === null && !(await exists(`households/main/members/${ul2}`)));
  await S(L2, () => Store.signOut()); await S(L2, () => Store.signIn("parent2@example.com", "pw-legacy-2")); await uidOf(L2);
  await t("after signing out and back in they still can't regain access", async () => (await S(L2, () => Store.family())) === null && !(await exists(`households/main/members/${ul2}`)) && !(await exists(`users/${ul2}`)));
  await t("the remaining allowlisted parent keeps normal access", async () => {
    await S(L1, () => Store.put("feeds", "b0-1", { twin: "A", i: 0, t: 1, v: 30 })); await new Promise(r => setTimeout(r, 300));
    return (await S(L1, () => Store.family())).hid === "main" && await exists("households/main/feeds/b0-1");
  });

  // ---- correction 2: the invite is rotated (and checked) before anyone loses access ----
  const O = await open(), X = await open(), Y = await open();
  await S(O, () => Store.signUp("rot-owner@example.net", "pw-rot-1")); await S(X, () => Store.signUp("rot-member@example.net", "pw-rot-2")); await S(Y, () => Store.signUp("rot-outsider@example.net", "pw-rot-3"));
  const ux = await uidOf(X); const { hid: hr } = await S(O, () => Store.createFamily());
  const codeA = (await S(O, () => Store.familyInfo())).code; await S(X, c => Store.joinFamily(c), codeA);
  const houseCode = () => admin(d => getDoc(doc(d, `households/${hr}`)).then(s => s.data().code));
  await setFail(O, ["rotate"]);
  await t("if the new invite can't be published, removal fails and changes nothing", async () =>
    (await attempt(O, u => Store.removeMember(u), ux)) === "injected" && await exists(`households/${hr}/members/${ux}`) && (await houseCode()) === codeA);
  await setFail(O, ["invalidate"]);
  await t("if the old invite can't be deleted, removal fails and they keep their membership", async () =>
    (await attempt(O, u => Store.removeMember(u), ux)) === "injected" && await exists(`households/${hr}/members/${ux}`) && (await houseCode()) !== codeA);
  await t("…and the old code already can't be used to join (the family's code changed first)", async () => (await attempt(Y, c => Store.joinFamily(c), codeA)) === "bad-code" && !(await exists(`households/${hr}/members/${(await uidOf(Y))}`)));
  await setFail(O, []);
  await t("with nothing failing, removal completes", async () => (await attempt(O, u => Store.removeMember(u), ux)) === "ok" && !(await exists(`households/${hr}/members/${ux}`)));

  // ---- correction 3: account deletion fails closed ----
  const D = await open(); await S(D, () => Store.signUp("del-last@example.net", "pw-del-1")); const ud = await uidOf(D);
  const { hid: hd } = await S(D, () => Store.createFamily());
  await S(D, () => Promise.all([Store.put("events", "e1", { title: "x" }), Store.put("needs", "n1", { text: "y" }), Store.setProfile({ born: "2026-01-01" }), Store.putPrivate("checkins", "d1", { mood: 3 })]));
  for (const step of ["purge", "shared", "config", "invite", "household", "member"]) {
    await setFail(D, [step]);
    await t(`last member: a failure at "${step}" stops deletion and keeps the sign-in and family pointer`, async () =>
      (await attempt(D, pw => Store.deleteAccount(pw), "pw-del-1")) === "injected" && await accountExists("del-last@example.net", "pw-del-1") && await exists(`users/${ud}`));
  }
  await setFail(D, ["pointer"]);
  await t(`last member: a failure at "pointer" keeps the sign-in`, async () => (await attempt(D, pw => Store.deleteAccount(pw), "pw-del-1")) === "injected" && await accountExists("del-last@example.net", "pw-del-1"));
  await reopen(D);   // the app's retry path: next open finishes the cleanup, then Delete my account runs again
  await t("retry after reopening: the leftover pointer is cleaned up first", async () => (await S(D, () => Store.family())) === null && !(await exists(`users/${ud}`)));
  await setFail(D, ["auth"]);
  await t(`a failure deleting the sign-in itself leaves it in place`, async () => (await attempt(D, pw => Store.deleteAccount(pw), "pw-del-1")) === "injected" && await accountExists("del-last@example.net", "pw-del-1"));
  await setFail(D, []);
  await t("with nothing failing, the account and all the family's data are gone", async () =>
    (await attempt(D, pw => Store.deleteAccount(pw), "pw-del-1")) === "ok" && !(await accountExists("del-last@example.net", "pw-del-1")) &&
    !(await exists(`households/${hd}`)) && (await count(`households/${hd}/events`)) === 0 && (await count(`households/${hd}/needs`)) === 0 &&
    !(await exists(`households/${hd}/config/profile`)) && (await count(`households/${hd}/private/${ud}/checkins`)) === 0 && !(await exists(`households/${hd}/members/${ud}`)));

  // non-last members
  const G1 = await open(), G2 = await open(), G3 = await open();
  await S(G1, () => Store.signUp("g-owner@example.net", "pw-g-1")); await S(G2, () => Store.signUp("g-member@example.net", "pw-g-2")); await S(G3, () => Store.signUp("g-third@example.net", "pw-g-3"));
  const ug1 = await uidOf(G1), ug2 = await uidOf(G2), ug3 = await uidOf(G3);
  const { hid: hg } = await S(G1, () => Store.createFamily()); const gc = (await S(G1, () => Store.familyInfo())).code;
  await S(G2, c => Store.joinFamily(c), gc); await S(G3, c => Store.joinFamily(c), gc);
  await S(G1, () => Store.put("events", "keep", { title: "shared" })); await S(G2, () => Store.putPrivate("checkins", "g2", { mood: 1 }));
  for (const step of ["purge", "member"]) {
    await setFail(G2, [step]);
    await t(`non-last member: a failure at "${step}" stops deletion, keeps the sign-in, membership and pointer`, async () =>
      (await attempt(G2, pw => Store.deleteAccount(pw), "pw-g-2")) === "injected" && await accountExists("g-member@example.net", "pw-g-2") && await exists(`households/${hg}/members/${ug2}`) && await exists(`users/${ug2}`));
  }
  await setFail(G2, ["pointer"]);
  await t(`non-last member: a failure at "pointer" keeps the sign-in`, async () => (await attempt(G2, pw => Store.deleteAccount(pw), "pw-g-2")) === "injected" && await accountExists("g-member@example.net", "pw-g-2"));
  await reopen(G2); await setFail(G2, []);
  await t("non-last member: after reopening, deletion completes and shared data stays", async () =>
    (await S(G2, () => Store.family())) === null && (await attempt(G2, pw => Store.deleteAccount(pw), "pw-g-2")) === "ok" && !(await accountExists("g-member@example.net", "pw-g-2")) &&
    (await count(`households/${hg}/private/${ug2}/checkins`)) === 0 && await exists(`households/${hg}/events/keep`));
  await setFail(G1, ["transfer"]);
  await t(`owner with others left: a failure handing over ownership stops deletion and keeps everything`, async () =>
    (await attempt(G1, pw => Store.deleteAccount(pw), "pw-g-1")) === "injected" && await accountExists("g-owner@example.net", "pw-g-1") &&
    (await admin(d => getDoc(doc(d, `households/${hg}`)).then(s => s.data().owner))) === ug1 && await exists(`households/${hg}/members/${ug1}`));
  await setFail(G1, []);
  await t("owner with others left: deletion completes, ownership passes on, shared data stays", async () =>
    (await attempt(G1, pw => Store.deleteAccount(pw), "pw-g-1")) === "ok" && !(await accountExists("g-owner@example.net", "pw-g-1")) &&
    (await admin(d => getDoc(doc(d, `households/${hg}`)).then(s => s.data().owner))) === ug3 && await exists(`households/${hg}/events/keep`));

  await t("no page errors in the real Store", async () => { const e = [A, B, C, L1, L2, O, X, Y, D, G1, G2, G3].flatMap(p => p.errs); if (e.length) throw new Error(e.join(" | ")); });

  await browser.close(); await env.cleanup(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
