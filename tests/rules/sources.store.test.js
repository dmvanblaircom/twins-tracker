// Integration test: the REAL firebase-store.js against the Auth + Firestore emulators and the real firestore.rules —
// milk-source writes (Phase 2b B1): create-only history, the rev-guarded write (including two phones offline at once),
// lost-acknowledgement resends, phone version markers, and lifecycle deletion. Fictional accounts only.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection, setDoc, deleteDoc } = require("firebase/firestore");

const ROOT = path.join(__dirname, "../.."), FB = path.dirname(require.resolve("firebase/package.json"));
const PROJECT = "demo-twins", EMU = { host: "127.0.0.1", firestore: 8080, auth: 9099 };
let pass = 0, fail = 0;
const t = async (name, fn) => { try { const r = await fn(); if (r === false) throw new Error("check returned false"); pass++; console.log("✓", name); } catch (e) { fail++; console.log("✗", name, "—", e.message); } };
const harness = `<!doctype html><meta charset="utf-8"><script>window.__FIREBASE_EMULATORS__=${JSON.stringify(EMU)};</script>
<script>window.__errs=[]; addEventListener("store-error", e => __errs.push({ code: e.detail && e.detail.code, current: e.detail && e.detail.current || null }));</script>
<script type="module" src="/firebase-store.js"></script>`;
const config = `export const firebaseConfig = { apiKey: "demo-key", authDomain: "localhost", projectId: "${PROJECT}", appId: "demo" };`;
const srv = http.createServer((q, r) => {
  const u = q.url.split("?")[0];
  if (u === "/" || u === "/harness.html") { r.writeHead(200, { "content-type": "text/html" }); return r.end(harness); }
  if (u === "/firebase-config.js") { r.writeHead(200, { "content-type": "text/javascript" }); return r.end(config); }
  if (u === "/firebase-store.js") { r.writeHead(200, { "content-type": "text/javascript" }); return r.end(fs.readFileSync(path.join(ROOT, "firebase-store.js"))); }
  r.writeHead(404); r.end();
});
const T0 = 1771000000000;
const alloc = (o = {}) => ({ i: 0, t: T0, state: "set", mL10: { mom: 300, donor: 100, formula: 50 }, total10: 450, basis: "feed", rev: 1, editT: 1, ...o });

