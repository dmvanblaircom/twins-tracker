> **Status:** Phase 0 audit as delivered. Where it conflicts with `docs/NICULOG-PLAN.md` (approved decisions, revised phases, photos in Firestore instead of Firebase Storage), the plan wins.

# NICUlog — Phase 0: Architecture and Product Readiness Audit

Repository: `twins-tracker` @ `a4122c2` (main). Read-only audit; nothing was changed, committed or deployed.
Baseline: browser suite **152/152 passing**, rules suite **28/28 passing** (Firestore emulator, run from a scratch copy).

---

## Executive summary

- **Most of NICUlog fits the current architecture without migrating care records.** Feeds, weights, pumping, checklists, plans and questions stay where they are. New records (events, photos, check-ins, family needs) go in new collections under `households/{hid}/`. The journey timeline is a computed view over the in-memory state the app already holds, so nothing is copied.
- **One security finding blocks Parent Support.** I proved it in the emulator: today's catch-all data rule lets any family member read anything under the family, including a "private" path. Private check-ins need that rule tightened first, and an explicitly owner-only subtree.
- **Photos are the hard part.**
  - **New infrastructure:** Firebase Storage needs a new rules file, and per Google's 2024 change it likely needs the paid pay-as-you-go plan (verify in the console).
  - **No offline:** the Storage SDK has no offline mode, so the app needs its own IndexedDB upload queue. Thumbnails need on-device generation (no Cloud Functions).
  - **Viewing:** photos are loaded through sign-in-checked downloads rather than shareable links, so removing a member actually cuts off access. On the bucket this needs a CORS setting (which origins may fetch files) that names both web origins.
- **Backup:** keep the current JSON format (bumped to version 2 with the new collections). Add an optional "with photos" ZIP. The ZIP writer and reader are small hand-written code (uncompressed ZIP, no library); JPEGs don't compress further anyway.
- **iOS:**
  - The camera and photo library work in both the web app and the iOS wrapper through a standard file input.
  - The iOS app must add camera and photo-library usage descriptions (the permission text Apple requires), or it will crash.
  - Saving files (backups) inside the iOS app likely needs the official Capacitor Share and Filesystem plugins.
- **Proposed order:**
  1. Foundations: rules hardening, Store additions, navigation, backup format 2.
  2. Events and milestones, plus the Journey timeline.
  3. Photos.
  4. Parent Support.
  5. Family Support.
  6. NICUlog rebrand, iOS hardening and privacy.
- **Eleven decisions** need your approval (section 15) before Phase 1.

---

## 1. Current-state architecture

| Layer | What exists | Where |
|---|---|---|
| App | Single static page, no build step; all UI, state, rendering and logic in one IIFE; Chart.js 4.4.1 from cdnjs | `index.html` (1,896 lines) |
| Data access | `window.Store` is the only path to the backend; the app never imports Firebase | `firebase-store.js` (151 lines) |
| Backend | Firebase Auth (email/password) + Cloud Firestore with `persistentLocalCache` (IndexedDB, multi-tab) | `firebase-store.js` `initializeFirestore(...)` |
| Auth | `initializeAuth` with IndexedDB → localStorage persistence (no popup/redirect, works in iOS web view) | `firebase-store.js` |
| Write semantics | `w(p)`: resolves on server ack or after 1.5 s; late rejections → `store-error` event → `failWrite()` banner | `firebase-store.js` `w`, `index.html` `failWrite` |
| Families | `users/{uid}→{hid}`, `households/{hid}` (owner, invite code), `members/{uid}`, `invites/{CODE}` | `firebase-store.js` `family/createFamily/joinFamily/...` |
| Rules | Membership-based; legacy allowlist for `households/main`; generic catch-all for all data subcollections | `firestore.rules` |
| Offline shell | Service worker, network-first app-shell cache (web only; not used in iOS) | `sw.js` (`CACHE` = `ec-tracker-v36`) |
| iOS | Capacitor 6 project; `build.mjs` copies web app + vendors Chart.js and Firebase locally | `native/` |
| Tests | Playwright browser suite with in-memory `Store` stub; rules suite on Firestore emulator | `tests/smoke.js`, `tests/stub-store.js`, `tests/rules/rules.test.js` |

