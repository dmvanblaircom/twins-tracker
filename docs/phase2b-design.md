# Phase 2b — Feeding sources: approved Stage A design

**Approved by the product owner:** Stage A revision 3, decisions D-1 to D-8, plus three binding guardrails:
1. Historical estimates use the schedule and source configuration applicable to their period. Historical feeding data is never retroactively reinterpreted.
2. Source allocations reconcile deterministically, with consistent results across devices and no silent overwrites.
3. Both phones are updated before milk-source tracking begins. Old-version schedule changes are identified and communicated, never silently assigned an assumed effective time (this supersedes the "from the time the new app first sees it" part of D-4).

Stage B is split: **B1** (data model, rules, calculation, tests; no UI) and **B2** (screens). The proposal follows unchanged.

---


## 0. Carried forward
**Product decisions [approved]:**
- **Label:** Mother's milk · Donor milk · Formula.
- **Usual milk** per baby, with history.
- **Mixed feeds** record actual mL per source; a mixed feed never counts in full.
- **Need / day** counts mother's milk only.
- **Per-feed control** on Today (compact) and in Records.
- **Journey** shows a source only when the whole day is one source.
- **F1** deferred to Phase 2.5.

**Technical decisions [approved in principle]:**
- **T-1:** a separate per-occurrence collection.
- **T-2:** defaults as percentages.
- **T-3:** one-tap single source.
- **T-4:** rules validation.
- **T-5:** CSV columns.
- **T-6:** no backdating.
- **T-7:** preserve unknown fields.

**Changed by this revision:**
- **T-8 is replaced** by occurrence-based allocations with schedule history (section 5).
- **T-9 (the 300 mL cap) is removed.** The only bound left is the one the app already enforces (section 8).

**Binding:**
- Existing feeds stay Not recorded: no backfill and no recalculation.
- A family that never configures sources sees exactly today's estimate.
- Feeding totals, weights, pumping, drop-offs and the day boundary are unchanged.

---

## 1. How the estimate works today (audit facts this design depends on)
- **`usedSince()` (`index.html:1893`)** walks every scheduled feed time between the estimate's start and now. It subtracts `FULL[baby]` at each one, logged or not. It's purely schedule-driven.
- **The schedule is a single current value** (`profile.schedule` + `twins[].slotMin` + `fullMl`).
  - `setSchedule()` (`:1040`) builds one grid, `SLOT_H`.
  - `slotT()` (`:1046`) turns (baby, feed day, slot) into an epoch time.
- **Consequence:** today, changing feed times or a full-feed amount **re-runs the whole estimate window on the new schedule**. Past estimates change retroactively.
  - **This is existing behaviour.** For families that never configure sources it stays exactly as it is (binding).
  - **For families that do configure sources**, this revision stops it, as you asked (section 5).
- **Feed entry is limited to 0–150 mL** by mouth (`saveSlot`, `:1101`; CSV import, `:1488`). The setup screen puts no cap on the full-feed amount.
- **Writes:** `Store.put` overwrites. `Store.patch` updates and fails if the document is missing. Late rejections arrive as a `store-error` event (`firebase-store.js:61`).

---

## 2. Two quantities, kept separate [proposed]
| | **Actual** (what was recorded) | **Scheduled** (basis of the stock estimate) |
|---|---|---|
| **What it is** | The feed record's by-mouth mL (`feeds.v`, unchanged), plus the **actual source composition** the parent records | That baby's **scheduled feed amount** (full feed) at that feed time, from the schedule in effect then |
| **Used for** | Feeding totals, % of target, mL/kg/day, Records, Journey (all unchanged); source display | **Only** the milk-stock estimate and Need / day |
| **Changed by 2b?** | No. A source allocation never changes `v` or any feeding total | Only the share of it charged to mother's stock |

**The rule:** at each scheduled feed occurrence, the stock is charged **the scheduled amount × the mother's-milk share** of that occurrence's composition. The actual composition supplies the **proportions only**.

