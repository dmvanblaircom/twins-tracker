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
  if (opts.init) await ctx.addInitScript(opts.init);
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
    check("age line (day of life + corrected age)", (await p.textContent("#ageLine")).includes("Day 11 · 37w3d PMA"), await p.textContent("#ageLine"));
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
    check("Both view is compact (no intake metrics)", (await p.$$(`${A} .metrics`)).length === 0);
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
    check("Details opens the single-baby view", (await p.$$(".nx")).length === 1 && (await p.$$(`${A} .metrics .m`)).length === 3);
    p.answers = ["Try ad lib tomorrow"];
    await p.click(`#planToday [data-tw="Ada Rose"] [data-plan-day]`); await p.waitForTimeout(200);
    check("plan from rounds saves (Today's plan card)", (await p.textContent(`#planToday [data-tw="Ada Rose"]`)).includes("Try ad lib tomorrow") && (await p.textContent(`#planToday [data-tw="Ada Rose"] [data-plan-day]`)).trim() === "Edit");
    p.answers = ["Try ad lib tomorrow; recheck weight"];
    await p.click(`#planToday [data-tw="Ada Rose"] [data-plan-day]`); await p.waitForTimeout(200);
    check("editing today's plan replaces it: still one plan for the day", (await p.textContent(`#planToday [data-tw="Ada Rose"]`)).includes("recheck weight") && (await p.evaluate(() => Object.keys(__db.plans || {}).filter(k => k.startsWith("0-")).length)) === 1);
    check("single-baby view: context names the baby", (await p.textContent("#ctxLabel")).endsWith("Ada Rose"), await p.textContent("#ctxLabel"));
    check("single-baby card: intake, Yesterday and weight only (rounds and trends live elsewhere)", (await p.$$(`${A} .metrics .m`)).length === 3 && !!(await p.$(`${A} [data-act=yday]`)) && !(await p.$(`${A} .spk`)) && !(await p.$(`${A} [data-act=gohome]`)));
    check("Rounds card: questions first, then today's plan, then the checklist", await p.evaluate(() => { const r = document.querySelector("#roundsCard"), q = r.querySelector("#qCard"), pl = r.querySelector("#planCard"), c = r.querySelector("#ckToday [data-ckgo]"); return !!(q && pl && c) && !!(q.compareDocumentPosition(pl) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(pl.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    check("Today has no milk summary (it's on the Milk tab)", !(await p.$("#todayMilk")));
    await p.click("#ckToday [data-ckgo]"); await p.waitForTimeout(250);
    check("checklist link opens Progress", await p.$eval("#tabbar .on", b => b.dataset.tab) === "trends");
    await p.click('#tabbar button[data-tab=feed]'); await p.waitForTimeout(250);
    await p.fill(`${A} .wIn`, "2560"); await p.click(`${A} [data-act=wsave]`); await p.waitForTimeout(900);
    check("tonight's weight saves to the feed day", await db(p, () => __db.weights["b0-2026-02-10"]?.v) === 2560);
    check("mL/kg/day shows", /\d+ mL\/kg\/day/.test(await p.textContent(`${A} .tsum`)), await p.textContent(`${A} .tsum`));
    await p.screenshot({ path: path.join(SHOTS, "today-single.png"), fullPage: true });
    await p.click("#view button:nth-child(3)"); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(SHOTS, "today-both.png") });

    // ---- questions ----
    await p.fill("#qText", "When is the hearing screen?"); await p.press("#qText", "Enter"); await p.waitForTimeout(200);
    p.answers = ["Monday"]; await p.click("#qList [data-q]"); await p.waitForTimeout(200);
    check("question added and answered", (await p.innerText("#qList")).includes("→ Monday"));
    await p.evaluate(() => Store.put("pumps", "p-t", { t: Date.now() - 3600e3, v: 120 })); await p.waitForTimeout(200);

    // ---- milk ----
    await tab(p, "milk");
    check("Milk tab is four cards: estimate, pumping, one log card, chart (no log table)", (await p.$$('.tab[data-tab="milk"] > .card:not([hidden])')).length === 4 && !(await p.$("#mkBody")) && (await p.$$("#mkLogCard #mkPump, #mkLogCard #mkDrop")).length === 2);
    check("Milk: the time is 'now' until changed, folded away", (await p.textContent("#mkWhenLbl")) === "now" && !(await p.$eval("#mkWhen", e => e.open)));
    await p.click("#mkWhen summary"); await p.waitForTimeout(100);
    check("Milk time box stays inside its card", await p.$eval("#mkT", e => e.getBoundingClientRect().right <= e.closest(".card").getBoundingClientRect().right));
    await p.click("#mkWhen summary"); await p.waitForTimeout(100);
    check("baby bar hidden on Milk", !(await p.isVisible(".viewbar")));
    check("Log feed button hidden on Milk", !(await p.isVisible("#fab")));
    check("Milk: no estimate before any drop-off or count", (await p.textContent("#mkInv")).includes("to start the estimate"));
    const pumpsBefore = await db(p, () => Object.keys(__db.pumps || {}).length);
    await p.fill("#mkV", "120"); await p.click("#mkPump"); await p.waitForTimeout(150);
    check("pump entry saves", await db(p, () => Object.keys(__db.pumps || {}).length) === pumpsBefore + 1);
    const pmAt = await p.inputValue("#mkT");
    for (const v of ["30", "35"]) { await p.click("#mkWhen summary"); await p.fill("#mkT", pmAt); await p.fill("#mkV", v); await p.click("#mkPump"); await p.waitForTimeout(150); }
    check("two pump entries in the same minute are both kept", await db(p, () => Object.keys(__db.pumps || {}).length) === pumpsBefore + 3);
    check("Need & pumping shows daily need and 24 h pumped in mL", /Est\. daily need\s*[\d,]+\s*mL/.test(await p.textContent("#mkStats")) && /Pumped 24 h\s*[\d,]+\s*mL/.test(await p.textContent("#mkStats")), (await p.textContent("#mkStats")).replace(/\s+/g, " "));
    const dropAt = await p.evaluate(() => { const d = new Date(Date.now() - 4 * 3600e3), q = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}T${q(d.getHours())}:${q(d.getMinutes())}`; });   // the page's clock, not the real one
    await p.click("#mkWhen summary"); await p.fill("#mkT", dropAt);
    check("Milk: a changed time shows on the fold", (await p.textContent("#mkWhenLbl")) !== "now");
    await p.fill("#mkV", "500"); await p.click("#mkDrop"); await p.waitForTimeout(200);
    check("Took to NICU saves a drop-off at the chosen time, and the time goes back to now", await db(p, () => Object.values(__db.drops || {}).some(x => x.v === 500)) && (await p.textContent("#mkWhenLbl")) === "now");
    const inv1 = await p.textContent("#mkInv");
    const amt = re => { const m = inv1.replace(/\s+/g, " ").match(re); return m ? +m[1].replace(/,/g, "") : NaN; };
    const start = amt(/before your first drop-off .*? ([\d,]+) mL/), added = amt(/Dropped off since.*? ([\d,]+) mL/), used = amt(/scheduled feeds since \(\d+\) ([\d,]+) mL/), est = amt(/Estimated now ([\d,]+) mL/);
    check("drop-off starts an estimate whose working adds up (start + added − used = estimate)", est === Math.max(0, start + added - used) && start === 0 && added === 500, inv1.replace(/\s+/g, " "));
    check("estimate is labelled as an estimate, not a count", (await p.textContent("#mkInvBadge")) === "Estimate" && !inv1.includes("Counted"));
    p.answers = ["1000"]; await p.click("#stkGo"); await p.waitForTimeout(200);
    const inv2 = (await p.textContent("#mkInv")).replace(/\s+/g, " ");
    check("NICU count becomes the starting point, marked Counted", inv2.includes("NICU's count") && inv2.includes("Counted") && /1,000 mL/.test(inv2), inv2);
    check("the working folds under 'How this is worked out' (still on the page)", await p.$eval("#mkInv details.mkhow", d => !d.open && d.querySelector("summary").textContent.includes("How this is worked out")));
    await p.click("#mkRecs"); await p.waitForTimeout(250);
    check("See all milk entries opens Records filtered to milk, with the NICU count", await p.$eval("#tabbar .on", b => b.dataset.tab) === "more" && (await p.$$eval("#logBody tr[data-kind]", x => [...new Set(x.map(t => t.dataset.kind))])).every(k => ["pump", "drop", "count"].includes(k)) && /NICU count/i.test(await p.innerText("#logBody")), JSON.stringify(await p.evaluate(() => ({ tab: document.querySelector("#tabbar .on").dataset.tab, f: document.querySelector("#recF .on")?.dataset.v, kinds: [...new Set([...document.querySelectorAll("#logBody tr[data-kind]")].map(t => t.dataset.kind))], txt: document.querySelector("#logBody").innerText.slice(0, 200) }))));
    await p.click('#recF button[data-v="all"]'); await p.waitForTimeout(100); await tab(p, "milk");
    await p.click("#toast button"); await p.waitForTimeout(200);
    check("Undo of a NICU count restores the drop-off estimate", (await p.textContent("#mkInv")).includes("before your first drop-off"));
    await p.context().setOffline(true); await p.waitForTimeout(200);
    check("offline: sync pill says so", (await p.textContent("#sync")).startsWith("Offline"));
    await p.fill("#mkV", "90"); await p.click("#mkPump"); await p.waitForTimeout(150);
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
    check("Growth grid marks estimated weights", (await p.innerText("#wBody")).includes("est.") && await p.$$eval("#wBody .wv.approx", x => x.length) > 0);
    check("Growth grid is compact: past nights are one line of text, only tonight has an entry box, 14 nights then Show all", await p.evaluate(() => {
      const rows = [...document.querySelectorAll("#wBody tr")], past = rows.filter(r => !r.classList.contains("tonight"));
      return rows.length <= 14 && past.every(r => !r.querySelector("input") && r.getBoundingClientRect().height <= 60) && !!document.querySelector("#wBody tr.tonight input"); }), await p.evaluate(() => JSON.stringify([...document.querySelectorAll("#wBody tr")].map(r => [Math.round(r.getBoundingClientRect().height), r.innerText.replace(/\s+/g, " ")]))));
    check("Growth grid marks tonight", (await p.textContent("#wBody tr.tonight")).includes("Tonight"));
    const cell = '#wBody input[data-k="Bea Joy|2026-02-08"]', open8 = () => p.click('#wBody [data-edit="Bea Joy|2026-02-08"]');
    await open8(); check("tapping a past night opens its entry box, focused", await p.evaluate(() => document.activeElement && document.activeElement.dataset.k === "Bea Joy|2026-02-08"));
    await p.fill(cell, "2712"); await p.press(cell, "Tab"); await p.waitForTimeout(300);
    check("Growth grid edit saves (and clears the estimate flag)", await db(p, () => { const w = __db.weights["b1-2026-02-08"]; return w && w.v === 2712 && !w.approx; }));
    await p.click("#toast button"); await p.waitForTimeout(300);
    check("Undo restores the previous weight", await db(p, () => __db.weights["b1-2026-02-08"].v) === 2700);
    const wOrig = await db(p, () => ({ ...__db.weights["b1-2026-02-08"] }));
    await open8(); await p.fill(cell, "2730");
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
    check("order: indicators, family checklist, baby checklists, then the timeline", await p.evaluate(() => { const a = [...document.querySelectorAll("#home,#famList,#ckBabies,#jCard")].map(e => e.getBoundingClientRect().top); return a.length === 4 && a[0] < a[1] && a[1] < a[2] && a[2] < a[3]; }));
    await p.click('[data-ck="b0-hearing"]'); await p.waitForTimeout(150); await p.click('[data-na="b0-rsv"]'); await p.waitForTimeout(150);
    check("checklist check + n/a", (await p.$$eval("#ckBabies .cl h4", x => x[0].textContent)).includes("1/7"));
    check("checklist marks persist to the database (ids unchanged)", await db(p, () => __db.checklist["b0-hearing"]?.s === "done" && __db.checklist["b0-rsv"]?.s === "na"));
    check("checklist item shows when it was marked", /^[A-Z][a-z]{2} \d+/.test(await p.textContent('[data-ckdate="b0-hearing"]')), await p.textContent('[data-ckdate="b0-hearing"]'));
    // the day it was done can be changed (forgot to check it off that day); who marked it stays
    await db(p, () => Store.put("checklist", "b0-hearing", { s: "done", d: "2026-02-10", by: "parent2@example.com" })); await p.waitForTimeout(200);
    await p.click('[data-ckdate="b0-hearing"]'); await p.waitForTimeout(150);
    check("tapping the date opens a date box limited to birth → today", await p.$eval('input[data-ckin="b0-hearing"]', i => i.type === "date" && i.value === "2026-02-10" && i.max === "2026-02-11" && i.min === "2026-02-01" && i.getBoundingClientRect().height >= 44), await p.$eval('input[data-ckin="b0-hearing"]', i => JSON.stringify([i.type, i.value, i.min, i.max, Math.round(i.getBoundingClientRect().height)])).catch(e => e.message));
    await p.fill('input[data-ckin="b0-hearing"]', "2026-02-06"); await p.waitForTimeout(300);
    check("picking a day saves it and keeps who marked it", await db(p, () => { const c = __db.checklist["b0-hearing"]; return c.s === "done" && c.d === "2026-02-06" && c.by === "parent2@example.com"; }) && (await p.textContent('[data-ckdate="b0-hearing"]')).startsWith("Feb 6"));
    await p.click("#toast button"); await p.waitForTimeout(300);
    check("Undo puts the old day back", await db(p, () => __db.checklist["b0-hearing"].d === "2026-02-10"));
    await p.click('[data-ckdate="b0-hearing"]'); await p.waitForTimeout(150); await p.fill('input[data-ckin="b0-hearing"]', "2026-01-20"); await p.waitForTimeout(250);
    check("a day before birth is refused", await db(p, () => __db.checklist["b0-hearing"].d === "2026-02-10") && (await p.textContent("#banner")).includes("before the babies were born"));
    await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(150);
    check("the family checklist dates can be changed too", await p.click('[data-ck="f-seats"]').then(() => p.waitForTimeout(200)).then(() => p.$('[data-ckdate="f-seats"]')).then(Boolean).catch(() => false));
    await db(p, () => { Store.remove("checklist", "f-seats"); Store.put("checklist", "b0-hearing", { s: "done", d: "2026-02-10" }); }); await p.waitForTimeout(200);
    check("checklist counts: marked done / open / not needed", /1 marked done/.test(await p.textContent("#ckBabies .ckmeta")) && /6 open/.test(await p.textContent("#ckBabies .ckmeta")) && /1 not needed/.test(await p.textContent("#ckBabies .ckmeta")), await p.textContent("#ckBabies .ckmeta"));
    await p.click('[data-ck="f-cpr"]'); await p.waitForTimeout(150);
    check("family checklist updates", await db(p, () => __db.checklist["f-cpr"]?.s === "done") && /1\/6/.test(await p.textContent("#famList h2")));
    await p.evaluate(() => { const b = document.querySelector('[data-ck="b1-hearing"]'); b.scrollIntoView({ block: "center" }); window.__ck = { b, y: scrollY }; });
    await p.click('[data-ck="b1-hearing"]'); await p.waitForTimeout(200);
    const still = await p.evaluate(() => { const b = document.querySelector('[data-ck="b1-hearing"]'); return { same: b === __ck.b, dy: Math.abs(scrollY - __ck.y), on: b.getAttribute("aria-pressed") }; });
    check("checklist tap keeps the screen still (same button, no scroll)", still.same && still.dy < 2 && still.on === "true", JSON.stringify(still));
    await db(p, () => Store.put("checklist", "b1-cchd", { s: "done", d: "2026-02-10", by: "parent2@example.com" })); await p.waitForTimeout(200);
    check("the other parent's checklist mark updates in place, with counts", await p.evaluate(() => document.querySelector('[data-ck="b1-hearing"]') === __ck.b) && (await p.$$eval("#ckBabies .cl h4 .ckn", x => x[1].textContent)) === "2/8" && /P|parent2/.test(await p.textContent('[data-ckdate="b1-cchd"]')), await p.$$eval("#ckBabies .cl h4 .ckn", x => x.map(e => e.textContent).join(",")));
    await db(p, () => { Store.remove("checklist", "b1-hearing"); Store.remove("checklist", "b1-cchd"); }); await p.waitForTimeout(200);
    await p.click('#tabbar button[data-tab=weight]'); await p.waitForTimeout(300);
    check("Growth holds all three charts: weight, by mouth per day, by mouth per feed (Journey has none)", await p.evaluate(() => ["cWeight", "cDaily", "cFeed"].every(id => document.getElementById(id).closest('.tab[data-tab="weight"]')) && !document.querySelector('.tab[data-tab="trends"] canvas')));
    check("By mouth: one card, Per day shown first, Per feed hidden", !(await p.$eval("#poDay", e => e.hidden)) && await p.$eval("#poFeed", e => e.hidden) && (await p.$$("#poCard canvas")).length === 2);
    await p.click('#poMode button[data-v="feed"]'); await p.waitForTimeout(300);
    check("By mouth: Per feed swaps the chart and is remembered on this phone", await p.$eval("#poDay", e => e.hidden) && !(await p.$eval("#poFeed", e => e.hidden)) && await p.evaluate(() => localStorage.getItem("poMode") === "feed" && !!Chart.getChart("cFeed")));
    const gl = await p.$$eval("#grSum .gline", x => x.map(e => e.textContent.trim()));
    const wantG = await p.evaluate(() => [0, 1].map(i => { const w = Object.values(__db.weights).filter(x => x.i === i).sort((a, b) => a.date < b.date ? -1 : 1), cur = w[w.length - 1];
      const t = d => new Date(d + "T20:00:00").getTime(), pts = w.filter(x => t(x.date) >= t(cur.date) - 7 * 864e5).map(x => ({ x: t(x.date) / 864e5, y: x.v }));
      const n = pts.length, mx = pts.reduce((a, q) => a + q.x, 0) / n, my = pts.reduce((a, q) => a + q.y, 0) / n;
      const g = pts.reduce((a, q) => a + (q.x - mx) * (q.y - my), 0) / pts.reduce((a, q) => a + (q.x - mx) ** 2, 0);
      const v = g / (cur.v / 1000); return `Gain ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} g/kg/day · last ${n} nights`; }));
    check("Growth: each summary card shows weight gain per day over the last 7 nights", gl.length === 2 && gl[0] === wantG[0] && gl[1] === wantG[1], `${gl.join(" | ")} vs ${wantG.join(" | ")}`);
    await p.evaluate(() => document.querySelector("#cFeed").scrollIntoView({ block: "center" })); await p.waitForTimeout(250);
    const box = await p.$eval("#cFeed", c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * .4, y: r.y + r.height * .6 }; });
    const tip = () => p.evaluate(() => Chart.getChart("cFeed").tooltip.getActiveElements().length);
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
    // ---- Store additions: patch + private (stub contract) ----
    await db(p, () => { Store.put("events", "e-1", { title: "First hold", note: "keep me", by: "parent2@example.com" }); });
    await db(p, () => Store.patch("events", "e-1", { title: "First cuddle", by: "someone-else" }));
    check("Store.patch merges fields and keeps the original author", await db(p, () => { const e = __db.events["e-1"]; return e.title === "First cuddle" && e.note === "keep me" && e.by === "parent2@example.com"; }));
    const errs0 = await db(p, () => { window.__se = 0; addEventListener("store-error", () => window.__se++); return 0; });
    await db(p, () => Store.patch("events", "e-gone", { title: "x" })); await p.waitForTimeout(50);
    check("Store.patch never recreates a missing record (reports an error instead)", await db(p, () => !__db.events["e-gone"] && window.__se === 1));
    await db(p, () => { __db.private.u2.checkins = { "c-partner": { mood: 1, by: "parent2@example.com" } }; Store.putPrivate("checkins", "c-mine", { mood: 4 }); Store.putPrivate("checkins", "c-temp", { mood: 2 }); });
    const seen = await p.evaluate(() => new Promise(res => { const un = Store.watchPrivate("checkins", list => { un(); res(list.map(([id]) => id).sort().join()); }); }));
    check("Store.watchPrivate shows only my own private records", seen === "c-mine,c-temp", seen);
    check("Store.putPrivate writes only to my private area, with my name on it", await db(p, () => __db.private.u1.checkins["c-mine"].by === "parent1@example.com" && !__db.private.u2.checkins["c-mine"] && !__db.checkins));
    await db(p, () => Store.removePrivate("checkins", "c-temp"));
    check("Store.removePrivate deletes only my record", await db(p, () => !__db.private.u1.checkins["c-temp"] && !!__db.private.u1.checkins["c-mine"] && !!__db.private.u2.checkins["c-partner"]));
    check("Store.lists names the shared, private and config collections in one place", await db(p, () => Store.lists.shared.includes("events") && Store.lists.shared.includes("needs") && Store.lists.private.join() === "checkins"));

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
    // format 2 specifics
    check("backup is format 2 with events, needs and a private section", bk.format === 2 && "events" in bk.data && "needs" in bk.data && !!bk.data.private && "checkins" in bk.data.private && bk.data.events["e-1"]);
    check("backup carries my private data and never the other parent's", !!bk.data.private.checkins["c-mine"] && !bk.data.private.checkins["c-partner"] && !JSON.stringify(bk).includes("c-partner"));
    const tmp = (name, obj) => { const f = path.join(SHOTS, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
    await db(p, () => { Store.removePrivate("checkins", "c-mine"); Store.remove("events", "e-1"); }); await p.waitForTimeout(150);
    p.answers = [true]; await p.setInputFiles("#rsFile", await dl.path()); await p.waitForTimeout(400);
    check("format 2 restore brings back events and my private data — into my private area only", await db(p, () => !!__db.events["e-1"] && !!__db.private.u1.checkins["c-mine"] && !__db.private.u2.checkins["c-mine"] && !__db.checkins), await p.textContent("#bkMsg"));
    check("restore leaves the other parent's private data alone", await db(p, () => Object.keys(__db.private.u2.checkins).join() === "c-partner"));
    const f1 = JSON.parse(JSON.stringify(bk)); f1.format = 1; delete f1.data.events; delete f1.data.needs; delete f1.data.private;
    const lost2 = Object.keys(bk.data.pumps)[1]; await db(p, id => Store.remove("pumps", id), lost2); await p.waitForTimeout(150);
    p.answers = [true]; await p.setInputFiles("#rsFile", tmp("bk-format1.json", f1)); await p.waitForTimeout(400);
    check("a format 1 backup still restores", await db(p, id => !!__db.pumps[id], lost2), await p.textContent("#bkMsg"));
    const fn = JSON.parse(JSON.stringify(bk)); fn.app = "niculog"; await db(p, id => Store.remove("pumps", id), lost2); await p.waitForTimeout(150);
    p.answers = [true]; await p.setInputFiles("#rsFile", tmp("bk-niculog.json", fn)); await p.waitForTimeout(400);
    check("a backup tagged niculog is accepted", await db(p, id => !!__db.pumps[id], lost2));
    const f3 = JSON.parse(JSON.stringify(bk)); f3.format = 3; await p.setInputFiles("#rsFile", tmp("bk-format3.json", f3)); await p.waitForTimeout(200);
    check("a backup from a newer format is refused in plain language", (await p.textContent("#bkMsg")).includes("newer version"));
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
    check("A++ text: tab labels fit without wrapping or clipping", await q.$$eval("#tabbar button span", s => s.every(e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().height < 30)));
    check("24-hour clock", (await q.textContent(`${A} .when`)).includes("02:00"));
    for (const t of ["feed", "weight", "milk", "trends", "more"]) {
      await tab(q, t);
      const over = await q.evaluate(() => [...document.querySelectorAll(".tab.on *")].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1 && !e.closest("[style*='overflow-x']"); }).length);
      check(`A++ text: no sideways overflow on ${t}`, over === 0, `${over} elements`);
    }
    await tab(q, "weight"); const gw = await q.$eval("table.wg", e => e.parentElement.scrollWidth <= e.parentElement.clientWidth + 1);
    const gwWhy = await q.$eval("table.wg", e => JSON.stringify({ sw: e.parentElement.scrollWidth, cw: e.parentElement.clientWidth, cells: [...e.querySelectorAll("tr:nth-child(-n+3) td, thead th")].map(c => [Math.round(c.getBoundingClientRect().width), c.innerText.replace(/\s+/g, " ").slice(0, 30), [...c.children].map(k => k.tagName + "." + k.className + ":" + Math.round(k.getBoundingClientRect().width) + "/" + getComputedStyle(k).minWidth)]) }));
    await tab(q, "more"); await q.click('#moreNav button[data-v="records"]'); await q.waitForTimeout(150);
    check("A++ text: growth grid and records need no sideways scroll", gw && await q.$eval("table.rec", e => e.parentElement.scrollWidth <= e.parentElement.clientWidth + 1), gwWhy);
    await q.screenshot({ path: path.join(SHOTS, "large-text.png") });
    check("no page errors with prefs", q.errors.length === 0, q.errors.join(" | "));
    await q.context().close();

    // ---- Phase 2: Journey — moments, timeline, firsts ----
    { const J = await newPage(browser, base); await importData(J);
      const evs = () => J.evaluate(() => Object.entries(__db.events || {}));
      const sheet = async (who, kind, pick, title, note) => {
        await J.click("#jAdd"); await J.waitForTimeout(100);
        await J.click(`#mWho button[data-v="${who}"]`); await J.click(`#mKind button[data-v="${kind}"]`);
        if (pick != null && kind === "milestone") await J.selectOption("#mPick", pick);
        if (title != null) await J.fill("#mTitle", title); if (note != null) await J.fill("#mNote", note);
        await J.click("#mSave"); await J.waitForTimeout(200); };
      await tab(J, "trends");
      check("Journey timeline sits below the existing Progress content", await J.evaluate(() => !!(document.querySelector("#ckBabies").compareDocumentPosition(document.querySelector("#jCard")) & Node.DOCUMENT_POSITION_FOLLOWING)));
      check("checklist label reads 'Open crib, maintaining temperature' (id unchanged)", (await J.textContent('[data-ck="b0-crib"] .lb')) === "Open crib, maintaining temperature");
      // add one of each scope
      await sheet("0", "milestone", "first-hold", null, "Forty minutes");
      let e = (await evs()).find(([, d]) => d.key === "first-hold");
      check("baby milestone from the catalog saves with index, key, title and author", !!e && e[1].kind === "milestone" && e[1].scope === "baby" && e[1].i === 0 && e[1].title === "First hold" && e[1].by === "parent1@example.com" && e[1].editBy === "parent1@example.com" && e[1].src === null && e[1].ref === null, JSON.stringify(e && e[1]));
      await J.click("#toast button"); await J.waitForTimeout(150);
      check("Undo removes a new moment", !(await evs()).some(([, d]) => d.key === "first-hold"));
      await sheet("0", "milestone", "first-hold", null, "Forty minutes");
      await sheet("1", "milestone", "", "Big yawn", null);
      await sheet("parent", "journal", null, null, "Long night, both slept after the 11p feed.");
      await sheet("family", "milestone", "holding-both", null, null);
      const all = (await evs()).map(([, d]) => d);
      check("custom milestone saves as kind 'moment' with no key", all.some(d => d.kind === "moment" && d.key === null && d.i === 1 && d.title === "Big yawn"));
      check("'Me' journal saves as scope parent with a title from the note", all.some(d => d.kind === "journal" && d.scope === "parent" && d.i === null && d.title.startsWith("Long night")));
      check("'Our family' offers holding both babies and saves as scope family", all.some(d => d.scope === "family" && d.key === "holding-both" && d.i === null && d.title === "First time holding both babies at once"));
      check("every saved event passes the shared validation", all.every(d => true) && await J.evaluate(() => Object.values(__db.events).every(__nicu.validEvent)));
      check("milestones and journal entries show with distinct treatments on the rail", (await J.$$("#jRail .ji-ms")).length >= 3 && (await J.$$("#jRail .ji-jr")).length >= 1 && (await J.$$("#jRail .ji-sum")).length >= 1);
      // edit + undo
      const holdId = (await evs()).find(([, d]) => d.key === "first-hold")[0];
      await J.click(`#jRail [data-ev="${holdId}"]`); await J.waitForTimeout(100); await J.fill("#mNote", "Forty-five minutes"); await J.click("#mSave"); await J.waitForTimeout(150);
      check("editing patches the moment", (await J.evaluate(id => __db.events[id].note, holdId)) === "Forty-five minutes");
      await J.click("#toast button"); await J.waitForTimeout(150);
      check("Undo restores the edited moment", (await J.evaluate(id => __db.events[id].note, holdId)) === "Forty minutes");
      // overwrite guard
      await J.click(`#jRail [data-ev="${holdId}"]`); await J.waitForTimeout(100);
      await J.evaluate(id => { const d = __db.events[id]; Store.put("events", id, { ...d, note: "Theirs", editT: Date.now() + 5, editBy: "parent2@example.com", by: d.by }); }, holdId); await J.waitForTimeout(100);
      await J.fill("#mNote", "Mine"); J.answers = [false]; await J.click("#mSave"); await J.waitForTimeout(150);
      check("overwrite guard asks before replacing the other parent's edit (Cancel keeps theirs)", J.dialogs.some(d => d.includes("just edited this")) && (await J.evaluate(id => __db.events[id].note, holdId)) === "Theirs", J.dialogs.slice(-1)[0]);
      await J.click("#mCancel");
      // edit vs delete
      const yawnId = (await evs()).find(([, d]) => d.title === "Big yawn")[0];
      await J.click(`#jRail [data-ev="${yawnId}"]`); await J.waitForTimeout(100);
      await J.evaluate(id => Store.remove("events", id), yawnId); await J.waitForTimeout(100);
      await J.fill("#mTitle", "Bigger yawn"); J.answers = [true]; await J.click("#mSave"); await J.waitForTimeout(150);
      check("saving a moment the other parent deleted offers to save it as new", J.dialogs.some(d => d.includes("removed from your journey")) && !(await J.evaluate(id => !!__db.events[id], yawnId)) && (await evs()).some(([, d]) => d.title === "Bigger yawn"));
      // delete + undo
      await J.click(`#jRail [data-ev="${holdId}"]`); await J.waitForTimeout(100); await J.click("#mDel"); await J.waitForTimeout(150);
      const gone = !(await J.evaluate(id => !!__db.events[id], holdId)); await J.click("#toast button"); await J.waitForTimeout(150);
      check("delete removes a moment and Undo brings it back", gone && await J.evaluate(id => !!__db.events[id], holdId));
      // Undo never silently overwrites the other parent's later change
      await sheet("0", "milestone", "first-story", null, "Goodnight Moon");
      const stId = (await evs()).find(([, d]) => d.key === "first-story")[0];
      await J.evaluate(id => { const d = __db.events[id]; Store.put("events", id, { ...d, note: "Their note", editT: Date.now() + 9, editBy: "parent2@example.com", by: d.by }); }, stId); await J.waitForTimeout(100);
      J.answers = [false]; await J.click("#toast button"); await J.waitForTimeout(150);
      check("Undo of a new moment asks first if the other parent edited it since (Cancel keeps theirs)", J.dialogs.slice(-1)[0].includes("changed this after you saved it") && (await J.evaluate(id => __db.events[id] && __db.events[id].note, stId)) === "Their note", J.dialogs.slice(-1)[0]);
      await J.click(`#jRail [data-ev="${stId}"]`); await J.waitForTimeout(100); await J.fill("#mNote", "My edit"); await J.click("#mSave"); await J.waitForTimeout(150);
      await J.evaluate(id => { const d = __db.events[id]; Store.put("events", id, { ...d, note: "Their second edit", editT: Date.now() + 19, editBy: "parent2@example.com", by: d.by }); }, stId); await J.waitForTimeout(100);
      J.answers = [false]; await J.click("#toast button"); await J.waitForTimeout(150);
      check("Undo of an edit asks first if the other parent edited it since (Cancel keeps theirs)", J.dialogs.slice(-1)[0].includes("changed this after you saved it") && (await J.evaluate(id => __db.events[id].note, stId)) === "Their second edit");
      await J.click(`#jRail [data-ev="${stId}"]`); await J.waitForTimeout(100); await J.fill("#mNote", "Mine again"); J.answers = [true]; await J.click("#mSave"); await J.waitForTimeout(150);
      const nd = J.dialogs.length; await J.click("#toast button"); await J.waitForTimeout(150);
      check("Undo with no change from the other parent still works without asking", J.dialogs.length === nd && (await J.evaluate(id => __db.events[id].note, stId)) === "Their second edit");

      // summaries and records from existing data
      const rail = await J.textContent("#jRail");
      check("feeds appear as daily summaries per baby", /Ada Rose:\s*[\d,]+ mL by mouth · \d+ of 8 feeds/.test(rail) && /Bea Joy:\s*[\d,]+ mL by mouth · \d+ of 8 feeds/.test(rail));
      check("each baby has at most one feed summary per day", await J.evaluate(() => { const days = []; let cur = null; for (const li of document.querySelectorAll("#jRail li")) { if (li.classList.contains("jday")) { cur = { a: 0, b: 0 }; days.push(cur); } else if (li.classList.contains("ji-sum") && /by mouth/.test(li.textContent)) { if (li.textContent.includes("Ada Rose")) cur.a++; if (li.textContent.includes("Bea Joy")) cur.b++; } } return days.every(d => d.a <= 1 && d.b <= 1); }));
      check("weights appear from the grid (not copied)", /Ada Rose:\s*[\d,]+ g/.test(rail) && !(await J.evaluate(() => Object.values(__db.events).some(e => /g$/.test(e.title)))));
      // shared check-in + invalid events
      await J.evaluate(() => { const now = Date.now();
        Store.put("events", "e-ck", { kind: "journal", scope: "parent", i: null, key: null, t: now - 36e5, title: "Check-in", note: "Feeling hopeful", ref: null, src: "checkin", by: "parent2@example.com", createdT: now, editT: now, editBy: "parent2@example.com" });
        Store.put("events", "e-bad", { kind: "milestone", scope: "baby", i: null, key: null, t: now, title: "Broken", note: "", ref: null, src: null, createdT: now, editT: now, editBy: "x" }); });
      await J.waitForTimeout(200);
      check("a shared check-in renders as '{name} shared a check-in'", /shared a check-in/.test(await J.textContent("#jRail")) && (await J.textContent("#jRail")).includes("Feeling hopeful"));
      check("an event with scope baby and no valid index is rejected (never shown)", !(await J.textContent("#jRail")).includes("Broken") && !(await J.evaluate(() => __nicu.validEvent({ kind: "milestone", scope: "baby", i: null, t: 1, title: "x" }))));
      check("validation rejects any other src value", !(await J.evaluate(() => __nicu.validEvent({ kind: "journal", scope: "parent", i: null, t: 1, title: "x", src: "c-123" }))));
      // baby selector
      await J.click("#view button:nth-child(1)"); await J.waitForTimeout(200);
      check("the timeline follows the baby selector", !(await J.textContent("#jRail")).includes("Bea Joy:") && (await J.textContent("#jRail")).includes("Ada Rose:"));
      await J.click("#view button:nth-child(3)"); await J.waitForTimeout(200);
      // firsts
      check("firsts appear as suggestions, one at a time", (await J.$$("#jSuggest .jsug")).length === 1 && (await J.textContent("#jSuggest")).includes("From your logs"));
      const before = (await evs()).length, sg1 = await J.$eval("#jSuggest .jsug", c => c.dataset.key + "|" + c.dataset.i);
      await J.click('#jSuggest [data-sg="dismiss"]'); await J.waitForTimeout(150);
      check("'Not now' saves nothing to the family record and hides that suggestion", (await evs()).length === before && !(await J.$$eval("#jSuggest .jsug", cs => cs.map(c => c.dataset.key + "|" + c.dataset.i))).includes(sg1));
      const k2 = await J.$eval("#jSuggest .jsug", c => c.dataset.key + "|" + c.dataset.i);
      await J.click('#jSuggest [data-sg="add"]'); await J.waitForTimeout(150);
      const added = (await evs()).map(([, d]) => d).find(d => d.key + "|" + d.i === k2);
      check("'Add to journey' saves the first with a ref to its source record", !!added && added.ref && ["feeds", "weights"].includes(added.ref.col) && !!added.ref.id && added.kind === "milestone", JSON.stringify(added));
      // a saved first stays intact if its source record is deleted
      const src = added.ref; await J.evaluate(r => r.col === "feeds" ? Store.delFeed(r.id) : Store.delWeight(r.id), src); await J.waitForTimeout(200);
      const kept = await J.evaluate(k => Object.values(__db.events).find(d => d.key + "|" + d.i === k), k2);
      check("a saved first stays intact when its source feed or weight is deleted", !!kept && kept.title === added.title && kept.ref && kept.ref.id === src.id && (await J.textContent("#jRail")).includes(added.title));
      check("…the timeline still shows it, and the same first isn't suggested again", !(await J.$$eval("#jSuggest .jsug", cs => cs.map(c => c.dataset.key + "|" + c.dataset.i))).includes(k2) && J.errors.length === 0, J.errors.join(" | "));
      const keptId = await J.evaluate(k => Object.entries(__db.events).find(([, d]) => d.key + "|" + d.i === k)[0], k2);
      await J.click(`#jRail [data-ev="${keptId}"]`); await J.waitForTimeout(100); await J.fill("#mNote", "Still remembered"); await J.click("#mSave"); await J.waitForTimeout(150);
      check("…and it can still be edited (keeping its title, kind and link)", await J.evaluate(([id, title]) => { const d = __db.events[id]; return d.note === "Still remembered" && d.title === title && d.kind === "milestone" && !!d.ref; }, [keptId, added.title]));
      // offline
      await J.context().setOffline(true); await J.waitForTimeout(200); await tab(J, "trends");
      await sheet("0", "milestone", "first-bath", null, null);
      check("the timeline renders and accepts a moment offline", (await J.$$("#jRail li")).length > 3 && (await evs()).some(([, d]) => d.key === "first-bath"));
      await J.context().setOffline(false);
      // sheet controls
      await J.click("#jAdd"); await J.waitForTimeout(100);
      check("Add a moment controls are at least 44 px tall", await J.evaluate(() => [...document.querySelectorAll("#mSheet button, #mSheet input, #mSheet select")].filter(e => e.offsetParent && !e.closest("[hidden]")).every(e => e.getBoundingClientRect().height >= 43.5)));
      check("a new moment's sheet has no Delete button", !(await J.isVisible("#mDel")));
      await J.click("#mCancel");
      check("no page errors on Journey", J.errors.length === 0, J.errors.join(" | "));
      await J.context().close(); }
    { const M = await newPage(browser, base);
      await M.evaluate(() => { const d0 = new Date("2026-02-10T12:00:00-05:00").getTime();
        for (let k = 0; k < 20; k++) Store.put("events", "e-m" + k, { kind: "moment", scope: "family", i: null, key: null, t: d0 - k * 864e5, title: "Moment " + k, note: "", ref: null, src: null, createdT: 1, editT: 1, editBy: "x" }); });
      await tab(M, "trends"); await M.waitForTimeout(150);
      const days1 = (await M.$$("#jRail .jday")).length, more1 = await M.isVisible("#jMore");
      await M.click("#jMore"); await M.waitForTimeout(150);
      check("the timeline shows 14 days at a time; 'Show earlier days' loads the next 14", days1 === 14 && more1 && (await M.$$("#jRail .jday")).length === 20 && !(await M.isVisible("#jMore")), `${days1} days, more=${more1}`);
      await M.context().close(); }
    { const E = await newPage(browser, base);
      await tab(E, "trends");
      check("an empty journey invites the first entry", (await E.textContent("#jEmpty")).includes("This is where your story lives"));
      await E.context().close(); }
    { const B1 = await newPage(browser, base, { now: "2026-02-01T12:00:00-05:00" });
      check("the birth date shows as Day 1 (PMA unchanged: 36w0d)", (await B1.textContent("#ageLine")).includes("Day 1 · 36w0d PMA"), await B1.textContent("#ageLine"));
      await B1.context().close(); }
    { const D100 = await newPage(browser, base, { now: "2026-05-11T12:00:00-04:00" });
      await D100.evaluate(() => Store.put("events", "e-d100", { kind: "moment", scope: "baby", i: 0, key: null, t: Date.now(), title: "Big day", note: "", ref: null, src: null, createdT: 1, editT: 1, editBy: "x" }));
      await tab(D100, "feed");
      check("the 100th day of life shows Day 100 on Today", (await D100.textContent("#ageLine")).startsWith("Day 100 ·"), await D100.textContent("#ageLine"));
      await tab(D100, "trends"); await D100.waitForTimeout(150);
      check("…and Day 100 on the Journey day header", (await D100.textContent("#jRail .jday")).includes("Day 100"), await D100.textContent("#jRail .jday"));
      await D100.context().close(); }
    { const W2 = await newPage(browser, base, { now: "2026-02-11T12:00:00-05:00" });
      await tab(W2, "trends");
      const wk = await W2.textContent("#jSuggest");
      check("later in the 7-day window, a date milestone still names its actual date", wk.includes("One week old") && wk.includes("This week") && wk.includes("On Sun, Feb 8"), wk.replace(/\s+/g, " "));
      await W2.context().close(); }
    { const W1 = await newPage(browser, base, { now: "2026-02-08T12:00:00-05:00" });
      await tab(W1, "trends");
      check("date milestone: 'One week old' is suggested on the day", (await W1.textContent("#jSuggest")).includes("One week old") && (await W1.textContent("#jSuggest")).includes("Today"));
      await W1.context().close(); }
    { const H = await newPage(browser, base, { now: "2026-05-11T12:00:00-04:00" });
      await tab(H, "trends");
      check("date milestone: '100 days old' is the 100th day of life (birth + 99 days)", await H.evaluate(() => [...document.querySelectorAll("#jSuggest .jsug, #jSuggest [data-sg=more]")].length > 0) && (await H.evaluate(async () => { const b = document.querySelector('#jSuggest [data-sg="more"]'); if (b) b.click(); await new Promise(r => setTimeout(r, 50)); return document.querySelector("#jSuggest").textContent; })).includes("100 days old"));
      await H.context().close(); }
    { // pure timeline: order, no duplicates, summaries, filtering
      const U = await newPage(browser, base);
      const r = await U.evaluate(() => { const day = t => new Date(t).toISOString().slice(0, 10), T0 = Date.UTC(2026, 1, 10, 12);
        const tl = __nicu.buildTimeline({ F: [{ twin: "A", t: T0, v: 30, note: "" }, { twin: "A", t: T0 + 36e5, v: 0, note: "All by tube" }, { twin: "B", t: T0, v: 20, note: "" }, { twin: "A", t: T0 - 864e5, v: 25, note: "" }],
          W: {}, CK: { "b1-hearing": { s: "done", d: "2026-02-10", by: "x" } }, PLANS: {}, QS: [{ text: "Q?", done: true, doneT: T0 + 2 * 36e5, ans: "A." }], P: [{ t: T0, v: 100 }, { t: T0 + 1, v: 50 }], D: [{ t: T0, v: 200 }],
          EV: [{ id: "e1", kind: "milestone", scope: "baby", i: 0, t: T0 + 3 * 36e5, title: "First hold" }, { id: "e2", kind: "journal", scope: "family", i: null, t: T0 - 864e5, title: "Day one" }],
          twins: ["A", "B"], shown: ["A"], feedsPerDay: 8, dayOf: day, checkLabel: () => "Hearing screen" });
        return { days: tl.map(g => g.day), d0: tl[0].items.map(i => i.type + ":" + (i.sub || i.ev?.id) + ":" + (i.i ?? "-")), feedA: tl[0].items.find(i => i.sub === "feed"), pump: tl[0].items.find(i => i.sub === "pump") }; });
      check("buildTimeline: days newest first, items newest first", r.days.join() === "2026-02-10,2026-02-09" && r.d0[0].startsWith("milestone:e1"), JSON.stringify(r.d0));
      check("buildTimeline: one feed summary per baby per day, with tube count; hidden baby excluded", r.feedA && r.feedA.mL === 30 && r.feedA.n === 1 && r.feedA.tube === 1 && !r.d0.some(x => x.endsWith(":1")), JSON.stringify(r));
      check("buildTimeline: pumping and drop-offs as one family summary", r.pump && r.pump.mL === 150 && r.pump.n === 2 && r.pump.drop === 200);
      await U.context().close(); }

    // ---- families: start one, join with a code, invite, remove, delete account ----
    { const n = await newPage(browser, base, { init: () => { window.__TEST_NOFAMILY = true; window.__TEST_PROFILE = null; } });
      check("a new account is asked to join or start a family", await n.isVisible("#family") && !(await n.isVisible("#main")));
      await n.fill("#fmCode", "WRONG-123"); await n.click("#fmJoin"); await n.waitForTimeout(200);
      check("a wrong invite code is explained", (await n.textContent("#fmMsg")).includes("didn't match"), await n.textContent("#fmMsg"));
      n.answers = [true]; await n.click("#fmNew"); await n.waitForTimeout(300);
      check("starting a family leads to the one-time setup", await n.isVisible("#setup") && !(await n.isVisible("#family")));
      check("no page errors starting a family", n.errors.length === 0, n.errors.join(" | "));
      await n.context().close(); }
    { const j = await newPage(browser, base, { init: () => { window.__TEST_NOFAMILY = true; } });
      await j.fill("#fmCode", "test-code"); await j.click("#fmJoin"); await j.waitForTimeout(400);
      check("joining with the partner's code opens the shared babies", await j.isVisible("#main") && (await j.textContent("#title")).includes("Ada Rose"));
      await j.context().close(); }
    { const f = await newPage(browser, base);
      await tab(f, "more"); await f.click('#moreNav button[data-v="settings"]'); await f.waitForTimeout(200);
      const list = await f.textContent("#fmList");
      check("Settings lists the family with you and the owner marked", list.includes("parent1@example.com") && list.includes("you") && list.includes("owner") && list.includes("parent2@example.com"), list);
      check("Settings shows the invite code", (await f.textContent("#fmInvite")) === "TEST-CODE");
      await f.click("#fmRenew"); await f.waitForTimeout(200);
      check("New code replaces the invite", (await f.textContent("#fmInvite")) === "NEWC-ODE2");
      f.answers = [true]; await f.click('#fmList [data-rm="u2"]'); await f.waitForTimeout(200);
      check("the owner can remove someone", !(await f.textContent("#fmList")).includes("parent2@example.com"));
      f.answers = [true, "nope"]; await f.click("#fmDelete"); await f.waitForTimeout(200);
      check("a wrong password deletes nothing", !(await f.evaluate(() => window.__deleted)) && (await f.textContent("#banner")).includes("didn't match"));
      await f.evaluate(() => { window.__TEST_DELETE_FAILS = true; }); f.answers = [true, "pw"]; await f.click("#fmDelete"); await f.waitForTimeout(250);
      check("if account deletion can't finish, the app says the account still exists and stays signed in", (await f.textContent("#banner")).includes("still exists") && !(await f.isVisible("#login")) && !(await f.evaluate(() => window.__deleted)));
      await f.evaluate(() => { window.__TEST_DELETE_FAILS = false; });
      f.answers = [true, "pw"]; await f.click("#fmDelete"); await f.waitForTimeout(300);
      check("the last member deleting their account removes the family's data and signs out", await f.evaluate(() => window.__deleted && !Object.keys(__db.feeds || {}).length && !__db.config.profile) && await f.isVisible("#login"));
      check("deleting warns that everything goes when you're the only one", f.dialogs.some(d => d.includes("only one in the family")));
      await f.click("#lMode");
      check("sign-in screen offers account creation", (await f.textContent("#lGo")) === "Create account");
      check("no page errors in family settings", f.errors.length === 0, f.errors.join(" | "));
      await f.context().close(); }

    // ---- navigation (D1): Today · Growth · Milk · Journey · More, ids unchanged ----
    { const N = await newPage(browser, base); await importData(N);
    check("tab bar reads Today · Growth · Milk · Journey · More", (await N.$$eval("#tabbar button", b => b.map(x => x.dataset.tab + ":" + x.textContent.trim()).join())) === "feed:Today,weight:Growth,milk:Milk,trends:Journey,more:More");
    await tab(N, "trends");
    check("Journey shows the existing Progress experience", await N.isVisible(".glance") && (await N.textContent(".glance h2")) === "Progress at a glance" && await N.isVisible("#ckBabies"));
    await tab(N, "more"); await N.click('#moreNav button[data-v="records"]'); await N.waitForTimeout(150);
    check("More opens Records / Care / Support / Settings", await N.isVisible("#moreNav") && (await N.$$eval("#moreNav button", b => b.map(x => x.textContent).join())) === "Records,Care,Support,Settings" && await N.isVisible("#logBody"));
    await tab(N, "trends"); await N.reload(); await N.waitForTimeout(700);
    check("the chosen tab is remembered (stored id 'trends' still valid)", await N.$eval("#tabbar .on", b => b.dataset.tab) === "trends" && await N.isVisible(".glance"));
      check("no page errors in navigation", N.errors.length === 0, N.errors.join(" | "));
      await N.context().close(); }

    // ---- Phase 1 lifecycle: leave / removal / account deletion clean only the right private data ----
    { const L = await newPage(browser, base);
      await L.evaluate(() => { __db.private.u2.checkins = { "c-partner": { mood: 1 } }; return Store.putPrivate("checkins", "c-mine", { mood: 3 }); });
      await L.evaluate(() => Store.leave());   // the Leave button runs this, then reloads the page (which would reset the stub)
      check("leaving deletes my private data and leaves the other parent's", await L.evaluate(() => Object.keys(__db.private.u1.checkins || {}).length === 0 && !!__db.private.u2.checkins["c-partner"]));
      await L.context().close(); }
    { const R = await newPage(browser, base, { init: () => { window.__TEST_REMOVED = true; } });
      check("a removed parent lands on join / start a family", await R.isVisible("#family") && !(await R.isVisible("#main")));
      await R.context().close(); }
    { const R2 = await newPage(browser, base, { init: () => { window.__TEST_REMOVED = true; window.__TEST_CLEANUP_FAILS = true; } });
      check("if removal cleanup can't finish, the app says so instead of pretending", (await R2.textContent("#banner")).includes("needs a connection") && !(await R2.isVisible("#family")));
      await R2.context().close(); }
    { const D = await newPage(browser, base);
      await D.evaluate(() => { __fam.members = [{ uid: "u1", email: "parent1@example.com" }]; __db.private.u2.checkins = { "c-partner": { mood: 1 } };
        Store.put("events", "e-9", { title: "x" }); Store.put("needs", "n-1", { text: "meals" }); return Store.putPrivate("checkins", "c-mine", { mood: 3 }); });
      await tab(D, "more"); await D.click('#moreNav button[data-v="settings"]'); await D.waitForTimeout(250);
      D.answers = [true, "pw"]; await D.click("#fmDelete"); await D.waitForTimeout(400);
      check("the last member deleting their account removes events, needs and their own private data", await D.evaluate(() => !__db.events && !__db.needs && !Object.keys(__db.private.u1.checkins || {}).length && !!__db.private.u2.checkins["c-partner"]));
      await D.context().close(); }

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
