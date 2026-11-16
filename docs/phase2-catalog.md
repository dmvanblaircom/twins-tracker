# Phase 2 — Milestone & firsts catalog (approved)

**Approved by the product owner on Nov 16, 2026 (Stage A, revision 3 plus final approval of the three remaining items).** This is the content source of truth for Phase 2; `docs/NICULOG-PLAN.md` governs scope and sequencing.

All items below are approved. The three items still open in revision 3 (the donor milk milestone, the vertical dot timeline, and Feeding sources as its own phase) were approved on Nov 16, 2026.

## Ground rules [approved]
- **Voice:** warm and personal, with short, natural titles.
- **Few curated items:** the curated list stays short so the timeline isn't noisy. **"Write your own"** covers anything else that matters to a family. No per-milestone prompts.
- **Names:** the baby's name is shown next to an item, never stored in it; records use index `i`.
- **Neutral and non-clinical:**
  - no clinical interpretation, and no good or bad judgement about weight or feeding;
  - **every feeding method is equal:** mother's milk, donor milk, formula, bottle and nursing; nothing implies one is better or expected.
- **Nothing is created without a parent tapping it:** firsts and date milestones are suggestions only.
- **Never inferred from data:** "Breathing without help", feeding methods and milk types are recorded by a parent only.
- **Calculations untouched:** feeding, weight, pumping, milk and day-boundary results don't change in Phase 2. Offline-first behaviour and the existing Store architecture remain binding.

---

## 1. Curated baby milestones
These are `kind: "milestone"`, `scope: "baby"`, `i` = Baby A or B. A parent picks one in **Add a moment**, or taps **Write your own**, which is saved as `kind: "moment"`. The notes field uses one generic placeholder for all of them.

### Meeting and bonding [approved]
| Key | Title |
|---|---|
| `first-touch` | First touch |
| `first-hold` | First hold |
| `skin-to-skin` | First skin-to-skin |
| `eye-contact` | First eye contact |
| `finger-grasp` | First time holding a finger |

### Feeding
| Key | Title | Status |
|---|---|---|
| `first-bottle` | First bottle | [approved] |
| `first-nursing` | First time nursing | [approved] |
| `first-breast-milk` | First breast milk feed | [approved] |
| `first-donor-milk` | First donor milk feed | [approved] |
| `first-formula` | First formula feed | [approved] |

- All of these are recorded by a parent only. They're never inferred from feed records, the diet text or the milk log.
- **Feeding tube out** stays in the existing checklist and reaches the timeline from there. [approved]

### Everyday care [approved]
| Key | Title |
|---|---|
| `first-diaper` | First diaper change |
| `first-bath` | First bath |
| `first-outfit` | First outfit |
| `first-swaddle` | First swaddle |
| `first-story` | First story read aloud |
| `first-song` | First song sung |

### Family and visitors [approved]
| Key | Title |
|---|---|
| `meets-sibling` | First meeting with big brother or sister |
| `meets-grandparents` | Met grandparents |

### Along the way [approved]
| Key | Title | Note |
|---|---|---|
| `breathing-own` | Breathing without help | Recorded by a parent only; never inferred from any respiratory or oxygen data |
| `room-move` | Moved to a new room | |
| `came-home` | Came home | Records a past event; makes no readiness claim |

### Conditional family milestone [approved]
| Key | Title | Scope | Offered when |
|---|---|---|---|
| `holding-both` | First time holding both babies at once | `family`, `i: null`, recorded once | Only when more than one baby is in the family's record. Always true in today's two-baby model; written as a real check |

---

## 2. Data-derived firsts (D9: suggestions only) [approved]
- **The card:** **"From your logs: {title}"**, a detail line, and two buttons: **Add to journey** and **Not now**.
- **Saving:** only when a parent taps Add, as `kind: "milestone"`, `scope: "baby"`, with `ref` pointing to the source record.
- **"Not now"** saves nothing to the family database. A dismissal may be remembered on that phone.

