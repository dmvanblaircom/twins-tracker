# NICUlog — approved plan

**Track the baby. Support the parents. Recognize the journey.**

NICUlog is more than a NICU log: it's a family record that parents will want to look back on years from now. Care tracking stays accurate and fast at 2 AM; around it, the app keeps the story of both babies' journey, and supports the parents living it.

This is the **single source of truth** for NICUlog direction, scope and sequencing. It records the product owner's decisions on the Phase 0 audit (`docs/niculog-phase0-audit.md`) and the phase plan. Where the audit or any other document says otherwise, this file wins. Project context and current architecture are in `CLAUDE.md`.

Last updated: Nov 19, 2026 (Phases 2.5 and 3 complete and merged; Phases 1–3 smoke tested on real devices by the product owner).

---

## How work proceeds
1. The product owner approves changes to this plan, and Claude commits them. Product functionality is built only from an approved plan.
2. The product owner (with ChatGPT) writes the implementation prompt for the next phase from this plan.
3. Claude implements the phase on its working branch and reports. No merge, deploy or rules publication without explicit approval.
4. The product owner reviews and approves the phase before the next phase begins. Production Firebase rule changes are approved and published separately from code merges.
5. **Faster process for the rest of Phase 2.5 and Phase 3 (product owner, Nov 19, 2026):**
   - Claude applies its own recommendations straight after each audit and reports once at the end. Feature or code removals and any `firestore.rules` change still need the product owner's approval first.
   - Pass 4 removes tests whose coverage is proven redundant, with the proof recorded in the ledger.
   - Pass 5 is a fresh-eyes checklist in one session: diff from the start of 2.5, every removal checked against the ledger, an old backup restored, every suite run once.
   - Claude merges to `main` (which deploys) once every suite passes. Publishing Firebase rules stays with the product owner.
   - Phase 3 starts from this plan when 2.5 closes, without waiting for a separate implementation prompt.

---

## Status

