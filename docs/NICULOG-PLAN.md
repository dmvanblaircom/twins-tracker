# NICUlog — approved plan

**Track the baby. Support the parents. Recognize the journey.**

This is the source of truth for NICUlog direction. It records the product owner's decisions on the Phase 0 audit (`docs/niculog-phase0-audit.md`) and the revised phase plan. Where the audit says otherwise, this file wins. Project context and current architecture are in `CLAUDE.md`.

Last updated: Nov 15, 2026.

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

## Decisions (product owner, Nov 15, 2026)

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

### Consequences of these decisions
- **Security fix first:** the current catch-all data rule lets any member read anything under the family, including a `private/` path. This was verified in the Firestore emulator. Phase 1 must fix it before any private data exists.
- **Shared free tier:** the Spark limits are 1 GiB stored, 50k reads/day, 20k writes/day and 10 GiB downloads/month, **per Firebase project, shared by every family**. That's ample for one family (roughly 3,000–4,000 photos at D3 sizes). At App Store scale, storage will cost money with any provider; revisit before launch.
- **Removal and private data:** on removal by the owner, the removed person's private check-ins can only be deleted by that person (owner-only rules). They're deleted the next time the removed person opens the app (`Store.family()` detects the removal). The privacy policy must say this.

---

## Revised phases

Each phase ends shippable, keeps all existing tests green, adds tests, updates `CLAUDE.md`, and **stops for product-owner approval**.

### Phase 1 — Foundations
- **Rules:** the catch-all data rule excludes `private`, and a new owner-only `private/{uid}/**` match is added. Emulator tests cover it.
- **`window.Store` additions:** `patch` (merge write), `watchPrivate` / `putPrivate` / `removePrivate`. The test stub mirrors them.
- **Account deletion and leaving** cover the new collections (`events`, `needs`, later `photos` / `photoData`) and the leaver's own private subtree (D10).
- **Navigation** per D1. Tab ids `feed`, `weight` and `milk` stay; `trends` becomes Journey, and `more` becomes More (Records / Care / Settings).
- **Backup format 2 skeleton:** new collections plus the user's own private subtree. Format 1 backups still restore; old apps ignore the unknown keys.
- No new user-facing features beyond navigation.

### Phase 2 — Moments and Journey
- `events` collection:
  ```
  households/{hid}/events/e-{epochMs}-{rand4}
  { kind: "milestone"|"journal"|"moment", scope: "baby"|"parent"|"family", i: 0|1|null, key: string|null,
    t, title (≤120), note (≤2000), ref: {col, id}|null, by, createdT, editT, editBy }
  ```
- Curated milestone lists (D8) next to `DIS_BABY` / `DIS_FAM`. "Add moment" sheet; editable date.
- `buildTimeline()` is a pure function over in-memory state (`F`, `W`, `CK`, `PLANS`, `QS`, `P`, `D`, events). No copies; feeds and pumps appear as daily summaries.
- Data-derived "firsts" (D9) are suggestions, saved with `ref` to the source record.
- Edit and delete with Undo; the overwrite guard (`otherTook` pattern on `editT` / `editBy`); `Store.patch` for field-level merges.

### Phase 3 — Parent Support
- **Private check-ins** (`households/{hid}/private/{uid}/checkins`): 1–5 mood scale plus an optional one-line note. "Share with my partner" creates an explicit copy in `events` (D6).
- **Curated supportive messages** (D8): static text in code, never conditional on clinical data. Parent milestones (scope `parent`).
- **Resources page** under More → Support: static, reviewed links. A crisis line (988 in the US) is always visible. Non-diagnostic wording, no scoring, no alerts, nothing sent automatically.

### Phase 4 — Family Support (deliberately small)
- `needs` list: text, optional date, `claimBy`, done. Meals, rides, pumping supplies, sibling pickup. Claim conflicts use the `otherTook` pattern.
- Shared family milestones (events, scope `family`). No supporter role (D7).

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

### Phase 6 — NICUlog rebrand, iOS hardening, privacy
- **Rename** the title, brand eyebrow, manifest, `capacitor.config.json` `appName` and `privacy.html`. Keep localStorage keys and the backup `app` tag (`"twins-tracker"`, plus accept `"niculog"`).
- **iOS:** `@capacitor/filesystem` + `@capacitor/share` for saving backups, Firebase App Check, the bundle id, and an on-device test pass on a Mac.
- **Privacy policy:**
  - Add photos (stored in the database, metadata stripped).
  - Add check-ins (private, not end-to-end encrypted, deleted on leaving or removal).
  - Add support resources.
  - Fix the support email.
  - Update the App Store privacy labels.

---

## Open items
- Name availability for "NICUlog" (trademark, App Store) before Phase 6.
- `SUPPORT_EMAIL` placeholder in `privacy.html`.
- Firebase console steps from the family-accounts release (publish rules, enable sign-up) if not done yet.
