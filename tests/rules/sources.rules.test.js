// Firestore rules for milk sources (Phase 2b), against the emulator. Uses the same accept/refuse fixtures as the app's
// validators (tests/sources.fixtures.js), so app and rules can't disagree.
//   runs inside `npm test` (firebase emulators:exec). RULES_FILE=<path> tests another rules file (mutate.js uses this).
const fs = require("fs"), path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, deleteDoc } = require("firebase/firestore");
const FX = require("../sources.fixtures.js");

const QUIET = !!process.env.QUIET;
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; QUIET || console.log("✓", name); } catch (e) { fail++; console.log("✗", name, "—", e.message); } };

(async () => {
  const rules = fs.readFileSync(process.env.RULES_FILE || path.join(__dirname, "../../firestore.rules"), "utf8");
  const env = await initializeTestEnvironment({ projectId: "demo-twins", firestore: { rules, host: "127.0.0.1", port: 8080 } });
  await env.clearFirestore();
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

  // ---- the catch-all no longer reaches these collections ----
  await t("an arbitrary document in slotMilk / milkUsual / schedPeriods / clients is refused", async () => {
    for (const c of ["slotMilk", "milkUsual", "schedPeriods"]) await assertFails(setDoc(doc(ann, `${H}/${c}/junk`), { anything: 1 }));
    await assertFails(setDoc(doc(ann, `${C}/ann`), { anything: 1 })); });
  await t("other shared collections still work for members", () => assertSucceeds(setDoc(doc(ann, `${H}/feeds/b0-1`), { v: 30 })));

  console.log(`\n${pass} passed, ${fail} failed`);
  await env.cleanup(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