**State model (in `index.html`).**
- Module-level arrays and maps hold the data: `F` (feeds), `W` (weights keyed `name|date`), `P` and `D` (pumps and drop-offs), `CK` (checklist), `PLANS`, `QS` (questions), `milkCfg`, `people`, `profile`.
- Raw docs are kept in `rawW`, `rawF`, `RAW{}` and `RAWC{}` for backup.
- `startData()` opens one whole-collection `onSnapshot` per collection. Every collection is watched in full; there are no queries.
- Each watcher calls the matching `render*()` function; `renderAll()` re-renders every screen and keeps the scroll position.
- Charts draw only while their tab is visible (`draw`, `showTab`).

---

## 2. Existing functionality inventory

- **Today** (`renderNext`, `nextSlot`, `todayBlock`, `renderCtx`, `renderQs`, `renderTodayMilk`, `renderSheet`):
  - A next-feed card per baby with Save, Full, Tube, Skipped and note tags (`TAGS`).
  - "Not logged" chips after 1 h.
  - Intake summary, the 8 PM weight, rounds plan line, checklist summary and 7-day sparklines.
  - Questions for rounds, milk summary and the day sheet.
- **Growth** (`renderGrowth`, `renderWeight`, `renderGrid`, `saveWeight`): weight summary, trend chart and nightly grid.
- **Milk** (`renderMilk`, `stockParts`, `usedSince`, `milkSave`, NICU count via `stkGo`): estimated inventory with its working, need and pumping stats, entry, chart and log.
- **Progress** (`renderHome`, `renderFam`, `renderBabyChecklists`, `ckRow`, `ckToggle`, `patchChecklists`): five computed family indicators per baby ("Marker reached" / "Not yet"), the family checklist (`DIS_FAM`, 6 items), per-baby checklists (`DIS_BABY`, 8 items), and charts.
- **Records** (`renderLog`, `#logBody` handler): unified chronological list grouped by day, with filters, note edit, two-tap delete and Undo.
- **Care** (`renderCare`): diet, history of rounds plans, questions and answers.
- **Settings:**
  - Per-phone preferences (`PREF`, `applyLook`).
  - Display name (`config/people`).
  - Family card (`renderFamily`, `drawFamily`): members, invite, remove, leave, delete account.
  - Babies and setup (`showSetup`, `suSave`).
  - Full backup and restore (`backupData`, `bkGo`, `rsFile`).
  - CSV export and import (`csvBtn`, `impGo`, `parseCSV`).
- **Safety and concurrency:**
  - Overwrite guard (`otherTook`, `fSig`, `wSig`, `data-had`).
  - Undo guard (undo functions can return `false`).
  - 8-second Undo bar (`undoBar`).
  - Unusual-amount confirm (`unusual`).
  - "Other parent logged…" flash (in the `watchFeeds` callback).
  - Sync pill (`renderSync`).
- **Not present today:** events, milestones, journal, photos, any file storage, emotional check-ins, a family task or needs list, a timeline.
  - The nearest existing things are checklist items (dated, with who marked them), rounds plans (one line per baby per day), questions (with answers) and feed note tags such as "Desat/brady".

## 3. Existing data model inventory (under `households/{hid}/`)

| Collection / doc | Key | Fields | Notes |
|---|---|---|---|
| `feeds` | `b{i}-{epochMs}` | twin, i, t, v, note, diet, by | Older `{Name}-{t}` read via `twinOf`, upgraded in place (`upgradeIndex`) |
| `weights` | `b{i}-{date}` | twin, i, date, v, approx, by | One per baby per night |
| `pumps` / `drops` | `p-{t}-{rand}` / `d-{t}-{rand}` | t, v, by | Older ids without suffix |
| `checklist` | `b0-*`, `b1-*`, `f-*` | s (done/na), d, by | Absent = open |
| `plans` | `{i}-{feedDay}` | i, day, text, by | |
| `questions` | `q-{epochMs}` | text, done, t, doneT, ans, by | |
| `config/profile` | | born, ga, schedule, twins[{name, birthTime, birthG, fullMl, slotMin, color, aka?}] | |
| `config/diet` `config/people` `config/milk` | | text / list / count,t | |
| Top level | `users/{uid}`, `invites/{CODE}`, `households/{hid}` + `members/{uid}` | see Families | |