**Your example:**
- **The feed:** scheduled 60 mL; recorded 45 mL = 30 mother's + 10 donor + 5 formula.
- **Stock charge:** 60 × 30/45 = **40.0 mL** of mother's milk.
- **The rest of the 60 mL, for the working only:** 13.3 donor milk + 6.7 formula.
- **The feed record stays 45 mL.** By-mouth totals still count 45. Nothing on screen says or implies 60 mL was taken.
- **Wording on the Milk tab:** "scheduled feed amounts, split by recorded source". Records and Today show the actual "30 / 10 / 5 mL".

---

## 3. Data model [proposed]
All of these live under `households/{hid}/` and join `Store.lists.shared`. That puts them in backup, restore and last-member deletion automatically.

### 3.1 `slotMilk/b{i}-{t}`: a source allocation for one scheduled occurrence (T-1)
```
{ i: 0|1,
  t: epochMs,                      // the scheduled occurrence time (not a logged time)
  state: "set" | "usual",          // "usual" = this occurrence follows the usual-milk default again
  mL10: { mom, donor, formula },   // integers, tenths of a mL (state "set"); null when "usual"
  total10: int,                    // = mom + donor + formula (state "set"); null when "usual"
  basis: "feed" | "scheduled",     // what total10 reconciles to (section 7); null when "usual"
  rev: int,                        // 1 on create, +1 on every change (conflict guard, section 9)
  by, editT, editBy }
```
- **The id is derived from `(i, t)`**, so one occurrence can never have two allocations, and a retried offline write lands on the same document.
- **Amounts are stored as integer tenths of a mL,** so sums are exact (no floating point) and the rules can check them exactly.
- **"Use usual milk" is an update to `state: "usual"`, not a delete,** so it goes through the same conflict guard. Documents are hard-deleted only by account or family deletion.

### 3.2 `milkUsual/u-{i}-{from}-{r4}`: usual-milk history (T-2, T-6)
```
{ i: 0|1, from: epochMs, pct: { mom, donor, formula } | null, by }
```
- **`pct`:** whole numbers 0–100 that total **exactly 100**. `null` means "Not recorded from here on".
- **In effect at time t:** the entry with the greatest `from ≤ t` for that baby. If two share a `from`, the greater id wins (deterministic).
- **Append-only:** create, and delete for Undo or lifecycle; never update. `from` is the save time; no backdating.
- **Shape change from revision 2 [D-5]:** this was a list inside `config/milkUsual`. One document per entry means two parents adding entries at once (or offline) can't overwrite each other's list, and each write is idempotent.

### 3.3 `schedPeriods/s-{from}-{r4}`: schedule history for families that use sources (replaces T-8)
```
{ from: epochMs (0 = all earlier time),
  everyH: 2|3|4, startH: 0–23, dayH: 0–12,
  slotMin: [0|30, 0|30],           // per baby index
  full10: [int, int],              // scheduled amount per baby, tenths of a mL
  src: "setup" | "first-use" | "observed", by }
```
- **In effect at time t:** the period with the greatest `from ≤ t` (ties broken by id).
- **Append-only,** like 3.2.

---

