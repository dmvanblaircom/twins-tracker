// Firebase backend for the tracker. Exposes window.Store, then fires "store-ready".
// Data lives under households/{hid}/…; a signed-in person belongs to one family (users/{uid} → {hid}).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAuth, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail, indexedDBLocalPersistence,
  deleteUser, reauthenticateWithCredential, EmailAuthProvider, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, updateDoc, getDocFromServer, getDocsFromServer, connectFirestoreEmulator,
  Bytes, writeBatch, query, where, deleteField, getAggregateFromServer, count, sum
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

if (!window.Store) {
  const app = initializeApp(firebaseConfig);
  // initializeAuth (not getAuth): email/password only, no popup/redirect iframe, which also lets it run inside the iOS app's web view.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  // Offline cache: the app opens and accepts entries with no signal; writes sync later.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  // Tests only (tests/rules/store.test.js): point at the local emulators. The app never sets this.
  const EMU = window.__FIREBASE_EMULATORS__;
  if (EMU) { connectAuthEmulator(auth, `http://${EMU.host}:${EMU.auth}`, { disableWarnings: true }); connectFirestoreEmulator(db, EMU.host, EMU.firestore); }
  // Tests only: make one named lifecycle step fail (EMU.fail = ["household"], …) to prove cleanup fails closed.
  const fault = name => { const f = EMU && EMU.fail; if (Array.isArray(f) && f.includes(name)) throw Object.assign(new Error("Injected failure: " + name), { code: "injected" }); };
  let HID = null, H = null;                      // current family: households/{HID}
  const setHid = hid => { HID = hid; H = `households/${hid}`; try { localStorage.setItem("hid:" + auth.currentUser.uid, hid); } catch {} };
  const denied = e => String(e && e.code || "").includes("permission");
  const me = () => auth.currentUser;
  const email = () => (me()?.email || "").toLowerCase();
  // The one place collection names live. Later phases add a name here once (e.g. photos, photoData, private photos);
  // deletion, cleanup and backup (index.html reads Store.lists) all follow.
  const SHARED = ["weights", "feeds", "pumps", "drops", "checklist", "plans", "questions", "events", "needs",
    "slotMilk", "milkUsual", "schedPeriods"];         // milk sources (Phase 2b): allocations, usual-milk and schedule history
  const MEDIA = ["photos", "photoData"];         // Phase 5: photo metadata + thumbnail, and the full image (read only when opened)
  const META = ["clients"];                      // per-phone app version markers: deleted with the family, never backed up
  const PRIVATE = ["checkins"];                  // households/{hid}/private/{uid}/{name}: owner-only (see firestore.rules)
  const CONFIG = ["profile", "diet", "people", "milk", "sources"];   // sources: milk-source tracking switched on (never backed up)
  const notReady = () => Object.assign(new Error("Not signed in to a family yet."), { code: "no-family" });
  // Private collection of the signed-in person. The uid always comes from Firebase Auth, never from the caller.
  const priv = name => { const u = me(); if (!u || !HID) throw notReady(); return collection(db, "households", HID, "private", u.uid, name); };
  // Delete every private document this person has in family `hid` (explicit collection list; no recursive delete).
  // Reads from the server so a stale offline cache can't make cleanup look finished; throws if anything is left.
  async function purgePrivate(hid, uid) {
    for (const name of PRIVATE) {
      const ref = collection(db, "households", hid, "private", uid, name);
      const snap = await getDocsFromServer(ref);
      for (const d of snap.docs) await deleteDoc(d.ref);
      if (!(await getDocsFromServer(ref)).empty) throw Object.assign(new Error("Private data cleanup didn't finish."), { code: "cleanup-pending" });
    }
  }
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

  // Stable comparison of two stored documents (nested maps, any key order).
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
    ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v;
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  // Guarded write (milk-source allocations): the rules accept a change only when rec.rev = stored rev + 1. If the server
  // refuses it, read the server copy: identical to what we wrote → it was already saved (a resend after a lost
  // acknowledgement), so it counts as saved; otherwise it's a real conflict, reported as code "conflict" with the
  // current server copy (store-error), never retried or overwritten.
  function guarded(ref, name, id, rec) {
    const p = setDoc(ref, rec).then(() => ({ saved: true }), async err => {
      if (!denied(err)) throw err;
      const s = await getDocFromServer(ref).catch(() => null);
      if (s && s.exists() && same(s.data(), rec)) return { saved: true, already: true };
      throw Object.assign(new Error("Someone else changed this first."), { code: "conflict", name, id, current: s && s.exists() ? s.data() : null, mine: rec, cause: err });
    });
    p.catch(err => window.dispatchEvent(new CustomEvent("store-error", { detail: err })));
    return Promise.race([p, new Promise(r => setTimeout(() => r({ pending: true }), 1500))]);
  }

  // Which family is this person in? null = none yet (show create / join).
  async function family() {
    const u = me(); if (!u) return null;
    let snap;
    try { snap = await getDoc(doc(db, "users", u.uid)); }
    catch (e) {
      // A refusal here is a real permission problem: say so, never quietly open another family (ledger P2-10).
      if (denied(e)) throw Object.assign(new Error("This account can't open the tracker."), { code: "denied", cause: e });
      const cached = (() => { try { return localStorage.getItem("hid:" + u.uid); } catch { return null; } })();
      setHid(cached || "main"); return { hid: HID };                    // offline: reopen the last family (the original one if never resolved)
    }
    if (snap.exists() && snap.data().hid) {
      const hid = snap.data().hid;
      // Membership is checked against the server only. If that can't be confirmed (offline, timeout, any error),
      // nothing is deleted and the family reopens from cache as before.
      let m;
      try { m = await getDocFromServer(doc(db, "households", hid, "members", u.uid)); }
      catch { setHid(hid); return { hid }; }
      if (m.exists()) { setHid(hid); return { hid }; }
      // Confirmed: the owner removed this person. Delete their own private data first (allowed by the narrow
      // cleanup rule), and only then drop the family pointer. If cleanup fails, keep the pointer so the next
      // open retries, and report it rather than pretending it finished.
      try { await purgePrivate(hid, u.uid); }
      catch (e) { throw Object.assign(new Error("Finishing your removal from the family needs a connection. Reopen the app with signal."), { code: "cleanup-pending", cause: e }); }
      await deleteDoc(doc(db, "users", u.uid));
      try { localStorage.removeItem("hid:" + u.uid); } catch {}
      HID = H = null; return null;
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
  // Strict view of the family for lifecycle decisions: server reads, errors propagate. (familyInfo() stays lenient
  // for the Settings card.) Deciding "I'm the last member" from a failed read would delete everyone's data.
  // The invite rules read the document being deleted, so deleting one that's already gone is refused. Check first, so
  // a retried removal or account deletion doesn't get stuck on an invite an earlier attempt already removed.
  async function deleteInvite(code) { const ref = doc(db, "invites", code); if ((await getDocFromServer(ref)).exists()) await deleteDoc(ref); }
  async function familyStrict() {
    const h = await getDocFromServer(doc(db, "households", HID));
    const ms = await getDocsFromServer(collection(db, "households", HID, "members"));
    const d = h.exists() ? h.data() : {};
    return { exists: h.exists(), owner: d.owner || null, code: d.code || null, members: ms.docs.map(m => ({ uid: m.id, email: m.data().email || "" })) };
  }
  // Replace the invite code. The household's code is what the rules check when someone joins, so changing it is what
  // invalidates the old code; the old invites/{code} lookup doc is then deleted. With strict = true (removal) every
  // step must succeed and the new code is read back from the server before returning.
  async function rotateInvite(strict) {
    const ref = doc(db, "households", HID), h = await getDocFromServer(ref), code = newCode(), exp = Date.now() + WEEK;
    const old = h.exists() ? h.data().code : null;
    fault("rotate");
    if (h.exists()) await updateDoc(ref, { code, codeExp: exp });
    else await setDoc(ref, { owner: me().uid, code, codeExp: exp, created: Date.now() });   // original family: first invite creates the family record
    await setDoc(doc(db, "invites", code), { hid: HID, exp });
    fault("verify");
    const now = await getDocFromServer(ref);
    if (!now.exists() || now.data().code !== code) throw Object.assign(new Error("The invite code didn't change."), { code: "rotate-failed" });
    if (old && old !== code) {
      if (strict) { fault("invalidate"); await deleteInvite(old); }
      else await deleteInvite(old).catch(() => {});
    }
    return { code, codeExp: exp };
  }
  const newInvite = () => rotateInvite(false);
  // Owner only (rules). Order matters (fails closed — any error stops before access is revoked, and is reported):
  //   1. publish a new invite code and read it back,  2. delete the old invite,
  //   3. original family only: record a revocation for their email, so the legacy allowlist can't let them back in,
  //   4. delete their membership.
  // The removed person's private data is deleted by their own app on its next open (family()).
  async function removeMember(uid) {
    const info = await familyStrict(), target = info.members.find(m => m.uid === uid);
    if (!target) throw Object.assign(new Error("They're not in this family."), { code: "not-member" });
    await rotateInvite(true);
    if (HID === "main") {
      fault("revoke");
      if (!target.email) throw Object.assign(new Error("Can't revoke an account without an email."), { code: "revoke-failed" });
      await setDoc(doc(db, "households", HID, "revoked", target.email.toLowerCase()), { uid, by: email(), t: Date.now() });
    }
    fault("remove");
    await deleteDoc(doc(db, "households", HID, "members", uid));
  }
  // Leave: private data first (while still a member), then ownership, then the pointer and membership.
  // Needs a connection; if cleanup fails nothing else changes and the error is passed on.
  // Order: private data → ownership → membership → family pointer. The pointer goes last so that a failure part-way
  // leaves it in place: the next open either finds the membership (try again) or a confirmed removal (family() finishes
  // the cleanup). Any error stops and is passed on.
  async function leave() {
    const u = me(), info = await familyStrict(), others = info.members.filter(m => m.uid !== u.uid);
    fault("purge"); await purgePrivate(HID, u.uid);
    if (info.owner === u.uid && others.length) { fault("transfer"); await updateDoc(doc(db, "households", HID), { owner: others[0].uid }); }
    for (const c of META) await deleteDoc(doc(db, H, c, u.uid));
    fault("member"); await deleteDoc(doc(db, "households", HID, "members", u.uid));
    fault("pointer"); await deleteDoc(doc(db, "users", u.uid));
    try { localStorage.removeItem("hid:" + u.uid); } catch {}
    return others.length;
  }
  // Leaves the family; the last person out deletes all of the family's data. Then deletes the sign-in itself.
  async function deleteAccount(password) {
    const u = me();
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
    // Fails closed: every step is awaited with no swallowed errors, and the sign-in itself is deleted only after all of
    // the Firestore cleanup has succeeded. Each step is safe to repeat, so "Delete my account" can simply be retried.
    if (HID) {
      const info = await familyStrict(), others = info.members.filter(m => m.uid !== u.uid);
      if (!others.length) {
        fault("purge"); await purgePrivate(HID, u.uid);
        fault("shared"); for (const c of [...SHARED, ...MEDIA, ...META]) { const s = await getDocsFromServer(collection(db, H, c)); for (const d of s.docs) await deleteDoc(d.ref); }
        fault("config"); for (const k of CONFIG) await deleteDoc(doc(db, H, "config", k));
        if (info.code) { fault("invite"); await deleteInvite(info.code); }
        if (info.exists) {   // the original family may never have had a family record
          fault("household");
          const rv = await getDocsFromServer(collection(db, "households", HID, "revoked")); for (const d of rv.docs) await deleteDoc(d.ref);
          await deleteDoc(doc(db, "households", HID));
        }
        fault("member"); await deleteDoc(doc(db, "households", HID, "members", u.uid));
        fault("pointer"); await deleteDoc(doc(db, "users", u.uid));
      } else await leave();
    }
    fault("auth");
    await deleteUser(u);
    try { localStorage.removeItem("hid:" + u.uid); } catch {}
    HID = H = null;
  }

  window.Store = {
    onAuth: cb => onAuthStateChanged(auth, u => { if (!u) HID = H = null; cb(u); }),
    signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
    signUp: (e, p) => createUserWithEmailAndPassword(auth, e, p),
    signOut: () => signOut(auth),
    reset: e => sendPasswordResetEmail(auth, e),
    family, createFamily, joinFamily, familyInfo, newInvite, removeMember, leave, deleteAccount,
    lists: Object.freeze({ shared: SHARED.slice(), private: PRIVATE.slice(), config: CONFIG.slice(), meta: META.slice(), media: MEDIA.slice() }),
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
    setConfig: (name, v) => w(setDoc(doc(db, H, "config", name), v)),
    // patch(name, id, fields): merge only these fields into an existing family document. Uses updateDoc, so it
    // fails (store-error) instead of recreating a document the other parent deleted; `by` is never changed.
    patch: (name, id, fields) => { const { by, ...f } = fields || {}; return w(updateDoc(doc(db, H, name, id), f)); },
    // create(name, id, rec): history entries (milk sources). The rules make these create-only, so writing an id that
    // already exists is refused (store-error) rather than changing history.
    create: (name, id, rec) => w(setDoc(doc(db, H, name, id), { by: email(), ...rec })),
    // guardedPut(name, id, rec): a full write whose rec.rev must be the stored rev + 1 (see guarded()). Resolves
    // {saved} / {saved, already} / {pending} (offline, after 1.5 s); a conflict arrives later as store-error code "conflict".
    guardedPut: (name, id, rec) => guarded(doc(db, H, name, id), name, id, { by: email(), ...rec, editBy: email() }),
    // activateSources(v): switch milk-source tracking on for the family. Reads the complete current member list FROM THE
    // SERVER and names every member account (uid) in the record; the rules accept it only if each named account is a
    // current member whose own version marker is at v or later (and the signer is one of them). Needs a connection.
    // Create-only: if tracking is already on, the existing record is returned unchanged.
    // Errors: code "offline" (no server read), "too-many" (> 4 members, beyond what the rules check), "not-ready"
    // (the rules refused: an account's marker is missing or out of date).
    activateSources: async v => {
      const ref = doc(db, H, "config", "sources");
      let info, cur;
      try { info = await familyStrict(); cur = await getDocFromServer(ref); }
      catch (e) { throw Object.assign(new Error("Turning on milk sources needs a connection."), { code: "offline", cause: e }); }
      if (cur.exists()) return cur.data();
      const phones = info.members.map(m => m.uid);
      if (phones.length > 4) throw Object.assign(new Error("Milk sources support up to 4 family members."), { code: "too-many" });
      const rec = { on: true, t: Date.now(), by: email(), phones };
      try { await setDoc(ref, rec); }
      catch (e) { throw Object.assign(new Error("Update the app for everyone in the family first."), { code: denied(e) ? "not-ready" : (e.code || "failed"), cause: e }); }
      return rec;
    },
    // This phone's app version, so milk-source tracking can wait until every member's phone is updated.
    markClient: async v => { const u = me(); if (!u || !HID) return; const ref = doc(db, H, "clients", u.uid);
      const cur = await getDoc(ref).catch(() => null);
      if (!cur || !cur.exists() || !(cur.data().v >= v)) return w(setDoc(ref, { v, t: Date.now() })); },
    uid: () => (me() ? me().uid : null),
    // Private collections of the signed-in person only: households/{hid}/private/{auth uid}/{name}.
    watchPrivate: (name, cb, err) => {
      if (!me() || !HID) { setTimeout(() => cb([], { fromCache: true, pending: false })); return () => {}; }
      return onSnapshot(priv(name), { includeMetadataChanges: true },
        snap => cb(snap.docs.map(d => [d.id, d.data()]), { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites }), err);
    },
    putPrivate: (name, id, rec) => w(setDoc(doc(priv(name), id), { by: email(), ...rec })),
    removePrivate: (name, id) => w(deleteDoc(doc(priv(name), id))),
    // Photos (Phase 5, D3/D4). Bytes cross this boundary as Uint8Array. The full image and its metadata are written in one
    // batch (one offline-queued commit, so neither lands without the other).
    putPhoto: (id, meta, full) => { const b = writeBatch(db);
      b.set(doc(db, H, "photoData", id), { full: Bytes.fromUint8Array(full) });
      b.set(doc(db, H, "photos", id), { ...meta, thumb: Bytes.fromUint8Array(meta.thumb), by: email() });
      return w(b.commit()); },
    // Metadata + thumbnails for the given moments only (never the whole collection), live, at most 30 ids per listener.
    watchPhotos: (evIds, cb, err) => {
      const ids = [...new Set(evIds)].filter(Boolean); if (!ids.length || !HID) { setTimeout(() => cb([])); return () => {}; }
      const parts = {}, subs = [];
      const emit = () => cb(Object.values(parts).flat());
      for (let k = 0; k < ids.length; k += 30) { const key = k;
        subs.push(onSnapshot(query(collection(db, H, "photos"), where("ev", "in", ids.slice(k, k + 30))),
          snap => { parts[key] = snap.docs.map(d => { const x = d.data(); return [d.id, { ...x, thumb: x.thumb && x.thumb.toUint8Array ? x.thumb.toUint8Array() : null }]; }); emit(); }, err)); }
      return () => subs.forEach(u => u()); },
    // The full image, read only when a photo is opened. null when it isn't here (removed, or offline and never loaded).
    photoFull: async id => { try { const s = await getDoc(doc(db, H, "photoData", id)); return s.exists() ? s.data().full.toUint8Array() : null; } catch { return null; } },
    // Soft delete (Undo clears it), then purge: the full image first, the metadata last.
    markPhoto: (id, deletedT) => w(updateDoc(doc(db, H, "photos", id), { deletedT: deletedT || deleteField() })),
    purgePhoto: async id => { await w(deleteDoc(doc(db, H, "photoData", id))); await w(deleteDoc(doc(db, H, "photos", id))); },
    // How many photos and how many bytes the family stores (server aggregate; needs a connection).
    photoUsage: async () => { const a = await getAggregateFromServer(collection(db, H, "photos"), { n: count(), bytes: sum("bytes") }); const d = a.data(); return { n: d.n || 0, bytes: d.bytes || 0 }; }
  };
  window.dispatchEvent(new Event("store-ready"));
}