`by` is set in `firebase-store.js` (`{ by: email(), ...rec }`), so a record that already carries `by` keeps it on edits and restores.

---

## 4. Recommended event and photo data models

### 4.1 Events (new collection `events`)
One collection for baby, parent, family and journal entries. Existing care records are **not** migrated.

```
households/{hid}/events/e-{epochMs}-{rand4}
{
  kind:   "milestone" | "journal" | "moment",   // what it is
  scope:  "baby" | "parent" | "family",          // who it's about
  i:      0 | 1 | null,                          // baby index when scope = "baby" (never a name)
  key:    "first-hold" | ... | null,             // curated milestone key (like DIS_BABY keys) or null for free text
  t:      epochMs,                               // when it happened (user-editable)
  title:  string (≤120), note: string (≤2000),
  ref:    { col: "feeds"|"weights"|"checklist", id } | null,  // optional pin to an existing record (no copy)
  by, createdT, editT, editBy                    // attribution + conflict signature
}
```
- **Ids** follow the existing `p-{t}-{rand}` pattern from `milkSave`.
- **Photos:** none are stored on the event; they point to it (4.2). That avoids array conflicts when both parents attach at once.
- **Curated milestone keys** live in code, alongside `DIS_BABY` and `DIS_FAM` (`index.html` ~1482). Examples: first hold, first bath, first time by mouth, off the ventilator. Wording needs product-owner review: family language, not clinical terms.
- **"Firsts" suggested from data** (for example, first full feed by mouth, back to birth weight) are computed with the existing helpers (`renderHome` indicator logic, `wSeries`, `fSeries`). They show as "Add to journey?" suggestions and are stored only if a parent saves them, with `ref` pointing back to the source record.

### 4.2 Photos (new collection `photos` + Firebase Storage objects)
```
households/{hid}/photos/ph-{epochMs}-{rand4}
{
  ev:    eventId,                 // owning event (family or private)
  t:     epochMs (capture/added), w, h, bytes,
  path:  "households/{hid}/photos/{pid}/full.jpg",
  thumb: "households/{hid}/photos/{pid}/thumb.jpg",
  state: "queued" | "ready",      // queued = metadata synced, file still on the adding phone
  by, deletedT?                   // soft delete for undo / purge
}
```
- **Private photos** (attached to a private check-in) use the same shape under `households/{hid}/private/{uid}/photos/` with Storage path `households/{hid}/private/{uid}/photos/{pid}/…`.

---

## 5. Recommended storage architecture

- **Firebase Storage**, default bucket (`storageBucket: twins-tracker-53f1d.firebasestorage.app` already in `firebase-config.js`).
- **Prerequisite to verify:** Google moved Cloud Storage for Firebase default buckets to the pay-as-you-go plan in 2024. Confirm in the console whether this project needs that plan before Storage works. I haven't estimated costs; it depends on photo volume.
- **On-device processing before upload** (no Cloud Functions, no extension):
  1. Decode with `createImageBitmap(file)`, which follows EXIF orientation in current Safari and Chrome. iPhone HEIC files decode in Safari and WKWebView on recent iOS; verify on the minimum iOS you support.
  2. Draw to a canvas and re-encode two JPEGs: **full** (long side ≤ 2048 px, quality ~0.82) and **thumb** (long side 400 px).
  3. Re-encoding strips all metadata, including GPS location. That's a privacy win to state in the policy.
