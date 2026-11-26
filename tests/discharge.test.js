// One baby goes home: she leaves daily tracking (Today, day sheet, new weights, Progress, the milk estimate) from the
// time she went home; her history stays. Headless Chromium, stub Store, fictional babies.   cd tests && npm run discharge
const path = require("path");
const { serve, newPage, importData, tab, SHOTS } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const at = s => new Date(s).getTime();
const NOW = "2026-02-10T15:10:00-05:00", HOME = "2026-02-10T12:00", ADA = "Ada Rose", BEA = "Bea Joy";
const wait = (p, ms = 250) => p.waitForTimeout(ms);
const settings = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]').then(() => p.evaluate(() => document.querySelectorAll("details.sfold").forEach(d => d.open = true))); await wait(p); };
async function setHome(p, value) { await settings(p); await p.click("#editProfile"); await p.fill("#suH0", value); await p.click("#suSave"); await wait(p, 400); }
const parts = p => p.evaluate(() => { const x = __nicu.src.parts(); return { used: x.used, nFeeds: x.nFeeds, est: x.est, need: __nicu.src.need() }; });

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    const p = await newPage(browser, base, { now: NOW, ctx: { deviceScaleFactor: 2 } });
    await importData(p);
    await p.evaluate(t => Store.put("drops", "d-" + t, { t, v: 6000 }), at("2026-02-05T08:00:00-05:00")); await wait(p);
    const upToHome = () => p.evaluate(h => JSON.stringify(__nicu.src.usage(new Date("2026-02-05T08:00:00-05:00").getTime(), new Date(h).getTime() - 1)), HOME);
    const beforeHome = await upToHome();
    const before = await parts(p), recBefore = await p.evaluate(() => Object.keys(__db.feeds).length);
    const fullA = await p.evaluate(() => { const t = __db.config.profile.twins[0]; return Math.round(150 * t.birthG / 1000 / 8); });

    // ---- validation ----
    await setHome(p, "2026-01-20T12:00");
    check("a went-home time before birth is refused, in plain words", (await p.textContent("#suMsg")).includes("between birth and now"));
    await p.fill("#suH0", "2026-02-12T12:00"); await p.click("#suSave"); await wait(p);
    check("a went-home time in the future is refused", (await p.textContent("#suMsg")).includes("between birth and now") && await p.evaluate(() => !__db.config.profile.twins[0].home));

    // ---- set it ----
    await p.fill("#suH0", HOME); await p.click("#suSave"); await wait(p, 400);
    check("saving stores when she went home on the babies' profile (no new collection)", await p.evaluate(h => __db.config.profile.twins[0].home === new Date(h).getTime() && !__db.config.profile.twins[1].home, HOME));
    await tab(p, "feed"); await p.evaluate(() => scrollTo(0, 0));
    const today = await p.textContent("#next");
    check("Today (Both): her card shrinks to one line after her sister's, with a way to view her", today.includes("Ada Rose · home since Feb 10") && await p.evaluate(() => { const s = [...document.querySelectorAll("#next > section")]; return s.length === 2 && s[1].classList.contains("mini") && !!s[1].querySelector("[data-viewbaby='0']"); }), today.slice(0, 200));
    check("selector: her chip is marked Home and is smaller", await p.evaluate(() => { const b = document.querySelector('#view button[data-v="#0"]'), c = document.querySelector('#view button[data-v="#1"]'); return b.classList.contains("home") && b.textContent.includes("Home") && b.getBoundingClientRect().width < c.getBoundingClientRect().width && b.getBoundingClientRect().height >= 44; }));
    check("selector: her sister (still in the NICU) is on the left, then her, then Both", await p.evaluate(() => { const x = s => document.querySelector(`#view button[data-v="${s}"]`).getBoundingClientRect().left; return x("#1") < x("#0") && x("#0") < x("both"); }));
    await p.click("#next [data-viewbaby='0']"); await wait(p, 300);
    const solo = await p.textContent("#next");
    check("View her: the full went-home note with links to her Growth and Journey", solo.includes("Ada Rose went home on Tue, Feb 10 at 12p") && solo.includes("Her history stays") && !!(await p.$('#next [data-gotab="weight"]')) && (await p.textContent("#ctxLabel")).includes(ADA));
    await p.click('#view button[data-v="both"]'); await wait(p, 300);
    check("Today: no feed entry for her, her sister's card unchanged", !(await p.$(`.nx[data-tw="${ADA}"] input`)) && !!(await p.$(`.nx[data-tw="${BEA}"] input`)));
    await p.screenshot({ path: path.join(SHOTS, "discharge-today.png"), fullPage: true });
    check("Today's day sheet still shows her for the day she left (feeds before she went home)", await p.$$eval("#sheet .tw", t => t.length) === 2);
    // ---- milk estimate ----
    const after = await parts(p);
    check("milk: her one scheduled feed after she went home (2 PM) no longer counts", before.nFeeds - after.nFeeds === 1 && Math.round((before.used - after.used) * 10) === fullA * 10, JSON.stringify([before, after]));
    check("milk: every feed before she went home still counts (the estimate up to that moment is identical)", (await upToHome()) === beforeHome);
    check("milk: need / day counts only her sister", Math.round(after.need) === Math.round(before.need - fullA * 8), `${before.need} → ${after.need}`);
    // ---- history stays ----
    await tab(p, "more"); await p.click('#moreNav button[data-v="records"]'); await wait(p);
    check("Records: all her feeds are still there", await p.evaluate(() => Object.keys(__db.feeds).length) === recBefore && (await p.textContent("#logBody")).includes(ADA));
    await tab(p, "weight"); await wait(p);
    const grid = await p.evaluate(tw => [...document.querySelectorAll("#wBody tr")][0].innerText, ADA);
    check("Growth: tonight shows 'Home' for her (no entry box), her sister still has one", grid.includes("Home") && await p.$$eval("#wBody tr:first-child input", x => x.length) === 1, grid);
    check("Growth: her weight history and chart remain (summary shrinks to one line, last)", (await p.textContent("#grSum")).includes(ADA + " · home since") && await p.evaluate(() => document.querySelector("#grSum").lastElementChild.classList.contains("mini")));
    await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(SHOTS, "discharge-growth.png") });
    await tab(p, "trends"); await wait(p, 300);
    check("Progress: her card says she went home (no discharge-readiness markers for her)", (await p.textContent("#home")).includes("Ada Rose · home since") && (await p.$$eval("#home .bcard:not(.gone) .ind", x => x.length)) === 5);
    // suggestions are offered one at a time, oldest first: step past the earlier ones with "Not now"
    let seen = false; for (let k = 0; k < 12 && !seen; k++) { seen = (await p.textContent("#jCard")).includes("Came home"); if (!seen) { const d = await p.$('#jCard [data-sg="dismiss"]'); if (!d) break; await d.click(); await wait(p, 200); } }
    check("Journey: offers the 'Came home' milestone for her", seen);
    if (seen) { await p.click('#jCard [data-sg="add"]'); await wait(p, 300);
      check("…and adding it saves a valid milestone dated when she went home", await p.evaluate(h => Object.values(__db.events || {}).some(e => e.key === "came-home" && e.i === 0 && e.title === "Came home" && e.t === new Date(h).getTime() && __nicu.validEvent(e)), HOME)); }
    // ---- the next day: only her sister ----
    await p.context().clock.fastForward(24 * 3600e3); await tab(p, "feed"); await wait(p, 400);
    await p.$eval("#dNext", b => b.click()); await wait(p, 300);
    check("the next day's sheet shows only her sister", await p.$$eval("#sheet .tw", t => t.length) === 1);
    // ---- milk sources path ----
    await p.evaluate(() => Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 }));
    const legacyAfter = await parts(p);
    await p.evaluate(() => __nicu.src.setUsual(1, { mom: 100, donor: 0, formula: 0 })); await wait(p);
    const srcAfter = await parts(p);
    check("milk sources on: the same estimate and need (her feeds stop at the same time)", Math.round(srcAfter.used * 10) === Math.round(legacyAfter.used * 10) && srcAfter.nFeeds === legacyAfter.nFeeds && Math.round(srcAfter.need) === Math.round(legacyAfter.need), JSON.stringify([legacyAfter, srcAfter]));
    // ---- NICU stay summary ----
    await p.evaluate(() => { Store.put("events", "e-1770500000000-sm01", { kind: "moment", scope: "baby", i: 0, key: null, t: new Date("2026-02-07T10:00:00-05:00").getTime(), title: "First bath", note: "", ref: null, src: null, createdT: 1, editT: 1, editBy: "parent1@example.com" });
      Store.put("checklist", "b0-hearing", { s: "done", d: "2026-02-08" }); }); await wait(p, 300);
    await tab(p, "trends"); await p.click('#jNav button[data-v="progress"]'); await wait(p, 200);
    await p.click("#sumGo"); await wait(p, 300);
    const sum = await p.$eval("#sumBody", e => e.innerText);
    check("summary opens from Journey → Progress", await p.isVisible("#sumView") && /NICU STAY SUMMARY|NICU stay summary/.test(sum));
    const ada = await p.$eval("#sumBody .sumbaby", e => e.innerText.replace(/\s+/g, " "));
    check("her section: born time and weight, went home with day and PMA, length of stay", ada.includes(ADA) && /Born .*2,600 g/.test(ada) && /Went home .*Feb 10 · Day 10 · \d+w\dd PMA/.test(ada) && /NICU stay 10 days/.test(ada), ada);
    check("her weights: last before home, lowest, and no 'back to birth weight' she hasn't reached", /Last weight before home 2,515 g · .*Feb 9 · −85 g since birth/.test(ada) && /Lowest weight 2,440 g/.test(ada) && !ada.includes("Back to birth weight"), ada);
    check("her feeding firsts come from the log", /First feed by mouth .* · \d+ mL/.test(ada), ada);
    check("her milestones and checklist dates are listed", /Milestones First bath .*Feb 7/i.test(ada) && /Before going home Hearing screen .*Feb 8/i.test(ada), ada);
    check("her sister still in the NICU says so", (await p.$$eval("#sumBody .sumbaby", x => x[1].innerText)).includes("Still in the NICU"));
    check("it says it's not a medical record", sum.includes("Not a medical record"));
    await p.evaluate(() => { window.__shared = null; navigator.share = d => { window.__shared = d; return Promise.resolve(); }; });
    await p.click("#sumShare"); await wait(p, 200);
    const shared = await p.evaluate(() => window.__shared);
    check("Share as text sends a plain-text version", !!shared && shared.title === "NICU stay summary" && shared.text.includes("• Went home:") && !/<[a-z]/i.test(shared.text), shared && shared.text.slice(0, 200));
    check("its buttons are 44 px tall", await p.$$eval(".sumbar button", x => x.length === 3 && x.every(b => b.getBoundingClientRect().height >= 44)));
    await p.screenshot({ path: path.join(SHOTS, "summary.png"), fullPage: false });
    // ---- corrections from the summary ----
    const sb = () => p.$eval("#sumBody .sumbaby", e => e.innerText.replace(/\s+/g, " "));
    p.answers = ["2530"]; await p.click('#sumBody [data-sed="w|0|2026-02-09"]'); await wait(p, 400);
    check("Edit on a weight fixes that night's weight in the log (and the summary follows)", await p.evaluate(() => __db.weights["b0-2026-02-09"].v === 2530) && (await sb()).includes("2,530 g · Mon, Feb 9"), await sb());
    await p.click("#toast button"); await wait(p, 300);
    check("…with Undo", await p.evaluate(() => __db.weights["b0-2026-02-09"].v === 2515));
    await p.click('#sumBody [data-sed="po|0"]'); await wait(p, 150);
    await p.fill("#sumBody [data-sfd]", "2026-02-03"); await p.fill("#sumBody [data-sfm]", "5"); await p.click('#sumBody [data-sfs="po|0"]'); await wait(p, 300);
    check("a first feed by mouth from before logging can be set; it's marked corrected and saved for the family", await p.evaluate(() => { const f = __db.config.summary.fix["0"].firstPo; return f.d === "2026-02-03" && f.mL === 5; }) && /First feed by mouth .*Feb 3 · 5 mL · corrected/i.test(await sb()), await sb());
    await p.click('#sumBody [data-sed="po|0"]'); await wait(p, 150); await p.click('#sumBody [data-sfr="po|0"]'); await wait(p, 300);
    check("Use what's logged puts it back", !(await p.evaluate(() => !!(__db.config.summary.fix["0"] || {}).firstPo)) && /First feed by mouth .*Feb 4 · 20 mL/.test(await sb()), await sb());
    await p.click('#sumBody [data-sed="full|0"]'); await wait(p, 150); await p.fill("#sumBody [data-sfd]", "2026-01-20"); await p.click('#sumBody [data-sfs="full|0"]'); await wait(p, 200);
    check("a day before birth is refused", !(await p.evaluate(() => !!(__db.config.summary.fix["0"] || {}).fullDay)) && (await p.textContent("#banner")).includes("between birth and today"));
    await p.click("#sumBody [data-sfx]"); await wait(p, 150);
    await p.click('#sumBody [data-ckdate="b0-hearing"]'); await wait(p, 150); await p.fill('#sumBody input[data-ckin="b0-hearing"]', "2026-02-07"); await wait(p, 300);
    await p.evaluate(() => document.activeElement.blur()); await wait(p, 200);
    check("a checklist date can be changed right on the summary", await p.evaluate(() => __db.checklist["b0-hearing"].d === "2026-02-07") && /Hearing screen .*Feb 7/.test(await sb()), await sb());
    const evId = await p.evaluate(() => Object.keys(__db.events).find(k => __db.events[k].title === "First bath"));
    await p.click(`#sumBody [data-sed="ev|${evId}"]`); await wait(p, 200);
    check("Edit on a milestone opens it, above the summary", await p.isVisible("#mSheet") && await p.evaluate(() => +getComputedStyle(document.querySelector("#mSheet")).zIndex > +getComputedStyle(document.querySelector("#sumView")).zIndex));
    await p.fill("#mTitle", "First bath at the bedside").catch(() => {}); await p.click("#mSave"); await wait(p, 300);
    check("…and saving it updates the summary", (await sb()).includes("First bath at the bedside") && await p.isVisible("#sumView"), await sb());
    await p.emulateMedia({ media: "print" });
    check("printing leaves out the Edit buttons", await p.$$eval("#sumBody .sumed", x => x.every(b => getComputedStyle(b).display === "none")));
    await p.emulateMedia({ media: "screen" });
    await p.click('#sumBody [data-sed="setup"]'); await wait(p, 300);
    check("Edit on Born opens the babies' setup (summary closes)", await p.isVisible("#setup") && !(await p.isVisible("#sumView")));
    await p.click("#suCancel").catch(() => {}); await wait(p, 200); await p.click('#jNav button[data-v="progress"]').catch(() => {}); await p.click("#sumGo").catch(() => {}); await wait(p, 200);
    await p.click("#sumClose"); await wait(p, 150);
    check("Close returns to the app", !(await p.isVisible("#sumView")));
    // ---- Log feed button: none once every baby is home ----
    await p.evaluate(() => { const pr = JSON.parse(JSON.stringify(__db.config.profile)); pr.twins[1].home = Date.now() - 600e3; return Store.setProfile(pr); }); await wait(p, 400);
    await tab(p, "feed"); await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await wait(p, 200);
    check("with both babies home there's no Log feed button", !(await p.$eval("#fab", e => e.classList.contains("on"))));
    await p.evaluate(() => { const pr = JSON.parse(JSON.stringify(__db.config.profile)); delete pr.twins[1].home; return Store.setProfile(pr); }); await wait(p, 400);
    // ---- undo: back in the NICU ----
    await setHome(p, "");
    check("clearing it (back in the NICU) removes the field and brings her card back", await p.evaluate(() => !("home" in __db.config.profile.twins[0])) && await (async () => { await tab(p, "feed"); return !!(await p.$(`.nx[data-tw="${ADA}"] input`)); })());
    check("no page errors", p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
  } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
}
main();