| Key | Title | Exact detection rule | Detail line | `ref` |
|---|---|---|---|---|
| `first-po` | First feed by mouth | Earliest feed for baby *i* with `v > 0` | "{v} mL · {date}, {time}" | that feed |
| `first-full` | First full feed by mouth | Earliest feed for baby *i* with `v ≥ FULL[i]` (the full amount set in setup) | "{v} mL · the full amount you set" | that feed |
| `first-full-day` | First day with every feed by mouth | Earliest **completed** day (7 AM–7 AM, the existing `feedDay`) in which every scheduled slot for baby *i* has a feed with `v > 0` and none is marked All by tube or Skipped | "All {n} feeds by mouth · {date}" | the last feed of that day |
| `birth-weight` | Back to birth weight | Earliest **recorded** night weight for baby *i* with `v ≥ birth weight`; estimated weights excluded | "{weight in the phone's units} · night of {date}" | that weight |

- No whole-pound or other interval weight milestones.
- Weight is shown neutrally: no colours, praise or concern.
- "By mouth" names no method.

---

## 3. Date milestones (calendar suggestions; `ref: null`) [approved]
Suggested on the day, with the same card and buttons. Saved as `kind: "milestone"`, `scope: "baby"`, `ref: null`.

| Key | Title | Rule |
|---|---|---|
| `one-week` | One week old | Birth date + 7 days |
| `one-month` | One month old | The same date one month later. If that month has no such date, the last day of the month (Jan 31 → Feb 28) |
| `hundred-days` | 100 days old | The 100th day of life: birth date + 99 days, counting the birth day as day 1 |
| `due-date` | Due date | The day gestational age reaches 40 weeks. Only if GA was entered in setup and birth was before 40 weeks |

---

## 4. Timeline design and wording

### Design: a vertical dot timeline [approved]
- **Layout:** a single vertical rail down the left edge, one dot per item, newest at the top, and day headers sitting on the rail. This is the dot chart you described, laid out vertically so it reads well on a 390 px phone and at A++ text.
- **Why vertical:** a horizontal dot strip gets cramped and hard to tap at large text sizes.
- **Item types:** the three types differ by **shape and size, not just colour**:

| Item | Dot | Row |
|---|---|---|
| **Milestone** (curated, "Write your own", saved first, date milestone) | Large **filled** dot in the baby's colour, with the baby's initial inside. Parent and family items use a neutral filled dot. | Card: title prominent, note underneath, "Added by {name}". Saved firsts add "From your logs". |
| **Journal** | Large **hollow (ring)** dot | Card: "Journal" label; note text prominent; "Written by {name}" |
| **Daily summary** (computed, not stored) | Small **muted** dot | Compact single line, no card |
| Other existing records (weight, checklist, plan, answered question) | Small **outlined** dot | Single line |

- **The rest of the design:**
  - each row is at least 44 px tall;
  - tapping a milestone or journal entry opens it for editing;
  - the baby selector filters the rail;
  - built with design-system tokens only, and works in light, dark and night themes.
- **Firsts suggestions** appear above the rail, not inside it, so a suggestion never looks like a saved item.

### Wording [approved: recommended wording accepted]
- **Day header:** "Tue, Feb 10 · Day 9"
- **Daily summaries:**
  - Feeds, per baby: "{Baby}: {mL} mL by mouth · {n} of {N} feeds". Add " · {k} by tube" when any.
  - Pumping, per family: "Pumped {mL} mL · {n} sessions". Add " · {mL} mL to the NICU" on drop-off days.
- **Weight:** "{Baby}: {weight}" plus " (est.)" when estimated, and " · {±} since the night before". Neutral.
- **Checklist:** "{Baby}: {item} — marked done by {name}". Family items read "{item} — marked done by {name}".
- **Plan from rounds:** "{Baby} · Plan from rounds: {text}"
- **Answered question:** "Asked at rounds: {question} · Answer: {answer}"
- **Milestone:** "{Baby} · {title}". Parent and family items read "Me" or "Our family".
- **Journal:** "{name}'s journal" for "Me"; "Our family" for family.
- **Shared check-in** (shown now, created in Phase 3): "{name} shared a check-in"
- **Empty state:** "This is where your story lives. Add a first hold, a first bath, or anything you want to remember about these days."
- **Checklist label fix:** "Open crib, holding her temperature" becomes **"Open crib, maintaining temperature"**. Text only; the id `crib` and all stored data are unchanged. Done in Stage B. [approved]

