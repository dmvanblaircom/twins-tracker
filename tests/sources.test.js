// Phase 2b B1 — milk sources in the running app (headless Chromium, in-memory Store stub, synthetic babies).
//   cd tests && npm run sources
// Proves: unconfigured families keep exactly today's estimate; the mixed-feed example; reconciliation; the conflict
// guard (app and "server"); offline idempotence; schedule history; drift reporting; phone readiness; feed-follow;
// unknown-field preservation; backup and CSV round-trips. No screen changes are expected in B1.
const fs = require("fs");
const { serve, newPage, importData, tab, PROFILE } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const at = s => new Date(s).getTime();
const DROP = at("2026-02-05T08:00:00-05:00");
const T = h => at(`2026-02-10T${h}:00-05:00`);                    // Ada's feed times on Feb 10 (her offset is 0)
const snap = p => p.evaluate(() => ({ inv: document.querySelector("#mkInv").textContent, stats: document.querySelector("#mkStats").textContent,
  parts: (({ src, ...r }) => r)(__nicu.src.parts() || {}), need: __nicu.src.need(), next: __nicu.src.nextUse() }));
const sameSnap = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ff = (p, ms) => p.context().clock.fastForward(ms);
const sheetSave = async (p, tw, i, v) => { const sel = `#sheet input[data-tw="${tw}"][data-i="${i}"]`; await p.fill(sel, String(v)); await p.press(sel, "Tab"); await p.waitForTimeout(250); };