- **Store additions:** new methods added, existing ones unchanged.
  - `Store.uploadFile(path, blob, meta)` (resumable upload, reports progress), `Store.getFile(path)` (returns a Blob through a sign-in-checked download), `Store.removeFile(path)`.
  - `Store.patch(name, id, fields)` (merge write, so two parents editing different fields don't clobber each other).
  - `Store.watchPrivate(name, cb)`, `Store.putPrivate`, `Store.removePrivate` (paths under `households/{hid}/private/{uid}/…`).
  - The test stub (`tests/stub-store.js`) gets in-memory equivalents.
- **Viewing:**
  - Use the SDK's `getBlob()`, not `getDownloadURL()`. Download URLs carry a token that works without signing in and survives member removal; `getBlob()` checks sign-in and the rules on every fetch.
  - This needs a bucket CORS setting listing `https://<pages-domain>` and the iOS origin. With `"scheme": "TwinsTracker"` in `capacitor.config.json`, that's likely `twinstracker://localhost` (verify).
- **Local caches:**
  - Thumbnails are kept in a small IndexedDB store (or the Cache API) keyed by photo id, so the timeline shows them offline.
  - Full-size images are fetched on demand.
  - Queued uploads live in a separate IndexedDB store.

## 6. Recommended security-rule changes

### 6.1 Firestore (`firestore.rules`) — required before any private data exists
**Finding (verified in the emulator):** `match /households/{hid}/{col}/{rest=**} { allow read, write: if col != 'members' && inFamily(hid); }` lets **any member read another member's `private/...` documents**.

Change:
```
match /{col}/{rest=**} {
  allow read, write: if !(col in ['members', 'private']) && inFamily(hid);
}
match /private/{uid}/{rest=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid && inFamily(hid);
}
```
- Sharing a check-in is an explicit copy (a family-visible `events` entry of kind `journal`, scope `parent`) written by its owner. Unsharing deletes the copy.
  - No conditional "shared == true" reads are needed, so whole-collection watching keeps working (it's the only pattern the app uses).
  - The private subtree stays absolutely private.
- Optional field validation for `events` and `photos`, mirroring the `users` doc check (`keys().hasOnly`, `i in [0,1,null]`, `by == request.auth.token.email` on create).
  - This needs care: restores write `by` for other members.
  - **Recommendation:** validate shape only; don't force `by` to equal the signer.
- **Legacy allowlist:** `inFamily` grants `main` to the allowlisted emails even without membership. For private data, require `request.auth.uid == uid`, which is already uid-scoped.

### 6.2 Storage (new `storage.rules`)
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function member(hid) { return request.auth != null &&
      firestore.exists(/databases/(default)/documents/households/$(hid)/members/$(request.auth.uid)); }
    function img() { return request.resource.contentType == 'image/jpeg' && request.resource.size < 8 * 1024 * 1024; }
    match /households/{hid}/photos/{pid}/{file} {
      allow read, delete: if member(hid);
      allow create: if member(hid) && img() && file in ['full.jpg', 'thumb.jpg'];
      allow update: if false;
    }
    match /households/{hid}/private/{uid}/photos/{pid}/{file} {
      allow read, delete: if request.auth.uid == uid && member(hid);
      allow create: if request.auth.uid == uid && member(hid) && img();
    }
    match /{all=**} { allow read, write: if false; }
  }
}
```
- Storage rules can look up Firestore membership with `firestore.exists`. Each check counts as a Firestore read.
- **Legacy `main`:** the allowlisted emails are always members already, because `family()` claims membership on open. So Storage can rely on membership alone.
- Deploying: the rules can be pasted in the console like today, or deployed with the Firebase CLI. Either way, it's your step.

## 7. Offline and synchronization strategy

- **Records** (events, check-ins, needs) inherit Firestore's existing offline behaviour: write locally, sync later. The `w()` 1.5-second race and the `store-error` path already cover late rejections. Nothing new is needed.
- **Photos: two-phase.**
  1. The photo doc is written immediately with `state: "queued"` and the thumbnail is kept locally, so the adding phone shows it at once.
  2. The blobs go into an IndexedDB upload queue.
  3. A queue runner starts at launch, on `online` events, and after each add: it uploads full, then thumb, then patches `state: "ready"`.
  4. Retry uses exponential backoff with a cap; a failed item stays queued, never dropped.
  5. The sync pill (`renderSync`) gains "Uploading 2 photos…".
- **The other parent** sees a placeholder ("Photo from Dad, still uploading") until `state` is `ready`.
- **Limits:**
  - Uploads run only while the app is open. There's no background upload in a PWA or a plain Capacitor web view.
  - Safari can evict script-written storage for websites unused for 7 days. Home-screen web apps and the iOS app are much safer, but this is the main argument for the iOS app if photos matter.

## 8. Conflict handling (two parents)

| Situation | Strategy | Builds on |
|---|---|---|
| Both edit the same event's text | Edit form keeps a `data-had` signature (`editT` + `editBy`); on save, if it changed and `editBy ≠ me`, confirm "…just edited by X. Replace?" | `otherTook`, `fSig` pattern |
| Different fields edited at once | `Store.patch` merge writes instead of full `setDoc` | new `Store.patch` |
| Both attach photos to one event | Photos are separate docs pointing to the event; no shared array, so no conflict | data model 4.2 |
| One deletes an event while the other edits it | Delete wins; the deleter's Undo restores it; the editor's save on a missing event asks "deleted by X — save as new?" | `undoBar`, undo-returns-false guard |
| Photo deletion | Soft delete (`deletedT`), hidden immediately; files purged by the deleting phone when the undo window closes; leftovers purged at next launch (`deletedT` older than 1 day) | `undoBar` |
| Private check-ins | Only one writer (the owner), so no conflict | rules 6.1 |
| Family needs claimed by both | Claim is a patch of `claimBy`; if someone already claimed it, confirm "X already took this" | `otherTook` pattern |

## 9. Backup and restore strategy

- **JSON format 2** (default, small):
  - The existing `backupData()` plus `events`, `photos` (metadata), `needs`, and **my own** private subtree (`private.checkins`, `private.photos`).
  - Restore (`rsFile` handler) keeps its merge-only, add-missing-ids behaviour.
  - It accepts format 1 and format 2. Format 1 files simply have no new keys.
  - An older app version reading a format 2 file ignores unknown collections; I checked the `BK_COLS` loop. The `app` tag stays `"twins-tracker"` for compatibility, with `"niculog"` also accepted.
- **"Backup with photos" (ZIP), optional:**
  - **Contents:** `backup.json` plus `photos/{pid}.jpg` (full only; thumbnails are regenerated on restore).
  - **Format:** uncompressed (STORE) ZIP, writer and reader hand-written (~150 lines with CRC-32), no library.
  - **Memory:** files are fetched one at a time with `Store.getFile()`, and the ZIP is assembled as a `Blob` from parts, so it isn't held in the JS heap.
  - **Restore:** reads the central directory with `File.slice()`, re-uploads only photos whose ids are missing, then writes metadata.
  - **Is ZIP appropriate?** Yes as an option, no as the default. A JSON with images base64-encoded inside would be 33% bigger and must be parsed whole. ZIP keeps photos as real files the parent can open.
  - **Large libraries:** hundreds of photos means a large file; on iOS the share sheet handles it but it's slow. Show the size first.
- **Saving the file:**
  - Web uses the existing share-or-download path (`bkGo`).
  - The iOS app likely needs `@capacitor/filesystem` + `@capacitor/share` (official plugins): write to the app's cache, then present the share sheet. Unverified whether WKWebView's Web Share supports files.

## 10. Privacy policy implications (`privacy.html`)

- Add **photos**: stored in Firebase Storage, re-encoded with location and other metadata removed, visible to family members only, deleted with the account.
- Add **emotional check-ins**:
  - Private by default and visible only to the parent who wrote them unless shared.
  - Encrypted in transit and at rest by Google, but **not end-to-end encrypted**.
  - Today's line "The developer does not look at your family's data unless you ask for help" is a promise you must be able to keep. Technically, the Firebase project owner can access stored data. Decide whether to keep that wording or add an end-to-end or local-only option (decision D5).
- Add **support resources**: links to outside organisations, and what happens when they're tapped (they open in the browser, nothing is sent).
- **Account deletion** must also remove the deleter's private subtree and their photos' files when they're the last member. `deleteAccount` in `firebase-store.js` currently deletes only its `DATA` list: no events, photos, Storage or private data.
  - Also decide whether a departing non-last member's **own private check-ins** are deleted when they leave. Recommended: yes.
- **App Store privacy labels:**
  - Add **Photos**, **Health & Fitness** (care data), and possibly **Sensitive Info** (mood check-ins).
  - All "linked to user", none "used for tracking".
- **Rename:** the policy title, the in-app name and the support contact change to NICUlog. `SUPPORT_EMAIL` is still a placeholder.

## 11. iOS versus web capability

| Capability | Web app (Safari / home screen) | iOS app (Capacitor 6, `native/`) |
|---|---|---|
| Camera capture | `<input type=file accept="image/*" capture="environment">` | Same input works; **must add** `NSCameraUsageDescription` (Info.plist has none today — crash on first use) |
| Photo library (multiple) | `<input type=file accept="image/*" multiple>` | Same; add `NSPhotoLibraryUsageDescription` |
| HEIC decode | Safari: yes (recent iOS) | WKWebView: yes (same engine) |
| Offline records | Firestore IndexedDB cache | Same, but storage isn't evicted |
| Offline photo queue | IndexedDB; 7-day eviction risk if unused | IndexedDB in app sandbox; durable |
| Background upload | No | No (would need a native plugin; not recommended now) |
| Backup save | Share sheet / download (works today) | Likely needs Filesystem + Share plugins |
| App shell offline | Service worker (`sw.js`) | Bundled files (`native/build.mjs`) |
| Storage CORS | GitHub Pages origin | `twinstracker://localhost` (verify) |
| Save photo to camera roll | Share sheet "Save Image" | Same via share sheet; a direct save needs a plugin |

