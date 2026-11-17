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
  } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
}
main();
