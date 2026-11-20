// Phase 2b B2 — milk-source screens, end to end in headless Chromium (stub Store, fictional babies).
//   cd tests && npm run sources-ui      Screenshots of every workflow: tests/shots/b2/ (git-ignored).
const fs = require("fs"), path = require("path");
const { serve, newPage, importData, tab, PROFILE, SHOTS } = require("./smoke.js");
const { chromium } = require("playwright");

const OUT = path.join(SHOTS, "b2"); fs.mkdirSync(OUT, { recursive: true });
let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const at = s => new Date(s).getTime();
const DAYNOW = "2026-02-10T15:10:00-05:00";
const T = (d, h) => at(`2026-02-${d}T${h}:00-05:00`);
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, name + ".png"), fullPage: full });
const wait = (p, ms = 250) => p.waitForTimeout(ms);
const care = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="care"]'); await wait(p); };
const tap = (p, sel) => p.$eval(sel, b => b.click()).then(() => p.waitForTimeout(250));   // the sticky header can sit over a just-scrolled notice
const records = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="records"]'); await wait(p); };
const bodyText = p => p.evaluate(() => document.body.innerText);
const ADA = "Ada Rose", BEA = "Bea Joy";

async function page(browser, base, { ready = true, empty = false, prefs, ctx, now = DAYNOW, night = false } = {}) {
  const p = await newPage(browser, base, { now, prefs: { night: "manual", ...(prefs || {}) }, ctx: { deviceScaleFactor: 2, ...(ctx || {}) } });
  if (night) { await p.evaluate(() => localStorage.setItem("night", "1")); await p.reload(); await wait(p, 600); }
  if (!empty) { await importData(p); await p.evaluate(t => { Store.put("drops", "d-" + t, { t, v: 6000 }); Store.setConfig("people", { list: [{ email: "parent1@example.com", name: "Sam" }, { email: "parent2@example.com", name: "Alex" }] }); }, T("05", "08:00")); await wait(p); }
  if (ready) await p.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 }));
  return p;
}
// Set up usual milk through the Care screen (the real workflow).
async function setUsualUI(p, name, k, pct) {
  await care(p);
  const row = `#srcCare .srow:has(b:text("${name}"))`;
  await p.click(`${row} [data-se="edit"]`); await wait(p, 150);
  await p.click(`${row} [data-se="pick"][data-k="${k}"]`); await wait(p, 150);
  if (pct) for (const [s, v] of Object.entries(pct)) { await p.fill(`${row} [data-pk="${s}"]`, String(v)); }
  await p.click(`${row} [data-se="save"]`); await wait(p, 300);
}
const todaySrc = (p, tw) => p.$(`.nx[data-tw="${tw}"] [data-act="src"]`);

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    // ===== 1. version gate =====
    const p = await page(browser, base, { ready: false });
    await care(p); await wait(p, 300);
    const gate = await p.textContent("#srcCare");
    check("Care: before everyone has the updated app, it says so and lists each member account", gate.includes("Everyone in the family needs the updated app first") && gate.includes("You") && gate.includes("Has the updated app") && gate.includes("Hasn't opened the updated app"), gate);
    check("Care: says the check is per member account, not per device", gate.includes("checked for each family member's account") && gate.includes("more than one device"));
    check("Care: no usual-milk controls while the gate is closed", !(await p.$('#srcCare [data-se="edit"]')));
    await shot(p, "01-care-version-gate");
    check("Today shows no milk control until tracking is on", !(await todaySrc(p, ADA)));
    await p.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 })); await wait(p, 300);
    check("Care: once both phones are updated, the usual-milk controls appear", !!(await p.$('#srcCare [data-se="edit"]')) && (await p.textContent("#srcCare")).includes("Saving the first setting starts"));
    check("phone markers hold only a version number and a time (no names, devices or hardware ids)", await p.evaluate(() => Object.keys(__db.clients.u1).sort().join() === "t,v" && Number.isInteger(__db.clients.u1.v)));

    // ===== 2. Care: usual milk, mixed percentages with a live preview =====
    const row = `#srcCare .srow:has(b:text("${ADA}"))`;
    await p.click(`${row} [data-se="edit"]`); await wait(p, 150); await p.click(`${row} [data-se="pick"][data-k="mixed"]`); await wait(p, 150);
    await p.fill(`${row} [data-pk="mom"]`, "60"); await p.fill(`${row} [data-pk="donor"]`, "30"); await p.fill(`${row} [data-pk="formula"]`, "0");
    const bad = await p.textContent("#srcPrev");
    check("mixed shares that don't total 100% are explained and can't be saved", bad.includes("add up to 90%") && await p.$eval("#srcSaveGo", b => b.disabled), bad);
    await shot(p, "02-care-mixed-invalid");
    await p.fill(`${row} [data-pk="donor"]`, "40");
    const prev = await p.textContent("#srcPrev");
    check("live mL preview of the mix on the scheduled feed (60/40 of 49 mL → 29.4 / 19.6)", prev.includes("29.4 mL mother's milk") && prev.includes("19.6 mL donor milk") && !(await p.$eval("#srcSaveGo", b => b.disabled)), prev);
    await shot(p, "03-care-mixed-preview");
    await p.click(`${row} [data-se="save"]`); await wait(p, 300);
    check("saving the first setting turns tracking on (activation record) and saves 60/40", await p.evaluate(() => __db.config.sources && __db.config.sources.on === true && Object.values(__db.milkUsual).some(u => u.i === 0 && u.pct.mom === 60 && u.pct.donor === 40)));
    check("the activation record names every current member account (from the member list)", await p.evaluate(() => JSON.stringify(__db.config.sources.phones) === JSON.stringify(["u1", "u2"])));
    check("activation is written before the first-use period (no stray period when activation is refused)", await p.evaluate(() => Object.values(__db.schedPeriods).filter(x => x.src === "first-use").length === 1));
    check("Care shows when and by whom milk sources were turned on, and who is included", (await p.textContent("#srcCare")).includes("Milk sources turned on") && (await p.textContent("#srcCare")).includes("included: You, Alex"));
    check("the Undo bar offers to undo the usual-milk change", (await p.textContent("#toast")).includes("Usual milk: 60% mother's milk · 40% donor milk"));
    await setUsualUI(p, BEA, "donor");
    const careOn = await p.textContent("#srcCare");
    check("Care shows each baby's usual milk with when and who", careOn.includes("60% mother's milk · 40% donor milk") && careOn.includes("Donor milk") && careOn.includes("Since") && careOn.includes("Sam"), careOn);
    await shot(p, "04-care-usual-set");

    // ===== 3. Today: compact per-feed control and the source sheet =====
    await tab(p, "feed"); await wait(p);
    const line = await p.textContent(`.nx[data-tw="${BEA}"] [data-act="src"]`);
    check("Today card shows a compact milk line for the next feed", line.startsWith("Milk: Donor milk · usual"), line);
    await shot(p, "05-today-milk-line");
    await (await todaySrc(p, ADA)).click(); await wait(p);
    const sh = await p.textContent("#sCard");
    check("the sheet says what the feed is and what it uses now", sh.includes("Milk · Ada Rose") && sh.includes("scheduled 49 mL feed") && sh.includes("usual milk"), sh);
    await shot(p, "06-sheet-open");
    await p.click('#sCard [data-sa="mixed"]'); await wait(p, 150);
    check("Mixed… starts from the usual mix of the scheduled amount (29.4 / 19.6 / 0)", await p.$eval('[data-mk="mom"]', i => i.value) === "29.4" && await p.$eval('[data-mk="donor"]', i => i.value) === "19.6");
    await p.fill('[data-mk="mom"]', "30"); await p.fill('[data-mk="donor"]', "10");
    const tot = await p.textContent("#sTot");
    check("mixed mL that don't reconcile show what's left and can't be saved", tot.includes("Total 40 of 49 mL") && tot.includes("9 mL to go") && await p.$eval("#sMixGo", b => b.disabled), tot);
    await shot(p, "07-sheet-mixed-mismatch");
    await p.fill('[data-mk="formula"]', "9");
    check("…and save once they add up exactly", (await p.textContent("#sTot")) === "Total 49 of 49 mL" && !(await p.$eval("#sMixGo", b => b.disabled)));
    await p.click("#sMixGo"); await wait(p, 300);
    const tA = await p.evaluate(tw => { const n = document.querySelector(`.nx[data-tw="${tw}"]`); return n ? +n.dataset.i : null; }, ADA);
    const nextT = await p.evaluate(() => { const r = document.querySelector('.nx[data-tw="Ada Rose"]'); return __nicu.src.state && r ? r.dataset.day + "|" + r.dataset.i : ""; });
    check("the mixed allocation is saved (30 / 10 / 9 mL of the scheduled 49, basis scheduled)", await p.evaluate(() => Object.values(__db.slotMilk).some(a => a.i === 0 && a.mL10.mom === 300 && a.mL10.donor === 100 && a.mL10.formula === 90 && a.basis === "scheduled")));
    check("Today's line now shows the mix", (await p.textContent(`.nx[data-tw="${ADA}"] [data-act="src"]`)).includes("Mixed · 30 / 10 / 9 mL"));
    await p.click("#toast button"); await wait(p, 300);
    check("Undo removes the new allocation", await p.evaluate(() => !Object.values(__db.slotMilk).some(a => a.i === 0 && a.mL10 && a.mL10.formula === 90)));

    // ===== 4. Records: source per feed, editing, Undo =====
    const t1430 = T("10", "14:30");             // Bea's 2:30 PM feed (logged by the synthetic import? no: Bea's feeds are on :30 slots)
    await records(p);
    const recTxt = await p.textContent("#logBody");
    check("Records shows the milk for each feed (usual)", recTxt.includes("Donor milk · usual") && recTxt.includes("60% mother's milk · 40% donor milk · usual"));
    const btn = await p.$(`#logBody button.srcbtn[data-src^="1|"]`); await btn.click(); await wait(p);
    await p.click('#sCard [data-sa="one"][data-k="mom"]'); await wait(p, 300);
    const edited = await p.evaluate(() => Object.values(__db.slotMilk).find(a => a.i === 1 && a.mL10 && a.mL10.mom > 0));
    check("one tap in Records sets a feed to one source (the logged amount, basis feed)", !!edited && edited.basis === "feed" && edited.mL10.donor === 0, JSON.stringify(edited));
    check("Records shows the change", (await p.textContent("#logBody")).includes("Mother's milk"));
    await shot(p, "08-records-sources");
    await p.click("#toast button"); await wait(p, 300);
    check("Undo in Records takes it back", await p.evaluate(id => !__db.slotMilk[id], `b1-${edited.t}`));

    // ===== 5. conflicts =====
    // 5a. the other parent changes it while this sheet is open (app guard)
    const t1130 = T("10", "11:30"), id1130 = `b1-${t1130}`;
    await p.evaluate(t => __nicu.src.singleAlloc(1, t, "donor", 0), t1130); await wait(p);
    await p.click(`#logBody button.srcbtn[data-src="1|${t1130}"]`); await wait(p);
    await p.evaluate(id => { const d = { ...__db.slotMilk[id], rev: __db.slotMilk[id].rev + 1, mL10: { mom: 0, donor: 0, formula: __db.slotMilk[id].total10 }, editBy: "parent2@example.com" }; Store.remove("slotMilk", id); Store.put("slotMilk", id, d); }, id1130);
    await wait(p);
    await p.click('#sCard [data-sa="one"][data-k="mom"]'); await wait(p, 300);
    const cf = await p.textContent("#sCard");
    check("a change made from a stale sheet is stopped and explained (who changed it, both versions)", cf.includes("Changed on the other phone") && cf.includes("Alex changed the milk") && cf.includes("Formula") && cf.includes("Mother's milk") && cf.includes("hasn't been applied"), cf);
    check("…and nothing was overwritten", await p.evaluate(id => __db.slotMilk[id].mL10.formula > 0 && __db.slotMilk[id].editBy === "parent2@example.com", id1130));
    await shot(p, "09-sheet-conflict");
    await p.click('#sCard [data-sa="close"]'); await wait(p);
    await tab(p, "feed");
    check("closing without choosing keeps the conflict: a review notice stays on Today", (await p.textContent("#srcNote")).includes("A milk source needs your review"));
    check("the kept change survives a reload (stored on this phone)", await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("srcConflicts:") && JSON.parse(localStorage.getItem(k)).length === 1)));
    await shot(p, "10-today-review-notice");
    await tap(p, '#srcNote [data-sn="conflict"]'); await wait(p);
    await p.click('#sCard [data-sa="mine"]'); await wait(p, 300);
    check("Use mine replaces theirs (guarded, new rev) and clears the notice", await p.evaluate(id => __db.slotMilk[id].mL10.mom > 0 && __db.slotMilk[id].editBy === "parent1@example.com", id1130) && !(await p.textContent("#srcNote")).includes("review"));
    // 5b. the server refuses a write the phone didn't know was stale
    await p.evaluate(id => { __db.slotMilk[id] = { ...__db.slotMilk[id], rev: __db.slotMilk[id].rev + 1, mL10: { mom: 0, donor: __db.slotMilk[id].total10, formula: 0 }, editBy: "parent2@example.com" }; }, id1130);
    await records(p); await p.click(`#logBody button.srcbtn[data-src="1|${t1130}"]`); await wait(p);
    await p.click('#sCard [data-sa="one"][data-k="formula"]'); await wait(p, 300);
    const ban = await p.textContent("#banner");
    check("a server-side conflict is explained in plain words", ban.includes("The other phone changed a milk source first") && ban.includes("Your change is kept"), ban);
    await tab(p, "feed");
    check("…and the review notice appears", (await p.textContent("#srcNote")).includes("needs your review"));
    await tap(p, '#srcNote [data-sn="conflict"]'); await wait(p);
    const cf2 = await p.textContent("#sCard"); if (!cf2) console.log("DEBUG", p.errors, await p.evaluate(() => [document.querySelector("#sSheet").hidden, localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("srcConflicts:")))]));
    check("the review shows theirs (donor) and yours (formula)", cf2.includes("Donor milk") && cf2.includes("Formula"), cf2.replace(/\s+/g, " "));
    await p.click('#sCard [data-sa="keep"]'); await wait(p, 300);
    check("Keep theirs drops yours and leaves their choice in place", !(await p.textContent("#srcNote")).includes("review") && await p.evaluate(id => __db.slotMilk[id].mL10.donor > 0, id1130));

    // ===== 6. Milk tab: the working by source =====
    // a past mixed feed: Ada's 2 PM feed was logged, so the parts must add up to its logged amount
    const mixR = await p.evaluate(t => { const v10 = __db.feeds[`b0-${t}`].v * 10; return __nicu.src.setAlloc(0, t, { mom: v10 - 100, donor: 60, formula: 40 }, 0); }, T("10", "14:00")); await wait(p);
    check("a mixed feed matching the logged amount saves", !!mixR.saved, JSON.stringify(mixR));
    await tab(p, "milk"); await wait(p);
    const inv = await p.textContent("#mkInv");
    check("Milk tab: mother's milk used, split into usual / per-feed / Not recorded", inv.includes("Mother's milk used by scheduled feeds since") && inv.includes("From usual milk") && inv.includes("From sources set for a feed") && inv.includes("Not recorded — counted as mother's milk, as before"), inv);
    check("Milk tab: mixed feeds and the donor milk / formula not counted are shown", inv.includes("Mixed feeds among these") && inv.includes("Not counted: donor milk"), inv);
    const sub = await p.evaluate(() => { const u = __nicu.src.parts().src; return u.by.usual.mom10 + u.by.alloc.mom10 + u.by.none.mom10 === u.mom10 && u.by.usual.n + u.by.alloc.n + u.by.none.n === u.n; });
    check("the parts of the working add up exactly to the total", sub);
    const stats = await p.textContent("#mkStats");
    check("Need / day is labelled mother's milk", stats.includes("Need / day (mother's milk)") && stats.includes("at the current usual milk"), stats);
    check("the note under the estimate explains what's counted", (await p.textContent("#mkNote")).includes("Donor milk and formula aren't taken from mother's stock"));
    await shot(p, "11-milk-breakdown", true);

    // ===== 7. Journey: a source only when the whole day was one source =====
    for (const h of ["08:30", "11:30", "14:30"]) await p.evaluate(t => { const id = `b1-${t}`, a = __db.slotMilk[id]; return a ? __nicu.src.singleAlloc(1, t, "donor", a.rev) : __nicu.src.singleAlloc(1, t, "donor", 0); }, T("10", h));
    await wait(p);
    await tab(p, "trends"); await wait(p, 300);
    const jr = await p.textContent("#jRail");
    check("Journey's daily summary names the source when the whole day was donor milk", /Bea Joy:[^\n]*donor milk/.test(jr), jr.slice(0, 400));
    check("…and names none for a day of mixed or unrecorded feeds", !/Ada Rose:[^\n]*(mother's milk|donor milk|formula)/.test(jr));
    await p.evaluate(() => document.querySelector("#jCard").scrollIntoView()); await shot(p, "12-journey-source");

    // ===== 8. zero mother's milk planned =====
    await p.evaluate(async () => { await __nicu.src.setUsual(0, { mom: 0, donor: 0, formula: 100 }); await __nicu.src.setUsual(1, { mom: 0, donor: 100, formula: 0 }); }); await wait(p);
    await tab(p, "milk"); await wait(p);
    const zt = await bodyText(p);
    check("zero need: no Infinity, NaN or division artefacts anywhere", !/Infinity|NaN/.test(zt));
    check("zero need: the estimate says there's no days figure, in words", (await p.textContent("#mkInv")).includes("No mother's milk is planned"));
    check("zero need: Need / day 0 with 'no mother's milk planned', no % of need", (await p.textContent("#mkStats")).includes("no mother's milk planned") && !(await p.textContent("#mkStats")).includes("% of need"));
    await shot(p, "13-milk-zero-need", true);
    check("zero need: no Infinity / NaN anywhere", !/Infinity|NaN/.test(await bodyText(p)));
    await p.evaluate(async () => { await __nicu.src.setUsual(0, { mom: 60, donor: 40, formula: 0 }); await __nicu.src.setUsual(1, { mom: 0, donor: 100, formula: 0 }); }); await wait(p);

    // ===== 9. schedule change: stranded upcoming sources =====
    const t17 = T("10", "17:00");
    await p.evaluate(t => __nicu.src.singleAlloc(0, t, "formula", 0), t17); await wait(p);
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]');
    await p.click("#editProfile"); await p.selectOption("#suEvery", "4"); p.answers = [true]; await p.click("#suSave"); await wait(p, 400);
    const dlg = p.dialogs.slice(-1)[0] || "";
    check("the feed-time change confirm names upcoming sources that won't match", dlg.includes("1 milk source set for upcoming feeds won't match the new times") && dlg.includes("kept in Records but not counted"), dlg);
    await records(p);
    const rec2 = await p.textContent("#logBody");
    check("Records lists the stranded source as not on the feed schedule, not counted", rec2.includes("not on the feed schedule, not counted"));
    check("Milk tab notes it too", await (async () => { await tab(p, "milk"); return (await p.textContent("#mkInv")).includes("no longer scheduled"); })());
    await records(p); await p.evaluate(() => document.querySelector('#logBody tr[data-kind="src"]')?.scrollIntoView({ block: "center" }));
    await shot(p, "14-records-stranded");
    await p.context().clock.fastForward(60e3);
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]');
    await p.click("#editProfile"); await p.selectOption("#suEvery", "3"); p.answers = [true]; await p.click("#suSave"); await wait(p, 400);

    // ===== 10. old-app schedule change: detected, explained, recorded only when a parent confirms =====
    const nP = await p.evaluate(() => Object.keys(__db.schedPeriods).length);
    await p.evaluate(() => Store.setProfile({ ...__db.config.profile, schedule: { ...__db.config.profile.schedule, everyH: 2 } })); await wait(p, 300);
    await tab(p, "feed");
    check("Today shows a notice that feed times changed on another phone", (await p.textContent("#srcNote")).includes("Feed times changed on another phone"));
    await tap(p, '#srcNote [data-sn="drift"]'); await wait(p, 300);
    const dc = await p.textContent("#srcDrift");
    check("the Milk tab explains it with both schedules and asks when the new times started", dc.includes("Earlier") && dc.includes("Every 3 h") && dc.includes("Every 2 h") && dc.includes("When did the new feed times start?"), dc);
    check("nothing is recorded until a parent confirms", await p.evaluate(() => Object.keys(__db.schedPeriods).length) === nP && await p.$eval("#drWhen", i => i.value === ""));
    await shot(p, "15-milk-drift", true);
    await p.click("#drGo"); await wait(p);
    check("confirming without a time asks for one", (await p.textContent("#drMsg")).includes("Pick the date and time"));
    await p.fill("#drWhen", "2026-02-10T08:00"); await p.click("#drGo"); await wait(p);
    check("a time before the earlier feed times were recorded is refused with a reason", (await p.textContent("#drMsg")).includes("before the earlier feed times were recorded"));
    await p.context().clock.fastForward(10 * 60e3);
    const localMin = () => p.evaluate(() => { const d = new Date(Date.now() - 60e3), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; });
    const when = await localMin();
    await p.fill("#drWhen", when); await p.click("#drGo"); await wait(p, 300);
    check("confirming records an 'observed' period from the chosen time and clears the notice", await p.evaluate(w => Object.values(__db.schedPeriods).some(x => x.src === "observed" && x.everyH === 2 && x.from === new Date(w).getTime()), when) && await p.$eval("#srcDrift", e => e.hidden));
    await p.evaluate(() => Store.setProfile({ ...__db.config.profile, schedule: { ...__db.config.profile.schedule, everyH: 3 } })); await wait(p);
    await p.context().clock.fastForward(5 * 60e3); await tab(p, "milk"); await wait(p);
    if (!(await p.$eval("#srcDrift", e => e.hidden))) { await p.fill("#drWhen", await localMin()); await p.click("#drGo"); await wait(p, 300); }

    // ===== 11. offline =====
    await p.context().setOffline(true); await tab(p, "feed"); await wait(p);
    await (await todaySrc(p, BEA)).click(); await wait(p);
    await p.click('#sCard [data-sa="one"][data-k="mom"]'); await wait(p, 300);
    check("offline: a save says it's on this phone and will sync later", (await p.textContent("#banner")).includes("Saved on this phone. It will sync when you're back online."));
    await shot(p, "16-offline-saved");
    await p.context().setOffline(false);

    // ===== 12. every new control is at least 44 px =====
    await care(p); await p.click(`${row} [data-se="edit"]`); await p.click(`${row} [data-se="pick"][data-k="mixed"]`); await wait(p);
    const small = await p.evaluate(() => [...document.querySelectorAll("#srcCare button, #srcCare input, #logBody .srcbtn, .srcline, #srcNote button")].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).map(b => b.textContent.trim().slice(0, 30)));
    await tab(p, "feed"); await (await todaySrc(p, ADA)).click(); await p.click('#sCard [data-sa="mixed"]'); await wait(p);
    const small2 = await p.evaluate(() => [...document.querySelectorAll("#sCard button, #sCard input")].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).map(b => b.textContent.trim().slice(0, 30)));
    check("every new control is at least 44 px tall", !small.length && !small2.length, [...small, ...small2].join(" | "));
    await p.click('#sCard [data-sa="close"]');

    // ===== 13. backup → restore into a family whose phones aren't both updated =====
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await p.evaluate(() => { document.querySelector("details.settings").open = true; });
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#bkGo")]);
    const bkFile = path.join(OUT, "backup-with-sources.json"); await dl.saveAs(bkFile);
    const bk = JSON.parse(fs.readFileSync(bkFile, "utf8"));
    check("the backup never carries the activation record", !(bk.data.config && bk.data.config.sources));
    const win = [T("05", "08:00"), T("11", "07:00")];
    const srcUsage = await p.evaluate(([a, b]) => __nicu.src.usage(a, b), win);
    check("no page errors (main walk-through)", p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();

    const r = await page(browser, base, { ready: false, empty: true });
    await tab(r, "more"); await r.click('#moreNav button[data-v="settings"]'); await r.evaluate(() => { document.querySelector("details.settings").open = true; });
    r.answers = [true]; await r.setInputFiles("#rsFile", bkFile); await wait(r, 800);
    check("restore brings every allocation and history entry back intact", await r.evaluate(b => ["slotMilk", "milkUsual", "schedPeriods"].every(c => Object.entries(b.data[c]).every(([id, d]) => JSON.stringify(__db[c][id]) === JSON.stringify(d))), bk));
    check("…but tracking stays off while the other phone isn't updated (legacy estimate, no activation)", await r.evaluate(() => !__nicu.src.on() && !(__db.config.sources)));
    await care(r);
    const rc = await r.textContent("#srcCare");
    check("Care explains the restored sources are waiting until everyone has the updated app", rc.includes("Everyone in the family needs the updated app first") && rc.includes("saved here (for example from a backup)"), rc);
    await shot(r, "17-care-restored-waiting");
    await r.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 })); await wait(r, 300);
    check("once both phones are updated, Care offers to turn them on", (await r.textContent("#srcCare")).includes("Turn on milk sources"));
    await shot(r, "18-care-restored-turn-on");
    const nPer = await r.evaluate(() => Object.keys(__db.schedPeriods).length);
    await r.click('#srcCare [data-se="turnon"]'); await wait(r, 400);
    check("turning on uses the restored history with its original dates (no new first-use period)", await r.evaluate(() => __nicu.src.on()) && await r.evaluate(() => Object.keys(__db.schedPeriods).length) === nPer);
    check("…and the estimate matches the original family's exactly", JSON.stringify(await r.evaluate(([a, b]) => __nicu.src.usage(a, b), win)) === JSON.stringify(srcUsage));
    check("no page errors (restore)", r.errors.length === 0, r.errors.join(" | "));
    await r.context().close();

    // ===== 13b. single member, refused activation, a member who joins later =====
    const one = await page(browser, base, { ready: false });
    await one.evaluate(() => { __fam.members = __fam.members.filter(m => m.uid === "u1"); });
    await care(one); await wait(one, 300);
    check("a one-member family can turn milk sources on (only its own account is required)", !!(await one.$('#srcCare [data-se="edit"]')));
    await setUsualUI(one, ADA, "donor");
    check("…and the record names just that account", await one.evaluate(() => JSON.stringify(__db.config.sources && __db.config.sources.phones) === '["u1"]'));
    check("no page errors (one member)", one.errors.length === 0, one.errors.join(" | "));
    await one.context().close();
    const rf = await page(browser, base);
    await rf.evaluate(() => { window.__TEST_OFFLINE_ACTIVATE = true; });   // the server can't be reached for the member list
    await care(rf); await rf.click(`${row} [data-se="edit"]`); await rf.click(`${row} [data-se="pick"][data-k="donor"]`); await rf.click(`${row} [data-se="save"]`); await wait(rf, 300);
    check("turning on without a connection says it needs one, and writes nothing", (await rf.textContent("#srcMsg")).includes("needs a connection") && await rf.evaluate(() => !__db.config.sources && !Object.keys(__db.schedPeriods || {}).length && !Object.keys(__db.milkUsual || {}).length));
    // The app's own copy says the other account is ready, but the backend's copy is out of date: the backend decides.
    await rf.evaluate(() => { window.__TEST_OFFLINE_ACTIVATE = false; __db.clients.u2 = { v: 0, t: 1 }; });
    await rf.click(`${row} [data-se="save"]`).catch(() => {}); await wait(rf, 300);
    check("if the backend refuses (an account's marker out of date), nothing is turned on and no stray data is left", await rf.evaluate(() => !__db.config.sources && !Object.keys(__db.schedPeriods || {}).length));
    await rf.evaluate(() => { __db.clients.u2 = { v: 1, t: 1 }; }); await rf.click(`${row} [data-se="save"]`).catch(() => {}); await wait(rf, 300);
    check("once the marker is current, turning on succeeds", await rf.evaluate(() => !!(__db.config.sources && __db.config.sources.on)));
    await rf.evaluate(() => { __fam.members.push({ uid: "u3", email: "parent3@example.com" }); __db.config.people = { list: [{ email: "parent1@example.com", name: "Sam" }, { email: "parent2@example.com", name: "Alex" }, { email: "parent3@example.com", name: "Robin" }] }; });
    await rf.evaluate(() => Store.setConfig("people", __db.config.people)); await records(rf); await care(rf); await wait(rf, 400);
    const late = await rf.textContent("#srcCare");
    check("a member who joins after activation is named as not included, never shown as activated", late.includes("Robin joined after milk sources were turned on") && late.includes("included: You, Alex") && !late.includes("included: You, Alex, Robin"), late);
    check("…and the Care list marks them and their app status", late.includes("Joined after milk sources were turned on") && late.includes("Hasn't opened the updated app"));
    await shot(rf, "19-care-member-joined-later");
    check("the activation record itself is unchanged by a new member", await rf.evaluate(() => JSON.stringify(__db.config.sources.phones) === '["u1","u2"]'));
    check("no page errors (activation cases)", rf.errors.length === 0, rf.errors.join(" | "));
    await rf.context().close();

    // ===== 14. themes and A++ =====
    for (const [name, opts] of [["dark", { ctx: { colorScheme: "dark" } }], ["night", { night: true }], ["aplus", { prefs: { text: "1.3" } }]]) {
      const q = await page(browser, base, opts);
      await setUsualUI(q, ADA, "mixed", { mom: 60, donor: 40, formula: 0 }); await setUsualUI(q, BEA, "donor");
      await q.evaluate(t => __nicu.src.setAlloc(0, t, { mom: 300, donor: 100, formula: 90 }, 0), T("10", "14:00"));
      await care(q); await q.click(`${row} [data-se="edit"]`); await q.click(`${row} [data-se="pick"][data-k="mixed"]`); await wait(q); await shot(q, `20-${name}-care`);
      await q.click(`${row} [data-se="cancel"]`);
      await tab(q, "feed"); await q.evaluate(() => scrollTo(0, 0)); await shot(q, `21-${name}-today`);
      await (await todaySrc(q, ADA)).click(); await q.click('#sCard [data-sa="mixed"]'); await wait(q); await shot(q, `22-${name}-sheet`);
      await q.click('#sCard [data-sa="close"]');
      await tab(q, "milk"); await shot(q, `23-${name}-milk`, true);
      await records(q); await shot(q, `24-${name}-records`);
      const over = await q.evaluate(() => [...document.querySelectorAll("#logBody, #mkInv, #srcCare")].some(el => el.scrollWidth > el.clientWidth + 1) || document.documentElement.scrollWidth > innerWidth + 1);
      check(`${name}: no horizontal overflow on the new screens`, !over);
      check(`${name}: no page errors`, q.errors.length === 0, q.errors.join(" | "));
      await q.context().close();
    }
  } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
}
main();
