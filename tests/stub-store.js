// In-memory stand-in for firebase-store.js, served in its place by smoke.js.
// Same window.Store contract as the real backend. Holds only synthetic test data.
(() => {
  const me = "parent1@example.com";
  const db = { config: {} }, subs = {}, cfgSubs = {};
  const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const col = n => (db[n] = db[n] || {});
  const fire = n => (subs[n] || []).forEach(cb => cb(Object.entries(col(n)).map(([id, d]) => [id, copy(d)]), { fromCache: false, pending: false }));
  const fireCfg = n => (cfgSubs[n] || []).forEach(cb => cb(copy(db.config[n]) || null));
  const watch = (n, cb) => { (subs[n] = subs[n] || []).push(cb); setTimeout(() => fire(n)); return () => { subs[n] = subs[n].filter(x => x !== cb); }; };
  // Generic writes into the milk-source collections follow the rules too (create-only history; allocations: valid shape,
  // and an existing allocation is only replaced through the rev check — a restore of an id already here is refused).
  const put = async (n, id, rec) => { const d = { by: me, ...copy(rec) };
    if (VAL[n]) { window.__TEST_WRITES.push([n, id, copy(d)]);
      if (!window.MilkSources[VAL[n]](id, d)) return void deny("invalid " + n);
      if (col(n)[id]) return void deny("exists " + n); }
    col(n)[id] = d; fire(n); };
  const remove = async (n, id) => { delete col(n)[id]; fire(n); };
  const watchConfig = (n, cb) => { (cfgSubs[n] = cfgSubs[n] || []).push(cb); setTimeout(() => cb(copy(db.config[n]) || null)); return () => { cfgSubs[n] = cfgSubs[n].filter(x => x !== cb); }; };
  // config/sources (activation) has its own rule: never written through setConfig (mirrors firestore.rules).
  const setConfig = async (n, v) => { if (n === "sources") { const e = Object.assign(new Error("denied"), { code: "permission-denied" }); window.dispatchEvent(new CustomEvent("store-error", { detail: e })); throw e; }
    db.config[n] = copy(v); fireCfg(n); };
  if (window.__TEST_PROFILE) db.config.profile = copy(window.__TEST_PROFILE);
  // Same collection lists as firebase-store.js (Store.lists).
  const SHARED = ["weights", "feeds", "pumps", "drops", "checklist", "plans", "questions", "events", "needs", "slotMilk", "milkUsual", "schedPeriods"],
    PRIVATE = ["checkins"], CONFIG = ["profile", "diet", "people", "milk", "sources"], META = ["clients"], MEDIA = ["photos", "photoData"];
  // Milk sources: the stub refuses what firestore.rules refuses (same validators as the app), so the browser tests
  // can't pass with data the real backend would reject. __TEST_WRITES logs every write attempt for the tests.
  const deny = (msg, extra) => { const e = Object.assign(new Error(msg), { code: "permission-denied", ...extra }); window.dispatchEvent(new CustomEvent("store-error", { detail: e })); return e; };
  const VAL = { slotMilk: "validAlloc", milkUsual: "validUsual", schedPeriods: "validPeriod" };
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v;
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  window.__TEST_WRITES = [];
  let phSubs = [];
  const phOut = p => ({ ...p, thumb: new Uint8Array(p.thumb) });
  const firePh = only => (only ? [only] : phSubs).forEach(s => s.cb(Object.entries(db.photos || {}).filter(([, p]) => s.ids.has(p.ev)).map(([id, p]) => [id, phOut(p)])));
  // Private data is per user: db.private[uid][name][id]. The signed-in user is always "u1"; tests seed "u2" directly
  // (window.__db.private.u2...) to prove one parent never sees the other's.
  db.private = { u1: {}, u2: {} };
  const ME = "u1", pcol = (uid, n) => ((db.private[uid] = db.private[uid] || {})[n] = db.private[uid][n] || {});
  const psubs = {};
  const pfire = n => (psubs[n] || []).forEach(cb => cb(Object.entries(pcol(ME, n)).map(([id, d]) => [id, copy(d)]), { fromCache: false, pending: false }));
  const purgeMine = () => { PRIVATE.forEach(n => { db.private[ME][n] = {}; pfire(n); }); };
  window.__db = db;
  // Families: by default the test user is already in one; __TEST_NOFAMILY starts with none (create / join).
  const fam = { hid: window.__TEST_NOFAMILY ? null : "main", owner: "u1", code: "TESTCODE", codeExp: Date.now() + 7 * 864e5,
    members: [{ uid: "u1", email: me }, { uid: "u2", email: "parent2@example.com" }] };
  window.__fam = fam;
  let authCb = null;
  window.Store = {
    onAuth: cb => { authCb = cb; setTimeout(() => cb({ email: me, uid: "u1" })); return () => {}; },
    signIn: async () => {}, signUp: async () => {}, reset: async () => {},
    signOut: async () => { authCb && authCb(null); },
    // __TEST_REMOVED: the owner removed this user while they were away; the next open cleans their private data.
    family: async () => { if (window.__TEST_REMOVED && fam.hid) { if (window.__TEST_CLEANUP_FAILS) throw Object.assign(new Error("Finishing your removal from the family needs a connection. Reopen the app with signal."), { code: "cleanup-pending" });
        purgeMine(); fam.hid = null; window.__TEST_REMOVED = false; return null; }
      return fam.hid ? { hid: fam.hid } : null; },
    createFamily: async () => { fam.hid = "h-new"; fam.members = [{ uid: "u1", email: me }]; return { hid: fam.hid }; },
    joinFamily: async code => { if (String(code).toUpperCase().replace(/[^A-Z0-9]/g, "") !== "TESTCODE") throw Object.assign(new Error("That code didn't match a family."), { code: "bad-code" }); fam.hid = "main"; return { hid: "main" }; },
    familyInfo: async () => ({ hid: fam.hid, owner: fam.owner, code: fam.code, codeExp: fam.codeExp, me: "u1", members: fam.members.slice() }),
    newInvite: async () => { fam.code = "NEWCODE2"; fam.codeExp = Date.now() + 7 * 864e5; return { code: fam.code, codeExp: fam.codeExp }; },
    removeMember: async uid => { fam.members = fam.members.filter(m => m.uid !== uid); },
    leave: async () => { purgeMine(); fam.members = fam.members.filter(m => m.uid !== "u1"); fam.hid = null; return fam.members.length; },
    deleteAccount: async pw => { if (pw !== "pw") throw Object.assign(new Error("wrong"), { code: "auth/wrong-password" });
      if (window.__TEST_DELETE_FAILS) throw Object.assign(new Error("Injected failure"), { code: "injected" });
      purgeMine();
      if (fam.members.length <= 1) Object.keys(db).forEach(k => k === "config" ? (db.config = {}) : k === "private" ? 0 : delete db[k]);
      fam.hid = null; window.__deleted = true; authCb && authCb(null); },
    watchWeights: cb => watch("weights", cb), watchFeeds: cb => watch("feeds", cb),
    watchDiet: cb => watchConfig("diet", d => cb(d ? d.text : null)),
    setWeight: (id, r) => put("weights", id, r), delWeight: id => remove("weights", id),
    setFeed: (id, r) => put("feeds", id, r), delFeed: id => remove("feeds", id),
    setDiet: text => setConfig("diet", { text }),
    watchProfile: cb => watchConfig("profile", cb), setProfile: p => setConfig("profile", p),
    watch, put, remove, watchConfig, setConfig,
    lists: Object.freeze({ shared: SHARED.slice(), private: PRIVATE.slice(), config: CONFIG.slice(), meta: META.slice(), media: MEDIA.slice() }),
    // Photos: bytes are kept as Uint8Array copies (never through JSON). __TEST_PHOTO_OFFLINE makes photoFull find nothing.
    putPhoto: async (id, meta, full) => { db.photoData = db.photoData || {}; db.photos = db.photos || {};
      db.photoData[id] = { full: new Uint8Array(full) }; db.photos[id] = { ...meta, thumb: new Uint8Array(meta.thumb), by: me }; window.__TEST_WRITES.push(["photos", id]); firePh(); },
    watchPhotos: (evIds, cb) => { const ids = new Set(evIds); const sub = { ids, cb }; phSubs.push(sub); setTimeout(() => firePh(sub)); return () => { phSubs = phSubs.filter(x => x !== sub); }; },
    photoFull: async id => window.__TEST_PHOTO_OFFLINE ? null : (db.photoData && db.photoData[id] ? new Uint8Array(db.photoData[id].full) : null),
    markPhoto: async (id, deletedT) => { const p = db.photos && db.photos[id]; if (!p) throw Object.assign(new Error("missing"), { code: "not-found" }); if (deletedT) p.deletedT = deletedT; else delete p.deletedT; firePh(); },
    purgePhoto: async id => { if (db.photoData) delete db.photoData[id]; if (db.photos) delete db.photos[id]; firePh(); },
    photoUsage: async () => { const l = Object.values(db.photos || {}); return { n: l.length, bytes: l.reduce((a, p) => a + (p.bytes || 0), 0) }; },
    patch: async (n, id, fields) => { const cur = col(n)[id]; if (!cur) { const e = Object.assign(new Error("No document to update"), { code: "not-found" }); window.dispatchEvent(new CustomEvent("store-error", { detail: e })); return; }
      const { by, ...f } = copy(fields) || {}; col(n)[id] = { ...cur, ...f }; fire(n); },
    create: (n, id, rec) => put(n, id, rec),
    // Same contract as firebase-store.js guardedPut: rev must be stored rev + 1 (or any rev ≥ 1 when absent); a refused
    // write that matches the stored copy counts as already saved; anything else is a conflict (store-error).
    guardedPut: async (n, id, rec) => { const d = { by: me, ...copy(rec), editBy: me }, cur = col(n)[id];
      window.__TEST_WRITES.push([n, id, copy(d)]);
      if (window.__TEST_HOLD) { window.__TEST_HOLD.push(() => window.Store.guardedPut(n, id, rec)); return { pending: true }; }
      if (VAL[n] && !window.MilkSources[VAL[n]](id, d)) { deny("invalid " + n); return { refused: true }; }
      if (cur && !(d.rev === cur.rev + 1 && d.i === cur.i && d.t === cur.t)) {
        if (same(cur, d)) return { saved: true, already: true };
        const e = Object.assign(new Error("Someone else changed this first."), { code: "conflict", name: n, id, current: copy(cur), mine: copy(d) });
        window.dispatchEvent(new CustomEvent("store-error", { detail: e })); return { conflict: true };
      }
      col(n)[id] = d; fire(n); return { saved: true }; },
    // Same contract as firebase-store.js: names every current member; each needs a marker at v (the rules' check).
    activateSources: async v => { if (window.__TEST_OFFLINE_ACTIVATE) throw Object.assign(new Error("offline"), { code: "offline" });
      if (db.config.sources) return copy(db.config.sources);
      const phones = fam.members.map(m => m.uid), c = col("clients");
      if (phones.length > 4) throw Object.assign(new Error("too many"), { code: "too-many" });
      if (!phones.every(u => c[u] && Number.isInteger(c[u].v) && c[u].v >= 1)) throw Object.assign(new Error("not ready"), { code: "not-ready" });
      db.config.sources = { on: true, t: Date.now(), by: me, phones }; fireCfg("sources"); return copy(db.config.sources); },
    markClient: async v => { const c = col("clients"); if (!(c.u1 && c.u1.v >= v)) { c.u1 = { v, t: Date.now() }; fire("clients"); } },
    uid: () => "u1",
    watchPrivate: (n, cb) => { (psubs[n] = psubs[n] || []).push(cb); setTimeout(() => pfire(n)); return () => { psubs[n] = psubs[n].filter(x => x !== cb); }; },
    putPrivate: async (n, id, rec) => { pcol(ME, n)[id] = { by: me, ...copy(rec) }; pfire(n); },
    removePrivate: async (n, id) => { delete pcol(ME, n)[id]; pfire(n); }
  };
  window.dispatchEvent(new Event("store-ready"));
})();
