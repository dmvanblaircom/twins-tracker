# Twins Tracker — context for Claude

Static PWA (no build step) for two parents to chart twin NICU babies' nightly weights and PO feeds. Hosted on GitHub Pages from `main` / root. Backend: Firebase Auth (email/password) + Firestore.

**This repo is public. Never commit names, birth dates/times, weights or any feed data.** All personal details live in Firestore (`households/main/config/profile`), entered on the in-app setup screen.

## Files
- `index.html` — the whole app (UI, charts via Chart.js 4.4.1 from cdnjs, all logic). Talks to the backend only through `window.Store`.
- `firebase-store.js` — implements `window.Store` on Firebase (offline cache on; writes resolve after server ack or 1.5 s). Fires `store-ready`.
- `firebase-config.js` — Firebase web config (not secret).
- `firestore.rules` — allowlist of the two parents' emails; everything under `households/main/**`.
- `sw.js` — app-shell cache, network-first. Bump `CACHE` name when shell files change.
- `manifest.webmanifest`, `icons/`.

## Data model (under `households/main/`)
- `weights/{Name}-{YYYY-MM-DD}` → `{twin, date, v (g), approx, by}` — one per baby per night (weighed at 8 PM).
- `feeds/{Name}-{epochMs}` → `{twin, t, v (mL PO), note, diet, by}` — one per baby per fixed feed slot. `v:0` with note `All by tube` / `Skipped` marks a non-PO feed; notes matching `MARK` (`est.`, those two) are replaced when a value is re-entered.
- `config/profile` → `{born, ga, twins:[{name, birthTime, birthG, fullMl, slotMin, color}]}` — `color` is a PALETTE key (pink, purple, blue, orange, green, teal) with light/dark/night variants.
- `config/diet` → `{text}`; stamped onto each new feed.
- `pumps/p-{epochMs}` → `{t, v (mL), by}` — mom's pump sessions. `drops/d-{epochMs}` → `{t, v, by}` — milk taken to the NICU.
- `config/milk` → `{count, t}` — NICU's actual stock count at time t (overrides drop-off math from then on).
- Milk math (assumes babies get only mom's milk): need/day = Σ fullMl × 8; NICU stock ≈ (count or 0) + drop-offs since − need × elapsed.

## UI layout
- Sticky top: title, night-mode toggle (amber-on-black, per device), view bar (twin 0 | twin 1 | Both) that filters every screen.
- Bottom tab bar: **Feed** ("Next feed" card per baby: big mL box + Save, All by tube / Skipped, "Not logged" chips for missed slots in the last 12 h; then the day sheet), **Weight** (nightly grid + chart), **Milk** (pump + drop-off entry, 24 h pumped vs need, last pump, NICU stock estimate, per-day chart, log; hides the baby bar), **Trends** (tiles, PO chart, daily %), **More** (diet, feed log, CSV export/import, profile, sign out). Tab, view and night mode are remembered in localStorage.
- Every save/delete shows an 8 s Undo bar. Amounts >130% of full feed or far from the recent average ask to confirm.
- Charts render only when their tab is visible (`draw` skips hidden canvases; `showTab` re-renders).

## Domain rules
- Feeds every 3 h starting 8 AM (`SLOT_H`); each baby offset by `slotMin` (0 or 30). Feed day = 8 AM–8 AM (`DAY_START_H`).
- Only PO volume is tracked. Full feed default = 150 mL/kg/day × birth weight ÷ 8, overridable per baby.
- Tiles: last weight, night-over-night delta, % vs birth, 3-night g/day slope, PO last 24 h vs 8 × full feed.

## Status / next steps
- [x] Firebase project created (twins-tracker-53f1d), Email/Password on, both users added, sign-up disabled, github.io authorized. Rules: real emails pasted in console only (repo copy keeps placeholders).
- [x] `firebase-config.js` filled.
- [x] GitHub Pages live from main / root; sign-in verified on iPhone.
- [x] Setup screen done; prior data imported from NICU chart photos (estimates flagged `approx` / note `est.`).

## Testing
No test suite. Verify by stubbing `window.Store` in a copy of `index.html` (all calls return promises; watchers take `(cb, err)` and return an unsubscribe) and loading it in headless Chromium with `timezone_id="America/New_York"`.
