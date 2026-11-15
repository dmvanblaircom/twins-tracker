// Firestore security rules tests, run against the local emulator (needs Java).
//   cd tests/rules && npm install && npm test
// Uses the placeholder allowlist emails from firestore.rules — never real ones.
const fs = require("fs"), path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } = require("firebase/firestore");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("✓", name); } catch (e) { fail++; console.log("✗", name, "—", e.message); } };

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-twins", firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 }
  });
  const as = (uid, email) => env.authenticatedContext(uid, { email }).firestore();
  const dad = as("dad", "parent1@example.com"), mom = as("mom", "parent2@example.com");
  const eve = as("eve", "eve@example.net"), sam = as("sam", "sam@example.net"), anon = env.unauthenticatedContext().firestore();
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "households/main/feeds/b0-1"), { twin: "A", i: 0, t: 1, v: 30 }); });

  // ---- the original family (households/main) ----
  await t("original-family email reads and writes main", async () => { await assertSucceeds(getDoc(doc(dad, "households/main/feeds/b0-1"))); await assertSucceeds(setDoc(doc(dad, "households/main/feeds/b0-2"), { v: 1 })); });
  await t("original-family email claims membership of main", async () => { await assertSucceeds(setDoc(doc(dad, "households/main/members/dad"), { email: "parent1@example.com" })); await assertSucceeds(setDoc(doc(dad, "users/dad"), { hid: "main" })); });
  await t("signed-out users read nothing", () => assertFails(getDoc(doc(anon, "households/main/feeds/b0-1"))));
  await t("a stranger can't read main", () => assertFails(getDoc(doc(eve, "households/main/feeds/b0-1"))));
  await t("a stranger can't join main", () => assertFails(setDoc(doc(eve, "households/main/members/eve"), { email: "eve@example.net" })));
  await t("a stranger can't create the main family record", () => assertFails(setDoc(doc(eve, "households/main"), { owner: "eve", code: "AAAAAAAA", codeExp: Date.now() + 1e9 })));
  await t("a stranger can't point their account at main", () => assertFails(setDoc(doc(eve, "users/eve"), { hid: "main" })));
  await t("users docs are private", () => assertFails(getDoc(doc(eve, "users/dad"))));

  // ---- a new family ----
  const exp = Date.now() + 7 * 864e5;
  await t("anyone signed in can start their own family", async () => {
    await assertSucceeds(setDoc(doc(eve, "households/h1"), { owner: "eve", code: "CODEAAAA", codeExp: exp, created: 1 }));
    await assertSucceeds(setDoc(doc(eve, "households/h1/members/eve"), { email: "eve@example.net" }));
    await assertSucceeds(setDoc(doc(eve, "invites/CODEAAAA"), { hid: "h1", exp }));
    await assertSucceeds(setDoc(doc(eve, "users/eve"), { hid: "h1" }));
    await assertSucceeds(setDoc(doc(eve, "households/h1/config/profile"), { born: "2026-01-01" }));
  });
  await t("can't start a family owned by someone else", () => assertFails(setDoc(doc(sam, "households/h2"), { owner: "eve", code: "X", codeExp: exp })));
  await t("families can't see each other", async () => { await assertFails(getDoc(doc(dad, "households/h1/config/profile"))); await assertFails(getDoc(doc(eve, "households/main/feeds/b0-1"))); });
  await t("invites can't be listed", () => assertFails(getDocs(collection(sam, "invites"))));
  await t("an invite can't be forged for someone else's family", () => assertFails(setDoc(doc(sam, "invites/CODEBBBB"), { hid: "h1", exp })));
  await t("joining needs the right code", () => assertFails(setDoc(doc(sam, "households/h1/members/sam"), { email: "s", code: "WRONGCOD" })));
  await t("can't join on someone else's behalf", () => assertFails(setDoc(doc(sam, "households/h1/members/zed"), { email: "z", code: "CODEAAAA" })));
  await t("the partner joins with the code and sees the data", async () => {
    await assertSucceeds(getDoc(doc(sam, "invites/CODEAAAA")));
    await assertSucceeds(setDoc(doc(sam, "households/h1/members/sam"), { email: "sam@example.net", code: "CODEAAAA" }));
    await assertSucceeds(setDoc(doc(sam, "users/sam"), { hid: "h1" }));
    await assertSucceeds(getDoc(doc(sam, "households/h1/config/profile")));
    await assertSucceeds(setDoc(doc(sam, "households/h1/feeds/b1-5"), { v: 20 }));
  });
  await t("members can't be edited (only added or removed)", () => assertFails(updateDoc(doc(sam, "households/h1/members/sam"), { email: "x" })));
  await t("a member can renew the invite code", async () => { await assertSucceeds(updateDoc(doc(sam, "households/h1"), { code: "CODECCCC", codeExp: exp })); await assertSucceeds(setDoc(doc(sam, "invites/CODECCCC"), { hid: "h1", exp })); });
  await t("old code stops working after renewal", () => assertFails(setDoc(doc(dad, "households/h1/members/dad"), { email: "d", code: "CODEAAAA" })));
  await t("a non-owner can't take ownership", () => assertFails(updateDoc(doc(sam, "households/h1"), { owner: "sam" })));
  await t("a non-owner can't delete the family record", () => assertFails(deleteDoc(doc(sam, "households/h1"))));
  await t("ownership can only pass to a member", async () => { await assertFails(updateDoc(doc(eve, "households/h1"), { owner: "dad" })); await assertSucceeds(updateDoc(doc(eve, "households/h1"), { owner: "sam" })); await assertSucceeds(updateDoc(doc(sam, "households/h1"), { owner: "eve" })); });
  await t("the owner removes a member and their access ends", async () => {
    await assertSucceeds(deleteDoc(doc(eve, "households/h1/members/sam")));
    await assertFails(getDoc(doc(sam, "households/h1/config/profile")));
    await assertFails(setDoc(doc(sam, "users/sam"), { hid: "h1" }));
  });
  await t("an expired code can't be used", async () => {
    await assertSucceeds(updateDoc(doc(eve, "households/h1"), { code: "CODEDDDD", codeExp: Date.now() - 1000 }));
    await assertFails(setDoc(doc(sam, "households/h1/members/sam"), { email: "s", code: "CODEDDDD" }));
  });
  await t("users docs only hold the family id", () => assertFails(setDoc(doc(eve, "users/eve"), { hid: "h1", admin: true })));
  await t("leaving: you can remove yourself", async () => { await assertSucceeds(deleteDoc(doc(dad, "households/main/members/dad"))); });
  await t("the owner deletes all data and the family record", async () => { await assertSucceeds(deleteDoc(doc(eve, "households/h1/config/profile"))); await assertSucceeds(deleteDoc(doc(eve, "households/h1"))); });
  await t("paths outside households/users/invites are closed", () => assertFails(setDoc(doc(dad, "other/x"), { a: 1 })));

  // ---- private subtrees (Phase 1): owner-only, with a narrow cleanup exception for removed members ----
  const own = as("own", "own@example.net"), par = as("par", "par@example.net"), zed = as("zed", "zed@example.net");
  const legacyDad = dad;   // allowlisted email for households/main
  await env.withSecurityRulesDisabled(async c => { const d = c.firestore();
    await setDoc(doc(d, "households/h3"), { owner: "own", code: "CODEHHHH", codeExp: exp, created: 1 });
    await setDoc(doc(d, "households/h3/members/own"), { email: "own@example.net" });
    await setDoc(doc(d, "households/h3/members/par"), { email: "par@example.net", code: "CODEHHHH" });
    await setDoc(doc(d, "invites/CODEHHHH"), { hid: "h3", exp });
    await setDoc(doc(d, "users/par"), { hid: "h3" });
    await setDoc(doc(d, "households/h3/feeds/b0-9"), { v: 10 });
    await setDoc(doc(d, "households/main/private/mom/checkins/m1"), { mood: 3, by: "parent2@example.com" });
  });
  const P1 = "households/h3/private/own/checkins", P2 = "households/h3/private/par/checkins";
  await t("a parent creates, reads, updates and deletes their own private data", async () => {
    await assertSucceeds(setDoc(doc(own, P1 + "/c1"), { mood: 3 }));
    await assertSucceeds(getDoc(doc(own, P1 + "/c1")));
    await assertSucceeds(getDocs(collection(own, P1)));
    await assertSucceeds(updateDoc(doc(own, P1 + "/c1"), { mood: 4 }));
    await assertSucceeds(setDoc(doc(own, P1 + "/c2"), { mood: 2 }));
    await assertSucceeds(deleteDoc(doc(own, P1 + "/c2")));
    await assertSucceeds(setDoc(doc(par, P2 + "/p1"), { mood: 5 }));
  });
  await t("the other parent can't read, list or write a parent's private data", async () => {
    await assertFails(getDoc(doc(par, P1 + "/c1")));
    await assertFails(getDocs(collection(par, P1)));
    await assertFails(setDoc(doc(par, P1 + "/x"), { mood: 1 }));
    await assertFails(updateDoc(doc(par, P1 + "/c1"), { mood: 1 }));
    await assertFails(deleteDoc(doc(par, P1 + "/c1")));
  });
  await t("a stranger can't touch private data", async () => {
    await assertFails(getDoc(doc(zed, P1 + "/c1"))); await assertFails(getDocs(collection(zed, P1)));
    await assertFails(setDoc(doc(zed, P1 + "/x"), {})); await assertFails(deleteDoc(doc(zed, P1 + "/c1")));
  });
  await t("the legacy allowlist doesn't open another person's private data in main", async () => {
    await assertFails(getDoc(doc(legacyDad, "households/main/private/mom/checkins/m1")));
    await assertFails(getDocs(collection(legacyDad, "households/main/private/mom/checkins")));
    await assertFails(setDoc(doc(legacyDad, "households/main/private/mom/checkins/x"), {}));
    await assertFails(deleteDoc(doc(legacyDad, "households/main/private/mom/checkins/m1")));
  });
  await t("the shared-data catch-all still works for members", async () => {
    await assertSucceeds(getDoc(doc(par, "households/h3/feeds/b0-9"))); await assertSucceeds(setDoc(doc(par, "households/h3/events/e1"), { title: "x" }));
  });
  // The owner removes the partner the way Store.removeMember does: delete the membership, then rotate the invite code.
  await assertSucceeds(deleteDoc(doc(own, "households/h3/members/par")));
  await assertSucceeds(updateDoc(doc(own, "households/h3"), { code: "CODEJJJJ", codeExp: exp }));
  await assertSucceeds(setDoc(doc(own, "invites/CODEJJJJ"), { hid: "h3", exp }));
  await assertSucceeds(deleteDoc(doc(own, "invites/CODEHHHH")));
  await t("a removed parent loses family data", async () => {
    await assertFails(getDoc(doc(par, "households/h3/feeds/b0-9"))); await assertFails(getDocs(collection(par, "households/h3/feeds")));
    await assertFails(setDoc(doc(par, "households/h3/feeds/b0-10"), { v: 1 })); await assertFails(getDoc(doc(par, "households/h3")));
  });
  await t("a removed parent can't rejoin or re-point their account", async () => {
    await assertFails(setDoc(doc(par, "households/h3/members/par"), { email: "par@example.net", code: "CODEHHHH" }));
    await assertFails(setDoc(doc(par, "users/par"), { hid: "h3" }));
  });
  await t("a removed parent can still read and list their own private data (cleanup)", async () => {
    await assertSucceeds(getDoc(doc(par, P2 + "/p1"))); await assertSucceeds(getDocs(collection(par, P2)));
  });
  await t("a removed parent can't create or update private data", async () => {
    await assertFails(setDoc(doc(par, P2 + "/p2"), { mood: 1 })); await assertFails(updateDoc(doc(par, P2 + "/p1"), { mood: 1 }));
  });
  await t("a removed parent can't reach the other parent's private data", async () => {
    await assertFails(getDoc(doc(par, P1 + "/c1"))); await assertFails(getDocs(collection(par, P1))); await assertFails(deleteDoc(doc(par, P1 + "/c1")));
  });
  await t("the remaining parent and strangers can't read the removed parent's private data", async () => {
    await assertFails(getDoc(doc(own, P2 + "/p1"))); await assertFails(getDocs(collection(own, P2)));
    await assertFails(getDoc(doc(zed, P2 + "/p1"))); await assertFails(getDoc(doc(zed, P1 + "/c1")));
  });
  await t("a removed parent deletes their own private data", () => assertSucceeds(deleteDoc(doc(par, P2 + "/p1"))));

  // ---- legacy allowlist revocation (original family `main`) ----
  await env.withSecurityRulesDisabled(async c => { const d = c.firestore();
    await setDoc(doc(d, "households/main"), { owner: "dad", code: "CODEMMMM", codeExp: exp, created: 1 });
    await setDoc(doc(d, "households/main/members/dad"), { email: "parent1@example.com" });
    await setDoc(doc(d, "households/main/members/mom"), { email: "parent2@example.com" });
    await setDoc(doc(d, "households/main/members/zed"), { email: "zed@example.net" });
    await setDoc(doc(d, "users/mom"), { hid: "main" });
  });
  await t("only the owner can revoke, and only in the original family", async () => {
    await assertFails(setDoc(doc(mom, "households/main/revoked/parent1@example.com"), { uid: "dad" }));
    await assertFails(setDoc(doc(zed, "households/main/revoked/parent2@example.com"), { uid: "mom" }));
    await assertFails(setDoc(doc(own, "households/h3/revoked/par@example.net"), { uid: "par" }));
    await assertSucceeds(setDoc(doc(dad, "households/main/revoked/parent2@example.com"), { uid: "mom", by: "parent1@example.com" }));
  });
  await assertSucceeds(deleteDoc(doc(dad, "households/main/members/mom")));
  await t("a revoked allowlisted email loses all family data", async () => {
    await assertFails(getDoc(doc(mom, "households/main/feeds/b0-1"))); await assertFails(getDocs(collection(mom, "households/main/feeds")));
    await assertFails(setDoc(doc(mom, "households/main/feeds/b0-77"), { v: 1 })); await assertFails(getDoc(doc(mom, "households/main")));
  });
  await t("a revoked allowlisted email can't reclaim membership or re-point their account", async () => {
    await assertFails(setDoc(doc(mom, "households/main/members/mom"), { email: "parent2@example.com" }));
    await assertFails(setDoc(doc(mom, "users/mom"), { hid: "main" }));
    await assertFails(setDoc(doc(mom, "households/main/config/profile"), { born: "x" }));
  });
  await t("nobody but the owner can lift a revocation", async () => {
    await assertFails(deleteDoc(doc(mom, "households/main/revoked/parent2@example.com")));
    await assertFails(deleteDoc(doc(zed, "households/main/revoked/parent2@example.com")));
    await assertFails(updateDoc(doc(dad, "households/main/revoked/parent2@example.com"), { uid: "x" }));
  });
  await t("a revoked parent can still clean up only their own private data", async () => {
    await assertSucceeds(getDocs(collection(mom, "households/main/private/mom/checkins")));
    await assertFails(setDoc(doc(mom, "households/main/private/mom/checkins/new"), { mood: 1 }));
    await assertSucceeds(deleteDoc(doc(mom, "households/main/private/mom/checkins/m1")));
    await assertFails(getDocs(collection(mom, "households/main/private/dad/checkins")));
  });
  await t("the remaining allowlisted parent keeps normal access", async () => {
    await assertSucceeds(getDoc(doc(dad, "households/main/feeds/b0-1"))); await assertSucceeds(setDoc(doc(dad, "households/main/feeds/b0-78"), { v: 2 }));
    await assertSucceeds(getDoc(doc(dad, "households/main/revoked/parent2@example.com")));
  });
  await t("the owner can deliberately re-invite a revoked parent with the current code", async () => {
    await assertSucceeds(setDoc(doc(mom, "households/main/members/mom"), { email: "parent2@example.com", code: "CODEMMMM" }));
    await assertSucceeds(getDoc(doc(mom, "households/main/feeds/b0-1")));
  });

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
