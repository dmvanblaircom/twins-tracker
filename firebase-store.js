// Firebase backend for the tracker. Exposes window.Store, then fires "store-ready".
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, setPersistence, indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc
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
  const H = "households/main";                   // all data lives under one household doc

  const watchCol = (name, cb, err) =>
    onSnapshot(collection(db, H, name), { includeMetadataChanges: true },
      snap => cb(snap.docs.map(d => [d.id, d.data()]), { fromCache: snap.metadata.fromCache }),
      err);

  // Offline, a write is saved locally at once but the server ack waits for signal.
  // Resolve after the ack or 1.5 s, whichever first, so the UI never hangs; rejections still surface.
  // A late rejection (e.g. permission denied after the timeout) is reported via a "store-error" event.
  const w = p => { p.catch(err => window.dispatchEvent(new CustomEvent("store-error", { detail: err })));
    return Promise.race([p, new Promise(r => setTimeout(r, 1500))]); };

  window.Store = {
    onAuth: cb => onAuthStateChanged(auth, cb),
    signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
    signOut: () => signOut(auth),
    reset: e => sendPasswordResetEmail(auth, e),
    watchWeights: (cb, err) => watchCol("weights", cb, err),
    watchFeeds: (cb, err) => watchCol("feeds", cb, err),
    watchDiet: (cb, err) => onSnapshot(doc(db, H, "config", "diet"), d => cb(d.exists() ? d.data().text : null), err),
    setWeight: (id, rec) => w(setDoc(doc(db, H, "weights", id), { ...rec, by: auth.currentUser?.email || "" })),
    delWeight: id => w(deleteDoc(doc(db, H, "weights", id))),
    setFeed: (id, rec) => w(setDoc(doc(db, H, "feeds", id), { ...rec, by: auth.currentUser?.email || "" })),
    delFeed: id => w(deleteDoc(doc(db, H, "feeds", id))),
    setDiet: text => w(setDoc(doc(db, H, "config", "diet"), { text })),
    watchProfile: (cb, err) => onSnapshot(doc(db, H, "config", "profile"), d => cb(d.exists() ? d.data() : null), err),
    setProfile: p => w(setDoc(doc(db, H, "config", "profile"), p))
  };
  window.dispatchEvent(new Event("store-ready"));
}