## 12. Proposed implementation phases

Each phase ends shippable, keeps existing tests green, adds tests, and stops for your approval.

**Phase 1 — Foundations (no visible features beyond navigation)**
- **Rules:**
  - Tighten the catch-all and add the owner-only `private/{uid}` match (`firestore.rules`).
  - Add emulator tests: the partner can't read private data; the owner can.
- **Store:**
  - Add `patch`, `watchPrivate`, `putPrivate` and `removePrivate` (`firebase-store.js`), plus their stub equivalents (`tests/stub-store.js`).
  - Account deletion also covers `events`, `photos`, `needs` and my own `private` subtree (`firebase-store.js` `DATA`, `deleteAccount`).
- **Navigation (decision D1):** proposed tab bar: Today · Growth · Milk · **Journey** · More.
  - Progress becomes the top of Journey.
  - Records/Care/Settings move under More, with Support added there.
  - Tab ids `feed`, `weight`, `milk` stay; `trends` maps to Journey (`showTab`, `#tabbar`, the localStorage `tab` key).
- **Backup format 2 skeleton:** `backupData`, the restore handler and `BK_COLS` accept the new collections; format 1 is still accepted.

**Phase 2 — Events, milestones and the Journey timeline**
- `events` collection and watcher (`startData`).
- Curated milestone lists (next to `DIS_BABY`).
- "Add moment" sheet: baby A / B / parent / family; milestone or note; editable date.
- `buildTimeline()`: a pure function over `F`, `W`, `CK`, `PLANS`, `QS`, `P`, `D` and `EV`.
  - It produces day groups of items, each `{src, id, t, kind}`, reusing `renderLog`'s grouping and `longD`.
  - Feeds and pumps show as daily summaries, not one row each.