---

## 5. "Add a moment" sheet [approved]
- **Title:** Add a moment
- **Who is it about?** [Baby A name] · [Baby B name] · Me · Our family
  - "Me" saves `scope: "parent"`; "Our family" saves `scope: "family"`.
  - Both are free text only in Phase 2.
- **What would you like to add?**
  - **Milestone**: pick from the list, or **Write your own** (saved as `kind: "moment"`)
  - **Journal**: a longer note
- **Fields:**
  - "What happened?" (placeholder: "e.g. First hold")
  - "When?" (defaults to now; editable)
  - "Anything you want to remember?" (optional)
- **Buttons:** Save · Cancel. In the editor: Delete.
- **Undo bar:** "Saved to your journey · Undo" / "Removed from your journey · Undo"
- **Conflict prompts:**
  - "{name} just edited this. Replace their changes with yours?"
  - "{name} removed this. Save yours as a new entry?"

---

## 6. Exclusions and deferred items [approved]
- **Already in the checklists,** so they reach the timeline from there:
  - baby items: open crib, car seat test, hearing screen, heart screen, repeat newborn screen, Hep B, RSV shot, feeding tube out;
  - family items: CPR class, rooming-in night, car seats installed, pediatrician chosen, first visit booked, feeding recipe written down.
- **Removed:**
  - all whole-pound and interval weight milestones;
  - per-milestone prompts (the list is deliberately kept short).
- **Never inferred from data:** respiratory and oxygen status; feeding method; milk type.
- **Excluded:** anything implying a medical judgement (weight-gain rates, "ready for…", equipment and settings).
- **Deferred:**
  - curated parent milestones (Phase 3);
  - curated family milestones beyond `holding-both` (Phase 4);
  - photos (Phase 5).

---

## 7. Donor milk across the app [approved: its own phase, "Phase 2b — Feeding sources", after Phase 2]
You asked for donor breast milk to be a feeding option across the app, not just in moments. That's more than catalog wording.

**What the app does today:**
- Feeds record only an amount by mouth, plus the free-text diet line (for example a fortifier).
- No feed records what kind of milk it was.
- The milk estimate assumes the babies get **only mom's milk**: every scheduled feed draws down the NICU's stock of pumped milk.

**What "across the app" means:**
- **A milk type on each feed:** mom's milk, donor milk, formula, or a mix. It's set from a family default, like the diet line, and can be changed with one tap per feed.
- **Milk-estimate maths:** only feeds of mom's milk would draw down her NICU stock. Donor milk and formula feeds wouldn't.
- **Records, CSV export, backup and the timeline** would show the milk type neutrally.

**Why it can't simply go into Phase 2:**
- It changes the milk calculation, which the plan's binding rules freeze for Phase 2.
- It adds a field to every feed.
- It needs a rule for existing feeds. Recommendation: existing feeds stay "not recorded" and keep today's maths, so nothing logged so far changes.

**Recommendation:** add it to the roadmap as its own small phase, "Feeding sources", right after Phase 2 and before Phase 3. It would get its own acceptance criteria:
- the milk estimate is unchanged for any family that never sets a milk type;
- donor milk and formula feeds don't draw down mom's stock;
- every type is shown neutrally.

Phase 2 still ships the parent-recorded "First donor milk feed" milestone (§1).

**Decision:** approved as its own phase (Phase 2b in `docs/NICULOG-PLAN.md`).

## 8. Future requirement: multiple birth vs NICU admission [approved to record; not built in Phase 2]
- **Requirement:** the app must eventually distinguish **how many babies were born** in the multiple birth from **how many were admitted to the NICU**. For example, a family may have twins with only one baby admitted.
- **What it will affect:**
  - conditional milestones (`holding-both`);
  - which babies appear in Today, Growth, the timeline and the firsts;
  - the setup screen;
  - milk-need maths;
  - the backup format.
- **Phase 2 constraint:** no architecture change. Phase 2 writes `holding-both` as a genuine "more than one baby in the record" check.
- **Recorded** in the roadmap's Open items.