(async () => {
  await new Promise(res => srv.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8"), host: EMU.host, port: EMU.firestore } });
  await env.clearFirestore(); await require("./allowlist.js").seedAllowlist(env);
  const admin = async fn => { let out; await env.withSecurityRulesDisabled(async c => { out = await fn(c.firestore()); }); return out; };
  const get = p => admin(d => getDoc(doc(d, p)).then(s => s.exists() ? s.data() : null));
  const count = p => admin(d => getDocs(collection(d, p)).then(s => s.size));
  const browser = await chromium.launch();
  const open = async () => {
    const ctx = await browser.newContext();
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z]+\.js)/, route => {
      const f = route.request().url().match(/(firebase-[a-z]+\.js)$/)[1]; route.fulfill({ path: path.join(FB, f), contentType: "text/javascript" }); });
    const p = await ctx.newPage(); p.errs = []; p.on("pageerror", e => p.errs.push(e.message));
    await p.goto(base + "harness.html"); await p.waitForFunction(() => !!window.Store); return p;
  };
  const S = (p, fn, arg) => p.evaluate(fn, arg);
  // A write the rules are expected to refuse: catch it inside the page (the refusal is also reported via store-error).
  const refused = (p, fn, arg) => p.evaluate(async ([src, a]) => { try { await (0, eval)("(" + src + ")")(a); return "ok"; } catch (e) { return String(e && e.code || e); } }, [fn.toString(), arg]);
  const uidOf = p => S(p, () => new Promise(res => { const un = Store.onAuth(u => { if (u) { un && un(); res(u.uid); } }); }));
  const errs = p => S(p, () => window.__errs.splice(0));
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

  const A = await open(), B = await open();
  await S(A, () => Store.signUp("ann@example.net", "pw-ann-1")); await S(B, () => Store.signUp("ben@example.net", "pw-ben-1"));
  const ua = await uidOf(A), ub = await uidOf(B);
  const { hid } = await S(A, () => Store.createFamily()); const code = (await S(A, () => Store.familyInfo())).code;
  await S(B, c => Store.joinFamily(c), code);
  const H = `households/${hid}`, AL = `${H}/slotMilk/b0-${T0}`;

  await t("Store.lists names the milk-source collections (shared) and phone markers (meta, not backed up)", async () =>
    S(A, () => ["slotMilk", "milkUsual", "schedPeriods"].every(c => Store.lists.shared.includes(c)) && Store.lists.meta.join() === "clients" && !Store.lists.shared.includes("clients")));
  // ---- phone markers ----
  await S(A, () => Store.markClient(1)); await S(B, () => Store.markClient(1));
  await t("each phone records its own version", async () => (await get(`${H}/clients/${ua}`)).v === 1 && (await get(`${H}/clients/${ub}`)).v === 1);
  const tA = (await get(`${H}/clients/${ua}`)).t; await S(A, () => Store.markClient(1));
  await t("an unchanged version isn't rewritten", async () => (await get(`${H}/clients/${ua}`)).t === tA);
  // ---- create-only history ----
  const uid1 = `u-1-${T0}-ab12`;
  await S(A, ([id, t]) => Store.create("milkUsual", id, { i: 1, from: t, pct: { mom: 60, donor: 40, formula: 0 } }), [uid1, T0]);
  await t("Store.create writes a usual-milk entry, stamped with the author", async () => (await get(`${H}/milkUsual/${uid1}`)).by === "ann@example.net");
  await errs(B); await refused(B, ([id, t]) => Store.create("milkUsual", id, { i: 1, from: t, pct: { mom: 0, donor: 100, formula: 0 } }), [uid1, T0]);
  await t("writing over an existing history entry is refused and changes nothing", async () =>
    await until(async () => (await S(B, () => window.__errs.length)) > 0) && (await get(`${H}/milkUsual/${uid1}`)).pct.mom === 60);
  await errs(A); await refused(A, () => Store.create("milkUsual", "u-1-5-ab12", { i: 1, from: 5, pct: { mom: 50, donor: 40, formula: 0 } }));
  await t("an invalid entry (99%) is refused by the rules", async () => await until(async () => (await S(A, () => window.__errs.length)) > 0) && !(await get(`${H}/milkUsual/u-1-5-ab12`)));
  // ---- the rev-guarded write ----
  await t("guardedPut creates an allocation (rev 1, editBy = signer)", async () => {
    const r = await S(A, ([id, d]) => Store.guardedPut("slotMilk", id, d), [`b0-${T0}`, alloc()]); const s = await get(AL);
    return r.saved && s.rev === 1 && s.editBy === "ann@example.net" && s.by === "ann@example.net"; });
  await t("the other parent changes it with rev 2", async () => (await S(B, ([id, d]) => Store.guardedPut("slotMilk", id, d), [`b0-${T0}`, alloc({ rev: 2, mL10: { mom: 0, donor: 450, formula: 0 } })])).saved && (await get(AL)).rev === 2);
  await errs(A);
  await t("a stale write (rev 2 over stored 2, different parts) is refused as a conflict carrying the current copy", async () => {
    const r = await S(A, async ([id, d]) => { try { return await Store.guardedPut("slotMilk", id, d); } catch (e) { return { threw: e.code }; } }, [`b0-${T0}`, alloc({ rev: 2, mL10: { mom: 450, donor: 0, formula: 0 } })]);
    await until(async () => (await S(A, () => window.__errs.length)) > 0);
    const e = await errs(A), s = await get(AL);
    return (r.threw === "conflict" || r.pending) && e.some(x => x.code === "conflict" && x.current && x.current.mL10.donor === 450) && s.mL10.donor === 450 && s.editBy === "ben@example.net"; });
  await t("a resend of a write that already landed (lost acknowledgement) resolves as saved, with no conflict", async () => {
    const d = alloc({ rev: 3, mL10: { mom: 450, donor: 0, formula: 0 }, editT: 3 });
    const r1 = await S(A, ([id, x]) => Store.guardedPut("slotMilk", id, x), [`b0-${T0}`, d]);
    const r2 = await S(A, ([id, x]) => Store.guardedPut("slotMilk", id, x), [`b0-${T0}`, d]);
    await new Promise(r => setTimeout(r, 500));
    return r1.saved && r2.saved && r2.already && !(await errs(A)).length && (await get(AL)).rev === 3; });
  // ---- two phones offline, both editing the same feed's sources ----
  await t("both phones offline: both writes queue; the first to sync wins, the second is refused as a conflict", async () => {
    await A.context().setOffline(true); await B.context().setOffline(true); await errs(A); await errs(B);
    const ra = await S(A, ([id, x]) => Store.guardedPut("slotMilk", id, x), [`b0-${T0}`, alloc({ rev: 4, mL10: { mom: 0, donor: 0, formula: 450 }, editT: 4 })]);
    const rb = await S(B, ([id, x]) => Store.guardedPut("slotMilk", id, x), [`b0-${T0}`, alloc({ rev: 4, mL10: { mom: 0, donor: 450, formula: 0 }, editT: 5 })]);
    if (!ra.pending || !rb.pending) throw new Error(`expected both pending: ${JSON.stringify([ra, rb])}`);
    await A.context().setOffline(false);
    if (!(await until(async () => ((await get(AL)) || {}).rev === 4, 20000))) throw new Error("A never synced");
    await B.context().setOffline(false);
    if (!(await until(async () => (await S(B, () => window.__errs.length)) > 0, 20000))) throw new Error("B's conflict never surfaced");
    const e = await errs(B), s = await get(AL);
    return e.some(x => x.code === "conflict") && s.mL10.formula === 450 && s.editBy === "ann@example.net"; });
  // ---- activation: Store.activateSources() reads the member list from the server and names every member account ----
  const tryAct = p => p.evaluate(async () => { try { const r = await Store.activateSources(1); return { ok: true, r }; } catch (e) { return { ok: false, code: e.code }; } });
  const ACT = `${H}/config/sources`;
  await admin(d => deleteDoc(doc(d, `${H}/clients/${ub}`)));
  await t("activateSources: refused (not-ready) while the other member's marker is missing; nothing written", async () => { const r = await tryAct(A); return !r.ok && r.code === "not-ready" && !(await get(ACT)); });
  await admin(d => setDoc(doc(d, `${H}/clients/${ub}`), { v: 0, t: 1 }));
  await t("activateSources: refused while the other member's marker is out of date", async () => { const r = await tryAct(A); return !r.ok && r.code === "not-ready" && !(await get(ACT)); });
  await B.evaluate(() => Store.markClient(1));
  await t("activateSources: with both members current it writes the record naming both member accounts", async () => {
    const r = await tryAct(A), s = await get(ACT);
    return r.ok && s && s.on === true && s.by === "ann@example.net" && JSON.stringify([...s.phones].sort()) === JSON.stringify([ua, ub].sort()); });
  const first = await get(ACT);
  await t("activateSources: a second call returns the existing record unchanged (create-only)", async () => { const r = await tryAct(B); return r.ok && JSON.stringify(await get(ACT)) === JSON.stringify(first); });
  await t("the record can't be overwritten through setConfig (rules refuse; stays as it was)", async () => {
    const r = await refused(B, () => Store.setConfig("sources", { on: true, t: 9, by: "ben@example.net", phones: ["x"] }));
    await new Promise(z => setTimeout(z, 600)); return r !== "ok" && JSON.stringify(await get(ACT)) === JSON.stringify(first); });
  const C = await open(); await S(C, () => Store.signUp("cal@example.net", "pw-cal-1")); const uc = await uidOf(C);
  await S(C, c => Store.joinFamily(c), (await S(A, () => Store.familyInfo())).code);
  await t("a member who joins later is not named in the record (never shown as activated) and can't change it", async () => {
    const r = await tryAct(C), s = await get(ACT);
    return r.ok && !s.phones.includes(uc) && JSON.stringify(s) === JSON.stringify(first); });
  await t("…and their account's app reports its own version separately", async () => { await S(C, () => Store.markClient(1)); return (await get(`${H}/clients/${uc}`)).v === 1; });
  await S(C, () => Store.leave());
  const D = await open(); await S(D, () => Store.signUp("dee@example.net", "pw-dee-1")); const ud = await uidOf(D);
  const hd = (await S(D, () => Store.createFamily())).hid; await S(D, () => Store.markClient(1));
  await t("a one-member family can turn milk sources on (names just that account)", async () => { const r = await tryAct(D), s = await get(`households/${hd}/config/sources`); return r.ok && JSON.stringify(s.phones) === JSON.stringify([ud]); });
  await D.context().setOffline(true);
  await t("activateSources offline: refused with code offline (it needs the server's member list)", async () => {
    await admin(d => deleteDoc(doc(d, `households/${hd}/config/sources`)));
    const r = await tryAct(D); return !r.ok && r.code === "offline"; });
  await D.context().setOffline(false);
  // ---- photos (Phase 5) ----
  const EVP = "e-1771000000000-ph01", PH = "ph-1771000000001-ab01";
  await S(A, id => Store.put("events", id, { kind: "journal", scope: "family", i: null, key: null, t: 1, title: "Photo day", note: "", ref: null, src: null, createdT: 1, editT: 1, editBy: "ann@example.net" }), EVP);
  await t("Store.lists names the photo collections (media)", () => S(A, () => Store.lists.media.join() === "photos,photoData" && !Store.lists.shared.includes("photos")));
  const seenB = S(B, ev => new Promise(res => { const u = Store.watchPhotos([ev], l => { if (l.length) { u(); res(l); } }); }), EVP);
  await S(A, ([id, ev]) => Store.putPhoto(id, { ev, t: 1771000000001, w: 1600, h: 1200, bytes: 30200, thumb: new Uint8Array(200).fill(3) }, new Uint8Array(30000).fill(9)), [PH, EVP]);
  await t("putPhoto writes the metadata (stamped with the author) and the full image", async () => { const m = await get(`${H}/photos/${PH}`), f = await get(`${H}/photoData/${PH}`);
    return m && m.by === "ann@example.net" && m.thumb.toUint8Array().length === 200 && f && f.full.toUint8Array().length === 30000; });
  await t("the other parent's watchPhotos sees it with its thumbnail as bytes", async () => { const l = await seenB; return l.length === 1 && l[0][0] === PH && l[0][1].thumb instanceof Object && l[0][1].thumb.length === 200; });
  await t("watchPhotos only returns photos of the moments asked for", () => S(B, () => new Promise(res => { const u = Store.watchPhotos(["e-1-other"], l => { u(); res(l.length === 0); }); })));
  await t("photoFull reads the full image on demand", () => S(B, id => Store.photoFull(id).then(b => b && b.length === 30000 && b[0] === 9), PH));
  await t("photoUsage counts the family's photos and their bytes", () => S(A, () => Store.photoUsage().then(u => u.n === 1 && u.bytes === 30200)));
  await S(B, id => Store.markPhoto(id, 12345), PH);
  await t("markPhoto sets the delete marker", async () => (await get(`${H}/photos/${PH}`)).deletedT === 12345);
  await S(B, id => Store.markPhoto(id, null), PH);
  await t("…and Undo clears it", async () => !("deletedT" in (await get(`${H}/photos/${PH}`))));
  const PH2 = "ph-1771000000002-ab02";
  await S(A, ([id, ev]) => Store.putPhoto(id, { ev, t: 1771000000002, w: 800, h: 600, bytes: 1100, thumb: new Uint8Array(100).fill(1) }, new Uint8Array(1000).fill(2)), [PH2, EVP]);
  await S(A, id => Store.purgePhoto(id), PH2);
  await t("purgePhoto removes the full image and the metadata", async () => !(await get(`${H}/photos/${PH2}`)) && !(await get(`${H}/photoData/${PH2}`)));
  await A.context().setOffline(true);
  const PH3 = "ph-1771000000003-ab03";
  await S(A, ([id, ev]) => Store.putPhoto(id, { ev, t: 1771000000003, w: 800, h: 600, bytes: 1100, thumb: new Uint8Array(100).fill(1) }, new Uint8Array(1000).fill(2)), [PH3, EVP]);
  await t("offline, putPhoto returns and the photo is queued (not on the server yet)", async () => !(await get(`${H}/photos/${PH3}`)));
  await A.context().setOffline(false);
  await t("back online, the queued photo and its image both arrive", () => until(async () => !!(await get(`${H}/photos/${PH3}`)) && !!(await get(`${H}/photoData/${PH3}`)), 15000));
  // ---- lifecycle: the last member out deletes everything, including phone markers ----
  await refused(A, () => Store.create("schedPeriods", "s-0-ab12", { from: 0, everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full10: [490, 530], src: "first-use" }));
  await t("leaving removes your own phone marker", async () => { await S(B, () => Store.leave()); return !(await get(`${H}/clients/${ub}`)); });
  await t("account deletion fails closed if the shared-data step fails (milk sources untouched)", async () => {
    await S(A, () => { window.__FIREBASE_EMULATORS__.fail = ["shared"]; });
    const r = await S(A, async () => { try { await Store.deleteAccount("pw-ann-1"); return "ok"; } catch (e) { return e.code; } });
    await S(A, () => { window.__FIREBASE_EMULATORS__.fail = []; });
    return r === "injected" && (await count(`${H}/slotMilk`)) === 1 && (await count(`${H}/milkUsual`)) === 1 && (await count(`${H}/schedPeriods`)) === 1; });
  await t("the last member's account deletion removes allocations, history, photos and phone markers", async () => {
    await S(A, () => Store.deleteAccount("pw-ann-1"));
    return (await count(`${H}/slotMilk`)) + (await count(`${H}/milkUsual`)) + (await count(`${H}/schedPeriods`)) + (await count(`${H}/clients`)) + (await count(`${H}/photos`)) + (await count(`${H}/photoData`)) === 0 && !(await get(ACT)); });
  // ---- Phase 2.5 P2-10: a refusal on users/ is reported, never treated as "old rules" (which used to open `main`) ----
  const E = await open(); await S(E, () => Store.signUp("eli@example.net", "pw-eli-1")); await S(E, () => Store.createFamily());
  const RULES = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8"), USERS_READ = "allow read, delete: if signedIn() && request.auth.uid == uid;";
  if (!RULES.includes(USERS_READ)) throw new Error("users/ rule pattern not found");
  const envDeny = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: RULES.replace(USERS_READ, "allow read, delete: if false;"), host: EMU.host, port: EMU.firestore } });
  await t("family(): a permission refusal on users/ throws code 'denied' and doesn't open the original family", async () => {
    const r = await S(E, async () => { try { const f = await Store.family(); return { ok: true, f }; } catch (e) { return { ok: false, code: e.code }; } });
    return !r.ok && r.code === "denied"; });
  await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: RULES, host: EMU.host, port: EMU.firestore } });   // restore the real rules
  await envDeny.cleanup();
  await t("no page errors", () => A.errs.length === 0 && B.errs.length === 0 && C.errs.length === 0 && D.errs.length === 0 && E.errs.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); await env.cleanup(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
