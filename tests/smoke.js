// Smoke test for the whole app: serves the repo, swaps firebase-store.js for an
// in-memory stub (stub-store.js), loads synthetic babies and walks every screen.
// Run:  cd tests && npm install && npm test        (needs Playwright + Chromium)
// Exits non-zero on any failed check or page error. Screenshots go to tests/shots/.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const CHART = path.join(__dirname, "node_modules/chart.js/dist/chart.umd.js");
const SHOTS = path.join(__dirname, "shots");
const TZ = "America/New_York";
const NOW = "2026-02-11T02:10:00-05:00";          // 2:10 AM: overnight, before the 8 AM day start
const BORN = "2026-02-01";

// ---------- synthetic data (fictional babies) ----------
const PROFILE = { born: BORN, ga: "36w0d", schedule: { everyH: 3, startH: 8 }, twins: [
  { name: "Ada Rose", birthTime: "09:00", birthG: 2600, fullMl: null, slotMin: 0, color: "pink" },
  { name: "Bea Joy", birthTime: "09:05", birthG: 2800, fullMl: null, slotMin: 30, color: "purple" }] };
function syntheticCSV() {
  const rows = ["datetime,twin,type,value,unit,pct_of_full_feed,estimated,note,diet"];
  const pad = n => String(n).padStart(2, "0");
  PROFILE.twins.forEach((t, k) => {
    for (let d = 1; d <= 9; d++) {                                   // nightly weights 2/1..2/9
      const g = t.birthG - 40 * Math.min(d, 4) + 15 * Math.max(0, d - 4);
      rows.push(`2026-02-${pad(d)}T20:00:00,${t.name},weight,${g},g,,${d < 3 ? "yes" : ""},,`);
    }
    for (let d = 4; d <= 10; d++) for (let s = 0; s < 8; s++) {     // feeds 2/4 8 AM .. 2/10 8 PM
      const h = 8 + 3 * s, day = d + Math.floor(h / 24), hh = h % 24;
      if (day > 10 || (day === 10 && hh > 20)) continue;
      const v = Math.round(20 + 2.5 * (d - 4) + (s % 3) * 3 + k * 2);
      rows.push(`2026-02-${pad(day)}T${pad(hh)}:${k ? "30" : "00"}:00,${t.name},PO feed,${v},mL,,,,22 kcal/oz`);
    }
  });
  return rows.join("\n");
}

// ---------- tiny static server; firebase-store.js -> stub ----------
function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const file = p === "/firebase-store.js" ? path.join(__dirname, "stub-store.js") : path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

// ---------- checks ----------
const fails = []; let passed = 0;
const check = (name, ok, detail = "") => { ok ? passed++ : fails.push(`${name}${detail ? " — " + detail : ""}`); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };

