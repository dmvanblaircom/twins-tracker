// Milk-source engine (milk-sources.js): calculation, rounding, schedule history and validation, in Node.
//   cd tests && npm run unit        (no browser needed; runs in America/New_York like the app tests)
// Synthetic schedules and amounts only.
process.env.TZ = "America/New_York";
const MS = require("../milk-sources.js");
const FX = require("./sources.fixtures.js");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = s => new Date(s).getTime();

// ---------- the app's original estimate code (index.html before Phase 2b), parameterised, copied verbatim in logic ----------
function legacy(cfg) {
  const pad = n => String(n).padStart(2, "0"), dKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const everyH = cfg.everyH, startH = cfg.startH, DAY_START_H = cfg.dayH, FEEDS_PER_DAY = 24 / everyH;
  const SLOT_H = [...Array(24)].map((_, k) => DAY_START_H + k).filter(h => ((h - startH) % everyH + everyH) % everyH === 0);
  const TWINS = ["A", "B"], SLOT_M = { A: cfg.slotMin[0], B: cfg.slotMin[1] }, FULL = { A: cfg.full[0], B: cfg.full[1] };
  const feedDay = t => { const d = new Date(t); if (d.getHours() < DAY_START_H) d.setDate(d.getDate() - 1); return dKey(d); };
  const slotT = (tw, day, i) => { const d = keyDate(day); d.setHours(SLOT_H[i], SLOT_M[tw], 0, 0); return d.getTime(); };
  const need = () => TWINS.reduce((a, tw) => a + FULL[tw] * FEEDS_PER_DAY, 0);
  function feedsSince(start, end) { let n = 0, day = feedDay(start); const last = feedDay(end);
    for (let guard = 0; day <= last && guard < 400; guard++) { TWINS.forEach(tw => SLOT_H.forEach((_, i) => { const t = slotT(tw, day, i); if (t > start && t <= end) n++; }));
      const d = keyDate(day); d.setDate(d.getDate() + 1); day = dKey(d); } return n; }
  function usedSince(start, end) { let used = 0, day = feedDay(start); const last = feedDay(end);
    for (let guard = 0; day <= last && guard < 400; guard++) { TWINS.forEach(tw => SLOT_H.forEach((_, i) => { const t = slotT(tw, day, i); if (t > start && t <= end) used += FULL[tw]; }));
      const d = keyDate(day); d.setDate(d.getDate() + 1); day = dKey(d); } return used; }
  function nextUse(now) { const day = feedDay(now), d = keyDate(day); d.setDate(d.getDate() + 1);
    const slots = [day, dKey(d)].flatMap(k => TWINS.flatMap(tw => SLOT_H.map((_, i) => ({ tw, t: slotT(tw, k, i) })))).filter(x => x.t > now).sort((a, b) => a.t - b.t);
    return slots.length ? { t: slots[0].t, tw: slots[0].tw, ml: FULL[slots[0].tw] } : null; }
  return { need, feedsSince, usedSince, nextUse };
}
const periodOf = (cfg, from = 0, id = "s-0-aaaa") => ({ id, from, everyH: cfg.everyH, startH: cfg.startH, dayH: cfg.dayH, slotMin: cfg.slotMin, full10: cfg.full.map(v => v * 10) });