## 4. Occurrences: integrating with the existing schedule model [proposed]
- **Today's model:** one grid (`SLOT_H`, `SLOT_M`, `FULL`), applied to all time.
- **The new model generalises it:** a **sequence of periods**, each holding exactly the values today's grid is built from.
- **Generating a period's occurrences:**
  - Each period generates occurrences with **the existing code path**, now parameterised: `setSchedule`-style `SLOT_H` from the period's `everyH / startH / dayH`, then `slotT` per feed day using the period's `slotMin`.
  - It keeps only occurrence times in **[`from`, the next period's `from`)**.
  - DST behaviour is therefore identical to today's (`setHours`).
- **The scheduled amount** of an occurrence is its period's `full10[i]`.

**When is the period sequence used?**

| Family | Occurrence source | Result |
|---|---|---|
| **Never configured sources** (no `milkUsual` and no `slotMilk` documents) | No periods are read or written. The current profile applies to all time, exactly as now | **Byte-identical to today**, including today's retroactive recalculation after a schedule change |
| **Has configured sources** | `schedPeriods` | Each past occurrence keeps the schedule, slot and scheduled amount it had |

**How a family enters the period model, without changing any number:**
- The first time anyone saves a usual-milk entry or a per-feed source, the app first writes a **`first-use` period** with `from: 0` and the **current** schedule and full amounts.
- That period reproduces exactly the grid today's estimate already uses, so the estimate is unchanged at that moment (tested).
- From then on, every setup save that changes `everyH`, `startH`, `dayH`, `slotMin` or a full-feed amount (including through birth weight) appends a `setup` period with `from` = save time.
- **Full-feed changes are included** because they change the scheduled amount. Without this, a later full-feed change would retroactively alter past estimates, which is the same problem as a schedule change.

---

## 5. Schedule-change behaviour [proposed]
- **Past occurrences** (before the change) stay on the old period:
  - same times, same scheduled amounts;
  - their allocations still match by `(i, t)` and **still count**;
  - their Not recorded occurrences are still charged the **old** scheduled amount;
  - **historical estimates don't move.**
- **New occurrences** (from the change onward) come from the new period. With no per-feed allocation, they use the usual-milk default in effect at their time.
- **Future allocations that no longer match a feed time:**
  - **The case:** a parent pre-set a source for a feed later today, and the new schedule removed that feed time.
  - They're **kept, not deleted, and not counted** (no milk is charged for a feed that won't happen).
  - Records lists them as "Not on the feed schedule · {time}", with Remove.
  - **Never silent:** the existing "Change feed times?" confirm adds a line: "{n} milk sources set for upcoming feeds won't match the new times. They'll be kept in Records but not counted."
  - If a later schedule change brings that time back, the allocation counts again (it still matches by `(i, t)`).
- **Schedule changed by a phone on the old app** (it writes the profile but no period):
  - The new app notices the profile no longer matches the latest period, and appends an `observed` period from the time it first saw the change.
  - **Its id is derived from the change itself** (latest period id + the new values), so both phones produce the same document, and the first create wins.
  - The Milk working notes: "Feed times changed on a phone that needs updating; counted from {time}."
  - **The mitigation is the same as before:** both phones update before sources are used [D-4].

**Example (fictional):**
- **Setup:** Baby A on a 3-hourly schedule from 8 AM with a 50 mL scheduled amount; usual milk 100% mother's. On Nov 20 at 1:00 PM it changes to 2-hourly from 8 AM at 45 mL.
- **11 AM, Nov 20** (old period), allocation "Donor milk": charged 0 mL, before and after the change.
- **8 AM, Nov 20** (old period), Not recorded: charged 50 mL before and after (today's code would re-charge it at 45 mL if 8 AM were on the new grid, and drop the 11 AM feed entirely).
- **2 PM, Nov 20** (new period): charged 45 mL × the default share.
- **A pre-set source for 5 PM, Nov 20:** 5 PM isn't on the 2-hourly grid (it runs 2, 4, 6 PM), so the source is kept in Records as "Not on the feed schedule" and not counted. The confirm warned about it.

---

## 6. Resolving an occurrence [proposed]
For occurrence `(i, t)` with scheduled amount `S` (in tenths):
1. **Per-feed allocation set** (`slotMilk/b{i}-{t}`, state "set"): split `S` in the proportions of its `mL10`.
2. **Otherwise, a usual-milk default in effect at t:** split `S` by its `pct`.
3. **Otherwise, Not recorded:** charge `S` in full as mother's milk (today's behaviour).

