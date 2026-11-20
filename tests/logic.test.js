// Phase 2.5 pass 2 (rules and logic) fixes, in the browser (stub Store, fictional babies).   cd tests && npm run logic
const { serve, newPage, importData, tab, PROFILE } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const at = s => new Date(s).getTime();
const NOW = "2026-02-10T15:10:00-05:00", ADA = "Ada Rose", BEA = "Bea Joy";
const wait = (p, ms = 250) => p.waitForTimeout(ms);
const setHome = (p, i, t) => p.evaluate(([i, t]) => { const pr = JSON.parse(JSON.stringify(__db.config.profile)); if (t) pr.twins[i].home = t; else delete pr.twins[i].home; return Store.setProfile(pr); }, [i, t]);

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    // ===== P2-06: one matcher — exact, else nearest within the window, ties to the earlier =====
    const p = await newPage(browser, base, { now: NOW });
    const slot = at("2026-02-10T11:00:00-05:00");
    await p.evaluate(([a, b]) => { Store.setFeed(`b0-${a}`, { twin: "Ada Rose", i: 0, t: a, v: 21, note: "", diet: "" }); Store.setFeed(`b0-${b}`, { twin: "Ada Rose", i: 0, t: b, v: 34, note: "", diet: "" }); },
      [at("2026-02-10T10:20:00-05:00"), at("2026-02-10T11:30:00-05:00")]);   // inserted far-one first: "first found" would pick 21
    await tab(p, "feed"); await wait(p, 300);
    const cell = await p.$eval(`#sheet input[data-tw="${ADA}"][data-i="1"]`, i => i.value);
    check("the day sheet fills the 11 AM slot with the nearest logged feed (11:30, 34 mL), not the first found", cell === "34", cell);
    await p.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 }));
    await p.evaluate(() => __nicu.src.setUsual(1, { mom: 100, donor: 0, formula: 0 })); await wait(p);
    const r34 = await p.evaluate(t => __nicu.src.setAlloc(0, t, { mom: 340, donor: 0, formula: 0 }, 0), slot);
    check("milk sources use the same feed for that slot (parts must add up to 34 mL)", !!r34.saved, JSON.stringify(r34));
    await p.evaluate(([a, b]) => { Store.setFeed(`b0-${a}`, { twin: "Ada Rose", i: 0, t: a, v: 25, note: "", diet: "" }); Store.setFeed(`b0-${b}`, { twin: "Ada Rose", i: 0, t: b, v: 27, note: "", diet: "" }); },
      [at("2026-02-10T13:30:00-05:00"), at("2026-02-10T14:30:00-05:00")]);    // both 30 min from the 2 PM slot
    await wait(p, 300);
    check("a tie goes to the earlier feed (1:30 PM, 25 mL)", await p.$eval(`#sheet input[data-tw="${ADA}"][data-i="2"]`, i => i.value) === "25");
    check("no page errors (matching)", p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();

    // ===== P2-07, P2-08, P2-11: after a baby goes home =====
    const q = await newPage(browser, base, { now: NOW });
    await importData(q); await q.evaluate(t => Store.put("drops", "d-" + t, { t, v: 6000 }), at("2026-02-05T08:00:00-05:00")); await wait(q);
    await setHome(q, 0, at("2026-02-10T12:00:00-05:00")); await wait(q, 300);
    await tab(q, "milk"); await wait(q);
    const st1 = await q.textContent("#mkStats");
    check("Milk: with one baby home, the need says whose full feed it counts", st1.includes(`${BEA}'s full feed × 8`) && !st1.includes("both full feeds"), st1);
    await setHome(q, 1, at("2026-02-10T13:00:00-05:00")); await wait(q, 300); await tab(q, "milk"); await wait(q);
    const st2 = await q.textContent("#mkStats"), inv2 = await q.textContent("#mkInv");
    check("Milk: with both babies home, it says so (not 'no mother's milk planned')", st2.includes("both babies are home") && inv2.includes("Both babies are home") && !inv2.includes("usual milk"), inv2.slice(0, 200));
    check("…and no Infinity / NaN anywhere", !/Infinity|NaN/.test(await q.evaluate(() => document.body.innerText)));
    await tab(q, "feed");
    check("Today's milk row says both babies are home", (await q.textContent("#todayMilk")).includes("both babies are home"));
    // milk sources on, a source set for after Ada went home
    await setHome(q, 1, null); await setHome(q, 0, null); await wait(q, 300);
    await q.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 }));
    await q.evaluate(() => __nicu.src.setUsual(1, { mom: 100, donor: 0, formula: 0 })); await wait(q);
    const late = at("2026-02-10T23:00:00-05:00");
    const ra = await q.evaluate(t => __nicu.src.singleAlloc(0, t, "donor", 0), late);
    await setHome(q, 0, at("2026-02-10T12:00:00-05:00")); await wait(q, 300);
    await tab(q, "more"); await q.click('#moreNav button[data-v="records"]'); await wait(q);
    const rec = await q.textContent("#logBody");
    check("Records: a source set for after she went home says 'after going home, not counted'", ra.saved && rec.includes("after going home, not counted"), rec.slice(0, 120));
    check("…and the milk estimate doesn't count it", await q.evaluate(t => __nicu.src.usage(t - 1, t).n === 0, late));
    await q.click('#moreNav button[data-v="care"]'); await wait(q, 300);
    const care = await q.textContent("#srcCare");
    check("Care: a baby who went home shows that, with no usual-milk editor", care.includes("Ada Rose went home") && await q.$$eval('#srcCare [data-se="edit"]', b => b.length) === 1, care.slice(0, 200));
    check("no page errors (after going home)", q.errors.length === 0, q.errors.join(" | "));
    await q.context().close();

    // ===== P2-09: a first baby actually named "A" =====
    const prof = JSON.parse(JSON.stringify(PROFILE)); prof.twins[0].name = "A";
    const r = await newPage(browser, base, { now: NOW, init: `window.__TEST_PROFILE = ${JSON.stringify(prof)};` });
    await tab(r, "feed"); await wait(r, 300);
    check("a first baby named \"A\" loads normally (Today card shown)", !!(await r.$('.nx[data-tw="A"] input')) && (await r.textContent("#title")).startsWith("A & "));
    check("no page errors (baby named A)", r.errors.length === 0, r.errors.join(" | "));
    await r.context().close();

    // ===== a stale "missing profile" snapshot after the profile loaded never sends the app back to setup =====
    const sp = await newPage(browser, base, { now: NOW }); await importData(sp); await tab(sp, "feed");
    await sp.evaluate(() => { const keep = __db.config.profile; delete __db.config.profile; __fireCfg("profile"); __db.config.profile = keep; }); await wait(sp, 300);
    check("a stale 'missing profile' reading after load keeps the app open (no jump back to setup)", await sp.isVisible("#main") && !(await sp.isVisible("#setup")));
    await sp.context().close();

    // ===== Phase 6: in the iOS app, Save full backup writes a file and opens the share sheet =====
    const ip = await newPage(browser, base, { now: NOW, init: () => { window.__capLog = []; window.Capacitor = { isNativePlatform: () => true, Plugins: {
      Filesystem: { writeFile: async o => { __capLog.push(["write", o.path, o.directory, o.encoding, JSON.parse(o.data).app]); return { uri: "file:///cache/" + o.path }; } },
      Share: { share: async o => { __capLog.push(["share", o.url, o.title]); } } } }; } });
    await importData(ip); await ip.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
    await ip.click("#bkGo"); await wait(ip, 400);
    const log = await ip.evaluate(() => __capLog), day = await ip.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    check("in the iOS app, the backup is written to a file and handed to the share sheet", log.length === 2 && log[0][0] === "write" && log[0][1] === `niculog-backup-${day}.json` && log[0][2] === "CACHE" && log[0][4] === "twins-tracker"
      && log[1][0] === "share" && log[1][1] === `file:///cache/niculog-backup-${day}.json` && log[1][2] === "NICUlog backup", JSON.stringify(log));
    check("…and reports it ready", (await ip.textContent("#bkMsg")).startsWith("Backup ready"));
    await ip.context().close();

    // ===== Today's 7-day trend: "yesterday" is yesterday's feed day, even before anything is logged today =====
    const yp = await newPage(browser, base, { now: NOW }); await importData(yp);
    await tab(yp, "feed"); await yp.click('#view button[data-v="#0"]'); await wait(yp, 300);
    // remove every Ada feed logged on today's feed day (the day runs 7 AM–7 AM; NOW is 3:10 PM)
    await yp.evaluate(() => { const start = new Date("2026-02-10T07:00:00-05:00").getTime();
      Object.entries(__db.feeds || {}).forEach(([id, f]) => { if ((f.i === 0 || f.twin === "Ada Rose") && f.t >= start) Store.delFeed(id); }); });
    await wait(yp, 500);
    const shown = await yp.evaluate(() => { const b = [...document.querySelectorAll(".spk b")][0]; return b ? b.textContent.trim() : null; });
    await yp.click("#dPrev"); await wait(yp, 300);
    const sheet = await yp.evaluate(() => { const m = (document.querySelector("#sheet .tws") || {}).textContent || ""; const r = m.match(/(\d+)%/); return r ? r[1] + "%" : null; });
    check("the 7-day trend's 'yesterday' is yesterday's total even when nothing is logged yet today (matches the day sheet)", !!shown && shown === sheet, `trend ${shown} · sheet ${sheet}`);
    await yp.context().close();

    // ===== Plans from rounds: Today card (both views), one per baby per day, editable from Care =====
    const pp = await newPage(browser, base, { now: NOW }); await importData(pp);
    await pp.evaluate(() => { Store.put("plans", "0-2026-02-08", { i: 0, day: "2026-02-08", text: "Old plan" }); }); await wait(pp, 300);
    await tab(pp, "feed"); await pp.click('#view button[data-v="both"]').catch(() => {}); await wait(pp, 300);
    check("Today shows a plan card in the Both view, one row per baby", (await pp.$$("#planToday li")).length === 2 && (await pp.textContent("#planToday")).includes("Nothing written yet today") && (await pp.textContent("#planToday")).includes("Last plan Feb 8: Old plan"));
    await tab(pp, "more"); await pp.click('#moreNav button[data-v="care"]'); await wait(pp);
    pp.answers = ["Old plan, corrected"];
    await pp.click('#careP [data-plan-edit="0|2026-02-08"]'); await wait(pp, 300);
    check("Care: Edit on a past day's plan replaces that day's plan (same entry, nothing added)", await pp.evaluate(() => __db.plans["0-2026-02-08"].text === "Old plan, corrected" && Object.keys(__db.plans).length === 1));
    check("Care: the bottom buttons say Add when there's no plan today", (await pp.textContent("#careP")).includes("Add today's plan"));
    await pp.evaluate(() => { const pr = JSON.parse(JSON.stringify(__db.config.profile)); pr.twins[1].home = Date.now() - 3600e3; return Store.setProfile(pr); }); await wait(pp, 400);
    await tab(pp, "feed"); await wait(pp, 300);
    check("a baby who went home has no plan row on Today", (await pp.$$("#planToday li")).length === 1 && !(await pp.textContent("#planToday")).includes(BEA));
    check("no page errors (plans)", !pp.errors.length, pp.errors.join("; "));
    await pp.context().close();

    // ===== Today: Yesterday line matches the day sheet and opens yesterday's sheet =====
    const yl = await newPage(browser, base, { now: NOW }); await importData(yl);
    await tab(yl, "feed"); await yl.click(`#viewbar button[data-v="${ADA}"], .viewbar button:has-text("${ADA}")`).catch(() => {}); await wait(yl, 300);
    const yTxt = await yl.evaluate(() => { const b = document.querySelector('.nx [data-act="yday"]'); return b ? b.textContent.trim() : null; });
    check("single view: a Yesterday line on the card", !!yTxt && /^Yesterday: \d+ \/ \d+ mL · \d+% · \d+ of \d+ feeds/.test(yTxt), yTxt);
    await yl.click('.nx [data-act="yday"]'); await wait(yl, 300);
    const ySheet = await yl.evaluate(() => (document.querySelector("#sheet .tws") || {}).textContent || "");
    const pctOf = t => (t.match(/(\d+)%/) || [])[1];
    const tot = (ySheet.match(/^\d+ \/ \d+ mL/) || [""])[0];
    check("tapping it opens yesterday's day sheet, and the totals agree", (await yl.textContent("#dLabel")).includes("Feb 9") && !!tot && pctOf(yTxt || "") === pctOf(ySheet) && (yTxt || "").includes(tot), `${yTxt} · ${ySheet}`);
    await yl.click('#view button[data-v="both"]').catch(() => {}); await wait(yl, 300);
    check("Both view: a Yesterday line for each baby", (await yl.$$('.nx [data-act="yday"]')).length === 2);
    check("no page errors (yesterday line)", !yl.errors.length, yl.errors.join("; "));
    await yl.context().close();

    // ===== Bedside camera button (AngelEye etc.): a family link per baby (config/cams), opened from her Today card =====
    const URL1 = "https://nicu.example.org/view", URL2 = "https://nicu.example.org/view2";
    const cp = await newPage(browser, base, { now: NOW }); await importData(cp);
    await tab(cp, "feed"); await wait(cp);
    check("with no camera links, Today offers a one-time note about bedside cameras", (await cp.textContent("#camTip")).includes("bedside cameras"));
    await cp.click('#camTip [data-ct="add"]'); await wait(cp, 300);
    check("'Add camera links' opens Settings", await cp.evaluate(() => document.querySelector(".tab.on").dataset.tab === "more" && document.querySelector(".msec.on").dataset.sec === "settings"));
    const labels = await cp.$$eval("#camFields label", l => l.map(x => x.textContent.trim()));
    check("Settings offers a camera link for each baby, by name", labels.length === 2 && labels[0].startsWith(`${ADA}'s camera link`) && labels[1].startsWith(`${BEA}'s camera link`), labels.join(" | "));
    await cp.fill('[data-cam="0"]', "http://nicu.example.org/view"); await cp.dispatchEvent('[data-cam="0"]', "change"); await wait(cp);
    check("a link that isn't https is refused in plain words and not saved", (await cp.textContent("#camMsg")).includes("starting with https://") && !(await cp.evaluate(() => __db.config.cams)));
    await cp.fill('[data-cam="0"]', URL1); await cp.dispatchEvent('[data-cam="0"]', "change"); await wait(cp);
    check("the link is saved for the family (config/cams), not on the phone", await cp.evaluate(u => !!__db.config.cams && __db.config.cams.links["0"] === u && !localStorage.getItem("camLinks"), URL1));
    await tab(cp, "feed"); await wait(cp);
    check("the note doesn't come back once used", (await cp.textContent("#camTip")).trim() === "");
    const cam = await cp.evaluate(() => [...document.querySelectorAll(".nx")].map(n => { const a = n.querySelector("a.camb"); return a && [n.dataset.tw, a.getAttribute("href"), a.target, a.rel, a.getAttribute("aria-label")]; }));
    check("her Today card gets a camera button that opens the link in a new page; her sister's doesn't", JSON.stringify(cam) === JSON.stringify([[ADA, URL1, "_blank", "noopener noreferrer", `Watch ${ADA}'s camera`], null]), JSON.stringify(cam));
    check("the camera button is 44 px", await cp.$eval("a.camb", a => a.getBoundingClientRect().height >= 44));
    await cp.evaluate(([a, b]) => Store.setConfig("cams", { links: { 0: a, 1: b } }), [URL1, URL2]); await wait(cp);
    check("a link the other parent saves shows up on this phone too", (await cp.$$("a.camb")).length === 2);
    await cp.evaluate(() => { const pr = JSON.parse(JSON.stringify(__db.config.profile)); pr.twins[0].home = Date.now() - 3600e3; return Store.setProfile(pr); }); await wait(cp, 400);
    check("after she goes home, her camera button goes with her card", (await cp.$$("a.camb")).length === 1);
    await cp.evaluate(() => { const pr = JSON.parse(JSON.stringify(__db.config.profile)); delete pr.twins[0].home; return Store.setProfile(pr); }); await wait(cp, 400);
    await tab(cp, "more"); await cp.click('#moreNav button[data-v="settings"]'); await wait(cp);
    await cp.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
    const [dl] = await Promise.all([cp.waitForEvent("download"), cp.click("#bkGo")]); const bk = JSON.parse(require("fs").readFileSync(await dl.path(), "utf8"));
    check("the family backup carries the camera links", !!bk.data.config.cams && bk.data.config.cams.links["1"] === URL2);
    await cp.fill('[data-cam="0"]', ""); await cp.dispatchEvent('[data-cam="0"]', "change"); await tab(cp, "feed"); await wait(cp);
    check("clearing a link removes her button for the family", (await cp.$$("a.camb")).length === 1 && await cp.evaluate(() => !("0" in __db.config.cams.links)));
    await tab(cp, "more"); await cp.click('#moreNav button[data-v="settings"]'); await cp.click("#editProfile"); await wait(cp);
    check("setup shows each baby's current camera link", (await cp.inputValue("#suK0")) === "" && (await cp.inputValue("#suK1")) === URL2);
    await cp.fill("#suK0", "nicu.example.org"); await cp.click("#suSave"); await wait(cp);
    check("setup refuses a camera link that isn't a full https address", (await cp.textContent("#suMsg")).includes(`${ADA}'s camera link`));
    await cp.fill("#suK0", URL1); await cp.click("#suSave"); await wait(cp, 400);
    check("setup saves the camera links for the family", await cp.evaluate(([a, b]) => __db.config.cams.links["0"] === a && __db.config.cams.links["1"] === b, [URL1, URL2]));
    check("no page errors (camera links)", !cp.errors.length, cp.errors.join("; "));
    await cp.context().close();
    const mp = await newPage(browser, base, { now: NOW, init: () => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("camLinks", JSON.stringify({ 1: "https://nicu.example.org/old" })); sessionStorage.setItem("seeded", "1"); } } });
    await importData(mp); await wait(mp, 400);
    check("a link from the first version moves into the family's links and off the phone", await mp.evaluate(() => !!__db.config.cams && __db.config.cams.links["1"] === "https://nicu.example.org/old" && !localStorage.getItem("camLinks")));
    await mp.context().close();
  } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
}
main();