(() => {
  // ---------- 1. deterministic split ----------
  check("your example: 60 mL scheduled, recorded 30/10/5 → mother's 40.0", eq(MS.split(600, [300, 100, 50]), [400, 133, 67]), JSON.stringify(MS.split(600, [300, 100, 50])));
  check("60/40 default on 49 mL → 29.4 / 19.6 / 0", eq(MS.split(490, [60, 40, 0]), [294, 196, 0]));
  check("33/33/34 on 49 mL → 16.2 / 16.2 / 16.6 (ties: mother's, then donor)", eq(MS.split(490, [33, 33, 34]), [162, 162, 166]));
  check("single source takes the whole scheduled amount", eq(MS.split(500, [450, 0, 0]), [500, 0, 0]));
  check("equal thirds of 10.0 mL → 3.4 / 3.3 / 3.3 (tie order)", eq(MS.split(100, [1, 1, 1]), [34, 33, 33]));
  let bad = 0, n = 0, zeroBump = 0, off = 0;
  const vecs = [[1, 1, 1], [1, 2, 3], [7, 0, 3], [0, 0, 5], [33, 33, 34], [300, 100, 50], [1, 0, 0], [0, 1, 1], [13, 17, 19], [999, 1, 0], [450, 151, 1]];
  for (let S10 = 0; S10 <= 2000; S10++) for (const w of vecs) {
    const a = MS.split(S10, w), b = MS.split(S10, w.slice()); n++;
    if (!a.every(Number.isInteger) || a[0] + a[1] + a[2] !== S10 || !eq(a, b)) bad++;
    a.forEach((x, k) => { if (w[k] === 0 && x !== 0) zeroBump++; const exact = S10 * w[k] / (w[0] + w[1] + w[2]); if (x < Math.floor(exact) || x > Math.ceil(exact)) off++; });
  }
  check(`split property over ${n} cases: integer parts, exact total, repeatable`, bad === 0, `${bad} bad`);
  check("split never gives anything to a source with zero share", zeroBump === 0, `${zeroBump}`);
  check("each part is within the floor/ceiling of its exact share", off === 0, `${off}`);
  let threw = 0; for (const w of [[0, 0, 0], [1, -1, 1], [1.5, 1, 1]]) { try { MS.split(100, w); } catch { threw++; } }
  check("split refuses zero, negative or fractional weights", threw === 3);

  // ---------- 2. unconfigured-equivalence of the occurrence walk (the first-use period reproduces today's grid) ----------
  const cfgs = [];
  for (const everyH of [2, 3, 4]) for (const startH of [0, 6, 8, 11]) for (const dayH of [0, 7, 12]) for (const slotMin of [[0, 30], [30, 0], [0, 0]])
    cfgs.push({ everyH, startH, dayH, slotMin, full: [49, 53] });
  const windows = [["2026-02-01T00:00:00-05:00", "2026-04-15T12:00:00-04:00"],          // across the March DST change
                   ["2026-10-20T06:59:59-04:00", "2026-11-25T07:00:00-05:00"],          // across the November DST change, edge seconds
                   ["2026-11-16T08:00:00-05:00", "2026-11-16T08:00:00-05:00"],          // empty
                   ["2026-11-16T07:00:00-05:00", "2026-11-17T07:00:00-05:00"]];         // exactly one feed day
  let mism = 0, cases = 0;
  for (const c of cfgs) { const L = legacy(c), src = { periods: [periodOf(c)], usual: [], alloc: {} };
    for (const [a, b] of windows) { cases++; const s = at(a), e = at(b), u = MS.usage(src, s, e);
      if (u.n !== L.feedsSince(s, e) || u.mom10 / 10 !== L.usedSince(s, e) || u.by.none.n !== u.n) mism++; }
    const now = at("2026-11-16T14:10:00-05:00"), nx = MS.nextDraw(src, now), ln = L.nextUse(now);
    if (!ln || !nx || nx.t !== ln.t || ["A", "B"][nx.i] !== ln.tw || nx.mom10 / 10 !== ln.ml) mism++;
    if (MS.needPerDay10(src, now) / 10 !== L.need()) mism++;
  }
  check(`first-use period = today's estimate exactly: ${cfgs.length} schedules × ${windows.length} windows (used, feed count, next draw, need)`, mism === 0, `${mism} mismatches in ${cases}`);
  const prof = { schedule: { everyH: 3, startH: 8 }, twins: [{ birthG: 2600, fullMl: null, slotMin: 0 }, { birthG: 2800, fullMl: 52, slotMin: 30 }] };
  check("periodFromProfile derives the app's own values (default 150 mL/kg/day ÷ feeds, override, offsets)",
    eq(MS.periodFromProfile(prof), { everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full10: [490, 520] }), JSON.stringify(MS.periodFromProfile(prof)));

  // ---------- 3. actual vs scheduled ----------
  const c3 = { everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full: [60, 50] }, P3 = [periodOf(c3)];
  const t9 = at("2026-11-16T11:00:00-05:00");
  const A3 = { [`b0-${t9}`]: FX.alloc({ t: t9 }) };                                      // recorded 45 = 30/10/5
  const base = MS.usage({ periods: P3, usual: [], alloc: {} }, t9 - 1, t9), withA = MS.usage({ periods: P3, usual: [], alloc: A3 }, t9 - 1, t9);
  check("example: stock charged 40.0 mL of mother's milk for that feed (scheduled 60)", withA.mom10 === 400 && withA.donor10 === 133 && withA.formula10 === 67, JSON.stringify(withA));
  check("example: the rest of the scheduled 60 mL is counted as donor 13.3 + formula 6.7, not as mother's", withA.mom10 + withA.donor10 + withA.formula10 === 600 && base.mom10 === 600);
  check("example: the estimate drops by exactly 20.0 mL less than Not recorded", base.mom10 - withA.mom10 === 200);
  check("the allocation's actual amounts are untouched by the calculation (still 45 mL = 30/10/5)", A3[`b0-${t9}`].total10 === 450 && eq(A3[`b0-${t9}`].mL10, { mom: 300, donor: 100, formula: 50 }));

  // ---------- 4. precedence and usual-milk history ----------
  const tA = at("2026-11-16T14:00:00-05:00"), occ = { i: 0, t: tA, S10: 600 };
  const U = [{ id: "u-0-1-aaaa", i: 0, from: at("2026-11-16T12:00:00-05:00"), pct: { mom: 50, donor: 50, formula: 0 } }];
  check("allocation beats usual milk", eq(MS.resolve(occ, FX.alloc({ t: tA, mL10: { mom: 0, donor: 600, formula: 0 }, total10: 600, basis: "scheduled" }), U).parts, [0, 600, 0]));
  check("usual milk beats Not recorded", eq(MS.resolve(occ, null, U), { parts: [300, 300, 0], how: "usual" }));
  check("an allocation back on 'usual' follows the default", MS.resolve(occ, FX.alloc({ t: tA, state: "usual", mL10: null, total10: null, basis: null }), U).how === "usual");
  check("Not recorded charges the whole scheduled amount", eq(MS.resolve({ ...occ, t: at("2026-11-16T11:00:00-05:00") }, null, U), { parts: [600, 0, 0], how: "none" }));
  check("usual pct null returns to Not recorded", MS.resolve(occ, null, [...U, { id: "u-0-2-aaaa", i: 0, from: tA - 1, pct: null }]).how === "none");
  check("usual-milk entries are per baby", MS.resolve({ ...occ, i: 1 }, null, U).how === "none");
  check("same from: the greater id wins (deterministic)", MS.usualAt([{ id: "u-0-5-aaaa", i: 0, from: 5, pct: null }, { id: "u-0-5-bbbb", i: 0, from: 5, pct: { mom: 100, donor: 0, formula: 0 } }], 0, 9).id === "u-0-5-bbbb");
  // never retroactive: adding a later entry leaves every earlier occurrence's charge identical
  const win0 = at("2026-11-01T07:00:00-05:00"), cut = at("2026-11-10T13:17:00-05:00"), win1 = at("2026-11-20T07:00:00-05:00");
  const src0 = { periods: P3, usual: U.map(u => ({ ...u, from: win0 })), alloc: {} };
  const src1 = { ...src0, usual: [...src0.usual, ...[0, 1].map(i => ({ id: `u-${i}-${cut}-zzzz`, i, from: cut, pct: { mom: 0, donor: 0, formula: 100 } }))] };
  const before = MS.usage(src0, win0, cut), after = MS.usage(src1, win0, cut);
  check("a usual-milk change never alters any earlier occurrence (whole window before it identical)", eq(before, after), `${before.mom10} vs ${after.mom10}`);
  check("…and does apply from its own time on", MS.usage(src1, cut, win1).mom10 === 0 && MS.usage(src0, cut, win1).mom10 > 0);
  check("Undo may delete an entry only while no feed time has passed since it took effect",
    MS.undoCanDelete(src1, src1.usual[1], cut + 60e3) && !MS.undoCanDelete(src1, src1.usual[1], cut + 6 * 3600e3));

  // ---------- 5. schedule history (the proposal's worked example, Baby A) ----------
  const p0 = { id: "s-0-aaaa", from: 0, everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full10: [500, 500] };
  const chg = at("2026-11-20T13:00:00-05:00"), p1 = { id: `s-${chg}-bbbb`, from: chg, everyH: 2, startH: 8, dayH: 7, slotMin: [0, 30], full10: [450, 450] };
  const t11 = at("2026-11-20T11:00:00-05:00"), t8 = at("2026-11-20T08:00:00-05:00"), t14 = at("2026-11-20T14:00:00-05:00"), t17 = at("2026-11-20T17:00:00-05:00");
  const AL = { [`b0-${t11}`]: FX.alloc({ t: t11, mL10: { mom: 0, donor: 500, formula: 0 }, total10: 500, basis: "scheduled" }),
               [`b0-${t17}`]: FX.alloc({ t: t17, mL10: { mom: 0, donor: 500, formula: 0 }, total10: 500, basis: "scheduled" }) };
  const UA = [{ id: "u-0-0-aaaa", i: 0, from: 0, pct: { mom: 100, donor: 0, formula: 0 } }];
  const S5 = { periods: [p0, p1], usual: UA, alloc: AL };
  const one = t => { const o = MS.occurrences(S5.periods, 0, t - 1, t)[0]; return o ? MS.resolve(o, AL[`b0-${t}`], UA).parts[0] : null; };
  check("11 AM (old period) with donor milk: 0 mL, before and after the change", one(t11) === 0 && MS.usage({ ...S5, periods: [p0] }, t11 - 1, t11).mom10 === 0);
  check("8 AM (old period), Not recorded under 100% mother's: 50 mL — the old scheduled amount", one(t8) === 500);
  check("2 PM (new period): 45 mL × the default share", one(t14) === 450);
  check("the pre-set 5 PM source isn't on the 2-hourly grid: not counted, listed as stranded", one(t17) === null && eq(MS.stranded(S5), [`b0-${t17}`]));
  check("Baby A's feed times on Nov 20 follow each period (8, 11 AM old; 2, 4, 6 PM… new)",
    eq(MS.occurrences(S5.periods, 0, t8 - 1, at("2026-11-20T19:00:00-05:00")).map(o => new Date(o.t).getHours()), [8, 11, 14, 16, 18]));
  const histBefore = MS.usage({ ...S5, periods: [p0] }, at("2026-11-01T07:00:00-05:00"), chg - 1), histAfter = MS.usage(S5, at("2026-11-01T07:00:00-05:00"), chg - 1);
  check("a schedule change never alters the estimate for any time before it", eq(histBefore, histAfter));
  const legacyRetro = legacy({ everyH: 2, startH: 8, dayH: 7, slotMin: [0, 30], full: [45, 45] }).usedSince(at("2026-11-01T07:00:00-05:00"), chg - 1);
  check("(today's unconfigured behaviour, kept for unconfigured families: it would re-run the past on the new grid)", legacyRetro !== histAfter.mom10 / 10);
  const p2 = { ...p0, id: `s-${chg + 3600e3}-cccc`, from: chg + 3600e3 };
  check("restoring the old schedule makes the stranded 5 PM source count again", MS.stranded({ ...S5, periods: [p0, p1, p2] }).length === 0);
  check("periods sharing a start time: the greater id is in effect", MS.periodAt(MS.sortPeriods([{ ...p1, id: `s-${chg}-zzzz`, everyH: 4 }, p1]), chg + 1).everyH === 4);
  check("a full-feed change starts a period too: earlier Not recorded feeds keep the old scheduled amount",
    MS.usage({ periods: [p0, { ...p0, id: `s-${chg}-dddd`, from: chg, full10: [700, 700] }], usual: [], alloc: {} }, t8 - 1, t11).mom10 === 1500);   // A 8:00, B 8:30, A 11:00 × 50 mL

  // ---------- 6. need / day (mother's milk) ----------
  const nowN = at("2026-11-16T14:10:00-05:00"), SN = { periods: [periodOf({ everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full: [49, 53] })], usual: [], alloc: {} };
  check("need / day unconfigured = (49 + 53) × 8 = 816 mL", MS.needPerDay10(SN, nowN) === 8160);
  check("need / day with Baby B on donor milk counts Baby A only (392 mL)",
    MS.needPerDay10({ ...SN, usual: [{ id: "u-1-0-aaaa", i: 1, from: 0, pct: { mom: 0, donor: 100, formula: 0 } }] }, nowN) === 3920);
  check("need / day 60/40 on Baby A: 29.4 × 8 + 53 × 8 = 659.2 mL",
    MS.needPerDay10({ ...SN, usual: [{ id: "u-0-0-aaaa", i: 0, from: 0, pct: { mom: 60, donor: 40, formula: 0 } }] }, nowN) === 6592);
  check("need / day can be zero (no mother's milk planned)", MS.needPerDay10({ ...SN, usual: [0, 1].map(i => ({ id: `u-${i}-0-aaaa`, i, from: 0, pct: { mom: 0, donor: 0, formula: 100 } })) }, nowN) === 0);
  check("next draw skips feeds that use no mother's milk", MS.nextDraw({ ...SN, usual: [{ id: "u-0-0-aaaa", i: 0, from: 0, pct: { mom: 0, donor: 100, formula: 0 } }] }, nowN).i === 1);

  // ---------- 7. reconciliation and feed-follow ----------
  const o60 = { i: 0, t: t9, S10: 600 };
  check("reference: a logged by-mouth feed → basis feed, its amount", eq(MS.reference(o60, 45), { basis: "feed", total10: 450 }));
  check("reference: tube / skipped / unlogged → basis scheduled, the scheduled amount", eq(MS.reference(o60, 0), { basis: "scheduled", total10: 600 }) && eq(MS.reference(o60, null), { basis: "scheduled", total10: 600 }));
  check("30/10/5 reconciles to a 45 mL feed", MS.reconciles(FX.alloc(), MS.reference(o60, 45)));
  check("a feed edit 45 → 50: a single-source allocation follows", eq(MS.follow(FX.alloc({ mL10: { mom: 450, donor: 0, formula: 0 } }), MS.reference(o60, 50)), { mL10: { mom: 500, donor: 0, formula: 0 }, total10: 500, basis: "feed" }));
  check("a feed edit 45 → 50: a mixed allocation is left alone (shown as a mismatch)", MS.follow(FX.alloc(), MS.reference(o60, 50)) === null && !MS.reconciles(FX.alloc(), MS.reference(o60, 50)));
  check("a feed cleared: a single-source allocation moves to the scheduled amount", eq(MS.follow(FX.alloc({ mL10: { mom: 0, donor: 450, formula: 0 } }), MS.reference(o60, null)), { mL10: { mom: 0, donor: 600, formula: 0 }, total10: 600, basis: "scheduled" }));
  check("a reconciled allocation needs no follow", MS.follow(FX.alloc(), MS.reference(o60, 45)) === null);

  // ---------- 8. drift (old-app schedule change) and phone readiness ----------
  const profD = { schedule: { everyH: 3, startH: 8, dayH: 7 }, twins: [{ birthG: 0, fullMl: 50, slotMin: 0 }, { birthG: 0, fullMl: 50, slotMin: 30 }] };
  check("no drift when the profile matches the period in effect", MS.drift({ periods: [p0], usual: [], alloc: {} }, profD, chg) === null);
  const dr = MS.drift({ periods: [p0], usual: [], alloc: {} }, { ...profD, schedule: { everyH: 2, startH: 8, dayH: 7 } }, chg);
  check("drift reported (with both versions) when another phone changed the schedule — no time assumed", !!dr && dr.inEffect.everyH === 3 && dr.profile.everyH === 2 && !("from" in dr.profile));
  check("both phones updated → ready", MS.allReady(["u1", "u2"], { u1: { v: 1 }, u2: { v: 1 } }, 1));
  check("one phone not yet updated → not ready", !MS.allReady(["u1", "u2"], { u1: { v: 1 } }, 1) && !MS.allReady(["u1", "u2"], { u1: { v: 1 }, u2: { v: 0 } }, 1));
  check("no members known → not ready", !MS.allReady([], {}, 1));

  // ---------- 8b. B2 additions: mixed / other counts and the single-source rule (Journey) ----------
  const occM = { i: 0, t: t9, S10: 600 }, UM = [{ id: "u-0-0-aaaa", i: 0, from: 0, pct: { mom: 50, donor: 50, formula: 0 } }];
  const um = MS.usage({ periods: P3, usual: UM, alloc: {} }, t9 - 1, t9);
  check("usage counts a mixed occurrence and its mother's share, and any donor/formula as 'other'", um.mixed.n === 1 && um.mixed.mom10 === 300 && um.other.n === 1);
  const umSingle = MS.usage({ periods: P3, usual: [{ ...UM[0], pct: { mom: 100, donor: 0, formula: 0 } }], alloc: {} }, t9 - 1, t9);
  check("a single-source mother's-milk occurrence is neither mixed nor other", umSingle.mixed.n === 0 && umSingle.other.n === 0);
  const R = (parts, how = "alloc") => ({ parts, how });
  check("oneSource: a whole day of donor milk → donor", MS.oneSource([R([0, 600, 0]), R([0, 490, 0], "usual")]) === "donor");
  check("oneSource: any mixed feed → none", MS.oneSource([R([0, 600, 0]), R([300, 300, 0])]) === null);
  check("oneSource: any Not recorded feed → none", MS.oneSource([R([0, 600, 0]), R([600, 0, 0], "none")]) === null);
  check("oneSource: different single sources → none", MS.oneSource([R([0, 600, 0]), R([0, 0, 600])]) === null);
  check("oneSource: no feeds → none", MS.oneSource([]) === null);

  // ---------- 8c. discharge: a baby's scheduled feeds stop at the time she went home ----------
  const SD = { periods: [periodOf({ everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full: [49, 53] })], usual: [], alloc: {} };
  const d0 = at("2026-11-10T07:00:00-05:00"), d1 = at("2026-11-12T07:00:00-05:00"), home = at("2026-11-11T12:00:00-05:00");
  const noUntil = MS.usage(SD, d0, d1), withNull = MS.usage({ ...SD, until: [null, null] }, d0, d1);
  check("discharge: no 'until' (or null) gives exactly the same usage", JSON.stringify(noUntil) === JSON.stringify(withNull));
  const dis = MS.usage({ ...SD, until: [home, null] }, d0, d1);
  const aBefore = MS.occurrences(SD.periods, 0, d0, home - 1).length;
  check("discharge: baby A's feeds count only before she went home; baby B unchanged",
    dis.n === aBefore + MS.occurrences(SD.periods, 1, d0, d1).length && dis.mom10 === aBefore * 490 + MS.occurrences(SD.periods, 1, d0, d1).length * 530);
  check("discharge: a feed exactly at the went-home time doesn't count", MS.usage({ ...SD, until: [at("2026-11-11T11:00:00-05:00"), null] }, at("2026-11-11T10:59:00-05:00"), at("2026-11-11T11:01:00-05:00")).n === 0);
  check("discharge: need / day counts only babies still in the NICU", MS.needPerDay10({ ...SD, until: [home, null] }, home + 1) === 530 * 8 && MS.needPerDay10({ ...SD, until: [home, null] }, home - 1) === (490 + 530) * 8);
  check("discharge: the next draw skips a baby who went home", MS.nextDraw({ ...SD, until: [home, null] }, home).i === 1);

  // ---------- 9. validation (same fixtures as the rules tests) ----------
  for (const [name, id, d] of FX.allocOk) check(`app accepts allocation: ${name}`, MS.validAlloc(id, d));
  for (const [name, id, d] of FX.allocBad) check(`app refuses allocation: ${name}`, !MS.validAlloc(id, d));
  for (const [name, id, d] of FX.usualOk) check(`app accepts usual milk: ${name}`, MS.validUsual(id, d));
  for (const [name, id, d] of FX.usualBad) check(`app refuses usual milk: ${name}`, !MS.validUsual(id, d));
  for (const [name, id, d] of FX.periodOk) check(`app accepts period: ${name}`, MS.validPeriod(id, d));
  for (const [name, id, d] of FX.periodBad) check(`app refuses period: ${name}`, !MS.validPeriod(id, d));
})();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