**Tube, skipped and unlogged occurrences** follow the same rule (unchanged from revision 2). For an unconfigured family, step 3 uses `FULL[i]` exactly as today, with no conversion to tenths.

---

## 7. Deterministic rounding and exact reconciliation [proposed; D-1]
### Units
All source arithmetic is done in **integer tenths of a mL**. The scheduled amount `S10 = round(S × 10)`. Full-feed amounts are whole mL today, so this is exact for every current family.

### Splitting a scheduled amount (largest remainder)
Inputs: `S10`, and weights `w = (mom, donor, formula)`, either the allocation's `mL10` or the default's `pct`, with `W = Σw > 0`.
1. Compute `q_k = floor(S10 × w_k / W)` and `r_k = (S10 × w_k) mod W`.
2. Take `left = S10 − Σq_k`. It's always between 0 and 2.
3. Give +1 to the `left` parts with the largest `r_k`. **Ties go in the fixed order mother's → donor → formula.**
4. **Guarantee:** the three parts are integers that total **exactly** `S10`. The same inputs always give the same result on every phone, because there's no floating point.

### Worked examples
| Scheduled | Weights | Exact shares | Floor | Remainders | Result (mL) | Total |
|---|---|---|---|---|---|---|
| 60 mL (600) | actual 30 / 10 / 5 mL (300 / 100 / 50) | 400 / 133.3 / 66.7 | 400 / 133 / 66 | 0 / 150 / 300 → formula +1 | **40.0** / 13.3 / 6.7 | 60.0 ✓ |
| 49 mL (490) | default 60 / 40 / 0 % | 294 / 196 / 0 | 294 / 196 / 0 | none | **29.4** / 19.6 / 0 | 49.0 ✓ |
| 49 mL (490) | default 33 / 33 / 34 % | 161.7 / 161.7 / 166.6 | 161 / 161 / 166 | 70 / 70 / 60 → mother's +1, donor +1 | **16.2** / 16.2 / 16.6 | 49.0 ✓ |
| 50 mL (500) | actual 45 mL mother's only | 500 / 0 / 0 | | | **50.0** / 0 / 0 | 50.0 ✓ |

Shares, floors and remainders are in tenths of a mL.

### Totals
- **The estimate's "used"** = Σ mother's tenths over all counted occurrences ÷ 10, plus (for Not recorded) `FULL` as today.
- **The Milk tab's working** lists mother's / donor / formula / Not recorded sub-totals. These come from the same per-occurrence integers, so they **add up exactly** to the scheduled total.
- Display rounds to whole mL only at the end, as today.

### Recorded composition vs the actual feed (your acceptance item)
- **The reference amount** for an allocation (`basis`):
  - **`feed`:** the occurrence has a logged feed with by-mouth `v > 0` (matched by the existing `slotFeed` rule). The parts must total **exactly `v`** (`total10 = v × 10`).
  - **`scheduled`:** the occurrence is tube, skipped or not logged, so there's no actual by-mouth amount. The parts must total exactly the scheduled amount `S`.
- **The save is blocked until it reconciles.** The Mixed sheet shows "{entered} of {reference} mL", with Save enabled only at an exact match.
  - **One-tap single source** fills the whole reference amount automatically (T-3, now: `v` if logged by mouth, otherwise `S`).
- **When the feed is edited afterwards** (for example 45 → 50 mL) [D-6]:
  - A **single-source** allocation follows automatically in the same save. It's unambiguous: 100% of one source, as a guarded update.
  - A **mixed** allocation is left as it was, and the card and Records show "Sources total 45 mL · feed is now 50 mL · Update". The estimate still uses its proportions, so it stays well-defined, but the mismatch is visible until it's fixed.
  - A feed logged later for a `scheduled`-basis allocation is handled the same way.

---

