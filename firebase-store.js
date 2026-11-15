// Firebase backend for the tracker. Exposes window.Store, then fires "store-ready".
// Data lives under households/{hid}/…; a signed-in person belongs to one family (users/{uid} → {hid}).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, setPersistence, indexedDBLocalPersistence,
  deleteUser, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

if (!window.Store) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  setPersistence(auth, indexedDBLocalPersistence).catch(() => {});
  // Offline cache: the app opens and accepts entries with no signal; writes sync later.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  let HID = null, H = null;                      // current family: households/{HID}
  const setHid = hid => { HID = hid; H = `households/${hid}`; try { localStorage.setItem("hid:" + auth.currentUser.uid, hid); } catch {} };
  const denied = e => String(e && e.code || "").includes("permission");
  const me = () => auth.currentUser;
  const email = () => (me()?.email || "").toLowerCase();
  const DATA = ["weights", "feeds", "pumps", "drops", "checklist", "plans", "questions"], CONFIG = ["profile", "diet", "people", "milk"];
  const WEEK = 7 * 864e5, ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const newCode = () => { const a = crypto.getRandomValues(new Uint32Array(8)); return [...a].map(n => ALPHA[n % ALPHA.length]).join(""); };

  const watchCol = (name, cb, err) =>
    onSnapshot(collection(db, H, name), { includeMetadataChanges: true },
      snap => cb(snap.docs.map(d => [d.id, d.data()]), { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites }),
      err);

  // Offline, a write is saved locally at once but the server ack waits for signal.
  // Resolve after the ack or 1.5 s, whichever first, so the UI never hangs; rejections still surface.
  // A late rejection (e.g. permission denied after the timeout) is reported via a "store-error" event.
  const w = p => { p.catch(err => window.dispatchEvent(new CustomEvent("store-error", { detail: err })));
    return Promise.race([p, new Promise(r => setTimeout(r, 1500))]); };

  // Which family is this person in? null = none yet (show create / join).
  async function family() {
    const u = me(); if (!u) return null;
    let snap;
    try { snap = await getDoc(doc(db, "users", u.uid)); }
    catch (e) {
      if (denied(e)) { setHid("main"); return { hid: "main" }; }          // rules not updated yet: original single-family setup
      const cached = (() => { try { return localStorage.getItem("hid:" + u.uid); } catch { return null; } })();
      setHid(cached || "main"); return { hid: HID };                    // offline: reopen the last family (the original one if never resolved)
    }
    if (snap.exists() && snap.data().hid) {
      const hid = snap.data().hid;
      try { const m = await getDoc(doc(db, "households", hid, "members", u.uid)); if (!m.exists()) { await deleteDoc(doc(db, "users", u.uid)).catch(() => {}); return null; } }
      catch (e) { if (denied(e)) { await deleteDoc(doc(db, "users", u.uid)).catch(() => {}); return null; } }   // removed from that family
      setHid(hid); return { hid };
    }
    // The original family (households/main) is claimed by the emails in the rules' allowlist.
    try {
      await setDoc(doc(db, "households", "main", "members", u.uid), { email: email(), t: Date.now() });
      await setDoc(doc(db, "users", u.uid), { hid: "main" });
      setHid("main"); return { hid: "main" };
    } catch { return null; }
  }
  async function createFamily() {
    const u = me(), ref = doc(collection(db, "households")), code = newCode(), exp = Date.now() + WEEK;
    await setDoc(ref, { owner: u.uid, code, codeExp: exp, created: Date.now() });
    await setDoc(doc(db, "households", ref.id, "members", u.uid), { email: email(), t: Date.now() });
    await setDoc(doc(db, "invites", code), { hid: ref.id, exp });
    await setDoc(doc(db, "users", u.uid), { hid: ref.id });
    setHid(ref.id); return { hid: ref.id };
  }
  async function joinFamily(code) {
    const u = me(), c = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const inv = c.length === 8 ? await getDoc(doc(db, "invites", c)).catch(() => null) : null;
    if (!inv || !inv.exists()) throw Object.assign(new Error("That code didn't match a family."), { code: "bad-code" });
    const { hid } = inv.data();
    try { await setDoc(doc(db, "households", hid, "members", u.uid), { email: email(), t: Date.now(), code: c }); }
    catch (e) { throw Object.assign(new Error("That code has expired. Ask for a new one."), { code: "bad-code" }); }
    await setDoc(doc(db, "users", u.uid), { hid });
    setHid(hid); return { hid };
  }
  async function familyInfo() {
    const h = await getDoc(doc(db, "households", HID)).catch(() => null);
    const ms = await getDocs(collection(db, "households", HID, "members")).catch(() => null);
    const d = h && h.exists() ? h.data() : {};
    return { hid: HID, owner: d.owner || null, code: d.code || null, codeExp: d.codeExp || 0, me: me().uid,
      members: ms ? ms.docs.map(m => ({ uid: m.id, email: m.data().email || "" })) : [] };
  }
  async function newInvite() {
    const ref = doc(db, "households", HID), h = await getDoc(ref), code = newCode(), exp = Date.now() + WEEK;
    if (h.exists()) { const old = h.data().code; await updateDoc(ref, { code, codeExp: exp }); if (old) await deleteDoc(doc(db, "invites", old)).catch(() => {}); }
    else await setDoc(ref, { owner: me().uid, code, codeExp: exp, created: Date.now() });   // original family: first invite creates the family record
    await setDoc(doc(db, "invites", code), { hid: HID, exp });
    return { code, codeExp: exp };
  }
  const removeMember = uid => deleteDoc(doc(db, "households", HID, "members", uid));
  async function leave() {
    const u = me(), info = await familyInfo(), others = info.members.filter(m => m.uid !== u.uid);
    if (info.owner === u.uid && others.length) await updateDoc(doc(db, "households", HID), { owner: others[0].uid });
    await deleteDoc(doc(db, "users", u.uid));
    await deleteDoc(doc(db, "households", HID, "members", u.uid));
    return others.length;
  }
  // Leaves the family; the last person out deletes all of the family's data. Then deletes the sign-in itself.
  async function deleteAccount(password) {
    const u = me();
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
    if (HID) {
      const info = await familyInfo(), others = info.members.filter(m => m.uid !== u.uid);
      if (!others.length) {
        for (const c of DATA) { const s = await getDocs(collection(db, H, c)); for (const d of s.docs) await deleteDoc(d.ref); }
        for (const k of CONFIG) await deleteDoc(doc(db, H, "config", k)).catch(() => {});
        if (info.code) await deleteDoc(doc(db, "invites", info.code)).catch(() => {});
        await deleteDoc(doc(db, "users", u.uid)).catch(() => {});
        await deleteDoc(doc(db, "households", HID, "members", u.uid)).catch(() => {});
        await deleteDoc(doc(db, "households", HID)).catch(() => {});
      } else await leave();
    }
    try { localStorage.removeItem("hid:" + u.uid); } catch {}
    HID = H = null;
    await deleteUser(u);
  }

  window.Store = {
    onAuth: cb => onAuthStateChanged(auth, u => { if (!u) HID = H = null; cb(u); }),
    signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
    signUp: (e, p) => createUserWithEmailAndPassword(auth, e, p),
    signOut: () => signOut(auth),
    reset: e => sendPasswordResetEmail(auth, e),
    family, createFamily, joinFamily, familyInfo, newInvite, removeMember, leave, deleteAccount,
    watchWeights: (cb, err) => watchCol("weights", cb, err),
    watchFeeds: (cb, err) => watchCol("feeds", cb, err),
    watchDiet: (cb, err) => onSnapshot(doc(db, H, "config", "diet"), d => cb(d.exists() ? d.data().text : null), err),
    setWeight: (id, rec) => w(setDoc(doc(db, H, "weights", id), { by: email(), ...rec })),
    delWeight: id => w(deleteDoc(doc(db, H, "weights", id))),
    setFeed: (id, rec) => w(setDoc(doc(db, H, "feeds", id), { by: email(), ...rec })),
    delFeed: id => w(deleteDoc(doc(db, H, "feeds", id))),
    setDiet: text => w(setDoc(doc(db, H, "config", "diet"), { text })),
    watchProfile: (cb, err) => onSnapshot(doc(db, H, "config", "profile"), d => cb(d.exists() ? d.data() : null), err),
    setProfile: p => w(setDoc(doc(db, H, "config", "profile"), p)),
    // Generic helpers (milk log: "pumps", "drops"; config docs such as "milk")
    watch: (name, cb, err) => watchCol(name, cb, err),
    put: (name, id, rec) => w(setDoc(doc(db, H, name, id), { by: email(), ...rec })),
    remove: (name, id) => w(deleteDoc(doc(db, H, name, id))),
    watchConfig: (name, cb, err) => onSnapshot(doc(db, H, "config", name), d => cb(d.exists() ? d.data() : null), err),
    setConfig: (name, v) => w(setDoc(doc(db, H, "config", name), v))
  };
  window.dispatchEvent(new Event("store-ready"));
}
