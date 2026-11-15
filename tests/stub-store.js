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
  const put = async (n, id, rec) => { col(n)[id] = { by: me, ...copy(rec) }; fire(n); };
  const remove = async (n, id) => { delete col(n)[id]; fire(n); };
  const watchConfig = (n, cb) => { (cfgSubs[n] = cfgSubs[n] || []).push(cb); setTimeout(() => cb(copy(db.config[n]) || null)); return () => { cfgSubs[n] = cfgSubs[n].filter(x => x !== cb); }; };
  const setConfig = async (n, v) => { db.config[n] = copy(v); fireCfg(n); };
  if (window.__TEST_PROFILE) db.config.profile = copy(window.__TEST_PROFILE);
  window.__db = db;
  window.Store = {
    onAuth: cb => { setTimeout(() => cb({ email: me })); return () => {}; },
    signIn: async () => {}, signOut: async () => {}, reset: async () => {},
    watchWeights: cb => watch("weights", cb), watchFeeds: cb => watch("feeds", cb),
    watchDiet: cb => watchConfig("diet", d => cb(d ? d.text : null)),
    setWeight: (id, r) => put("weights", id, r), delWeight: id => remove("weights", id),
    setFeed: (id, r) => put("feeds", id, r), delFeed: id => remove("feeds", id),
    setDiet: text => setConfig("diet", { text }),
    watchProfile: cb => watchConfig("profile", cb), setProfile: p => setConfig("profile", p),
    watch, put, remove, watchConfig, setConfig
  };
  window.dispatchEvent(new Event("store-ready"));
})();
