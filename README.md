# Twins Tracker

A home-screen app (PWA) for charting two babies' nightly weights and PO feeds on a fixed 3-hour schedule. Firebase holds the shared data; GitHub Pages hosts the app. No personal details live in this code: names, birth details and full-feed volumes are entered on a setup screen after sign-in and stored in the private database.

## Setup (one time)
1. **Firebase project** — https://console.firebase.google.com → Add project (Analytics off).
2. **Authentication → Sign-in method → Email/Password → Enable.** Then **Users → Add user** for each parent.
3. **Firestore Database → Create database** (production mode, a US location).
4. **Firestore → Rules** → paste `firestore.rules`, replace the two example emails with yours (lowercase) → Publish.
5. **Project settings → Your apps → Web (</>)** → register → copy the config values into `firebase-config.js` in this repo.
6. **Authentication → Settings → Authorized domains** → add `<username>.github.io`.
7. **This repo → Settings → Pages** → Deploy from branch `main`, folder `/ (root)`.
8. Open the site, sign in, fill in the setup screen. To bring over earlier data, paste a CSV into **Import data (CSV)** at the bottom.

## Phones
iPhone: open the site in Safari → Share → Add to Home Screen, then sign in once inside the home-screen app. Android: Chrome → Install app.

## Notes
- Works offline; entries sync when signal returns.
- Feed times, the 8 AM day start, and the 150 mL/kg/day default live in `index.html` (`SLOT_H`, `DAY_START_H`); per-baby full feed and :00/:30 offset are on the setup screen.
- Firebase's free Spark plan is plenty; no card required.