async function page(browser, base, { fullMl, empty, ready = true } = {}) {
  const prof = JSON.parse(JSON.stringify(PROFILE)); if (fullMl) prof.twins[0].fullMl = fullMl;
  const p = await newPage(browser, base, { init: `window.__TEST_PROFILE = ${JSON.stringify(prof)};` });
  if (ready) await p.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 }));   // the other parent's phone is updated
  if (!empty) { await importData(p); await p.evaluate(t => Store.put("drops", "d-" + t, { t, v: 9000 }), DROP); await p.waitForTimeout(200); }
  await tab(p, "milk");
  return p;
}

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    // ===== 1. unconfigured family: exactly today's numbers, nothing new written =====
    const p = await page(browser, base, { ready: false });
    const S0 = await snap(p);
    check("unconfigured: sources are off and no milk-source documents exist", !(await p.evaluate(() => __nicu.src.on())) && await p.evaluate(() => !Object.keys(__db.slotMilk || {}).length && !Object.keys(__db.milkUsual || {}).length && !Object.keys(__db.schedPeriods || {}).length));
    check("unconfigured: the estimate is the original code path (need = Σ full × feeds/day)", S0.need === await p.evaluate(() => __nicu.src.legacyNeed()) && S0.parts.est > 0, JSON.stringify(S0.parts));
    // a schedule change in an unconfigured family behaves exactly as today (no history is started)
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]');
    await p.click("#editProfile"); await p.selectOption("#suEvery", "4"); p.answers = [true]; await p.click("#suSave"); await p.waitForTimeout(400);
    const S4 = await snap(p);
    check("unconfigured schedule change: no schedule history written, sources still off", await p.evaluate(() => !Object.keys(__db.schedPeriods || {}).length && !__nicu.src.on()));
    check("unconfigured schedule change: today's retroactive recalculation is kept (estimate re-run on the new grid)", S4.parts.nFeeds !== S0.parts.nFeeds);
    await p.click("#editProfile"); await p.selectOption("#suEvery", "3"); p.answers = [true]; await p.click("#suSave"); await p.waitForTimeout(400);
    await tab(p, "milk");
    check("unconfigured: back on the original schedule, every number and the Milk / Today text are identical", sameSnap(await snap(p), S0));

    // ===== 2. phone readiness =====
    check("this phone records its app version", await p.evaluate(() => __db.clients && __db.clients.u1 && __db.clients.u1.v === MilkSources.CLIENT_V));
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await p.waitForTimeout(300);
    check("not ready while the other parent's phone hasn't reported the new version", !(await p.evaluate(() => __nicu.src.sourcesReady())));
    const early = await p.evaluate(async t => [await __nicu.src.setUsual(0, { mom: 100, donor: 0, formula: 0 }), await __nicu.src.singleAlloc(0, t, "donor", 0)], T("11:00"));
    check("tracking can't start until both phones are updated: usual milk and per-feed sources refused, nothing written",
      early.every(r => r.error === "not-ready") && await p.evaluate(() => !__TEST_WRITES.length && !__nicu.src.on()), JSON.stringify(early));
    await p.evaluate(() => Store.put("clients", "u2", { v: 0, t: 1 })); await p.waitForTimeout(100);
    check("not ready while the other phone is on an older version", !(await p.evaluate(() => __nicu.src.sourcesReady())));
    await p.evaluate(() => Store.put("clients", "u2", { v: 1, t: 1 })); await p.waitForTimeout(100);
    check("ready once both phones run this version", await p.evaluate(() => __nicu.src.sourcesReady()));
    await tab(p, "milk");

    // ===== 3. first use changes no number =====
    const r99 = await p.evaluate(() => __nicu.src.setUsual(0, { mom: 59, donor: 40, formula: 0 }));
    const r101 = await p.evaluate(() => __nicu.src.setUsual(0, { mom: 61, donor: 40, formula: 0 }));
    check("usual milk must total exactly 100% (99 and 101 refused, nothing written)", r99.error && r101.error && await p.evaluate(() => !__TEST_WRITES.length));
    await p.evaluate(async () => { await __nicu.src.setUsual(0, { mom: 100, donor: 0, formula: 0 }); await __nicu.src.setUsual(1, { mom: 100, donor: 0, formula: 0 }); });
    await p.waitForTimeout(200);
    check("first use writes exactly one first-use period (from 0, today's schedule)", await p.evaluate(() => { const ps = Object.values(__db.schedPeriods); return ps.length === 1 && ps[0].from === 0 && ps[0].src === "first-use" && ps[0].everyH === 3; }));
    check("sources are now on", await p.evaluate(() => __nicu.src.on()));
    const S1 = await snap(p);
    const num = x => JSON.stringify([x.parts, x.need, x.next]);
    check("first use: every number (estimate, used, feeds, need, next draw) and the Today milk row are identical to before", num(S1) === num(S0), JSON.stringify([S0.parts, S1.parts]));
    check("first use: the Milk tab now shows the working by source, with the same used total", S1.inv.includes("Mother's milk used by scheduled feeds since (" + S0.parts.nFeeds + ")") && S1.inv.includes("Not recorded"), S1.inv.slice(0, 300));
    check("0 / 0 / 100 is accepted", !(await p.evaluate(() => __nicu.src.setUsual(1, { mom: 0, donor: 0, formula: 100 }))).error);
    await p.context().close();

    // ===== 4. the mixed-feed example (scheduled 60 mL, recorded 45 = 30 / 10 / 5) =====
    const q = await page(browser, base, { fullMl: 60 });
    const t11 = T("11:00"), id11 = `b0-${t11}`;
    await q.evaluate(([id, t]) => Store.setFeed(id, { ...__db.feeds[id], v: 45 }), [id11, t11]); await q.waitForTimeout(150);
    await tab(q, "feed"); const tsum0 = await q.textContent('.nx[data-tw="Ada Rose"] .tsum'); await tab(q, "milk");
    const U0 = await q.evaluate(() => __nicu.src.parts());
    const ra = await q.evaluate(t => __nicu.src.setAlloc(0, t, { mom: 300, donor: 100, formula: 50 }, 0), t11);
    check("a 30 / 10 / 5 allocation of a 45 mL feed saves (basis feed, rev 1)", ra.saved && await q.evaluate(id => { const a = __db.slotMilk[id]; return a.basis === "feed" && a.total10 === 450 && a.rev === 1; }, id11), JSON.stringify(ra));
    const one = await q.evaluate(t => __nicu.src.usage(t - 1, t), t11);
    check("that feed charges exactly 40.0 mL of mother's milk (donor 13.3, formula 6.7 of the scheduled 60)", one.mom10 === 400 && one.donor10 === 133 && one.formula10 === 67, JSON.stringify(one));
    const U1 = await q.evaluate(() => __nicu.src.parts());
    check("the estimate's used total is exactly 20.0 mL lower than Not recorded (60 → 40)", Math.round((U0.used - U1.used) * 10) === 200, `${U0.used} → ${U1.used}`);
    check("the feed record is still 45 mL", await q.evaluate(id => __db.feeds[id].v, id11) === 45);
    await tab(q, "feed");
    check("by-mouth totals on Today are unchanged by the allocation", (await q.textContent('.nx[data-tw="Ada Rose"] .tsum')) === tsum0);
    await tab(q, "milk");
    // reconciliation
    const mm = await q.evaluate(t => __nicu.src.setAlloc(0, t, { mom: 300, donor: 100, formula: 100 }, 1), t11);
    check("parts that don't total the feed (50 ≠ 45 mL) are refused", mm.error === "mismatch" && mm.ref.total10 === 450 && await q.evaluate(id => __db.slotMilk[id].rev === 1, id11));
    const t23 = T("23:00"), s23 = await q.evaluate(t => __nicu.src.singleAlloc(1 - 1, t, "donor", 0), t23);
    check("one tap on an unlogged feed: the whole scheduled 60 mL from one source (basis scheduled)", s23.saved && await q.evaluate(t => { const a = __db.slotMilk[`b0-${t}`]; return a.basis === "scheduled" && a.mL10.donor === 600 && a.total10 === 600; }, t23));
    check("a time that isn't a scheduled feed is refused", (await q.evaluate(t => __nicu.src.setAlloc(0, t + 60e3, { mom: 600, donor: 0, formula: 0 }, 0), t23)).error === "not-scheduled");

    // ===== 5. conflict guard and offline =====
    const st = await q.evaluate(t => __nicu.src.setAlloc(0, t, { mom: 450, donor: 0, formula: 0 }, 0), t11);
    check("app guard: an edit from a stale copy (saw rev 0, stored rev 1) is stopped before writing", st.conflict && st.current.rev === 1);
    // the other phone changed it while this one still holds rev 1 (this phone's copy is stale, unseen)
    await q.evaluate(id => { __db.slotMilk[id] = { ...__db.slotMilk[id], rev: 2, mL10: { mom: 0, donor: 450, formula: 0 }, editBy: "parent2@example.com" }; }, id11);
    const w0 = await q.evaluate(() => __TEST_WRITES.length);
    const sv = await q.evaluate(t => __nicu.src.setAlloc(0, t, { mom: 450, donor: 0, formula: 0 }, 1), t11);
    check("server guard: the stale write (rev 2 over stored rev 2) is refused as a conflict, never overwriting", sv.conflict && await q.evaluate(id => __db.slotMilk[id].mL10.donor === 450 && __db.slotMilk[id].editBy === "parent2@example.com", id11) && await q.evaluate(() => __TEST_WRITES.length) === w0 + 1);
    // (put the other phone's copy back through the Store so the app sees it, then continue from it)
    await q.evaluate(id => { const d = __db.slotMilk[id]; delete __db.slotMilk[id]; return Store.guardedPut("slotMilk", id, d); }, id11); await q.waitForTimeout(100);
    const rec = await q.evaluate(id => ({ ...__db.slotMilk[id], rev: __db.slotMilk[id].rev + 1, mL10: { mom: 300, donor: 100, formula: 50 }, editT: 5 }), id11);
    const a1 = await q.evaluate(([id, r]) => Store.guardedPut("slotMilk", id, r), [id11, rec]);
    const a2 = await q.evaluate(([id, r]) => Store.guardedPut("slotMilk", id, r), [id11, rec]);
    check("a resend after a lost acknowledgement counts as already saved (no false conflict)", a1.saved && !a1.already && a2.saved && a2.already);
    // offline: the write is queued, then delivered twice
    const t14 = T("14:00"), id14 = `b0-${t14}`;
    await q.evaluate(() => { window.__TEST_HOLD = []; });
    const held = await q.evaluate(t => __nicu.src.singleAlloc(0, t, "donor", 0), t14);
    await q.evaluate(async () => { const h = window.__TEST_HOLD; window.__TEST_HOLD = null; for (const f of h) { await f(); await f(); } });
    await q.waitForTimeout(150);
    check("offline: a queued write delivered twice leaves one allocation with the same content", held.pending && await q.evaluate(id => { const a = __db.slotMilk[id]; return !!a && a.rev === 1 && a.mL10.donor > 0; }, id14));

    // ===== 6. feed-follow and unknown fields =====
    await tab(q, "feed");
    await q.evaluate(id => Store.setFeed(id, { ...__db.feeds[id], future: "keep-me" }), id14); await q.waitForTimeout(100);
    await sheetSave(q, "Ada Rose", 2, 33);
    check("re-saving a feed keeps a field this version doesn't know (T-7)", await q.evaluate(id => __db.feeds[id].future === "keep-me" && __db.feeds[id].v === 33, id14));
    check("a single-source allocation follows the feed edit (now 33 mL, basis feed, rev 2)", await q.evaluate(id => { const a = __db.slotMilk[id]; return a.mL10.donor === 330 && a.total10 === 330 && a.basis === "feed" && a.rev === 2; }, id14));
    await q.click("#toast button"); await q.waitForTimeout(300);
    check("Undo of the feed edit restores the feed (field kept) and the allocation follows back", await q.evaluate(id => __db.feeds[id].future === "keep-me" && __db.slotMilk[id].total10 === __db.feeds[id].v * 10 && __db.slotMilk[id].rev === 3, id14));
    await sheetSave(q, "Ada Rose", 2, "");
    check("clearing the feed moves a single-source allocation to the scheduled amount", await q.evaluate(id => { const a = __db.slotMilk[id]; return a.basis === "scheduled" && a.total10 === 600 && a.mL10.donor === 600; }, id14));
    await q.click("#toast button"); await q.waitForTimeout(300);
    await sheetSave(q, "Ada Rose", 1, 50);
    check("a mixed allocation is left alone when the feed changes (45 → 50; shown as a mismatch in B2)", await q.evaluate(id => { const a = __db.slotMilk[id]; return a.total10 === 450 && a.mL10.mom === 300; }, id11));
    await tab(q, "milk");

    // ===== 7. usual-milk history and Undo =====
    const now0 = await q.evaluate(() => Date.now());
    const before = await q.evaluate(t => __nicu.src.usage(0, t), now0);
    const u1 = await q.evaluate(() => __nicu.src.setUsual(1, { mom: 0, donor: 100, formula: 0 }));
    check("a usual-milk change leaves every estimate up to its time identical", JSON.stringify(await q.evaluate(t => __nicu.src.usage(0, t), now0)) === JSON.stringify(before));
    const und1 = await q.evaluate(id => __nicu.src.undoUsual(id), u1.id); await q.waitForTimeout(100);
    check("Undo straight away (no feed time passed) deletes the entry", und1.deleted && await q.evaluate(id => !__db.milkUsual[id], u1.id));
    const u2 = await q.evaluate(() => __nicu.src.setUsual(1, { mom: 0, donor: 100, formula: 0 }));
    await ff(q, 4 * 3600e3);
    const und2 = await q.evaluate(id => __nicu.src.undoUsual(id), u2.id); await q.waitForTimeout(100);
    check("Undo after a feed time has passed keeps the entry and adds one restoring the previous setting", und2.restored && await q.evaluate(([a, b]) => !!__db.milkUsual[a] && __db.milkUsual[b] && __db.milkUsual[b].pct === null, [u2.id, und2.id]));

    // ===== 8. schedule changes in a family using sources =====
    const tm11 = at("2026-02-11T11:00:00-05:00");
    await q.evaluate(t => __nicu.src.singleAlloc(0, t, "formula", 0), tm11); await q.waitForTimeout(100);
    const chg = await q.evaluate(() => Date.now()), hist0 = await q.evaluate(t => __nicu.src.usage(0, t), chg), P0 = await q.evaluate(() => Object.keys(__db.schedPeriods).length);
    await tab(q, "more"); await q.click('#moreNav button[data-v="settings"]');
    await q.click("#editProfile"); await q.selectOption("#suEvery", "4"); q.answers = [true]; await q.click("#suSave"); await q.waitForTimeout(400);
    check("a setup change to feed times starts a new period from now", await q.evaluate(([n, c]) => { const ps = Object.values(__db.schedPeriods); const np = ps.find(p => p.src === "setup"); return ps.length === n + 1 && np && np.everyH === 4 && np.from >= c; }, [P0, chg]));
    check("…and every estimate before the change is identical (history keeps its schedule)", JSON.stringify(await q.evaluate(t => __nicu.src.usage(0, t), chg)) === JSON.stringify(hist0));
    check("the pre-set 11 AM source no longer matches a feed time: kept, not counted, listed", await q.evaluate(t => !!__db.slotMilk[`b0-${t}`] && __nicu.src.stranded().includes(`b0-${t}`), tm11));
    check("Baby A's new feed times after the change are 4-hourly", JSON.stringify(await q.evaluate(([a, b]) => { const s = __nicu.src.state(); return MilkSources.occurrences(s.periods, 0, a, b).map(o => new Date(o.t).getHours()); }, [at("2026-02-11T07:00:00-05:00"), at("2026-02-11T19:00:00-05:00")])) === "[8,12,16]");
    await ff(q, 60e3);
    await q.click("#editProfile"); await q.selectOption("#suEvery", "3"); q.answers = [true]; await q.click("#suSave"); await q.waitForTimeout(400);
    check("changing back restores the 11 AM feed time, and its source counts again", await q.evaluate(t => !__nicu.src.stranded().includes(`b0-${t}`), tm11));
    const fullChg = await q.evaluate(() => Date.now()), hist1 = await q.evaluate(t => __nicu.src.usage(0, t), fullChg);
    await ff(q, 60e3);
    await q.click("#editProfile"); await q.fill("#suF0", "70"); await q.click("#suSave"); await q.waitForTimeout(400);
    check("a full-feed change also starts a period; earlier scheduled amounts are untouched", await q.evaluate(() => Object.values(__db.schedPeriods).some(p => p.full10[0] === 700)) && JSON.stringify(await q.evaluate(t => __nicu.src.usage(0, t), fullChg)) === JSON.stringify(hist1));
    // a phone on the old app changes the schedule (profile only): reported, never assigned a time
    const nP = await q.evaluate(() => Object.keys(__db.schedPeriods).length);
    await q.evaluate(() => Store.setProfile({ ...__db.config.profile, schedule: { ...__db.config.profile.schedule, everyH: 2 } })); await q.waitForTimeout(200);
    const dr = await q.evaluate(() => __nicu.src.scheduleDrift());
    check("an old-app schedule change is detected and reported with both versions", !!dr && dr.inEffect.everyH === 3 && dr.profile.everyH === 2);
    check("…and no effective time is assumed: nothing is written", await q.evaluate(() => Object.keys(__db.schedPeriods).length) === nP);
    await q.evaluate(() => Store.setProfile({ ...__db.config.profile, schedule: { ...__db.config.profile.schedule, everyH: 3 } })); await q.waitForTimeout(200);

    // ===== 9. backup round-trip =====
    await q.evaluate(() => { document.querySelector("details.settings").open = true; });
    const [dl] = await Promise.all([q.waitForEvent("download"), q.click("#bkGo")]);
    const bk = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    check("backup carries allocations (with rev), usual-milk history and schedule history",
      Object.keys(bk.data.slotMilk || {}).length >= 4 && Object.keys(bk.data.milkUsual || {}).length >= 2 && Object.keys(bk.data.schedPeriods || {}).length >= 4 && bk.data.slotMilk[id11].rev >= 1);
    check("backup does not carry phone version markers", !("clients" in bk.data));
    const win = [DROP, at("2026-02-12T07:00:00-05:00")];
    const usageQ = await q.evaluate(([a, b]) => __nicu.src.usage(a, b), win);
    await q.evaluate(([a, u]) => { Store.remove("slotMilk", a); Store.remove("milkUsual", u); }, [id11, u2.id]); await q.waitForTimeout(150);
    q.answers = [true]; await q.setInputFiles("#rsFile", await dl.path()); await q.waitForTimeout(500);
    check("restore brings back a missing allocation and history entry exactly (same rev and parts)", await q.evaluate(([a, u, b]) => JSON.stringify(__db.slotMilk[a]) === JSON.stringify(b.data.slotMilk[a]) && JSON.stringify(__db.milkUsual[u]) === JSON.stringify(b.data.milkUsual[u]), [id11, u2.id, bk]));
    check("the estimate after restore is identical", JSON.stringify(await q.evaluate(([a, b]) => __nicu.src.usage(a, b), win)) === JSON.stringify(usageQ));
    await q.setInputFiles("#rsFile", await dl.path()); await q.waitForTimeout(300);
    check("restoring again changes nothing", (await q.textContent("#bkMsg")).startsWith("Nothing to restore"));
    // a fresh, empty family restores the whole thing and computes the same numbers
    const r = await page(browser, base, { fullMl: 60, empty: true });
    await tab(r, "more"); await r.click('#moreNav button[data-v="settings"]'); await r.evaluate(() => { document.querySelector("details.settings").open = true; });
    r.answers = [true]; await r.setInputFiles("#rsFile", await dl.path()); await r.waitForTimeout(800);
    check("restored into an empty family, the estimate is identical", JSON.stringify(await r.evaluate(([a, b]) => __nicu.src.usage(a, b), win)) === JSON.stringify(usageQ), await r.textContent("#bkMsg"));
    const old = JSON.parse(JSON.stringify(bk)); ["slotMilk", "milkUsual", "schedPeriods"].forEach(k => delete old.data[k]);
    const oldF = require("path").join(require("./smoke.js").SHOTS, "bk-no-sources.json"); fs.writeFileSync(oldF, JSON.stringify(old));
    await r.evaluate(id => Store.remove("drops", id), Object.keys(bk.data.drops)[0]); await r.waitForTimeout(100);
    r.answers = [true]; await r.setInputFiles("#rsFile", oldF); await r.waitForTimeout(400);
    check("a backup without milk sources still restores normally", (await r.textContent("#bkMsg")).startsWith("Restored 1 record"), await r.textContent("#bkMsg"));
    check("no page errors (restore page)", r.errors.length === 0, r.errors.join(" | "));
    await r.context().close();

    // ===== 10. CSV round-trip =====
    await q.click("#csvBtn"); await q.waitForTimeout(200);
    const csv = await q.evaluate(async () => document.querySelector("#csvBox").value || await navigator.clipboard.readText().catch(() => ""));
    const lines = csv.split("\n"), head = lines[0];
    check("CSV header ends with the three milk-source columns", head.endsWith(",milk_mother_ml,milk_donor_ml,milk_formula_ml"), head);
    const row11 = lines.find(l => l.startsWith(new Date(t11).toISOString()) && l.includes('"Ada Rose"'));
    check("a feed row carries its recorded (actual) amounts: 30 / 10 / 5", !!row11 && row11.endsWith(",30,10,5"), row11);
    check("a feed with no recorded source has blank source columns", lines.some(l => l.includes('"Bea Joy",PO feed,') && l.endsWith(",,,")));
    const s = await page(browser, base, { fullMl: 60, empty: true });
    await tab(s, "more"); await s.click('#moreNav button[data-v="settings"]');
    await s.evaluate(() => { document.querySelector("details.settings").open = true; document.querySelector("#impBox").closest("details:not(.settings)").open = true; });
    await s.fill("#impBox", csv); await s.click("#impGo"); await s.waitForTimeout(1200);
    const msg = await s.textContent("#impMsg");
    check("CSV import recreates the allocations that reconcile, and reports the one that doesn't (30/10/5 vs a 50 mL feed)", /milk sources/.test(msg) && /1 milk sources didn't add up/.test(msg) && await s.evaluate(t => !__db.slotMilk[`b0-${t}`], t11), msg);
    check("the imported allocation keeps its amounts exactly (donor, = the feed's amount, basis feed)", await s.evaluate(t => { const a = __db.slotMilk[`b0-${t}`], f = __db.feeds[`b0-${t}`]; return a && f && a.mL10.donor === f.v * 10 && a.total10 === f.v * 10 && a.basis === "feed"; }, t14));
    check("allocations for feeds that were never logged aren't in the CSV (backup carries them)", await s.evaluate(t => !__db.slotMilk[`b0-${t}`], t23));
    const s2 = await page(browser, base);   // an older-format CSV (no source columns) still imports unchanged
    check("an older CSV without the new columns imports as before, with no sources", await s2.evaluate(() => Object.keys(__db.feeds).length > 50 && !Object.keys(__db.slotMilk || {}).length && !__nicu.src.on()));
    check("no page errors (CSV pages)", s.errors.length === 0 && s2.errors.length === 0, [...s.errors, ...s2.errors].join(" | "));
    await s.context().close(); await s2.context().close();
    check("no page errors (main page)", q.errors.length === 0, q.errors.join(" | "));
    await q.context().close();
  } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
}
main();
