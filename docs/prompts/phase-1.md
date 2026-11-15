# NICUlog — Phase 1: Foundations

Read `CLAUDE.md`, `docs/NICULOG-PLAN.md` (approved decisions D1–D11) and `docs/niculog-phase0-audit.md` before starting.

## Goal
Lay the groundwork for NICUlog without adding user-facing features beyond the new navigation. When this phase is done:
- Private per-parent data can exist safely.
- `window.Store` has the methods later phases need.
- Leaving a family and deleting an account clean up correctly.
- The app uses the approved tab layout.
- The backup format can carry the new collections.

## Binding rules
These are non-negotiable:
- Two babies per family, Baby A and Baby B. Baby-specific records use index `i` (0 or 1), never names.
- All data lives under `households/{familyId}/…`. Every record identifies its creator through `by`.
- Offline-first. All controls ≥ 44 px. Light, dark and night themes. Large text intact. Usable one-handed at 2 AM.
- No medical advice, clinical thresholds or discharge-readiness claims.
- Feeding, weight, pumping and day-boundary behaviour unchanged.
- No personal names or data in the repository or tests.
- Keep `window.Store`: add methods, don't change existing signatures or behaviour.
- No new external dependencies.

## Scope

### 1. Security rules (`firestore.rules`)
- **Fix the catch-all.** Change the generic data match so it excludes both `members` and `private`.
  - Today, any family member can read another member's `private/…` documents. This was verified in the emulator.
- **Add an owner-only match for `households/{hid}/private/{uid}/{rest=**}`:**
  - Read and delete: allowed when `request.auth.uid == uid`, even if that person is no longer a member, so a removed parent can still delete their own private data (D10).
  - Create and update: allowed only when `request.auth.uid == uid` and the person is a family member.
  - The legacy email allowlist for `households/main` must **not** grant access to anyone else's private subtree.
- **Emulator tests** (`tests/rules/rules.test.js`):
  - The owner can read and write their private docs.
  - The partner, a stranger and an allowlisted legacy email are all denied, for both reads and writes.
  - A removed member can still read and delete their own private docs but can't create new ones.
  - The catch-all still works for normal data.
- **Mutation check:** loosen the new rule once and confirm the tests fail, then restore it.

### 2. `window.Store` additions (`firebase-store.js`, mirrored in `tests/stub-store.js`)
- `patch(name, id, fields)`: a merge write (`setDoc(..., { merge: true })`) under the current family. It stamps `by` only on create; existing authorship is kept.
- `watchPrivate(name, cb, err)`, `putPrivate(name, id, rec)`, `removePrivate(name, id)`: same semantics as `watch` / `put` / `remove`, but under `households/{hid}/private/{uid}/{name}`.
- Keep the existing write behaviour: the `w()` 1.5 s ack race and the `store-error` event.
- The stub keeps a private area per signed-in user, so tests can prove the partner can't see it.

### 3. Leaving, removal and account deletion (`firebase-store.js` `leave`, `deleteAccount`, `family`)
- **Leaving** deletes the leaver's own private subtree before the membership is removed (D10). Anything previously shared to the family stays.
- **Removal:** when `family()` finds that the user's membership is gone, it deletes that user's private subtree in the old family before returning `null`.
- **Last member deleting their account:** the deletion lists add `events` and `needs` now (photos come in Phase 5), and the user's private subtree is deleted too.
- **Not the last member:** deleting the account removes that user's private subtree and leaves everyone else's data alone.
- Collection lists live in one place, so later phases add a name once.

### 4. Navigation (D1) (`index.html`: `#tabbar`, `showTab`, `showMoreSec`, Progress and Records sections)
- **Tab bar:** Today · Growth · Milk · **Journey** · **More**.
  - Tab ids `feed`, `weight` and `milk` are unchanged.
  - `trends` becomes the Journey tab; keep the id, or migrate the stored `tab` value so returning users land correctly.
  - `more` is labelled More.
- **Journey (for now):** shows the existing Progress content (the "Progress at a glance" card, indicators, family and baby checklists, charts) under a "Journey" heading. Leave room for the timeline in Phase 2, but don't add an empty placeholder card.
- **More:** keeps the Records / Care / Settings sub-navigation and the remembered section (`moreSec`). Support is added in Phase 3.
- Icons and labels stay legible in all three themes and at A++ text; the tab bar must not wrap or truncate at 390 px.
- No behaviour changes inside any screen.

### 5. Backup format 2 skeleton (`index.html`: `backupData`, the `rsFile` restore handler, `BK_COLS`)
- `format: 2` adds `events`, `needs` and `private: { checkins: {...} }` (the signed-in user's own private data only; empty for now).
- **Restore** stays merge-only:
  - It accepts format 1 and format 2.
  - Private items restore only into the signed-in user's own private subtree.
  - An unknown `format` is refused with a plain-language message.
- The `app` tag stays `"twins-tracker"` (also accept `"niculog"` for later).
- Confirm an older app version restoring a format 2 file ignores the new keys without error. Inspect its `BK_COLS` loop and note the result.

## Tests (`tests/smoke.js`)
Add checks for:
- The new tab labels and order, tab persistence across reload, and Journey showing the Progress content.
- More → Records / Care / Settings still working, plus the existing Records checks.
- A private record written by user A never rendering or being readable for user B (stub level).
- `Store.patch` merging fields without dropping others or changing `by`.
- Leave and removal deleting only the leaver's private data; account deletion covering `events` and `needs`.
- Backup format 2 round trip; a format 1 file still restoring; an unknown format being refused.
- The 44 px, theme and A++ checks still passing.

Requirements:
- **Every existing check still passes,** with feeding, weight, pumping and milk outputs identical.
- **Rules suite:** all existing checks plus the new private-subtree checks pass.

## Acceptance criteria
- Browser suite and rules suite green; the counts are reported.
- No change to any feeding, weight, pumping, milk or day-boundary result.
- `CLAUDE.md` updated (navigation, Store methods, private subtree, backup format 2, deletion behaviour).
- `sw.js` `CACHE` bumped.
- No personal data added.
- Before/after screenshots (`tests/screens.js`) of the tab bar and the Journey and More screens at 390 px, light and night, plus A++.

## Out of scope
Events and the timeline (Phase 2), check-ins UI and Support (Phase 3), needs list UI (Phase 4), photos (Phase 5), the NICUlog rename (Phase 6).

## Product-owner steps after this phase
Publish the updated `firestore.rules` in the Firebase console. Keep the real allowlist emails in place of the placeholders.

**Report what changed, with file and function references and test results. Then STOP and wait for approval.**
