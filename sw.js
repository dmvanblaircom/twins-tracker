// App-shell cache so the app opens with no signal. Data offline is handled by Firestore's own cache.
const CACHE = "ec-tracker-v1";
const SHELL = ["./", "index.html", "firebase-store.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-180.png",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Never touch Firebase API traffic.
  if (/googleapis\.com|firebaseio\.com|identitytoolkit|securetoken/.test(u.host)) return;
  const sameOrigin = u.origin === location.origin;
  if (sameOrigin || /cdnjs\.cloudflare\.com|gstatic\.com/.test(u.host)) {
    // Network first for our own files (so updates land), cache fallback offline.
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