- Data-derived "firsts" suggestions (logic shared with `renderHome`).
- Edit and delete with Undo and the overwrite guard.
- Records stays the raw ledger; Journey is the story view over the same data.

**Phase 3 — Photos**
- Storage setup (plan, bucket, CORS, `storage.rules`) — your steps.
- On-device resize and thumbnail; IndexedDB upload queue; `state` lifecycle.
- Attach to events (camera / library, multiple), placeholders while uploading, viewer, soft delete with purge.
- Sync pill upload count. ZIP backup option (writer/reader + tests).
- Info.plist usage strings (`native/ios/App/App/Info.plist`); Storage emulator rules tests.

**Phase 4 — Parent Support**
- Private check-ins: a 1–5 mood scale, optional one-line note, optional "share with my partner" (an explicit copy into `events`).
- Curated supportive messages: static text in code, rotated, never conditional on clinical data.
- Parent milestones: curated keys, scope `parent`.
- Resources page: static, reviewed links. Crisis line shown on the page at all times (988 Suicide & Crisis Lifeline in the US). Wording is non-diagnostic.
- No scoring, no alerts, nothing sent to anyone automatically.

**Phase 5 — Family Support (deliberately small)**
- `needs` list: text, optional date, `claimBy`, done. Examples: meals, rides, pumping supplies, sibling pickup.
- Shared family milestones: events, scope `family`.
- **Optional, decision D7:** a "supporter" role (grandparents) that can view the journey and claim needs, but not edit care records or see private data.
  - Needs a `role` on member docs, set at join via a separate invite type, plus rules that branch on role.
  - This is the largest rules change; recommend deferring.

