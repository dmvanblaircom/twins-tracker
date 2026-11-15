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

  await env.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