async function newPage(browser, base, opts = {}) {
  const ctx = await browser.newContext({ timezoneId: TZ, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...opts.ctx });
  await ctx.clock.install({ time: new Date(opts.now || NOW) });
  await ctx.addInitScript(p => { window.__TEST_PROFILE = p; }, PROFILE);
  await ctx.route("https://cdnjs.cloudflare.com/**/chart.umd.min.js", r => r.fulfill({ path: CHART, contentType: "text/javascript" }));
  if (opts.prefs) await ctx.addInitScript(p => localStorage.setItem("prefs", JSON.stringify(p)), opts.prefs);
  const page = await ctx.newPage();
  page.errors = []; page.on("pageerror", e => page.errors.push(e.message));
  page.dialogs = []; page.on("dialog", d => { page.dialogs.push(d.message()); const a = page.answers && page.answers.shift(); a === false ? d.dismiss() : d.accept(typeof a === "string" ? a : undefined); });
  await page.goto(base); await page.waitForTimeout(600);
  return page;
}
// Press the tab button directly: Playwright mis-scales tap coordinates under CSS zoom (A+/A++), while real
// taps hit the bar fine (elementFromPoint at the button returns the tab bar).
const tab = (p, t) => p.$eval(`#tabbar button[data-tab=${t}]`, b => b.click()).then(() => p.waitForTimeout(250));
const db = (p, f, arg) => p.evaluate(f, arg);
async function importData(p) {
  await tab(p, "more"); if (await p.$("#moreNav")) await p.click('#moreNav button[data-v="settings"]');   // older layouts had no sections
  await p.evaluate(() => { document.querySelector("details.settings").open = true; document.querySelector("#impBox").closest("details:not(.settings)").open = true; });
  await p.fill("#impBox", syntheticCSV()); await p.click("#impGo"); await p.waitForTimeout(800);
  return p.textContent("#impMsg");
}

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const A = '.nx[data-tw="Ada Rose"]';
  try {
    // ---- boot + import ----
    const p = await newPage(browser, base);
    check("boots to the app with both names", (await p.textContent("#title")) === "Ada Rose & Bea Joy");
    check("day runs 7 AM–7 AM by default", (await p.textContent("#dayRun")) === "7 AM–7 AM", await p.textContent("#dayRun"));
    check("age line (day of life + corrected age)", (await p.textContent("#ageLine")).includes("Day 10 · 37w3d PMA"), await p.textContent("#ageLine"));
    const msg = await importData(p);
    check("CSV import", /Imported 18 weights, \d+ feeds\./.test(msg), msg);

    // ---- Today: entry, undo, full, tube, notes ----
    await tab(p, "feed");
    check("next card shows the 2 AM feed as due", /^Due\s+2a$/.test((await p.textContent(`${A} .when`)).trim()), await p.textContent(`${A} .when`));
    check("overnight context label is short", (await p.textContent("#ctxLabel")) === "Overnight · Both babies", await p.textContent("#ctxLabel"));
    check("status banner is announced to screen readers", (await p.getAttribute("#banner", "role")) === "alert");
    check("context strip shows the date and both babies", (await p.textContent("#ctxLabel")).endsWith("Both babies") && /\w{3}, \w{3} \d+/.test(await p.textContent("#ctxDate")), await p.textContent("#ctxLabel"));
    check("each baby card names her and says Baby A/B", (await p.textContent(`${A} .bh`)).includes("Ada Rose") && (await p.textContent(`${A} .bh-sub`)) === "Baby A" && (await p.textContent('.nx[data-tw="Bea Joy"] .bh-sub')) === "Baby B");
    check("Full / tube / skipped are one tap each, side by side", (await p.$$(`${A} .quick [data-act]`)).length === 3);
    check("note chips hidden until + Note", await p.$eval(`${A} .tags`, e => e.hidden));
    check("Both view is compact (no mini charts)", (await p.$$(`${A} .spk`)).length === 0);
    check("feed count is out of the full day (of 8)", / of 8 feeds/.test(await p.textContent(`${A} .tsum`)), await p.textContent(`${A} .tsum`));
    await p.fill(`${A} .box input`, "40"); await p.click(`${A} [data-act=save]`); await p.waitForTimeout(200);
    const slot2 = new Date("2026-02-11T02:00:00-05:00").getTime();
    check("Save logs the feed", await db(p, t => __db.feeds[`b0-${t}`]?.v, slot2) === 40);
    await p.click("#toast button"); await p.waitForTimeout(200);
    check("Undo removes it", await db(p, t => !__db.feeds[`b0-${t}`], slot2));
    await p.waitForTimeout(2700);
    check("sheet note shows the real day boundary (7 AM, not 8 AM)", /^7\s?a/i.test(await p.textContent("#dayRange")) && !(await p.textContent("#sheet")).includes("8 AM to 8 AM"), await p.textContent("#dayRange"));
    await p.fill(`${A} .box input`, "42"); await p.click(`${A} [data-act=save]`); await p.waitForTimeout(200);
    await db(p, t => Store.setFeed(`b0-${t}`, { twin: "Ada Rose", t, v: 44, note: "", diet: "", by: "parent2@example.com" }), slot2);
    p.answers = [false]; await p.click("#toast button"); await p.waitForTimeout(200);
    check("Undo asks before wiping the other parent's later change", p.dialogs.some(d => d.includes("changed this feed after you saved it")) && await db(p, t => __db.feeds[`b0-${t}`]?.v, slot2) === 44);
    await db(p, t => Store.delFeed(`b0-${t}`), slot2); await p.waitForTimeout(2700);
    await p.fill(`${A} .box input`, "41");
    await db(p, t => Store.setFeed(`b0-${t}`, { twin: "Ada Rose", t, v: 30, note: "", diet: "", by: "parent2@example.com" }), slot2);
    p.answers = [false]; await p.click(`${A} [data-act=save]`); await p.waitForTimeout(200);
    check("saving over the other parent's new entry asks first (Cancel keeps theirs)", p.dialogs.some(d => d.includes("was just logged by")) && await db(p, t => __db.feeds[`b0-${t}`]?.v, slot2) === 30, p.dialogs.slice(-1)[0]);
    await db(p, t => Store.delFeed(`b0-${t}`), slot2); await p.waitForTimeout(2700);
    await p.click(`${A} [data-act=notes]`); await p.click(`${A} .tags button:has-text("Spit up")`);
    await p.click(`${A} [data-act=full]`); await p.waitForTimeout(200);
    const f = await db(p, t => __db.feeds[`b0-${t}`], slot2);
    check("Full button logs the full feed with the chosen note", f && f.v === 49 && f.note === "Spit up", JSON.stringify(f));
    await p.waitForTimeout(2700);
    check("card moves on to the next feed", /^Next\s+5a$/.test((await p.textContent(`${A} .when`)).trim()), await p.textContent(`${A} .when`));
    const B = '.nx[data-tw="Bea Joy"]';
    await p.click(`${B} [data-act=notes]`); await p.click(`${B} .tags button:has-text("Fussy")`); await p.click(`${B} [data-act=notes]`);
    check("hiding notes clears a chosen chip", await p.$$eval(`${B} .tags [aria-pressed="true"]`, x => x.length) === 0);
    await p.click(`${B} [data-act=tube]`); await p.waitForTimeout(200);
    const slotB = new Date("2026-02-11T02:30:00-05:00").getTime();
    check("All by tube logs 0 mL with its note (no hidden chip)", await db(p, t => { const x = __db.feeds[`b1-${t}`]; return x && x.v === 0 && x.note === "All by tube"; }, slotB));
    await p.waitForTimeout(2700);
    await p.click(`${A} [data-act=full]`); await p.click(`${B} [data-act=full]`); await p.waitForTimeout(300);
    const s5a = new Date("2026-02-11T05:00:00-05:00").getTime(), sBnext = await db(p, () => Object.values(__db.feeds).filter(x => x.twin === "Bea Joy" && x.v === 53).length);
    check("both babies can be logged back to back", await db(p, t => __db.feeds[`b0-${t}`]?.v, s5a) === 49 && sBnext >= 1, `Bea full feeds: ${sBnext}`);
    await p.waitForTimeout(2700);
    check("missed 11p shows as due, not logged", (await p.textContent(`${A} .tsum`)).includes("1 due, not logged"), await p.textContent(`${A} .tsum`));
    check("sheet inputs carry their own day", await p.$eval("#sheet input", i => !!i.dataset.day));
    p.answers = [false];
    await p.fill(`${B} .box input`, "95"); await p.click(`${B} [data-act=save]`); await p.waitForTimeout(200);
    check("unusual amount asks first (and Cancel keeps it unsaved)", p.dialogs.some(d => d.startsWith("95 mL for Bea Joy")) && await db(p, () => !Object.values(__db.feeds).some(x => x.v === 95)));

    // ---- single-baby view: full card, weight, plan ----
    await p.click(`${A} [data-act=detail]`); await p.waitForTimeout(300);
    check("Details opens the single-baby view", (await p.$$(".nx")).length === 1 && (await p.$$(`${A} .spk`)).length === 1);
    p.answers = ["Try ad lib tomorrow"];
    await p.click(`${A} [data-act=plan]`); await p.waitForTimeout(200);
    check("plan from rounds saves", (await p.textContent(`${A} .tplan`)).includes("Try ad lib tomorrow"));
    check("single-baby view: context names the baby", (await p.textContent("#ctxLabel")).endsWith("Ada Rose"), await p.textContent("#ctxLabel"));
    check("single-baby view shows intake metrics, rounds and 7-day trends", (await p.$$(`${A} .metrics .m`)).length === 3 && (await p.$$(`${A} .spk svg`)).length === 2);
    await p.click(`${A} [data-act=gohome]`); await p.waitForTimeout(250);
    check("checklist link opens Progress", await p.$eval("#tabbar .on", b => b.dataset.tab) === "trends");
    await p.click('#tabbar button[data-tab=feed]'); await p.waitForTimeout(250);
    await p.fill(`${A} .wIn`, "2560"); await p.click(`${A} [data-act=wsave]`); await p.waitForTimeout(900);
    check("tonight's weight saves to the feed day", await db(p, () => __db.weights["b0-2026-02-10"]?.v) === 2560);
    check("mL/kg/day shows", /\d+ mL\/kg\/day/.test(await p.textContent(`${A} .tsum`)), await p.textContent(`${A} .tsum`));
    await p.screenshot({ path: path.join(SHOTS, "today-single.png") });
    await p.click("#view button:nth-child(3)"); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(SHOTS, "today-both.png") });

    // ---- questions ----
    await p.fill("#qText", "When is the hearing screen?"); await p.press("#qText", "Enter"); await p.waitForTimeout(200);
    p.answers = ["Monday"]; await p.click("#qList [data-q]"); await p.waitForTimeout(200);
    check("question added and answered", (await p.innerText("#qList")).includes("→ Monday"));
    await p.evaluate(() => Store.put("pumps", "p-t", { t: Date.now() - 3600e3, v: 120 })); await p.waitForTimeout(200);
    await p.click("#todayMilk"); await p.waitForTimeout(250);
    check("milk summary on Today opens Milk", await p.$eval("#tabbar .on", b => b.dataset.tab) === "milk");
    await p.click('#tabbar button[data-tab=feed]'); await p.waitForTimeout(250);

    // ---- milk ----
    await tab(p, "milk");
    check("Milk time boxes stay inside their cards", await p.$$eval("#pmT,#dpT", els => els.every(e => e.getBoundingClientRect().right <= e.closest(".card").getBoundingClientRect().right)));
    check("baby bar hidden on Milk", !(await p.isVisible(".viewbar")));
    check("Log feed button hidden on Milk", !(await p.isVisible("#fab")));
    check("Milk: no estimate before any drop-off or count", (await p.textContent("#mkInv")).includes("to start the estimate"));
    const pumpsBefore = await db(p, () => Object.keys(__db.pumps || {}).length);
    await p.fill("#pmV", "120"); await p.click("#pmGo"); await p.waitForTimeout(150);
    check("pump entry saves", await db(p, () => Object.keys(__db.pumps || {}).length) === pumpsBefore + 1);
    const pmAt = await p.inputValue("#pmT");
    for (const v of ["30", "35"]) { await p.fill("#pmT", pmAt); await p.fill("#pmV", v); await p.click("#pmGo"); await p.waitForTimeout(150); }
    check("two pump entries in the same minute are both kept", await db(p, () => Object.keys(__db.pumps || {}).length) === pumpsBefore + 3);
    check("Need & pumping shows daily need and 24 h pumped in mL", /Est\. daily need\s*[\d,]+\s*mL/.test(await p.textContent("#mkStats")) && /Pumped 24 h\s*[\d,]+\s*mL/.test(await p.textContent("#mkStats")), (await p.textContent("#mkStats")).replace(/\s+/g, " "));
    const dropAt = await p.evaluate(() => { const d = new Date(Date.now() - 4 * 3600e3), q = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}T${q(d.getHours())}:${q(d.getMinutes())}`; });   // the page's clock, not the real one
    await p.fill("#dpT", dropAt);
    await p.fill("#dpV", "500"); await p.click("#dpGo"); await p.waitForTimeout(200);
    const inv1 = await p.textContent("#mkInv");
    const amt = re => { const m = inv1.replace(/\s+/g, " ").match(re); return m ? +m[1].replace(/,/g, "") : NaN; };
    const start = amt(/before your first drop-off .*? ([\d,]+) mL/), added = amt(/Dropped off since.*? ([\d,]+) mL/), used = amt(/scheduled feeds since \(\d+\) ([\d,]+) mL/), est = amt(/Estimated now ([\d,]+) mL/);
    check("drop-off starts an estimate whose working adds up (start + added − used = estimate)", est === Math.max(0, start + added - used) && start === 0 && added === 500, inv1.replace(/\s+/g, " "));
    check("estimate is labelled as an estimate, not a count", (await p.textContent("#mkInvBadge")) === "Estimate" && !inv1.includes("Counted"));
    p.answers = ["1000"]; await p.click("#stkGo"); await p.waitForTimeout(200);
    const inv2 = (await p.textContent("#mkInv")).replace(/\s+/g, " ");
    check("NICU count becomes the starting point, marked Counted", inv2.includes("NICU's count") && inv2.includes("Counted") && /1,000 mL/.test(inv2), inv2);
    check("NICU count appears in the milk log", (await p.innerText("#mkBody")).includes("NICU count"));
    await p.click("#toast button"); await p.waitForTimeout(200);
    check("Undo of a NICU count restores the drop-off estimate", (await p.textContent("#mkInv")).includes("before your first drop-off"));
    await p.context().setOffline(true); await p.waitForTimeout(200);
    check("offline: sync pill says so", (await p.textContent("#sync")).startsWith("Offline"));
    await p.fill("#pmV", "90"); await p.click("#pmGo"); await p.waitForTimeout(150);
    check("offline: pump entry still saves locally", await db(p, () => Object.values(__db.pumps || {}).some(x => x.v === 90)));
    await p.context().setOffline(false); await p.waitForTimeout(200);
    p.answers = ["1000"]; await p.click("#stkGo"); await p.waitForTimeout(200);

    // ---- growth ----
    await tab(p, "weight");
    check("Growth tab label", (await p.textContent('#tabbar button[data-tab=weight] span')) === "Growth");
    const gA = await p.textContent('#grSum .bcard[data-tw="Ada Rose"]');
    check("Growth: latest weight is the headline, in grams, with its night", /Latest weight\s*2,560 g/.test(gA) && /night of \w{3}, \w{3} \d+, 8 PM/.test(gA), gA.replace(/\s+/g, " "));
    check("Growth: previous, change and since-birth shown", /Previous\s*[\d,]+ g/.test(gA) && /Change\s*[+−±]\d+ g/.test(gA) && /Since birth\s*[+−±]\d+ g/.test(gA), gA.replace(/\s+/g, " "));
    check("Growth: both babies have summary cards in Both view", (await p.$$("#grSum .bcard")).length === 2);
    check("Growth grid marks estimated weights", (await p.innerText("#wBody")).includes("est.") && await p.$$eval("#wBody input.approx", x => x.length) > 0);
    check("Growth grid marks tonight", (await p.textContent("#wBody tr.tonight")).includes("Tonight"));
    const cell = '#wBody input[data-k="Bea Joy|2026-02-08"]';
    await p.fill(cell, "2712"); await p.press(cell, "Tab"); await p.waitForTimeout(300);
    check("Growth grid edit saves (and clears the estimate flag)", await db(p, () => { const w = __db.weights["b1-2026-02-08"]; return w && w.v === 2712 && !w.approx; }));
    await p.click("#toast button"); await p.waitForTimeout(300);
    check("Undo restores the previous weight", await db(p, () => __db.weights["b1-2026-02-08"].v) === 2700);
    const wOrig = await db(p, () => ({ ...__db.weights["b1-2026-02-08"] }));
    await p.focus(cell); await p.fill(cell, "2730");
    await db(p, () => Store.setWeight("b1-2026-02-08", { twin: "Bea Joy", date: "2026-02-08", v: 2720, approx: false, by: "parent2@example.com" }));
    p.answers = [false]; await p.press(cell, "Tab"); await p.waitForTimeout(300);
    check("weight grid asks before replacing the other parent's new weight", p.dialogs.some(d => d.includes("weight for") && d.includes("was just logged by")) && await db(p, () => __db.weights["b1-2026-02-08"].v) === 2720);
    await p.evaluate(() => document.activeElement.blur()); await db(p, w => Store.setWeight("b1-2026-02-08", w), wOrig); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector("#cWeight").scrollIntoView({ block: "center" })); await p.waitForTimeout(250);
    const wbox = await p.$eval("#cWeight", c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * .6, y: r.y + r.height * .5 }; });
    await p.touchscreen.tap(wbox.x, wbox.y); await p.waitForTimeout(200);
    const wt = await p.evaluate(() => { const c = Chart.getChart("cWeight"); return { n: c.tooltip.getActiveElements().length, title: (c.tooltip.title || []).join(" ") }; });
    check("weight chart: one tap shows both babies that night", wt.n === 2 && /Night of|Birth/.test(wt.title), JSON.stringify(wt));
    await p.click("#view button:nth-child(1)"); await p.waitForTimeout(250);
    check("Growth follows the baby filter", (await p.$$("#grSum .bcard")).length === 1 && await p.$$eval("#wHead th", x => x.length) === 2);
    await p.click("#view button:nth-child(3)"); await p.waitForTimeout(250);

    // ---- progress: checklist ----
    await tab(p, "trends");
    check("old summary tiles are gone", (await p.$$("#tiles")).length === 0);
    check("Progress is framed as family indicators, not discharge criteria", (await p.textContent(".glance h2")) === "Progress at a glance" && (await p.textContent(".glance .lead")).includes("not clinical discharge criteria") && (await p.textContent(".glance .lead")).includes("NICU care team"));
    check("no green check marks or 'Going home' wording on Progress", (await p.$$("[data-tab=trends] .y")).length === 0 && !(await p.textContent("[data-tab=trends]")).includes("Going home"));
    check("each baby shows all five indicators with explicit periods", await p.$$eval('#home .bcard[data-tw="Ada Rose"] .ind', x => x.length) === 5 && /last 48 h: \d+%/.test(await p.textContent("#home")) && /over the last 3 nights/.test(await p.textContent("#home")));
    check("indicator states are neutral words", await p.$$eval("#home .ind .mk", x => x.every(e => ["Marker reached", "Not yet"].includes(e.textContent))));
    check("order: indicators, family checklist, baby checklists, charts", await p.evaluate(() => { const a = [...document.querySelectorAll("#home,#famList,#ckBabies,#cFeed")].map(e => e.getBoundingClientRect().top); return a[0] < a[1] && a[1] < a[2] && a[2] < a[3]; }));
    await p.click('[data-ck="b0-hearing"]'); await p.waitForTimeout(150); await p.click('[data-na="b0-rsv"]'); await p.waitForTimeout(150);
    check("checklist check + n/a", (await p.$$eval("#ckBabies .cl h4", x => x[0].textContent)).includes("1/7"));
    check("checklist marks persist to the database (ids unchanged)", await db(p, () => __db.checklist["b0-hearing"]?.s === "done" && __db.checklist["b0-rsv"]?.s === "na"));
    check("checklist item shows when it was marked", /^[A-Z][a-z]{2} \d+/.test(await p.textContent('[data-ck="b0-hearing"] .dt')), await p.textContent('[data-ck="b0-hearing"] .dt'));
    check("checklist counts: marked done / open / not needed", /1 marked done/.test(await p.textContent("#ckBabies .ckmeta")) && /6 open/.test(await p.textContent("#ckBabies .ckmeta")) && /1 not needed/.test(await p.textContent("#ckBabies .ckmeta")), await p.textContent("#ckBabies .ckmeta"));
    await p.click('[data-ck="f-cpr"]'); await p.waitForTimeout(150);
    check("family checklist updates", await db(p, () => __db.checklist["f-cpr"]?.s === "done") && /1\/6/.test(await p.textContent("#famList h2")));
    await p.evaluate(() => { const b = document.querySelector('[data-ck="b1-hearing"]'); b.scrollIntoView({ block: "center" }); window.__ck = { b, y: scrollY, ch: Chart.getChart("cDaily") }; });
    await p.click('[data-ck="b1-hearing"]'); await p.waitForTimeout(200);
    const still = await p.evaluate(() => { const b = document.querySelector('[data-ck="b1-hearing"]'); return { same: b === __ck.b, dy: Math.abs(scrollY - __ck.y), chart: Chart.getChart("cDaily") === __ck.ch, on: b.getAttribute("aria-pressed") }; });
    check("checklist tap keeps the screen still (same button, no scroll, no chart redraw)", still.same && still.dy < 2 && still.chart && still.on === "true", JSON.stringify(still));
    await db(p, () => Store.put("checklist", "b1-cchd", { s: "done", d: "2026-02-10", by: "parent2@example.com" })); await p.waitForTimeout(200);
    check("the other parent's checklist mark updates in place, with counts", await p.evaluate(() => document.querySelector('[data-ck="b1-hearing"]') === __ck.b) && (await p.$$eval("#ckBabies .cl h4 .ckn", x => x[1].textContent)) === "2/8" && /P|parent2/.test(await p.textContent('[data-ck="b1-cchd"] .dt')), await p.$$eval("#ckBabies .cl h4 .ckn", x => x.map(e => e.textContent).join(",")));
    await db(p, () => { Store.remove("checklist", "b1-hearing"); Store.remove("checklist", "b1-cchd"); }); await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector("#cDaily").scrollIntoView({ block: "center" })); await p.waitForTimeout(250);
    const box = await p.$eval("#cDaily", c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * .4, y: r.y + r.height * .6 }; });
    const tip = () => p.evaluate(() => Chart.getChart("cDaily").tooltip.getActiveElements().length);
    await p.touchscreen.tap(box.x, box.y); await p.waitForTimeout(200); const opened = await tip();
    await p.touchscreen.tap(20, 300); await p.waitForTimeout(200);
    check("chart callout opens on tap and closes on a tap elsewhere", opened > 0 && (await tip()) === 0);

    // ---- records ----
    await tab(p, "more"); await p.click('#moreNav button[data-v="records"]'); await p.waitForTimeout(150);
    const kinds = await p.$$eval("#logBody tr[data-kind]", x => [...new Set(x.map(t => t.dataset.kind))].sort().join(","));
    check("Records: one list covers feeds, weights, pumping, drop-offs and the NICU count", ["count", "drop", "feed", "pump", "weight"].every(k => kinds.includes(k)), kinds);
    check("Records: newest first", await p.$$eval("#logBody tr[data-kind]", x => x.length > 5));
    const fit = await p.$eval("table.rec", t => { const w = t.parentElement, x = t.querySelector("button.x").getBoundingClientRect(), c = t.closest(".card").getBoundingClientRect(); return { sw: w.scrollWidth, cw: w.clientWidth, x: Math.round(x.right), c: Math.round(c.right) }; });
    check("Records fit a 390 px phone (delete button fully visible)", fit.sw <= fit.cw && fit.x <= fit.c, JSON.stringify(fit));
    await p.click('#recF button[data-v="milk"]'); await p.waitForTimeout(150);
    check("Records filter: Milk shows only milk", (await p.$$eval("#logBody tr[data-kind]", x => [...new Set(x.map(t => t.dataset.kind))])).every(k => ["pump", "drop", "count"].includes(k)));
    await p.click('#recF button[data-v="weight"]'); await p.waitForTimeout(150);
    check("Records filter: Weights shows estimates marked", (await p.$$eval("#logBody tr[data-kind]", x => x.every(t => t.dataset.kind === "weight"))) && (await p.textContent("#logBody")).includes("est."));
    await p.click('#recF button[data-v="all"]'); await p.waitForTimeout(150);
    check("Records show who entered them", /parent2|P/.test(await p.$$eval("#logBody .rby", x => x.map(t => t.textContent).join(" "))));
    p.answers = ["Sleepy at the end"]; await p.click('#logBody tr[data-kind="feed"] .notebtn'); await p.waitForTimeout(200);
    check("Records: feed note editable", await db(p, () => Object.values(__db.feeds).some(f => f.note === "Sleepy at the end")));
    const pumpId = await p.$eval('#logBody tr[data-kind="pump"] button.x', b => b.dataset.id);
    await p.click(`#logBody button.x[data-id="${pumpId}"]`); await p.click(`#logBody button.x[data-id="${pumpId}"]`); await p.waitForTimeout(200);
    check("Records: two-tap delete removes a pumping entry", await db(p, id => !__db.pumps[id], pumpId));
    await p.click("#toast button"); await p.waitForTimeout(200);
    check("Records: Undo brings it back", await db(p, id => !!__db.pumps[id], pumpId));
    const wId = await p.$eval('#logBody tr[data-kind="weight"] button.x', b => b.dataset.id);
    await p.click(`#logBody button.x[data-id="${wId}"]`); await p.click(`#logBody button.x[data-id="${wId}"]`); await p.waitForTimeout(200);
    const wGone = await db(p, id => !__db.weights[id], wId); await p.click("#toast button"); await p.waitForTimeout(200);
    check("Records: weight delete + Undo keeps the value", wGone && await db(p, id => !!__db.weights[id], wId));
    check("Records follow the baby filter", await (async () => { await p.click("#view button:nth-child(1)"); await p.waitForTimeout(200); const ok = await p.$$eval('#logBody tr[data-kind="feed"] .rk b', x => x.every(b => b.textContent.includes("Ada Rose"))); await p.click("#view button:nth-child(3)"); await p.waitForTimeout(200); return ok; })());
    // ---- care ----
    await p.click('#moreNav button[data-v="care"]'); await p.waitForTimeout(150);
    check("Care: plans from rounds listed and labelled as family-entered", (await p.textContent("#careP")).includes("Try ad lib tomorrow") && (await p.textContent("#careP")).includes("Entered by your family"));
    check("Care: questions show the team's answer", (await p.textContent("#careQ")).includes("Team's answer: Monday") && (await p.textContent("#careQ")).includes("Answered"));
    check("Care: diet box lives here", await p.isVisible("#diet"));
    // ---- settings ----
    await p.click('#moreNav button[data-v="settings"]'); await p.waitForTimeout(150);
    check("Settings: every preference is reachable", await p.evaluate(() => ["#pfLook", "#pfNight", "#pfText", "#pfUnits", "#pfClock", "#myName", "#editProfile", "#signOut"].every(id => document.querySelector(id).offsetParent)));
    const small = [];
    for (const [t, sec] of [["feed"], ["weight"], ["milk"], ["trends"], ["more", "records"], ["more", "care"], ["more", "settings"]]) {
      await tab(p, t); if (sec) await p.click(`#moreNav button[data-v="${sec}"]`); await p.waitForTimeout(150);
      small.push(...await p.evaluate(() => [...document.querySelectorAll(".tab.on button, .tab.on input, .tab.on select, .tab.on summary, .top button, #view button")]
        .filter(e => e.offsetParent && getComputedStyle(e).visibility !== "hidden").map(e => [e, e.getBoundingClientRect()]).filter(([e, b]) => b.height < 43.5 || b.width < 24)
        .map(([e, b]) => `${e.tagName}.${e.className} "${(e.textContent || e.ariaLabel || "").trim().slice(0, 16)}" ${Math.round(b.width)}x${Math.round(b.height)}`)));
    }
    check("every control is at least 44 px tall", small.length === 0, small.slice(0, 5).join("; "));
    check("error messages are plain language (no Firestore jargon)", !(await p.content()).includes("Firestore rules"));
    check("update notice is wired and hidden until a new version loads", await p.$eval("#upd", e => e.hidden));
    await tab(p, "weight"); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(100);
    await p.evaluate(() => scrollTo(0, 400)); await p.waitForTimeout(100); const tucked = await p.$eval("#fab", e => e.classList.contains("tuck"));
    await p.evaluate(() => scrollTo(0, 200)); await p.waitForTimeout(100);
    check("Log feed button tucks away while scrolling down and returns on scroll up", tucked && !(await p.$eval("#fab", e => e.classList.contains("tuck"))));
    await p.evaluate(() => scrollTo(0, 0)); await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]');
    // ---- full backup + merge-only restore ----
    await p.evaluate(() => { document.querySelector("details.settings").open = true; });
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#bkGo")]);
    const bk = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    check("full backup holds every kind of record and the setup", bk.app === "twins-tracker" && ["weights", "feeds", "pumps", "drops", "checklist", "plans", "questions"].every(c => Object.keys(bk.data[c] || {}).length > 0) && !!bk.data.config.profile && !!bk.data.config.milk, Object.entries(bk.data).map(([k, v]) => k + ":" + Object.keys(v).length).join(" "));
    const lostPump = Object.keys(bk.data.pumps)[0], lostQ = Object.keys(bk.data.questions)[0], keepF = Object.keys(bk.data.feeds)[0];
    await db(p, ([a, b, c]) => { Store.remove("pumps", a); Store.remove("questions", b); Store.remove("checklist", "b0-hearing"); Store.setFeed(c, { ...__db.feeds[c], v: 7 }); }, [lostPump, lostQ, keepF]);
    await p.waitForTimeout(200);
    p.answers = [true]; await p.setInputFiles("#rsFile", await dl.path()); await p.waitForTimeout(500);
    check("restore brings back what was missing", await db(p, ([a, b]) => !!__db.pumps[a] && !!__db.questions[b] && !!__db.checklist["b0-hearing"], [lostPump, lostQ]), await p.textContent("#bkMsg"));
    check("restore never overwrites a record that's already here", await db(p, c => __db.feeds[c].v, keepF) === 7 && /^Restore 3 records/.test(p.dialogs.slice(-1)[0]), p.dialogs.slice(-1)[0]);
    await p.setInputFiles("#rsFile", await dl.path()); await p.waitForTimeout(300);
    check("restoring the same backup again changes nothing", (await p.textContent("#bkMsg")).startsWith("Nothing to restore"));
    await p.setInputFiles("#rsFile", { name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') }); await p.waitForTimeout(200);
    check("a file from somewhere else is refused", (await p.textContent("#bkMsg")).includes("isn't a backup"));
    await p.evaluate(() => { document.querySelector("details.settings").open = false; });

    // ---- more: export ----
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]');
    await p.evaluate(() => { document.querySelector("details.settings").open = true; });
    await p.click("#csvBtn"); await p.waitForTimeout(200);
    const csv = await p.evaluate(async () => document.querySelector("#csvBox").value || await navigator.clipboard.readText().catch(() => ""));
    check("CSV export quotes names", csv.includes(',"Ada Rose",') && csv.split("\n").length > 50, csv.slice(0, 80));
    check("no page errors in main walk-through", p.errors.length === 0, p.errors.join(" | "));

    // ---- rename: records follow the baby, not the name ----
    const other = new Date("2026-02-10T20:00:00-05:00").getTime();
    await db(p, t => { const id = `b0-${t}`; Store.setFeed(id, { ...__db.feeds[id], by: "parent2@example.com" }); }, other);
    const before = await p.textContent("#recCount"), idsBefore = await db(p, () => Object.keys(__db.feeds).sort().join());
    await p.click("#editProfile"); await p.selectOption("#suEvery", "4");
    p.answers = [false]; await p.click("#suSave"); await p.waitForTimeout(300);
    check("changing feed times asks first (Cancel keeps the schedule)", p.dialogs.some(d => d.startsWith("Change feed times?")) && await db(p, () => __db.config?.profile?.schedule?.everyH ?? 3) === 3, p.dialogs.slice(-1)[0]);
    await p.selectOption("#suEvery", "3");
    await p.fill("#suN0", "Ada"); await p.fill("#suN1", "Bea");
    await p.click("#suSave"); await p.waitForTimeout(500);
    check("rename moves no data (same record ids, same count)", await db(p, () => Object.keys(__db.feeds).sort().join()) === idsBefore && (await p.textContent("#recCount")) === before, `${before} → ${await p.textContent("#recCount")}`);
    check("rename remembers the old name", await db(p, () => __db.config.profile.twins[0].aka?.includes("Ada Rose") && __db.config.profile.twins[1].aka?.includes("Bea Joy")));
    check("every record shows under the new name", await p.$$eval('#logBody tr[data-kind="feed"] .rk b', x => x.length > 0 && x.every(b => /^(Ada|Bea)$/.test(b.textContent.trim()))));
    await db(p, () => Store.setFeed("Ada Rose-offline", { twin: "Ada Rose", t: new Date("2026-02-10T17:00:00-05:00").getTime() + 60e3, v: 12, note: "", diet: "" }));   // a phone that missed the rename
    await p.waitForTimeout(200);
    check("an entry saved under the old name (phone was offline) still shows", (await p.textContent("#logBody")).includes("12 mL"));
    check("checklist survives the rename", await db(p, () => !!__db.checklist["b0-hearing"]));
    check("rename keeps who logged each feed", await db(p, t => __db.feeds[`b0-${t}`]?.by, other) === "parent2@example.com");
    check("no page errors after rename", p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();

    // ---- per-phone prefs + large text ----
    const q = await newPage(browser, base, { prefs: { clock: "24", units: "lb", text: "1.3" } });
    await tab(q, "more"); await q.click('#moreNav button[data-v="settings"]'); check("Data & settings starts collapsed", !(await q.$eval("details.settings", d => d.open)));
    await importData(q); await tab(q, "feed");
    check("A++ text: baby names in the selector are never truncated", await q.$$eval("#view .nm0,#view .nm1", els => els.every(e => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis")));
    check("24-hour clock", (await q.textContent(`${A} .when`)).includes("02:00"));
    for (const t of ["feed", "weight", "milk", "trends", "more"]) {
      await tab(q, t);
      const over = await q.evaluate(() => [...document.querySelectorAll(".tab.on *")].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1 && !e.closest("[style*='overflow-x']"); }).length);
      check(`A++ text: no sideways overflow on ${t}`, over === 0, `${over} elements`);
    }
    await tab(q, "weight"); const gw = await q.$eval("table.wg", e => e.parentElement.scrollWidth <= e.parentElement.clientWidth + 1);
    await tab(q, "more"); await q.click('#moreNav button[data-v="records"]'); await q.waitForTimeout(150);
    check("A++ text: growth grid and records need no sideways scroll", gw && await q.$eval("table.rec", e => e.parentElement.scrollWidth <= e.parentElement.clientWidth + 1));
    await q.screenshot({ path: path.join(SHOTS, "large-text.png") });
    check("no page errors with prefs", q.errors.length === 0, q.errors.join(" | "));
    await q.context().close();

    // ---- appearance: system / light / dark ----
    const bgOf = pg => pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const sysDark = await newPage(browser, base, { ctx: { colorScheme: "dark" } });
    check("System appearance follows a dark phone", await bgOf(sysDark) === "rgb(14, 26, 38)", await bgOf(sysDark));
    await sysDark.context().close();
    const forcedLight = await newPage(browser, base, { ctx: { colorScheme: "dark" }, prefs: { look: "light" } });
    check("Appearance = Light stays light on a dark phone", await bgOf(forcedLight) === "rgb(243, 246, 249)", await bgOf(forcedLight));
    await tab(forcedLight, "more"); await forcedLight.click('#moreNav button[data-v="settings"]');
    await forcedLight.click('#pfLook button[data-v="dark"]'); await forcedLight.waitForTimeout(150);
    check("switching Appearance to Dark applies immediately", await bgOf(forcedLight) === "rgb(14, 26, 38)", await bgOf(forcedLight));
    await forcedLight.click("#nightBtn"); await forcedLight.waitForTimeout(150);
    check("night mode still overrides Appearance", await bgOf(forcedLight) === "rgb(7, 12, 17)", await bgOf(forcedLight));
    check("no page errors on appearance", forcedLight.errors.length === 0, forcedLight.errors.join(" | "));
    await forcedLight.context().close();

    // ---- night mode + 4-hour schedule ----
    PROFILE.schedule = { everyH: 4, startH: 9 };
    const r = await newPage(browser, base, { prefs: { night: "auto" } });
    check("night mode turns on automatically at 2 AM", await r.evaluate(() => document.documentElement.dataset.theme) === "night");
    await tab(r, "feed");
    const labels = await r.$$eval("#sheet .tw", t => [...t[0].querySelectorAll("label")].map(l => l.textContent).join(" "));
    check("4-hour schedule builds 6 slots from 9 AM", labels === "9a 1p 5p 9p 1a 5a", labels);
    check("no page errors on night/4-hour", r.errors.length === 0, r.errors.join(" | "));
    await r.context().close();

    // ---- missed feeds become "Not logged" chips 1 h after their time ----
    { const keep = PROFILE.schedule; PROFILE.schedule = { everyH: 3, startH: 8 };
      for (const [now, due, chip] of [["2026-02-10T23:40:00-05:00", "Due 11p", false], ["2026-02-10T23:58:00-05:00", "Due 11p", false], ["2026-02-11T00:20:00-05:00", "Next 2a", true]]) {
        const m = await newPage(browser, base, { now }); await tab(m, "feed"); await m.waitForTimeout(200);
        const w = (await m.textContent('.nx[data-tw="Ada Rose"] .when')).replace(/\s+/g, " ").trim(), chips = await m.$$eval('.nx[data-tw="Ada Rose"] .missed button', x => x.map(b => b.textContent));
        check(`at ${now.slice(11, 16)} the 11p feed is ${chip ? "a Not logged chip" : "still the due card"}`, w === due && chips.includes("11p") === chip, `${w} / [${chips}]`);
        await m.context().close(); }
      PROFILE.schedule = keep; }
    // ---- 7 AM day boundary, independent of feed times ----
    PROFILE.schedule = { everyH: 3, startH: 6 };   // feeds at 6a/9a/...: the day still flips at 7
    const v = await newPage(browser, base, { now: "2026-02-11T07:20:00-05:00" });
    await v.evaluate(() => { Store.setFeed("Ada Rose-a", { twin: "Ada Rose", t: new Date("2026-02-11T06:00:00-05:00").getTime(), v: 30, note: "", diet: "" }); });
    await tab(v, "feed"); await v.waitForTimeout(200);
    check("at 7:20 AM the sheet is on the new day", (await v.textContent("#dLabel")).startsWith("Today · Wed, Feb 11"), await v.textContent("#dLabel"));
    check("a 6 AM feed counts toward the day before (7 AM boundary)", (await v.textContent('.nx[data-tw="Ada Rose"] .tsum')).includes("0 of 8"), await v.textContent('.nx[data-tw="Ada Rose"] .tsum'));
    const firstSlot = await v.$$eval("#sheet .tw", t => t[0].querySelector("label").textContent);
    check("6 AM feeds land at the end of the day (first slot 9a, last 6a)", firstSlot === "9a", firstSlot);
    check("older name-keyed records get the baby index stamped in place", await v.evaluate(() => __db.feeds["Ada Rose-a"]?.i === 0));
    check("no page errors on 7 AM boundary", v.errors.length === 0, v.errors.join(" | "));
    await v.context().close();

    // ---- 2-hour schedule, "36+0" age format ----
    PROFILE.schedule = { everyH: 2, startH: 8 }; PROFILE.ga = "36+0";
    const u = await newPage(browser, base);
    check("age accepts 36+0", (await u.textContent("#ageLine")).includes("37w3d"), await u.textContent("#ageLine"));
    await u.evaluate(() => Store.setFeed("Ada Rose-stray", { twin: "Ada Rose", t: new Date("2026-02-10T08:50:00-05:00").getTime(), v: 30, note: "", diet: "" }));
    await tab(u, "feed"); await u.waitForTimeout(200);
    const filled = await u.$$eval("#sheet .tw", t => [...t[0].querySelectorAll("input")].filter(i => i.value).length);
    check("2-hour schedule: an off-slot feed counts once", filled === 1, `${filled} slots show it`);
    check("no page errors on 2-hour", u.errors.length === 0, u.errors.join(" | "));
    check("2-hour schedule from 8 AM inside a 7 AM day: 12 slots, 8a..6a", (await u.$$eval("#sheet .tw", t => [...t[0].querySelectorAll("label")].map(l => l.textContent))).join(" ") === "8a 10a 12p 2p 4p 6p 8p 10p 12a 2a 4a 6a");
    await u.context().close();
  } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  await browser.close(); srv.close();
  console.log(`\n${passed} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.map(f => "  ✗ " + f).join("\n")); process.exit(1); }
}
if (require.main === module) main();
module.exports = { serve, newPage, importData, tab, PROFILE, syntheticCSV, SHOTS };