**Phase 6 — NICUlog rebrand, iOS hardening and privacy**
- **Rename:** title, brand eyebrow, manifest, `capacitor.config.json` `appName`, `privacy.html`.
- **Keep unchanged:** localStorage keys, the backup `app` tag (accepted as before), cache names (bump only), and the repo.
- **iOS:**
  - Filesystem + Share plugins for backups.
  - Firebase App Check (abuse protection: with Storage, open sign-up becomes costlier to abuse).
  - Bundle id; on-device test pass on a Mac.
- Privacy policy and App Store privacy label updates.

## 13. Dependencies and technical risks

| Item | Type | Risk / note |
|---|---|---|
| `firebase-storage` 10.12.2 (same CDN/npm source as app/auth/firestore) | New module, same SDK | Low; vendored by `native/build.mjs` (add to its list) |
| Firebase pay-as-you-go plan for Storage | Account | **Likely required** (verify); costs unestimated |
| Bucket CORS config | One-time setup | Must include both origins or photos won't load in one of them |
| `@capacitor/filesystem`, `@capacitor/share` | Official plugins | Only for iOS backup save; small |
| Hand-written ZIP (STORE) | Own code | Must be tested against macOS/iOS/Windows unzip |
| HEIC / large photos memory | Platform | Downscale before any other work; process one at a time |
| Safari storage eviction | Platform | Can drop queued uploads / thumb cache on the web if unused 7 days |
| Whole-collection watchers | Existing pattern | Fine for hundreds of events/photos; revisit past ~5,000 docs |
| Mental-health content | Product/legal | Needs your review; avoid any implication of assessment |
| "NICUlog" name | Product | Trademark / App Store name availability not checked |
| Single-file `index.html` growth | Maintainability | ~1,900 lines today; Phases 2–5 may add ~1,500. Still workable without a build step; could split into plain `<script>` files later if wanted |

## 14. Test strategy and acceptance criteria

**Browser suite** (`tests/smoke.js` + `tests/stub-store.js`): extend the stub with events, photos, files (in-memory Blobs, simulated upload delay and failure) and private collections.
- **Phase 1:** navigation and tab persistence; the partner's private items never render; format 1 backups still restore; account deletion covers the new collections.
- **Phase 2:**
  - Add, edit and delete a moment for each scope, with Undo.
  - The overwrite guard prompts on a concurrent edit.
  - The timeline merges sources in chronological order with no duplicates.
  - Suggestions appear and become events with `ref`.
  - 44 px controls, all three themes, A++ text (existing checks extended).
- **Phase 3:**
  - A `setInputFiles` photo becomes queued, then ready.
  - The thumbnail renders offline; a forced failure retries.
  - Soft delete, then Undo; purge.
  - ZIP backup round trip: pixel-identical files, missing-only restore.
- **Phase 4:** a check-in is invisible to the partner (stub-level and rules-level); share creates one family copy and unshare removes it; resources render with no network.
- **Phase 5:** claim conflict prompts; a supporter can't edit care (if D7 is approved).

**Rules suite** (`tests/rules/`):
- Add private-subtree tests: owner read/write; partner and stranger denied, including via the legacy allowlist.
- Add the Storage emulator with `storage.rules` tests:
  - A member can read and create JPEGs under 8 MB.
  - Wrong type, oversized files and non-members are denied.
  - Private paths are owner-only.
  - Updates are denied.
