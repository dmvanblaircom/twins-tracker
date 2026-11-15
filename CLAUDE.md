# Twins Tracker — context for Claude

Static PWA (no build step) for two parents to chart twin NICU babies' nightly weights and PO feeds. Hosted on GitHub Pages from `main` / root. Backend: Firebase Auth (email/password) + Firestore.

**This repo is public. Never commit names, birth dates/times, weights or any feed data.** All personal details live in Firestore (`households/main/config/profile`), entered on the in-app setup screen.

## Files
- `index.html` — the whole app (UI, charts via Chart.js 4.4.1 from cdnjs, all logic). Talks to the backend only through `window.Store`.
- `firebase-store.js` — implements `window.Store` on Firebase (offline cache on; writes resolve after server ack or 1.5 s). Fires `store-ready`.
- `firebase-config.js` — Firebase web config (not secret).
- `firestore.rules` — allowlist of the two parents' emails; everything under `households/main/**`.
- `sw.js` — app-shell cache, network-first. Bump `CACHE` name when shell files change.
- `fonts/inter-latin-var.woff2` — Inter variable font (latin, self-hosted, OFL; licence in `fonts/LICENSE-Inter.txt`). Cached with the shell for offline.
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
- Bottom tab bar: **Today** (tab id `feed`; Phase 1 layout: context strip (`#ctxLabel` today/overnight + viewing, `#ctxDate`, `#ageLine` Day N · PMA, now) → one `section.nx` card per baby: identity header (initial badge, name, Baby A/B, due/next pill `.when`), feed entry `.feed` (mL box + Save, then Full · Tube · Skipped in one row, + Note, missed chips), intake `.tsum` (single view: 3 metrics By mouth / Of target / Last 24 h mL/kg/day + bar + feed count + last feed; Both view: one line + bar + feed count + "Full day ›"), weight `.twt` (inline row in Both), and in single view Rounds (plan + checklist link) and 7-day trends; then Questions card, milk summary row, feed sheet. Both view stays compact so Baby B is reachable; header shows day of life + PMA from `ga`; per baby: "Next feed" card with big mL box + Save, a one-tap "Full · N mL" button (skips the unusual-amount check), All by tube / Skipped, one-tap note chips (`TAGS`), "Not logged" chips for slots missed by more than 1 h (last 12 h; a slot stays "Due" on the card for 1 h), then today's PO total vs goal plus last-24 h mL/kg/day by mouth (`poPerKg`, against the latest weight; full feeds stay birth-weight based as the NICU does), the 8 PM weight box for the current feed day, rounds plan line, checklist summary linking to Progress, 7-day SVG sparklines for PO % and weight; a one-line milk summary linking to Milk; Questions for rounds card; then the day sheet), **Growth** (tab id `weight`; Phase 2: per-baby `.bcard` summary in `#grSum` — latest weight as hero with night date + Recorded/Estimated badge, previous, change, since birth, all neutral; weight trend chart (dashed into estimated points, nearest-night tooltip across babies, g/lb/% axis); nightly grid with weekday dates, Tonight row, est. marker), **Milk** (Phase 2: inventory card `#mkInv` labelled Estimate with the working — start (NICU count, badge Counted, or before first drop-off) + drop-offs since − scheduled feeds since = estimate, via `stockParts()`; Need & pumping metrics `#mkStats`; pump + drop-off entry; per-day chart; log incl. the NICU count; hides the baby bar), **Progress** (tab id `trends`; Phase 3: "Progress at a glance" framing card — family tracking indicators, NOT clinical discharge criteria, NICU team decides; key Logged / Marked done / Open; per-baby `.bcard` in `#home` with five `.ind` rows (full feeds in a row ≥ FEEDS_PER_DAY, by mouth 24 h ≥100% with 48 h + mL/kg/day, 3-night g/kg/day ≥10, birth weight, days since desat/brady note ≥5), each with a neutral "Marker reached"/"Not yet" chip — never green checks; then `#famList` family checklist, `#ckBabies` per-baby checklists (who/when shown; counts marked done/open/not needed); then the two charts), **Records** (tab id `more`; Phase 3: sub-nav `#moreNav` Records / Care / Settings remembered in localStorage `moreSec`. Records: one chronological `#logBody` over feeds, weights, pumps, drop-offs and the NICU count with `#recF` All/Feeds/Weights/Milk filter, editable feed notes, two-tap delete + Undo for every kind except the count, who entered each (shown under the record type; no separate By column so the table fits 390 px). Care: diet, plans from rounds history (family-entered), questions & answers (team answers as recorded by the family). Settings: your name, this phone prefs, babies & account, collapsed `details.settings` CSV export/import). Tab, view and night mode are remembered in localStorage.
- Overwrite guard: Today cards, the feed sheet and the weight grid remember what each box showed (`data-had` / `fSig` / `wSig`); if the entry changed since and the other parent made it, saving asks before replacing it.
- Checklist snapshots patch rows in place (`patchChecklists`, containers carry `data-ids`) instead of a full re-render, and `renderAll` restores scroll, so taps never move the screen.
- New pump/drop-off ids get a 4-char random suffix (`p-{epochMs}-xxxx`) so two entries in one minute both save; old ids are untouched.
- A feed arriving from the other parent (by ≠ me, within 3 h) flashes "<name> logged …".
- Every save/delete shows an 8 s Undo bar. Amounts >130% of full feed or far from the recent average ask to confirm.
- Per-phone prefs (localStorage `prefs`): appearance `look` system|light|dark (sets `data-look`; system follows `prefers-color-scheme`; night overrides), units g|lb (display only; entry stays grams), clock 12|24, text size via CSS zoom (cards restack with container queries), night manual|auto 9 PM–7 AM.
- Floating "+ Log feed" button on Weight/Progress, or on Today once the Next card scrolls away (hidden on Milk/More). Chart callouts close on a tap elsewhere, on scroll, or after 5 s (`hideTips`). Diet changes (from feeds' `diet`) draw dotted markers on the PO and daily charts.
- Floating button tucks away (`.tuck`) while scrolling down and returns on any scroll up. Every control is ≥44 px tall (tested). `#upd` "New version ready — tap to refresh" shows on `controllerchange` when the page was already controlled (https only). Records table becomes two-line rows under a container query at large text; growth grid boxes flex. Sign-in and setup screens carry the brand mark. Error text is plain language (no rules/allowlist jargon).
- Charts render only when their tab is visible (`draw` skips hidden canvases; `showTab` re-renders).

## Design system (Phase 0)
- All colours, spacing (`--sp-1..6`, 4-pt), radii (`--r-xs..lg`, `--r-pill`), elevation (`--shadow-1/2`) and type sizes (`--fs-*`) are CSS tokens at the top of `<style>`; components use tokens only.
- Brand: navy `#193653` for titles and the brand mark only (`--title`, `--brand`); medical blue `#3976A8` is the action colour (`--accent`: buttons, FAB, pressed chips) and links/focus; supporting blue `#6C8FAD`. Status tokens come as base / `-ink` (text) / `-tint` (backgrounds): success `#24836B`, warning `#B77928`, danger `#B94A48`.
- Light text: `--text` `#182B3A`, `--title` navy, `--text2` `#637587` (on cards), `--muted` `#5A6D80` (small text anywhere, incl. the page background where #637587 is <4.5:1).
- Themes: light, dark (Appearance = Dark, or System + phone in Dark mode; `data-look`), night (`data-theme=night`, manual or auto; blue-black with warm text). Every text pair ≥4.5:1, field borders ≥3:1 in all three.
- Twin identity: `PALETTE` keys unchanged (pink, purple, blue, orange, green, teal), muted values per theme [light, dark, night], each ≥4.5:1 on its surface. Identity is never colour-only: names always shown, selector names wrap rather than truncate.
- Shell: brand mark + eyebrow + baby names, sync pill (success/warning/danger tint), segmented baby selector (tinted track, selected = raised white chip with navy text, colour dot + name), tab bar with pill highlight behind the active icon. Tab ids unchanged.
- `tests/screens.js <dir>` saves iPhone-size (390×844 @2x) screenshots of every tab in light/night, each baby, A++ text and offline, for before/after design review.

## Domain rules
- A day runs `dayH` to `dayH` (default 7 AM–7 AM, matching NICU shifts) and never depends on feed times. Feeds every `everyH` h (default 3) on the grid anchored at `startH` (default 8 AM); `setSchedule` builds `SLOT_H` (hours within the day window), `FEEDS_PER_DAY`, `DAY_START_H`. Each baby offset by `slotMin` (0 or 30). Daily totals count feeds by clock time (`feedDay`), so changing feed times never moves the day.
- Only PO volume is tracked. Full feed default = 150 mL/kg/day × birth weight ÷ 8, overridable per baby.

## Status / next steps
- [x] Firebase project created (twins-tracker-53f1d), Email/Password on, both users added, sign-up disabled, github.io authorized. Rules: real emails pasted in console only (repo copy keeps placeholders).
- [x] `firebase-config.js` filled.
- [x] GitHub Pages live from main / root; sign-in verified on iPhone.
- [x] Setup screen done; prior data imported from NICU chart photos (estimates flagged `approx` / note `est.`).

## Testing
`cd tests && npm install && npm test` — `smoke.js` serves the repo, swaps `firebase-store.js` for `tests/stub-store.js` (in-memory Store, same contract), loads fictional babies (synthetic CSV), and walks every screen in headless Chromium (America/New_York, phone viewport, touch, fixed clock). ~55 checks; exits non-zero on any failure or page error. Screenshots land in `tests/shots/` (git-ignored). Needs Playwright + Chromium available. Never put real names or data in tests. Run it after every change.
