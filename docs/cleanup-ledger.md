# Cleanup Ledger — Phase 2.5 Repository stabilization

Governed by `docs/NICULOG-PLAN.md` (D18, Phase 2.5). The goal is to clean up everything accumulated over several iterations of changes in Phases 0–2b; as part of that, each pass may propose removals. Every approved behaviour, data rule and security protection is preserved, except removals the product owner approves individually.

## How to read this ledger
- **One row per finding**, with a stable ID: `P{pass}-{nn}`.
- **Recommendation** is Claude's; **Decision** is the product owner's: **Fix** · **Remove** · **Defer** (with target) · **Reject** (with reason).
- **Status:** Open → Approved → Done → Verified → Closed. Deferred and rejected findings stay on record.
- **Every fix and removal lists the tests that prove it.** A test is removed only with a redundancy proof or a link to an approved removal (section 4).
- **Removals** also record what is lost, why it isn't needed, and what replaces it, if anything.

## 1. Pass log
| Pass | Scope | Audit date | Findings | Fix / Remove / Defer / Reject | Verified | Approved to continue |
|---|---|---|---|---|---|---|
| 1 | Architecture | Nov 17, 2026 (baseline `3ce60b5`) | 16 | awaiting decisions | | |
| 2 | Rules and logic | | | | | |
| 3 | UI and CSS | | | | | |
| 4 | Tests and tooling | | | | | |
| 5 | Independent final audit | | | | | |

**Severity:** High = could lose or expose data, break security, or produce wrong care numbers · Med = a real defect or maintenance risk with no data or security impact · Low = clarity, duplication or style.

## 2. Findings — Pass 1 (Architecture)
Baseline: `main` = `3ce60b5`. Sizes: `index.html` 2,647 lines (442 CSS, 1,893 JS), `firebase-store.js` 303, `milk-sources.js` 209, `tests/stub-store.js` 103. No High findings.

