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
const settings = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await wait(p); };
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
    check("Today: her card is replaced by when she went home", today.includes("Ada Rose went home on Tue, Feb 10 at 12p") && today.includes("Her history stays"), today.slice(0, 200));
    check("Today: no feed entry for her, her sister's card unchanged", !(await p.$(`.nx[data-tw="${ADA}"] input`)) && !!(await p.$(`.nx[data-tw="${BEA}"] input`)));
    await p.screenshot({ path: path.join(SHOTS, "discharge-today.png") });
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
    check("Growth: her weight history and chart remain", (await p.textContent("#grSum")).includes(ADA));
    await tab(p, "trends"); await wait(p, 300);
    check("Progress: her card says she went home (no discharge-readiness markers for her)", (await p.textContent("#home")).includes("Ada Rose went home") && (await p.$$eval("#home .bcard:not(.gone) .ind", x => x.length)) === 5);
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
