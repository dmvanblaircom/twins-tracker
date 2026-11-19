// Firestore rules for milk sources (Phase 2b), against the emulator. Uses the same accept/refuse fixtures as the app's
// validators (tests/sources.fixtures.js), so app and rules can't disagree.
//   runs inside `npm test` (firebase emulators:exec). RULES_FILE=<path> tests another rules file (mutate.js uses this).
const fs = require("fs"), path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, deleteDoc, updateDoc, deleteField, writeBatch, Bytes } = require("firebase/firestore");
const FX = require("../sources.fixtures.js");

const QUIET = !!process.env.QUIET;
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; QUIET || console.log("✓", name); } catch (e) { fail++; console.log("✗", name, "—", e.message); } };

(async () => {
  const rules = fs.readFileSync(process.env.RULES_FILE || path.join(__dirname, "../../firestore.rules"), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-twins", firestore: { rules, host: "127.0.0.1", port: 8080 } });
  await env.clearFirestore(); await require("./allowlist.js").seedAllowlist(env);
  const as = (uid, email) => env.authenticatedContext(uid, { email }).firestore();
  const H = "households/hs";
  const ann = as("ann", FX.E), ben = as("ben", "parent2@example.com"), zed = as("zed", "zed@example.net");
  const dad = as("dad", "parent1@example.com");           // allowlisted email (placeholder) for the original family
  const admin = async fn => { let out; await env.withSecurityRulesDisabled(async c => { out = await fn(c.firestore()); }); return out; };
  await admin(async d => {
    await setDoc(doc(d, H), { owner: "ann", code: "CODEAAAA", codeExp: Date.now() + 1e9, created: 1 });
    await setDoc(doc(d, `${H}/members/ann`), { email: FX.E, t: 1 });
    await setDoc(doc(d, `${H}/members/ben`), { email: "parent2@example.com", t: 1 });
  });
  const clear = p => admin(d => deleteDoc(doc(d, p)));
  const seed = (p, v) => admin(d => setDoc(doc(d, p), v));

  // ---- allocations: shape (create) ----
  for (const [name, id, d] of FX.allocOk) await t(`accepts allocation: ${name}`, async () => { await clear(`${H}/slotMilk/${id}`); await assertSucceeds(setDoc(doc(ann, `${H}/slotMilk/${id}`), d)); });
  for (const [name, id, d] of FX.allocBad) await t(`refuses allocation: ${name}`, async () => { await clear(`${H}/slotMilk/${id}`); await assertFails(setDoc(doc(ann, `${H}/slotMilk/${id}`), d)); });
  // ---- allocations: the rev guard ----
  const A = `${H}/slotMilk/b0-${FX.T}`, v1 = FX.alloc(), v2 = FX.alloc({ rev: 2, mL10: { mom: 450, donor: 0, formula: 0 } });
  await t("a change must carry rev = stored + 1", async () => { await clear(A); await seed(A, v1); await assertSucceeds(setDoc(doc(ann, A), v2)); });
  await t("a stale change (same rev as stored) is refused", async () => { await clear(A); await seed(A, v1); await assertFails(setDoc(doc(ann, A), FX.alloc({ rev: 1, mL10: { mom: 450, donor: 0, formula: 0 } }))); });
  await t("a change that skips a rev is refused", async () => { await clear(A); await seed(A, v1); await assertFails(setDoc(doc(ann, A), FX.alloc({ rev: 3 }))); });
  await t("two parents from the same copy: the first wins, the second is refused", async () => {
    await clear(A); await seed(A, v1);
    await assertSucceeds(setDoc(doc(ann, A), v2));
    await assertFails(setDoc(doc(ben, A), FX.alloc({ rev: 2, mL10: { mom: 0, donor: 450, formula: 0 }, editBy: "parent2@example.com" })));
    const now = await admin(d => getDoc(doc(d, A))); if (now.data().mL10.mom !== 450) throw new Error("overwritten");
  });
  await t("on a change, editBy must be the signer", async () => { await clear(A); await seed(A, v1); await assertFails(setDoc(doc(ann, A), { ...v2, editBy: "parent2@example.com" })); });
  await t("on create (restore), editBy may be the other parent", async () => { await clear(A); await assertSucceeds(setDoc(doc(ann, A), FX.alloc({ editBy: "parent2@example.com", by: "parent2@example.com" }))); });
  await t("'use usual milk' is a guarded change", async () => { await clear(A); await seed(A, v1); await assertSucceeds(setDoc(doc(ann, A), FX.alloc({ rev: 2, state: "usual", mL10: null, total10: null, basis: null }))); });
  await t("members can delete an allocation (Undo of a create, lifecycle)", async () => { await clear(A); await seed(A, v1); await assertSucceeds(deleteDoc(doc(ben, A))); });
  // ---- who ----
  await t("a stranger can't read allocations", async () => { await seed(A, v1); await assertFails(getDoc(doc(zed, A))); });
  await t("a stranger can't create, change or delete allocations", async () => {
    await clear(A); await assertFails(setDoc(doc(zed, A), v1)); await seed(A, v1); await assertFails(setDoc(doc(zed, A), v2)); await assertFails(deleteDoc(doc(zed, A))); });
  await t("members read allocations", () => assertSucceeds(getDoc(doc(ben, A))));
  await t("the original family's allowlisted email can use allocations there", async () => {
    await clear(`households/main/slotMilk/b0-${FX.T}`); await assertSucceeds(setDoc(doc(dad, `households/main/slotMilk/b0-${FX.T}`), FX.alloc({ editBy: "parent1@example.com" }))); });

  // ---- usual milk ----
  for (const [name, id, d] of FX.usualOk) await t(`accepts usual milk: ${name}`, async () => { await clear(`${H}/milkUsual/${id}`); await assertSucceeds(setDoc(doc(ann, `${H}/milkUsual/${id}`), d)); });
  for (const [name, id, d] of FX.usualBad) await t(`refuses usual milk: ${name}`, async () => { await clear(`${H}/milkUsual/${id}`); await assertFails(setDoc(doc(ann, `${H}/milkUsual/${id}`), d)); });
  const U = `${H}/milkUsual/u-1-${FX.T}-ab12`;
  await t("usual-milk entries can't be edited (history is append-only)", async () => { await clear(U); await seed(U, FX.usual()); await assertFails(setDoc(doc(ann, U), FX.usual({ pct: { mom: 100, donor: 0, formula: 0 } }))); });
  await t("members can delete a usual-milk entry (Undo, lifecycle); strangers can't read or delete", async () => {
    await seed(U, FX.usual()); await assertFails(getDoc(doc(zed, U))); await assertFails(deleteDoc(doc(zed, U))); await assertSucceeds(deleteDoc(doc(ben, U))); });
  await t("a stranger can't add a usual-milk entry", async () => { await clear(U); await assertFails(setDoc(doc(zed, U), FX.usual())); });

  // ---- schedule periods ----
  for (const [name, id, d] of FX.periodOk) await t(`accepts period: ${name}`, async () => { await clear(`${H}/schedPeriods/${id}`); await assertSucceeds(setDoc(doc(ann, `${H}/schedPeriods/${id}`), d)); });
  for (const [name, id, d] of FX.periodBad) await t(`refuses period: ${name}`, async () => { await clear(`${H}/schedPeriods/${id}`); await assertFails(setDoc(doc(ann, `${H}/schedPeriods/${id}`), d)); });
  const S = `${H}/schedPeriods/s-0-ab12`;
  await t("periods can't be edited", async () => { await clear(S); await seed(S, FX.period()); await assertFails(setDoc(doc(ann, S), FX.period({ everyH: 2 }))); });
  await t("a stranger can't read, add or delete periods", async () => { await assertFails(getDoc(doc(zed, S))); await assertFails(deleteDoc(doc(zed, S))); await clear(S); await assertFails(setDoc(doc(zed, S), FX.period())); });

  // ---- phone version markers ----
  const C = `${H}/clients`;
  await t("each member records their own phone's version", () => assertSucceeds(setDoc(doc(ann, `${C}/ann`), { v: 1, t: 1 })));
  await t("…and can update it", () => assertSucceeds(setDoc(doc(ann, `${C}/ann`), { v: 2, t: 2 })));
  await t("no one can write another member's version (which could unlock tracking early)", () => assertFails(setDoc(doc(ann, `${C}/ben`), { v: 1, t: 1 })));
  await t("version markers have exactly v (≥ 1, integer) and t", async () => {
    await assertFails(setDoc(doc(ben, `${C}/ben`), { v: 0, t: 1 })); await assertFails(setDoc(doc(ben, `${C}/ben`), { v: 1.5, t: 1 }));
    await assertFails(setDoc(doc(ben, `${C}/ben`), { v: 1, t: 1, x: 1 })); await assertFails(setDoc(doc(ben, `${C}/ben`), { v: 1 })); });
  await t("members read every marker; strangers can't read or write", async () => {
    await assertSucceeds(getDoc(doc(ben, `${C}/ann`))); await assertFails(getDoc(doc(zed, `${C}/ann`))); await assertFails(setDoc(doc(zed, `${C}/zed`), { v: 1, t: 1 })); });
  await t("members may delete markers (lifecycle; deleting only ever blocks tracking)", () => assertSucceeds(deleteDoc(doc(ben, `${C}/ann`))));

  // ---- activation (config/sources): enforced by the rules, not only the app ----
  // A uid identifies a member ACCOUNT, not a device; a marker is self-reported by that account's app.
  const ACT = `${H}/config/sources`, act = (o = {}) => ({ on: true, t: 1, by: FX.E, phones: ["ann", "ben"], ...o });
  const markers = async m => { for (const u of ["ann", "ben", "cal", "zed"]) await clear(`${H}/clients/${u}`); for (const [u, v] of Object.entries(m)) await seed(`${H}/clients/${u}`, { v, t: 1 }); };
  await t("activation: two members, both markers current → allowed", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 }); await assertSucceeds(setDoc(doc(ann, ACT), act())); });
  await t("activation: the other member's marker is missing → refused", async () => { await clear(ACT); await markers({ ann: 1 }); await assertFails(setDoc(doc(ann, ACT), act())); });
  await t("activation: the other member's marker is out of date → refused", async () => { await clear(ACT); await markers({ ann: 1, ben: 0 }); await assertFails(setDoc(doc(ann, ACT), act())); });
  await t("activation: the signer's own marker is missing → refused", async () => { await clear(ACT); await markers({ ben: 1 }); await assertFails(setDoc(doc(ann, ACT), act())); });
  await t("activation: the old / UI-bypass shape {on, t, by} with no member list → refused", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 }); await assertFails(setDoc(doc(ann, ACT), { on: true, t: 1, by: FX.E })); });
  await t("activation: leaving out the signer → refused", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 }); await assertFails(setDoc(doc(ann, ACT), act({ phones: ["ben"] }))); });
  await t("activation: naming a non-member who has a marker → refused", async () => { await clear(ACT); await markers({ ann: 1, zed: 1 }); await assertFails(setDoc(doc(ann, ACT), act({ phones: ["ann", "zed"] }))); });
  await t("activation: a forged author (someone else's email) → refused", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 }); await assertFails(setDoc(doc(ann, ACT), act({ by: "parent2@example.com" }))); });
  await t("activation: extra fields, on:false, or more than 4 accounts → refused", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 });
    await assertFails(setDoc(doc(ann, ACT), act({ x: 1 }))); await assertFails(setDoc(doc(ann, ACT), act({ on: false })));
    await assertFails(setDoc(doc(ann, ACT), act({ phones: ["ann", "ben", "ann", "ben", "ann"] }))); });
  await t("activation: a stranger → refused", async () => { await clear(ACT); await assertFails(setDoc(doc(zed, ACT), act({ by: "zed@example.net", phones: ["zed"] }))); });
  await t("activation: an allowlisted email that isn't a member of main → refused", () => assertFails(setDoc(doc(dad, "households/main/config/sources"), { on: true, t: 1, by: "parent1@example.com", phones: ["dad"] })));
  await t("activation can't be overwritten, by either member", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 }); await seed(ACT, act());
    await assertFails(setDoc(doc(ben, ACT), act({ by: "parent2@example.com", phones: ["ben"] }))); await assertFails(setDoc(doc(ann, ACT), act({ t: 2 }))); });
  await t("activation: a member may delete it (switches tracking off); a stranger can't", async () => { await seed(ACT, act()); await assertFails(deleteDoc(doc(zed, ACT))); await assertSucceeds(deleteDoc(doc(ben, ACT))); });
  await t("deleting the activation leaves every milk-source document untouched", async () => {
    const docs = { [`${H}/slotMilk/b0-${FX.T}`]: FX.alloc(), [`${H}/milkUsual/u-1-${FX.T}-ab12`]: FX.usual(), [`${H}/schedPeriods/s-0-ab12`]: FX.period() };
    for (const [p, d] of Object.entries(docs)) await seed(p, d);
    await seed(ACT, act()); await assertSucceeds(deleteDoc(doc(ann, ACT)));
    for (const [p, d] of Object.entries(docs)) { const now = await admin(x => getDoc(doc(x, p))); if (!now.exists() || JSON.stringify(now.data()) !== JSON.stringify(d)) throw new Error("changed: " + p); } });
  await t("restore: re-creating a backed-up activation is held to the same rule (refused while a marker is missing)", async () => { await clear(ACT); await markers({ ann: 1 }); await assertFails(setDoc(doc(ann, ACT), act({ t: 12345 }))); });
  await t("restore: …and allowed only once every named account's marker is current", async () => { await clear(ACT); await markers({ ann: 1, ben: 1 }); await assertSucceeds(setDoc(doc(ann, ACT), act({ t: 12345 }))); });
  await t("a member who joins later can read the activation but can't rewrite it to add themselves", async () => {
    await clear(ACT); await markers({ ann: 1, ben: 1, cal: 1 }); await seed(ACT, act());
    await seed(`${H}/members/cal`, { email: "cal@example.net", t: 2 });
    const cal = as("cal", "cal@example.net");
    await assertSucceeds(getDoc(doc(cal, ACT)));
    await assertFails(setDoc(doc(cal, ACT), act({ by: "cal@example.net", phones: ["ann", "ben", "cal"] })));
    const now = await admin(x => getDoc(doc(x, ACT))); if (JSON.stringify(now.data().phones) !== '["ann","ben"]') throw new Error("changed");
    await clear(`${H}/members/cal`); });
  await t("one-member family: activation naming only that member is allowed", async () => {
    const H1 = "households/solo", sol = as("sol", "sol@example.net");
    await admin(async x => { await setDoc(doc(x, H1), { owner: "sol", code: "CODESOLO", codeExp: Date.now() + 1e9, created: 1 }); await setDoc(doc(x, `${H1}/members/sol`), { email: "sol@example.net", t: 1 }); await setDoc(doc(x, `${H1}/clients/sol`), { v: 1, t: 1 }); });
    await assertSucceeds(setDoc(doc(sol, `${H1}/config/sources`), { on: true, t: 1, by: "sol@example.net", phones: ["sol"] })); });
  await t("other settings keep their rule: members write profile / diet / people / milk; strangers can't", async () => {
    for (const k of ["profile", "diet", "people", "milk"]) await assertSucceeds(setDoc(doc(ben, `${H}/config/${k}`), { x: 1 }));
    await assertFails(setDoc(doc(zed, `${H}/config/profile`), { x: 1 })); await assertFails(getDoc(doc(zed, `${H}/config/profile`))); });

  // ---- membership records (Phase 2.5 P2-01): exactly {email, t?, code?}, and the email is the signer's own ----
  await admin(async x => { await setDoc(doc(x, "households/hm"), { owner: "ann", code: "CODEMEMB", codeExp: Date.now() + 1e9, created: 1 }); await setDoc(doc(x, "households/hm/members/ann"), { email: FX.E, t: 1 }); });
  const kim = as("kim", "kim@example.net"), KIM = "households/hm/members/kim";
  await t("joining with the right code and your own email is allowed (what the app writes)", async () => { await clear(KIM); await assertSucceeds(setDoc(doc(kim, KIM), { email: "kim@example.net", t: 1, code: "CODEMEMB" })); });
  await t("joining under someone else's email is refused", async () => { await clear(KIM); await assertFails(setDoc(doc(kim, KIM), { email: "parent2@example.com", t: 1, code: "CODEMEMB" })); });
  await t("a membership record with extra fields is refused", async () => { await clear(KIM); await assertFails(setDoc(doc(kim, KIM), { email: "kim@example.net", t: 1, code: "CODEMEMB", name: "Somebody" })); });
  await t("a membership record without an email is refused", async () => { await clear(KIM); await assertFails(setDoc(doc(kim, KIM), { t: 1, code: "CODEMEMB" })); });
  await t("a membership record whose time isn't a number is refused", async () => { await clear(KIM); await assertFails(setDoc(doc(kim, KIM), { email: "kim@example.net", t: "now", code: "CODEMEMB" })); });
  await t("the email check ignores letter case in the sign-in (stored lowercase)", async () => { await clear(KIM); const kim2 = as("kim", "Kim@Example.net"); await assertSucceeds(setDoc(doc(kim2, KIM), { email: "kim@example.net", t: 1, code: "CODEMEMB" })); });
  await t("the owner creating their own family record can't use someone else's email", async () => {
    const hal = as("hal", "hal@example.net");
    await assertSucceeds(setDoc(doc(hal, "households/hh"), { owner: "hal", code: "CODEHALL", codeExp: Date.now() + 1e9, created: 1 }));
    await assertFails(setDoc(doc(hal, "households/hh/members/hal"), { email: "parent1@example.com", t: 1 }));
    await assertSucceeds(setDoc(doc(hal, "households/hh/members/hal"), { email: "hal@example.net", t: 1 })); });
  await t("an allowlisted email claiming main must use its own email", async () => {
    await admin(x => deleteDoc(doc(x, "households/main/members/dad")));
    await assertFails(setDoc(doc(dad, "households/main/members/dad"), { email: "parent2@example.com", t: 1 }));
    await assertSucceeds(setDoc(doc(dad, "households/main/members/dad"), { email: "parent1@example.com", t: 1 })); });

  // ---- the allowlist lives in admin/allowlist (console only), not in the rules file ----
  await t("no client can read the allowlist document — not a member, not an allowlisted email, not a stranger", async () => {
    await assertFails(getDoc(doc(dad, "admin/allowlist"))); await assertFails(getDoc(doc(ann, "admin/allowlist"))); await assertFails(getDoc(doc(zed, "admin/allowlist"))); });
  await t("no client can change or delete it (e.g. add themselves)", async () => {
    await assertFails(setDoc(doc(zed, "admin/allowlist"), { emails: ["zed@example.net"] })); await assertFails(setDoc(doc(dad, "admin/allowlist"), { emails: ["parent1@example.com", "zed@example.net"] }));
    await assertFails(deleteDoc(doc(dad, "admin/allowlist"))); });
  await t("an email on the allowlist can use the original family; the check ignores letter case", async () => {
    await assertSucceeds(getDoc(doc(as("pa1", "Parent1@Example.com"), "households/main/config/profile"))); });   // not a member: access comes from the list
  await t("an email not on the allowlist can't", () => assertFails(getDoc(doc(zed, "households/main/config/profile"))));
  await t("with no allowlist document, the allowlist grants nothing (members still have access)", async () => {
    await admin(x => setDoc(doc(x, "households/main/members/mem"), { email: "mem@example.net", t: 1 }));
    await admin(x => deleteDoc(doc(x, "admin/allowlist")));
    await assertFails(getDoc(doc(as("pa1", "parent1@example.com"), "households/main/config/profile")));   // allowlisted email, not a member
    await assertSucceeds(getDoc(doc(as("mem", "mem@example.net"), "households/main/config/profile")));
    await require("./allowlist.js").seedAllowlist(env); await admin(x => deleteDoc(doc(x, "households/main/members/mem"))); });

  // ---- photos (Phase 5): metadata + thumbnail and the full image, written together, on an existing moment ----
  const EVP = `${H}/events/e-1771000000000-ph01`;
  await seed(EVP, { kind: "journal", scope: "family", i: null, key: null, t: 1, title: "Photo day", note: "", ref: null, src: null, by: FX.E, createdT: 1, editT: 1, editBy: FX.E });
  const B = n => Bytes.fromUint8Array(new Uint8Array(n).fill(7));
  const pmeta = (o = {}) => ({ ev: "e-1771000000000-ph01", t: 1771000000000, w: 1600, h: 1200, bytes: 300000, thumb: B(20000), by: FX.E, ...o });
  let pn = 0; const pid = () => `ph-177100000000${pn}-ab${String(pn++).padStart(2, "0")}`;
  const putPh = (db, id, meta, full = B(280000)) => { const b = writeBatch(db); b.set(doc(db, `${H}/photoData/${id}`), { full }); b.set(doc(db, `${H}/photos/${id}`), meta); return b.commit(); };
  await t("a member adds a photo (metadata and full image in one batch)", () => assertSucceeds(putPh(ann, pid(), pmeta())));
  await t("a photo's metadata without its full image is refused", () => assertFails(setDoc(doc(ann, `${H}/photos/${pid()}`), pmeta())));
  await t("a photo on a moment that doesn't exist is refused", () => assertFails(putPh(ann, pid(), pmeta({ ev: "e-1-none" }))));
  await t("a photo with extra fields is refused", () => assertFails(putPh(ann, pid(), pmeta({ gps: "x" }))));
  await t("a photo missing a field is refused", () => { const m = pmeta(); delete m.h; return assertFails(putPh(ann, pid(), m)); });
  await t("a photo larger than 1600 px is refused", () => assertFails(putPh(ann, pid(), pmeta({ w: 4032 }))));
  await t("a photo whose size isn't a positive whole number is refused", () => assertFails(putPh(ann, pid(), pmeta({ bytes: 0 }))));
  await t("a thumbnail over 100 KB is refused", () => assertFails(putPh(ann, pid(), pmeta({ thumb: B(102401) }))));
  await t("a full image over 900 KB is refused", () => assertFails(putPh(ann, pid(), pmeta(), B(921601))));
  await t("a photo written in someone else's name is refused", () => assertFails(putPh(ann, pid(), pmeta({ by: "parent2@example.com" }))));
  await t("a photo id in the wrong form is refused", () => assertFails(putPh(ann, "junk", pmeta())));
  await t("full-image documents carry only the image", () => { const b = writeBatch(ann), id = pid(); b.set(doc(ann, `${H}/photoData/${id}`), { full: B(1000), note: "x" }); b.set(doc(ann, `${H}/photos/${id}`), pmeta()); return assertFails(b.commit()); });
  await t("a stranger can't add, read or delete photos", async () => { const id = pid(); await putPh(ann, id, pmeta());
    await assertFails(putPh(zed, pid(), pmeta({ by: "zed@example.net" }))); await assertFails(getDoc(doc(zed, `${H}/photos/${id}`))); await assertFails(getDoc(doc(zed, `${H}/photoData/${id}`)));
    await assertFails(deleteDoc(doc(zed, `${H}/photoData/${id}`))); });
  await t("the other parent reads both, and can soft-delete, undo and purge", async () => { const id = pid(); await putPh(ann, id, pmeta());
    await assertSucceeds(getDoc(doc(ben, `${H}/photoData/${id}`))); await assertSucceeds(updateDoc(doc(ben, `${H}/photos/${id}`), { deletedT: 5 }));
    await assertSucceeds(updateDoc(doc(ben, `${H}/photos/${id}`), { deletedT: deleteField() }));
    await assertSucceeds(deleteDoc(doc(ben, `${H}/photoData/${id}`))); await assertSucceeds(deleteDoc(doc(ben, `${H}/photos/${id}`))); });
  await t("a photo can't be edited apart from the delete marker", async () => { const id = pid(); await putPh(ann, id, pmeta());
    await assertFails(updateDoc(doc(ann, `${H}/photos/${id}`), { ev: "e-1771000000000-ph01", w: 10 })); await assertFails(updateDoc(doc(ann, `${H}/photos/${id}`), { deletedT: "soon" }));
    await assertFails(setDoc(doc(ann, `${H}/photoData/${id}`), { full: B(10) })); });

  // ---- the catch-all no longer reaches these collections ----
  await t("an arbitrary document in slotMilk / milkUsual / schedPeriods / clients is refused", async () => {
    for (const c of ["slotMilk", "milkUsual", "schedPeriods", "photos", "photoData"]) await assertFails(setDoc(doc(ann, `${H}/${c}/junk`), { anything: 1 }));
    await assertFails(setDoc(doc(ann, `${C}/ann`), { anything: 1 })); });
  await t("other shared collections still work for members", () => assertSucceeds(setDoc(doc(ann, `${H}/feeds/b0-1`), { v: 30 })));

  console.log(`\n${pass} passed, ${fail} failed`);
  await env.cleanup(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