## 8. Limits (replaces T-9)
- **The 300 mL cap is removed.**
- **The only bound kept is inherited:** a `feed`-basis allocation must total the logged by-mouth amount, which the app already limits to 0–150 mL (`index.html:1101`, `:1488`). The rules enforce `total10 ≤ 1500` for `basis == "feed"`, which is that same constraint.
- **`scheduled` basis has no cap** of its own, because the setup screen puts no cap on the full-feed amount. The rules check only that it's a positive integer.
- **Percentages are bounded by their meaning:** integers 0–100 totalling exactly 100.

---

## 9. Offline, idempotence and the conflict guard [proposed; D-2]
### Idempotence
- **Every document id is fixed when the parent taps:**
  - `slotMilk` from `(i, t)`;
  - history entries from `from` + a 4-character suffix generated once;
  - `observed` periods from their content.
- **Retries are safe:** the Firestore offline queue (and any retry) rewrites the same document with the same content.

### Conflict guard, enforced by the server rather than just the phone
- **Rules for `slotMilk`:**
  - **create:** only when the document doesn't exist, with `rev == 1` (or any `rev ≥ 1` for restore and import);
  - **update:** only when `request.rev == stored rev + 1`.
- **On the phone:** Today, the sheet and Records remember the `rev` they displayed. Saving writes `rev + 1`.
- **Both parents online:** the existing pattern applies first. If the shown version is older and the other parent made it, the app asks before replacing it.
- **Both parents offline, editing the same feed:**
  - The first to sync wins.
  - The second phone's write is **rejected by the server** (its `rev` is stale), never silently overwriting.
  - That phone then shows "{name} changed the milk source for {baby} {time} — yours wasn't saved. Review", opening the sheet with both versions.
- **A lost acknowledgement** (the server committed it, but the phone resends):
  - The resend is rejected as stale.
  - The app re-reads the server document. If it equals what it wrote (same `editBy`, `editT` and parts), it treats the write as **saved**, with no false error.
- **Usual-milk and period entries are create-only,** so concurrent saves create two entries rather than overwriting one. The later `from` wins, as section 3.2 defines.
  - The Care card shows the in-effect entry and who set it.
  - If the other parent's entry arrives after yours with a later `from`, it flashes "{name} changed usual milk for {baby}".
- **Undo:**
  - An allocation's Undo is a guarded update back to the previous state, so it's refused if the other parent changed it since, using the existing Undo confirm.
  - A usual-milk entry's Undo deletes it **only if no occurrence for that baby fell between its `from` and now**. Otherwise it appends a new entry restoring the previous setting, so no estimate already shown changes.

### Store additions only
- **`create(name, id, rec)`** fails if the document exists.
- **`update(name, id, rec, rev)`:** a full replace that relies on the rules' `rev` check.
- **The `store-error` event detail** gains `{name, id, code}`, so a late rejection can be tied to its feed.
- **Same additions in the stub;** the existing contract is unchanged.

---

## 10. Firestore rules (T-4; needs a separate production publish)
- **All three collections are excluded from the shared catch-all,** like `events`.
- **Read:** family members only.
- **Delete:** family members (Undo and lifecycle).

### `slotMilk/{id}`
- **Fields:** exactly the fields in section 3.1. `i` is 0 or 1; `t` is an integer; `id == 'b' + i + '-' + t`.
- **State "set":**
  - `mom`, `donor` and `formula` are integers ≥ 0;
  - `total10` equals their sum and is > 0;
  - `basis` is `feed` or `scheduled`;
  - `basis == "feed"` requires `total10 ≤ 1500`.
- **State "usual":** `mL10`, `total10` and `basis` are null.
- **Create and update:** `rev` rules per section 9. On update, `editBy` must be the signer's email; on create it isn't required, so a restore can keep the other parent's authorship.

### `milkUsual/{id}`
- **Fields:** exactly those in section 3.2.
- **`pct`** is null, or three integers 0–100 summing to exactly 100.
- **Create only; no update.**