- Keep the mutation-check habit: deliberately weaken one rule per phase and confirm the tests fail.

**Device checks (manual, per phase):** two iPhones, in airplane mode and back; photos in both the web app and the iOS build; large text; night mode.

**Acceptance for every phase:**
- All existing checks are still green.
- New checks are listed and green.
- No feeding, weight, pumping or day-boundary output changes (existing assertions prove this).
- No personal data in the repo.

## 15. Decisions for the product owner

1. **D1 Navigation:** Today · Growth · Milk · Journey · More (Progress folded into Journey; Support under More)? Or another layout?
2. **D2 Firebase plan:** OK to move to pay-as-you-go for Storage (verify the requirement first)? It should come with a budget alert.
3. **D3 Photo limits:** max photos per event (suggest 10), full-size long side 2048 px, and whether originals are kept (recommend no: re-encoded only).
4. **D4 Photo viewing model:** sign-in-checked downloads (`getBlob` + CORS, recommended) or simpler token URLs (work everywhere but can't be revoked).
5. **D5 Check-in privacy level:** private in the family database (recommended for v1), local-only on the phone (never synced or backed up off-device), or end-to-end encrypted (much more work). Also confirm the privacy policy wording about developer access.
6. **D6 Sharing a check-in:** explicit copy into the family journey (recommended) vs. a shared flag on the private doc (needs query-based reads).
7. **D7 Supporter role** (grandparents with limited access): defer (recommended) or include in Phase 5.
8. **D8 Milestone lists and support messages:** you supply or approve the curated wording; I won't write clinical language.
9. **D9 Data-derived "firsts":** shown as suggestions only (recommended) or recorded automatically.
10. **D10 Leaving the family:** delete the leaver's own private check-ins (recommended) or keep them attached to the account.
11. **D11 Rename timing:** rebrand to NICUlog in Phase 6 (recommended, once features settle) or now. Also check the name's availability.

---

## Complete proposed implementation plan (one view)

| Phase | Scope | Key files / functions | Your steps | Exit criteria |
|---|---|---|---|---|
| 1 Foundations | Private-subtree rule fix; Store `patch`/private methods; deletion coverage; Journey/More navigation; backup format 2 skeleton | `firestore.rules`; `firebase-store.js` (`DATA`, `deleteAccount`, new methods); `tests/stub-store.js`; `index.html` `#tabbar`, `showTab`, `showMoreSec`, `backupData`, restore handler | Publish updated rules | Rules + browser suites green; partner can't read private; old backups restore |
| 2 Events & Journey | `events` collection; milestone lists; add/edit/delete with Undo + guard; `buildTimeline()`; firsts suggestions | `index.html` `startData`, new `renderJourney`, reuse `renderLog` grouping, `renderHome` indicator logic, `otherTook`, `undoBar` | Approve milestone wording | Timeline merges all sources without copies; concurrency prompts tested |
| 3 Photos | Storage, resize/thumb, upload queue, viewer, soft delete, ZIP backup, Info.plist strings | `firebase-store.js` file methods; `storage.rules`; `native/build.mjs` (+storage module); `native/ios/App/App/Info.plist`; `renderSync` | Enable Storage (plan), set CORS, publish storage rules | Offline add → later upload; failure retry; ZIP round trip; Storage rules tests |
| 4 Parent Support | Private check-ins, share copy, curated messages, parent milestones, resources | Private Store methods; new Support section under More | Approve wording + resources | Partner can't see private (UI + rules); resources offline |
| 5 Family Support | `needs` list with claims; family milestones; (optional supporter role) | New collection + renderer; rules only if D7 | Decide D7 | Claim conflicts handled; scope stays small |
| 6 NICUlog & iOS | Rebrand; Filesystem/Share plugins; App Check; privacy policy + labels; on-device pass | `index.html` brand, `manifest.webmanifest`, `capacitor.config.json`, `privacy.html`, `native/` | Bundle id, support email, Mac build, App Store Connect | Device test checklist passed on two iPhones |

**Stopping here for product-owner approval.**