| ID | Area | Finding | Sev. | Recommendation | Decision | Status |
|---|---|---|---|---|---|---|
| P1-01 | `index.html` structure | Phase 2b code sits inside the "milk log" section in three separate blocks (engine wiring, logic API, screens), between the milk state and `renderMilk`. Its headers are stale ("the screens that call these arrive in Phase 2b B2"). | Med | **Fix**: move it, unchanged, into one "milk sources" section after Milk; update the headers. A move only, no logic change. | | Open |
| P1-02 | Comments | Comments and CSS headers carry old phase labels that no longer match the plan: "Progress + Records (Phase 3)" (Phase 3 is now Parent Support), "Collections with no screen yet (events, needs: Phase 2+)" (events has a screen), "Today (Phase 1)", etc. | Low | **Fix**: name sections by feature, not phase; correct the stale statements. Comments only. | | Open |
| P1-03 | Dead code | `wtSub` (`index.html`) is defined and never used. | Low | **Remove**: nothing is lost. | | Open |
| P1-04 | Duplicated schedule logic | The feed-slot formula exists twice (`setSchedule` and `MilkSources.slotHours`), as does the stray-feed window (`slotFeed` and `strayWin`). | Med | **Fix**: `setSchedule` uses `MilkSources.slotHours`; `slotFeed` uses `strayWin()`. Same formulas, one copy each. Proven by the existing equivalence tests (108 schedules × 4 windows) and the frozen-calculation suites. | | Open |
| P1-05 | Duplicated helpers | `pad`, `dKey`, `keyDate` and `hrOk` exist in both `index.html` and `milk-sources.js`. | Low | **Reject**: they're one-liners, and the copies keep the engine self-contained, so the Node tests can load it without the page. | | Open |
| P1-06 | Readability | `TWINS[0]==="A"` is used 14 times as an unexplained "profile not loaded yet" check. | Low | **Fix**: one named helper (e.g. `profileReady()`). | | Open |
| P1-07 | `window.Store` contract | Two styles side by side: older per-collection methods (`watchWeights`, `watchFeeds`, `setWeight`, `delWeight`, `setFeed`, `delFeed`, `watchDiet`, `setDiet`, `watchProfile`, `setProfile`) and generic ones (`watch`, `put`, `remove`, `watchConfig`, `setConfig`). **Removal candidate.** | Low | **Reject removal; document it**: collapsing them touches every write path, the stub and the tests, with no benefit to you. Instead, add a one-paragraph contract summary to `CLAUDE.md`. | | Open |
| P1-08 | Naming | `clients`, the activation field `phones`, `markClient`, `phoneReady`, `phoneList` and the CSS `.phones` all mean member **accounts**, not devices. | Low | **Fix** the internal names that aren't stored (`phoneList` → `memberList`, `.phones` → `.members`, `phoneReady` → `accountReady` in rules and tests). **Reject** renaming the stored names (`clients`, `phones`): that needs a rules change plus a data migration, for no benefit. Document the meaning in `CLAUDE.md`. | | Open |
| P1-09 | Test hooks in production | `window.__nicu` and `window.__nicu.src` (which includes write functions) ship in the production app. They grant nothing beyond the same rules and screens, but they're test surface in production. | Low | **Reject removal; document it**: tests depend on them, and they don't widen access. Mark them clearly as test hooks in the code. | | Open |
| P1-10 | `needs` collection | Watched, backed up and deleted with the family, but nothing writes it and no screen shows it. It's groundwork for Phase 4 (a family needs list). **Removal candidate.** | Low | **Defer** to the Phase 4 decision: keep it if Phase 4 stays; remove the watch and backup entry if Phase 4 is cut. No stored data exists. | | Open |
| P1-11 | Docs | `docs/STATUS-2026-11-15.md` is a superseded summary for outside reviewers; the plan replaced it. **Removal candidate.** | Low | **Remove**: git history keeps it. Update the `CLAUDE.md` pointer. | | Open |
| P1-12 | `CLAUDE.md` drift | Stale facts ("~55 checks"; the smoke suite now has 221), old phase labels in screen descriptions, a single ~1,500-word UI paragraph, and Phase 1 and 2b Store notes interleaved. | Med | **Fix**: restructure and correct `CLAUDE.md`, keeping every fact (docs only). | | Open |
| P1-13 | File size | `index.html` is one 2,647-line file (no build step). Option: split more pure modules out, like `milk-sources.js` (e.g. the Journey timeline builder). | Low | **Reject**: the no-build design works, each split adds to the offline-cache and iOS file lists, and P1-01/P1-02 make the file navigable. | | Open |
| P1-14 | Rules comments | In `firestore.rules`, the version-marker comment sits above the `config` block instead of `clients`, and the catch-all comment doesn't mention `config`. | Low | **Defer to pass 2** (rules), with any other rules finding, so the rules change and publish once. | | Open |
| P1-15 | Unused Store method | `Store.removePrivate` isn't called by the app (it's Phase 3 check-in groundwork; covered by tests). **Removal candidate.** | Low | **Defer** to Phase 3: keep while Phase 3 is planned. | | Open |
| P1-16 | Process | The plan asks for a separate before/after report each pass **and** this ledger, which largely duplicate each other. **Removal candidate (process).** | Low | **Remove the separate report**: the ledger's pass section (findings, decisions, verification) plus a short chat summary is the report. The plan text would change accordingly (docs only). | | Open |

## 3. Verification record (one block per pass)
_Pass 1: filled in after the approved changes are made._
- **Suites:** browser x/x · rules x/x · real Store x/x (counts before → after).
- **Mutation checks:** for any rule or lifecycle change.
- **Frozen calculations:** feeding, weight, pumping, milk and day-boundary outputs confirmed unchanged.
- **Screenshots:** for any UI-affecting change.
- **Data:** stored data, the backup format and the `window.Store` contract confirmed unchanged (additions only, or removals tied to an approved finding).

## 4. Test changes and redundancy proofs
| Test (file : name) | Change | Why | Redundancy proof or approved removal |
|---|---|---|---|

## 5. Outstanding issues carried forward
| ID | Issue | Why not fixed in Phase 2.5 | Target |
|---|---|---|---|
| CF-01 | VoiceOver / screen-reader testing not done | Needs a real iOS device | Release readiness |
| CF-02 | Real-device validation outstanding for Phases 1, 2 and 2b | Needs the product owner's devices | Release readiness |
| CF-03 | Journey timeline performance with months of data not measured | Needs long-running data | Pass 4, or release readiness |
| CF-04 | Journey timeline sits low on the Journey tab | Placement approved as is; revisit after real use | Product decision |
| CF-05 | An old-app last-member account deletion leaves `config/sources` behind (inaccessible family) | Found in the 2b security review | Pass 2 |
| CF-06 | `slotFeed` takes the first feed within the stray window; the milk-source `feedAt` takes the nearest. They can disagree when two off-schedule feeds fall in one window. | Logic, not architecture | Pass 2 |