### `schedPeriods/{id}`
- **Fields:** exactly those in section 3.3.
  - `everyH` is 2, 3 or 4; `startH` 0–23; `dayH` 0–12 (all integers);
  - `slotMin` entries are each 0 or 30;
  - `full10` holds two positive integers;
  - `from` is an integer ≥ 0.
- **Create only; no update.**

### What the rules can't check, and why
- Cross-document reconciliation (allocation total = the feed's `v`) is app-enforced and shown as a mismatch, because it depends on another document that may sync separately.
- "No backdating" (`from` = save time) is also app-enforced: an offline save reaches the server hours later, so the server's clock can't judge it.

---

## 11. Where it appears (unchanged from revision 2, with these additions)
- **Today:** the "Milk: {source} ›" line, and the sheet (one tap per source · Mixed… with "{entered} of {reference} mL" · Use usual milk).
- **Records:** source line per feed, editable. Occurrences with an allocation but **no feed logged** appear as their own row ("Milk source · not logged"). "Not on the feed schedule" rows sit under the Feeds filter.
- **Care:** usual milk per baby, as percentages with an mL preview of the current scheduled amount, plus who set it and when.
- **Milk tab:** the working splits "Mother's milk used by scheduled feeds" into usual / recorded / Not recorded. It adds "Not counted: donor milk X · formula Y", and a note when the schedule changed or an old phone was detected.
- **Need / day (mother's milk):** current period × feeds per day × the current default share, split with the same rounding, so it's exact. It shows "—" at zero.
- **Journey, CSV and backup:**
  - Journey, as approved.
  - CSV: three trailing columns with the **actual** recorded mL (one decimal), blank when inherited or Not recorded. Import is merge-only.
  - Backup: all three collections, merge-only restore, keeping `rev`.

---

## 12. Test requirements
### Browser suite (stub)
1. **Equivalence (unconfigured):** estimate, used, slot count, next draw, need, ≈ days, % of need, the Today row and the chart need line all equal today's values exactly, over the synthetic data and a 30+ day window, **including after a schedule change and a full-feed change** (today's retroactive behaviour is preserved). No `schedPeriods` are written.
2. **Equivalence at first use:** saving the first usual-milk entry writes a `first-use` period and leaves every number above unchanged at that moment.
3. **Your example:** scheduled 60, recorded 45 = 30 / 10 / 5. The stock charge is exactly 40.0; the feed record is still 45; by-mouth totals and % of target are unchanged.
4. **Rounding:** every row of the table in section 7 gives those exact parts. A property check over a generated set (all `S10` from 10 to 2000 × weight vectors) shows the parts are integers, total exactly `S10`, and repeat identically on re-run.
5. **Defaults:** saving is refused unless the percentages total exactly 100 (99 and 101 are rejected; 0/0/100 is accepted).
6. **Reconciliation:** a Mixed save is refused unless the parts equal the reference (`v`, or the scheduled amount). One-tap fills the reference exactly. A feed edit makes a single-source allocation follow it, while a mixed one shows the mismatch notice.
7. **No retroactive defaults:** a usual-milk change leaves the estimate for every occurrence before its `from` identical (compare before and after across a whole window). Undo follows the rule in section 9.
8. **Schedule change (configured):**
   - Past occurrences, their allocations and their scheduled amounts are unchanged.
   - New occurrences use the new period and the default.
   - The worked example in section 5 gives exactly those charges.
   - A stranded allocation is kept, not counted, listed in Records, and named in the confirm.
   - Restoring the old schedule counts it again.
9. **Full-feed change (configured):** past Not recorded occurrences keep their old scheduled amount.
10. **Old-app schedule change:** an `observed` period is appended once, even when both phones observe it; the Milk note shows.
11. **Precedence:** allocation > default > Not recorded; `state: "usual"` returns to the default; `pct: null` returns to Not recorded. Tube, skipped and unlogged occurrences resolve the same way.
12. **Conflict guard:** a stale-`rev` save is rejected and the review prompt shown. The lost-ack resend is treated as saved. The online both-parents confirm works. Undo is refused after the other parent's change.
13. **Offline:** repeating the same save (simulated retry) leaves one document with the same content.
14. **Backup/restore:** round-trips all three collections, including `rev`, history order and stranded allocations. Restoring into an empty family reproduces the estimate exactly. Format-2 backups without them restore unchanged.
15. **CSV:** the new columns export actual mL; older CSVs import unchanged; import never overwrites an existing allocation.
16. **Records, Today, Care and Journey** displays per section 11; neutral, identical styling for all three sources.
17. **Unknown-field preservation (T-7):** re-saving or editing a feed keeps an extra field.
18. **Accessibility:** 44 px controls, three themes and A++ text on every new control and sheet.

### Rules suite (emulator; every rule mutation-checked)
- **`slotMilk`:**
  - valid "set" and "usual" accepted;
  - rejected: a negative part, a non-integer part, a total ≠ sum, a zero total, `feed` total > 1500, an unknown basis, an extra field, an id that doesn't match `(i, t)`, `i` not 0/1;
  - create only when absent; update only when `rev` = stored + 1 (stale and skipped `rev` rejected); `editBy` must be the signer on update;
  - strangers and the legacy allowlist denied where the existing rules deny them.
- **`milkUsual`:** sums of 99, 100 and 101; `pct` out of range; null accepted; update rejected; create and delete by members.
- **`schedPeriods`:** each field's range; update rejected.
- **Mutation proof:** weaken each rule in turn (drop the sum check, the `rev` check, the id check, the 100% check); at least one test must fail for each.

### Real-Store suite (emulator, the real `firebase-store.js`)
- `create` and the `rev`-guarded `update`, including two contexts racing offline: one wins, the other gets a typed rejection tied to its document.
- The lost-ack resend is resolved as saved.
- Last-member account deletion removes all three collections.
- Fault injection on each new step.

### Frozen behaviour
Every existing feeding, weight, pumping, drop-off and day-boundary assertion stays green.

---

## 13. Outstanding decisions
| # | Decision | Recommendation |
|---|---|---|
| **D-1** | Integer tenths of a mL; largest-remainder split with ties mother's → donor → formula | **Yes** |
| **D-2** | Conflict guard enforced by the server through a `rev` counter, so offline conflicts are rejected and reviewed rather than overwritten | **Yes** |
| **D-3** | The schedule history (`schedPeriods`) starts only when a family first configures sources. Unconfigured families keep today's behaviour, including today's retroactive recalculation after a schedule change | **Yes**: this is the only way to meet both "exactly the existing estimate" and "never retroactive". Making it non-retroactive for everyone is a candidate for Phase 2.5 |
| **D-4** | When a phone still on the old app changes the schedule, the change is recorded from the time the new app first sees it, with a visible note | **Yes**, and update both phones first |
| **D-5** | Usual-milk history as one document per entry instead of a list in `config/milkUsual` (a shape change to T-6; the principle is unchanged) | **Yes**: needed for idempotent, conflict-free offline appends |
| **D-6** | After a feed edit, a single-source allocation follows it automatically; a mixed one shows the mismatch for the parent to fix | **Yes** |
| **D-7** | Stranded future allocations are kept and not counted; the schedule-change confirm and Records surface them | **Yes** |
| **D-8** | Stage B split into **B1:** data model, rules, estimate engine and their tests (no UI change); then **B2:** Today, Records, Care, Milk and Journey UI. Each is reviewed separately | **Yes**: the scope has grown, and B1 proves the numbers before any screen depends on them |

---

## 14. What stays exactly the same
- Every existing record.
- Feed amounts, by-mouth totals, % of target, mL/kg/day, weights, pumping, drop-offs, the NICU count, the day boundary and the feed grid on Today and in the sheet.
- Every number for a family that never configures sources.
- F1 stays deferred to Phase 2.5.
