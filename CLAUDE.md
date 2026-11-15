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
- `config/profile` → `{born, ga, schedule:{everyH (2|3|4), startH (0–12)}, twins:[{name, birthTime, birthG, fullMl, slotMin, color}]}` — `color` is a PALETTE key (pink, purple, blue, orange, green, teal) with light/dark/night variants.
- `config/diet` → `{text}`; stamped onto each new feed.
- `pumps/p-{epochMs}` → `{t, v (mL), by}` — mom's pump sessions. `drops/d-{epochMs}` → `{t, v, by}` — milk taken to the NICU.
- `config/people` → `{list:[{email, name}]}` — display names shown as "by" on entries (fallback: email initial). Store stamps `by` = signer's email unless the record already carries one (restores/edits keep the author).
- `checklist/{b0|b1|f}-{key}` → `{s:"done"|"na", d:YYYY-MM-DD, by}` — discharge checklist (`DIS_BABY` per baby by index, `DIS_FAM` for parents). Absent doc = not done.
- `plans/{idx}-{feedDay}` → `{i, day, text, by}` — one-line plan from rounds per baby per feed day.
- `questions/q-{epochMs}` → `{text, done, t, doneT, ans, by}` — questions for rounds.
- Baby-keyed extras use the baby's index (0/1), not the name, so renames don't orphan them.
- `config/milk` → `{count, t}` — NICU's actual stock count at time t (overrides drop-off math from then on).
- Milk math (assumes babies get only mom's milk): need/day = Σ fullMl × 8; NICU stock ≈ (count or 0) + drop-offs since − fullMl for every scheduled feed slot since (`usedSince`), stepping down at each feed time.

## UI layout
- Sticky top: title + sync status (Synced / Syncing… / Connecting… / Offline, from snapshot `fromCache`/`pending` + navigator.onLine), night-mode toggle (amber-on-black, per device), view bar (twin 0 | twin 1 | Both) that filters every screen.
- Bottom tab bar: **Today** (tab id `feed`; in Both view each baby card is compact — entry, Full/tube/skip, + Note toggle, one-line summary, weight row, "All of <name>'s day ›" switches to her view; header shows day of life + PMA from `ga`; per baby: "Next feed" card with big mL box + Save, a one-tap "Full · N mL" button (skips the unusual-amount check), All by tube / Skipped, one-tap note chips (`TAGS`), "Not logged" chips for missed slots in the last 12 h, then today's PO total vs goal plus last-24 h mL/kg/day by mouth (`poPerKg`, against the latest weight; full feeds stay birth-weight based as the NICU does), the 8 PM weight box for the current feed day, rounds plan line, checklist summary linking to Progress, 7-day SVG sparklines for PO % and weight; a one-line milk summary linking to Milk; Questions for rounds card; then the day sheet), **Weight** (nightly grid + chart), **Milk** (pump + drop-off entry, 24 h pumped vs need, last pump, NICU stock estimate, per-day chart, log; hides the baby bar), **Progress** (tab id `trends`; Going home card per baby: full-PO streak ≥8, PO % 24/48 h, g/kg/day ≥10, back to birth weight, days since a desat/brady note ≥5, plus the discharge checklist; a "For you two" list; then PO chart, daily %), **More** (diet, feed log with editable notes and who logged, your display name, collapsed "Data & settings" with this-phone prefs + CSV export/import, profile, sign out). Tab, view and night mode are remembered in localStorage.
- A feed arriving from the other parent (by ≠ me, within 3 h) flashes "<name> logged …".
- Every save/delete shows an 8 s Undo bar. Amounts >130% of full feed or far from the recent average ask to confirm.
- Per-phone prefs (localStorage `prefs`): units g|lb (display only; entry stays grams), clock 12|24, text size via CSS zoom (cards restack with container queries), night manual|auto 9 PM–7 AM.
- Floating "+ Log feed" button on Weight/Progress, or on Today once the Next card scrolls away (hidden on Milk/More). Chart callouts close on a tap elsewhere, on scroll, or after 5 s (`hideTips`). Diet changes (from feeds' `diet`) draw dotted markers on the PO and daily charts.
- Charts render only when their tab is visible (`draw` skips hidden canvases; `showTab` re-renders).

## Domain rules
- A day runs `dayH` to `dayH` (default 7 AM–7 AM, matching NICU shifts) and never depends on feed times. Feeds every `everyH` h (default 3) on the grid anchored at `startH` (default 8 AM); `setSchedule` builds `SLOT_H` (hours within the day window), `FEEDS_PER_DAY`, `DAY_START_H`. Each baby offset by `slotMin` (0 or 30). Daily totals count feeds by clock time (`feedDay`), so changing feed times never moves the day.
- Only PO volume is tracked. Full feed default = 150 mL/kg/day × birth weight ÷ 8, overridable per baby.

## Status / next steps
- [x] Firebase project created (twins-tracker-53f1d), Email/Password on, both users added, sign-up disabled, github.io authorized. Rules: real emails pasted in console only (repo copy keeps placeholders).
- [x] `firebase-config.js` filled.
- [x] GitHub Pages live from main / root; sign-in verified on iPhone.
- [x] Setup screen done; prior data imported from NICU chart photos (estimates flagged `approx` / note `est.`).

## Testing
`cd tests && npm install && npm test` — `smoke.js` serves the repo, swaps `firebase-store.js` for `tests/stub-store.js` (in-memory Store, same contract), loads fictional babies (synthetic CSV), and walks every screen in headless Chromium (America/New_York, phone viewport, touch, fixed clock). ~40 checks; exits non-zero on any failure or page error. Screenshots land in `tests/shots/` (git-ignored). Needs Playwright + Chromium available. Never put real names or data in tests. Run it after every change.