| Phase | Status |
|---|---|
| 1 — Foundations | **Functionally complete and merged** (`6f70a1e`); production rules published and verified. **Smoke tested on real devices** (product owner, Nov 19, 2026); other release-readiness checks are tracked in Open items and Phase 6. |
| 2 — Moments and Journey | **Complete and merged** to `main` at `9be9957` (Nov 16, 2026); events rules published to production (product owner's confirmation). **Smoke tested on real devices** (Nov 19, 2026). |
| 2b — Feeding sources | **Complete and merged** to `main` at `3ce60b5` (Nov 17, 2026): Stage A design approved (`docs/phase2b-design.md`), B1 data/rules/calculation, B2 screens, and the backend-enforced activation gate. Milk-source rules published to production (product owner's confirmation). **Real-device validation outstanding.** |
| 2.5 — Repository stabilization | **Complete** (Nov 19, 2026). Five passes; findings, decisions and verification in `docs/cleanup-ledger.md`. Approved exceptions: discharge (one baby went home); allowlist moved to a console-only document. |
| 3 — Parent Support | **Complete and merged** (Nov 19, 2026): private check-ins, share / unshare, daily message, parent milestones, resources (US only), privacy policy. All wording approved (`docs/phase3-content.md`). No rules change. **Smoke tested on real devices** (Nov 19, 2026). |
| 4 — Family Support | **Complete and merged** (Nov 19, 2026): family milestones only. The needs list was dropped by the product owner (Nov 19, 2026); `needs` stays a dormant, backed-up collection. |
| 5 — Photos | **Built** on the working branch (Nov 20, 2026), moments only (product owner's scope, Nov 19): up to 6 photos per moment, timeline thumbnails, viewer, delete with Undo, offline, usage in Settings, backup lists photo metadata. Check-in photos and the ZIP backup are deferred. **Needs a rules publish before merge.** |
| 6 | Planned. |

---

## Binding product rules (unchanged)
- Two babies per family, Baby A and Baby B. Baby-specific records use baby index `i` (0 or 1), never names.
- All data lives under `households/{familyId}/…`. Every record identifies its creator through `by`.
- Separate accounts per family member, shared family access (invite codes).
- Offline-first. Every control is at least 44 px. Light, dark and night themes. Large text intact. Usable one-handed at 2 AM.
- No medical advice, clinical thresholds or discharge-readiness claims. Label estimates as estimates.
- Feeding, weight, pumping and day-boundary rules stay unchanged.
- No personal names or data in this public repository.
- Keep the `window.Store` abstraction: add methods, don't break existing ones.
- No unnecessary external dependencies.

## Decisions (product owner)

| # | Decision | Choice |
|---|---|---|
| D1 | Navigation | Today · Growth · Milk · **Journey** · **More**. Progress becomes the top of Journey. Records / Care / Settings move under More, with Support added there in Phase 3. |
| D2 | Firebase plan | **Stay on the free Spark plan.** No pay-as-you-go. |
| D3 | Photo limits | Up to **6 photos per moment**. Re-encoded on the phone to **1600 px on the long side** (JPEG, ~200–350 KB) plus a ~320 px thumbnail. Originals are not stored; re-encoding strips GPS and other metadata. |
| D4 | Photo storage and access | **Photos are stored in Firestore** (not Firebase Storage, which needs pay-as-you-go). They're covered by the same family rules, offline write queue, backup and deletion as every other record. |
| D5 | Check-in privacy | Private check-ins are stored in the family database under an **owner-only** subtree `households/{hid}/private/{uid}/…`. Nobody else can read them, including other family members. Encrypted at rest by Google, not end-to-end. |
| D6 | Sharing a check-in | Sharing writes an **explicit copy** into the family-visible journey (`events`); unsharing deletes the copy. The private original is never readable by others. |
| D7 | Grandparent / supporter access | **Deferred.** All members keep equal access. |
| D8 | Milestone and support wording | **Claude drafts, product owner approves** before it ships. Family language, no clinical terms. |
| D9 | Data-derived "firsts" | **Suggested only.** "Add to journey?" Nothing is saved unless a parent taps it. |
| D10 | Leaving a family | A leaving or removed member's **private check-ins are deleted**. Anything they shared stays in the family journey. |
| D11 | Rename to NICUlog | **Last phase** (Phase 6). Check name and App Store availability before then. |
| D12 | Phase 2–3 acceptance criteria and sequence | **Approved as written in the Phase 2 and Phase 3 sections below** (Nov 15, 2026). |
| D13 | Finding a shared check-in's copy | The private check-in stores the copy's event id (`sharedEv`). The family copy carries **no** id or link back to the private document (`ref: null`), so the partner never sees a pointer into private data. |
| D14 | Shape of a shared check-in | `kind: "journal"`, `scope: "parent"`, `i: null`. Optional provenance field `src: "checkin"`: a fixed marker that carries no private information (no id, no link, nothing the parent didn't choose to share). The security rules validate `src` (absent, `null` or exactly `"checkin"`). The Phase 2 `events` schema must accept it. |
| D16 | Phase 2 content | The milestone and firsts catalog in **`docs/phase2-catalog.md`** is approved (Nov 16, 2026) and is the content source of truth for Phase 2. It includes the vertical dot timeline, the "First donor milk feed" milestone, the checklist label fix "Open crib, maintaining temperature" (text only; id `crib` unchanged), and no per-milestone prompts or interval weight milestones. |
| D17 | Donor milk and feeding sources | Donor milk becomes a feeding option across the app, not just a milestone, delivered as **its own phase, Phase 2b — Feeding sources**, after Phase 2 and before Phase 3. |
| D18 | Repository stabilization | **Phase 2.5 — Repository stabilization**, after Phase 2b and before Phase 3: five cleanup passes, each audited, approved, fixed, verified and reported before the next, recorded in a Cleanup Ledger. Stabilization only: no redesign and no new features. The goal is to clean up everything accumulated over several iterations of changes; as part of that, each pass also identifies what can be removed (features, code, tests or process steps that aren't needed), and anything is removed only with the product owner's explicit approval. |
| D15 | Privacy policy timing | The check-ins and support-resources sections of `privacy.html` ship **with Phase 3**, not Phase 6, so the policy is never behind the app. Phase 6 keeps photos, the support email and the App Store labels. |

### Consequences of these decisions
- **Private-data security (done in Phase 1):** the catch-all data rule excludes `private`, and the owner-only `private/{uid}` subtree is live in production.
- **Shared free tier:** the Spark limits are 1 GiB stored, 50k reads/day, 20k writes/day and 10 GiB downloads/month, **per Firebase project, shared by every family**. That's ample for one family (roughly 3,000–4,000 photos at D3 sizes). At App Store scale, storage will cost money with any provider; revisit before launch.
- **Removal and private data:** on removal by the owner, the removed person's private check-ins can only be deleted by that person (owner-only rules). They're deleted the next time the removed person opens the app (`Store.family()` detects the removal). The privacy policy must say this (Phase 3, D15).

---

## Phases

Each phase ends shippable, keeps all existing tests green, adds tests, updates `CLAUDE.md`, and **stops for product-owner approval**.

**Acceptance for every phase:**
- All existing checks green in all three suites: browser (`tests/smoke.js`), security rules (`tests/rules/rules.test.js`), and real Store integration (`tests/rules/store.test.js`).
- The new checks are listed in the phase report and are green.
- No change to feeding, weight, pumping, milk or day-boundary results (existing assertions prove this).
- 44 px controls, all three themes and A++ text keep passing, including on new screens.
- Any new rule is mutation-checked (deliberately weakened in a scratch copy, and the tests fail).
- No personal data in the repo; `CLAUDE.md` updated; `sw.js` cache bumped.

### Phase 1 — Foundations — **complete and merged; smoke tested on real devices**
- **Shipped:**
  - Navigation per D1: Journey / More, with tab ids unchanged.
  - The catch-all rule excludes `members`, `private` and `revoked`.
  - An owner-only `private/{uid}` subtree with the removed-member cleanup exception.
  - `Store.patch`, `watchPrivate` / `putPrivate` / `removePrivate`, and `Store.lists`.
  - Leave, removal and account deletion clean up the user's own private data and fail closed.
  - Removal rotates the invite code before membership is deleted.
  - Permanent legacy-allowlist revocation, including re-invite and second removal.
  - Backup format 2.
- **Merged:** `main` = `6f70a1e`. Independently confirmed with `git ls-remote` on Nov 15, 2026: both `main` and the working branch point to `6f70a1e`, and the trees are identical.
- **Firebase rules:** published by the product owner and verified read-only on Nov 15, 2026.
  - The deployed text matches `firestore.rules` at `6f70a1e`; the only difference is the two real allowlist emails, which are lowercase.
  - Both emulator suites passed against the deployed text (rules 50/50, real Store 50/50). Nothing was changed in production during verification.
- **Tests at completion:** browser 176/176, rules 50/50, real Store 50/50. All eight mutation checks are caught.
- **Real devices:** smoke tested and functional (product owner, Nov 19, 2026). **Not yet done:** release-readiness work (device testing, App Check, privacy labels, bundle id, support email) is not complete; see Open items and Phase 6. "Complete" here means the Phase 1 scope is built, tested, merged and its rules are live, not that the app is release-ready.

### Phase 2 — Moments and Journey — **complete and merged; smoke tested on real devices**
- **Merged:** `main` = `9be9957` (Nov 16, 2026), a fast-forward of `26aeced`, `ec7af7d`, `ee238c2` (plus the roadmap commit `9be9957`).
- **Rules:** the events validation rules were published to production (product owner's confirmation).
- **Real devices:** smoke tested and functional (product owner, Nov 19, 2026).
- **Tests at completion:** browser 221/221, rules 56/56, real Store 53/53; three events-rule mutations and the Undo-guard mutation were caught.
- **Carried forward** (Phase 2.5 / release readiness):
  - VoiceOver testing;
  - timeline performance with months of data;
  - timeline placement low on the Journey tab;
  - no jump-to-date or search;
  - "Not now" remembered per phone only.

**Scope**
- **`events` collection:**
  ```
  households/{hid}/events/e-{epochMs}-{rand4}
  { kind: "milestone"|"journal"|"moment", scope: "baby"|"parent"|"family", i: 0|1|null, key: string|null,
    t, title (≤120), note (≤2000), ref: {col, id}|null, src: "checkin"|null, by, createdT, editT, editBy }
  ```
  - `i` is required (0 or 1) when `scope` is `"baby"`, and `null` otherwise.
  - `src: "checkin"` is reserved for Phase 3 shared check-ins (D14). Phase 2 must accept and display such events, but doesn't create them.
  - **Security rules validate the `events` shape** (D14): `src` absent, `null` or exactly `"checkin"`; `i` in `[0, 1, null]`; `kind` and `scope` from the allowed values. Emulator tests and a mutation check cover it.
- **Curated milestone lists** (D8), kept in code next to `DIS_BABY` / `DIS_FAM`, exactly as approved in `docs/phase2-catalog.md` (D16). That file also defines the firsts and date-milestone rules, the timeline wording and the vertical dot timeline design.
- **"Add moment" sheet:** baby A / baby B / parent / family; milestone or free text; editable date.
- **`buildTimeline()`:** a pure function over in-memory state (`F`, `W`, `CK`, `PLANS`, `QS`, `P`, `D`, events). No copies; feeds and pumping appear as daily summaries.
  - Shown on Journey below the existing Progress content.
  - Follows the baby selector.
- **Data-derived "firsts"** (D9): suggestions only, saved with `ref` to the source record.
- **Concurrency:**
  - Edit and delete with Undo.
  - The overwrite guard: the `otherTook` pattern on `editT` / `editBy`.
  - `Store.patch` for field-level merges.
  - Edit vs delete: delete wins; the deleter's Undo restores it; an editor saving a deleted event is asked "deleted by X — save as new?".

**Dependencies**

| Needs | Status |
|---|---|
| `Store.patch` | Done (Phase 1) |
| `events` in `Store.lists.shared` (deletion + backup), watched in `startData` (`RAW.events`) | Done (Phase 1) |
| `otherTook`, `undoBar`, undo-returns-false | Present in the app |
| Journey tab | Done (Phase 1) |
| Milestone + firsts wording approved (D8) | **First gate: approved before implementation begins** |

**Acceptance criteria** (in addition to the every-phase list)
1. Add, edit and delete a moment for each scope (baby A, baby B, parent, family), each with Undo.
2. The overwrite guard prompts when the other parent edited the same event; the edit-vs-delete case behaves as specified.
3. The timeline merges all sources in chronological order, with no duplicates and no copied records.
4. Feeds and pumping appear as daily summaries.
5. Firsts suggestions appear, and become events with `ref` only when a parent taps "Add to journey?"; dismissing one saves nothing.
6. An event with `src: "checkin"` renders correctly; one with `scope: "baby"` and no valid `i` is rejected; the rules reject any other `src` value or an invalid `kind` / `scope` / `i`.
7. Events with `i` follow the baby selector; the timeline works offline.
8. Events round-trip through backup format 2 and are removed by last-member account deletion; the real Store integration suite covers event create, patch and delete.
9. No wording ships that the product owner hasn't approved.

**Implementation sequence**
1. **Gate:** draft the milestone and firsts wording; the product owner approves it **before implementation begins** (D8).
2. Events data layer: id format, field validation in the app and in the security rules, using the existing `put` / `patch` / `remove`.
3. `buildTimeline()` as a pure function, with unit-level tests.
4. Journey timeline UI below the Progress content.
5. Add / edit / delete sheet with Undo, the overwrite guard and the edit-vs-delete handling.
6. Firsts suggestions.
7. Tests, `CLAUDE.md`, cache bump, report. **Stop for approval.**

### Phase 2b — Feeding sources (D17) — **complete and merged at `3ce60b5`; smoke tested on real devices**
**Scope**
- **Milk type on each feed:** mom's milk, donor milk, formula, or a mix.
  - Set from a family default, like the diet line; changeable with one tap per feed.
  - Recorded by a parent only, never inferred.
- **Milk estimate:** only feeds of mom's milk draw down her NICU stock; donor milk and formula feeds don't.
- **Existing feeds stay "not recorded"** and keep today's maths, so nothing already logged changes.
- **Shown neutrally everywhere:** Today, Records, the timeline, the CSV export and backup. No milk type is presented as better or expected.

**Dependencies:** Phase 2 approved. A new optional field on `feeds` (a schema addition; existing documents untouched); validation in the security rules if feed rules are tightened.

**Acceptance criteria** (in addition to the every-phase list)
1. A family that never sets a milk type sees exactly today's milk estimate and feed displays.
2. Donor milk and formula feeds don't reduce the mom's-milk stock estimate; mom's-milk and mixed feeds behave as specified.
3. The milk type round-trips through backup and appears in the CSV export without breaking older CSV imports.
4. All milk types use neutral wording and equal visual weight.
5. The overwrite guard and Undo cover milk-type changes.

**Implementation sequence:** to be detailed in the Phase 2b prompt, from this section.

### Phase 2.5 — Repository stabilization (D18)
A stabilization effort, **not a redesign or feature-development phase**. Its goal is to **clean up everything accumulated over several iterations of changes** in Phases 0–2b, so Phase 3 starts from a well-understood codebase. Part of that cleanup is **cutting what isn't needed**: alongside fixes, every pass looks for features, code paths, tests and process steps that aren't earning their keep, and proposes removing them.

**Five passes, in this order**
1. **Architecture:** structure of `index.html`, `firebase-store.js` and the `window.Store` contract; duplicated or dead code; module boundaries within the no-build-step design; naming and comments.
2. **Rules and logic:** `firestore.rules`, lifecycle and cleanup paths, validation parity between the app and the rules, error handling, and edge cases in calculations. Every frozen calculation is re-checked, never changed.
3. **UI and CSS:** design-token usage, unused or conflicting styles (for example specificity overrides and display-rule clashes), accessibility (44 px, contrast, focus, screen-reader labels), and consistency across the light, dark and night themes and at A++ text.
4. **Tests and tooling:** the browser, rules and real-Store suites; flaky or overlapping checks; coverage gaps; test helpers, stubs and scripts; the `native/` build.
5. **Independent final audit:** a fresh review of the whole repository against this plan and the binding rules, done independently of passes 1–4.

**Each pass follows the same gates**
1. **Audit:** findings only, with no changes. Every audit includes a **removal candidates** section (it may be empty).
2. **Findings review and approval:** the product owner decides which findings to fix, remove, defer or reject.
3. **Approved fixes and removals only.**
4. **Full verification:** all three suites, mutation checks for any rule change, and screenshots for any UI change.
5. **Report:** the pass's section of the Cleanup Ledger (findings, decisions, changes, verification) plus a short summary in chat. No separate report document (ledger P1-16).
6. **Approval before the next pass begins.**

**Cleanup Ledger** (`docs/cleanup-ledger.md`, created when the phase starts). For every finding it records: pass, finding, decision (fix / remove / defer / reject, with reason), the change made, the tests that prove it, and any outstanding issue. For a removal it also records what is lost, why it isn't needed, and what replaces it, if anything. It's the record of what was cleaned up, what we chose to stop doing, and why.

**Removals**
- **What can be proposed:** a feature or screen element, a code path, a test, documentation, or a process step (for example a review artifact or gate in a later phase) that isn't needed.
- **Approval:** each removal is approved individually in that pass's findings review, with what is lost stated in plain words. Nothing is removed as a side effect of another change.
- **Security protections are never removed silently.** A removal that touches `firestore.rules` is its own finding, comes with mutation checks proving the remaining protections still hold, and is published separately like any rule change.
- **Stored data is never deleted by a removal.** Removing a feature stops the app reading or writing that data; existing documents stay in place unless a separately approved migration says otherwise. Backups made before a removal still restore.
- **Tests:** the tests that cover a removed behaviour are removed with it, and the ledger links them to the approved removal. Any other test removal still needs a redundancy proof.

**Constraints**
- Preserve all approved functionality, UX, data behavior and security protections, **except approved removals**. No change to feeding, weight, pumping, milk or day-boundary results, to stored data, or to the `window.Store` contract (additions only, or the removal of a method whose only callers were approved for removal).
- **No test is removed** unless its coverage is proven redundant, or it covered a behaviour approved for removal; either is recorded in the ledger.
- No merges or deployments without separate approval. Firebase rule changes, if any, are approved and published separately.

**Acceptance criteria** (in addition to the every-phase list)
1. All five passes complete, each with an approved findings list and a verification record in the Cleanup Ledger.
2. The Cleanup Ledger is complete: every finding has a decision, every fix has the tests that cover it, and every removal records what was lost and why.
3. Test counts never drop without a recorded redundancy proof or a link to an approved removal; all three suites are green at the end of every pass.
4. Screenshots before and after any UI-affecting pass show no unapproved change to the experience.
5. No product behaviour changes except fixes the product owner approved as defects and removals the product owner approved.
6. The independent final audit (pass 5) confirms nothing was removed without approval, and that every removal left stored data and existing backups intact.

### Phase 3 — Parent Support
**Scope**
- **Private check-ins** (`households/{hid}/private/{uid}/checkins`): a 1–5 mood scale plus an optional one-line note.
- **Share and unshare:**
  - "Share with my partner" creates an explicit copy in `events` (D6, D14) and stores its id as `sharedEv` on the private check-in (D13).
  - "Unshare" deletes that copy and clears `sharedEv`.
  - **Offline and interrupted writes must not duplicate or lose anything:**
    - Share first records the copy's id as `sharedEv` on the private check-in, then writes the copy under exactly that id. A retry, an app restart or a delayed sync reuses the same id, so there is at most one copy per check-in.
    - Unshare deletes the copy by that id, then clears `sharedEv`. Both steps are safe to repeat.
    - Sharing and unsharing never delete or overwrite the private check-in's own content.
    - Pending writes made offline sync in order through Firestore's queue. The UI shows the shared state from `sharedEv`, so it stays truthful across reloads.
- **Curated supportive messages** (D8): static text in code, never conditional on clinical data or check-in values. Parent milestones (scope `parent`).
- **Where check-ins appear:** only on the author's own Support screen. They never appear in the Journey timeline (which is built from shared collections only), in Records, in partner-facing views or notifications, in the CSV export, or in any family-level data surface. A shared copy appears in the family journey like any other event.
- **Resources page** under More → Support: static, reviewed links.
  - A crisis line is always visible without scrolling. 988 is the US line; markets beyond the US need country handling (see Open items).
  - Non-diagnostic wording, no scoring, no alerts, nothing sent automatically.
- **Privacy policy (D15):** add check-ins (private, not end-to-end encrypted, deleted when you leave or are removed; shared copies stay) and support resources.

**Dependencies**

| Needs | Status |
|---|---|
| Owner-only private subtree, rules, removed-member cleanup | Done (Phase 1); published and verified in production |
| `watchPrivate` / `putPrivate` / `removePrivate`; `checkins` in `Store.lists.private`; backup + purge coverage | Done (Phase 1) |
| `events` with D14 support | **Phase 2** (must be approved first) |
| Phase 2b | Approved before Phase 3 begins |
| Phase 2.5 | Approved before Phase 3 begins |
| More → Support section | Built in this phase |
| Support messages, parent milestones and resource list approved (D8) | **Required before Phase 3 ships** |
| Market decision for crisis resources | **Required before Phase 3 ships** |
| Phase 2 events rules validation (D14) | **Phase 2** |

**Acceptance criteria** (in addition to the every-phase list)
1. A check-in is invisible to the other parent at the stub, rules and real-Store levels.
2. **Private check-ins never appear in any shared surface.** Each is tested explicitly:
   - partner-facing views (Today, Journey, Records, Care, Settings family card) and the "other parent logged…" notification;
   - shared exports: the CSV export, and a full backup taken by the partner;
   - timeline queries: `buildTimeline()` never includes private check-ins, including for their author;
   - family-level backups and any other shared collection (`events` contains only explicit shared copies).
   The author's own full backup includes their own private data, as designed in Phase 1.
3. Share creates exactly one family copy; unshare removes it; the copy has `ref: null`, `src` only `"checkin"`, and no private id.
4. **Offline and interrupted sharing:**
   - a failure injected between recording `sharedEv` and writing the copy, then a retry, gives exactly one copy;
   - sharing while offline, then reconnecting, gives exactly one copy;
   - unsharing while offline removes the copy once reconnected;
   - repeated share / unshare / share leaves at most one copy;
   - the private check-in's content is unchanged throughout.
5. Leave, removal and account deletion purge the user's check-ins; shared copies stay.
6. No check-in value changes any other screen or triggers any message, alert or send.
7. The crisis line is visible without scrolling; the resources page renders with no network.
8. `privacy.html` describes check-ins and resources as shipped.
9. No wording ships that the product owner hasn't approved.

**Implementation sequence**
1. Draft the support messages, parent milestones and resource list for product-owner approval (D8).
2. Check-in data and UI under More → Support.
3. Share / unshare (D13, D14), including the offline and retry handling.
4. Supportive messages.
5. Resources page.
6. Privacy policy update (D15).
7. Tests, `CLAUDE.md`, cache bump, report. **Stop for approval.**

### Phase 4 — Family Support (deliberately small)
- ~~`needs` list~~ — **dropped by the product owner (Nov 19, 2026):** with no supporter role (D7) it would only be shared between the two parents, who already coordinate directly. The `needs` collection stays as dormant groundwork (watched and backed up; no screen, no writer).
- Shared family milestones (events, scope `family`), **approved Nov 19, 2026:** First family photo · First time we were all together · Big brother or sister's first visit · First visit from friends · Nursery ready · Last day in the NICU · First night all home together (plus the existing "First time holding both babies at once"). No supporter role (D7).

### Phase 5 — Photos (in Firestore, D3/D4)
- **Data model:**
  - `households/{hid}/photos/ph-{epochMs}-{rand4}` → `{ ev, t, w, h, bytes, thumb: Bytes (~320 px JPEG), by, deletedT? }`
  - `households/{hid}/photoData/{same id}` → `{ full: Bytes (≤1600 px JPEG, < 900 KB) }`, loaded on demand when a photo is opened, never watched wholesale.
  - Private photos (attached to a private check-in) mirror this under `private/{uid}/photos` and `private/{uid}/photoData`.
- **On the phone:** `createImageBitmap`, then canvas, then JPEG, one photo at a time; a hard size check before writing (Firestore's document limit is 1 MiB).
- **Offline:** Firestore's offline write queue handles it, so no custom upload queue. Consider raising the local cache size.
- **Read budget:** thumbnails are loaded per event or per visible day (a new `Store` query or get method), not by watching the whole collection, so reads stay inside the free tier.
- **Capture:** camera and library via `<input type=file accept="image/*" [capture] [multiple]>`. iOS `Info.plist` needs `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
- **Deletion:** soft delete with Undo, then the deleting phone purges `photoData` and the metadata.
- **Backup:** an optional "Backup with photos" ZIP (uncompressed STORE format, hand-written writer and reader, no library) holding `backup.json` and `photos/{id}.jpg`. The default JSON backup carries photo metadata only.
- New collections are added to `Store.lists`, so deletion, cleanup and backup cover them.
- **Scope decided Nov 19, 2026 (product owner):** moments only. Deferred until missed: private check-in photos (`private/{uid}/photos`, `photoData`) and the ZIP "Backup with photos". Usage is shown in Settings ("Photos: N · about X MB of the 1 GB free storage"); no hard limit.

### Phase 6 — NICUlog rebrand, iOS hardening, privacy
- **Rename** the title, brand eyebrow, manifest, `capacitor.config.json` `appName` and `privacy.html`. Keep localStorage keys and the backup `app` tag (`"twins-tracker"`, plus accept `"niculog"`).
- **iOS:** `@capacitor/filesystem` + `@capacitor/share` for saving backups, Firebase App Check, the bundle id, and an on-device test pass on a Mac.
- **Privacy policy:**
  - Add photos (stored in the database, metadata stripped).
  - Fix the support email.
  - Update the App Store privacy labels.
  - Check-ins and support resources are already covered (Phase 3, D15).

---

## Open items
- **Original family owner:** check in the Firebase console whether `households/main` exists and who its `owner` is. Whoever first taps "New code" or "Remove" becomes the owner.
- **Account sign-up:** confirm it's enabled in Firebase Authentication if new families should be able to join.
- **Wording approvals (D8):** Phase 2 catalog approved (D16); Phase 3 messages, parent milestones and resources approved (`docs/phase3-content.md`, Nov 19, 2026).
- **Future requirement: multiple birth vs NICU admission.** The app must eventually distinguish **how many babies were born** in the multiple birth from **how many were admitted to the NICU** (for example, twins with only one baby admitted).
  - **It will affect:** conditional milestones (`holding-both`); which babies appear in Today, Growth, the timeline and firsts; the setup screen; milk-need maths; the backup format.
  - **Not scheduled yet.** Phase 2 keeps the two-baby model and writes `holding-both` as a real "more than one baby in the record" check, so the later change is contained.
- **Market decision:** US-only, or more countries? This determines crisis resources and country handling in Phase 3.
- **Name availability for "NICUlog"** (trademark, App Store) before Phase 6.
- **`SUPPORT_EMAIL` placeholder** in `privacy.html`.
