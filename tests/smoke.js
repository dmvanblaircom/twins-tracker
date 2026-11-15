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
const tab = (p, t) => p.click(`#tabbar button[data-tab=${t}]`).then(() => p.waitForTimeout(250));
const db = (p, f, arg) => p.evaluate(f, arg);
async function importData(p) {
  await tab(p, "more");
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
    check("age line (day of life + corrected age)", (await p.textContent("#ageLine")).includes("day 10 · 37w3d"), await p.textContent("#ageLine"));
    const msg = await importData(p);
    check("CSV import", /Imported 18 weights, \d+ feeds\./.test(msg), msg);

    // ---- Today: entry, undo, full, tube, notes ----
    await tab(p, "feed");
    check("next card shows the 2 AM feed as due", (await p.textContent(`${A} .when`)).includes("Due: 2a"));
    check("note chips hidden until + Note", await p.$eval(`${A} .tags`, e => e.hidden));
    check("Both view is compact (no mini charts)", (await p.$$(`${A} .spk`)).length === 0);
    check("feed count is out of the full day (of 8)", / of 8 feeds/.test(await p.textContent(`${A} .tsum`)), await p.textContent(`${A} .tsum`));
    await p.fill(`${A} .box input`, "40"); await p.click(`${A} [data-act=save]`); await p.waitForTimeout(200);
    const slot2 = new Date("2026-02-11T02:00:00-05:00").getTime();
    check("Save logs the feed", await db(p, t => __db.feeds[`Ada Rose-${t}`]?.v, slot2) === 40);
    await p.click("#toast button"); await p.waitForTimeout(200);
    check("Undo removes it", await db(p, t => !__db.feeds[`Ada Rose-${t}`], slot2));
    await p.waitForTimeout(2700);
    await p.click(`${A} [data-act=notes]`); await p.click(`${A} .tags button:has-text("Spit up")`);
    await p.click(`${A} [data-act=full]`); await p.waitForTimeout(200);
    const f = await db(p, t => __db.feeds[`Ada Rose-${t}`], slot2);
    check("Full button logs the full feed with the chosen note", f && f.v === 49 && f.note === "Spit up", JSON.stringify(f));
    await p.waitForTimeout(2700);
    check("card moves on to the next feed", (await p.textContent(`${A} .when`)).includes("Next: 5a"));
    const B = '.nx[data-tw="Bea Joy"]';
    await p.click(`${B} [data-act=notes]`); await p.click(`${B} .tags button:has-text("Fussy")`); await p.click(`${B} [data-act=notes]`);
    check("hiding notes clears a chosen chip", await p.$$eval(`${B} .tags [aria-pressed="true"]`, x => x.length) === 0);
    await p.click(`${B} [data-act=tube]`); await p.waitForTimeout(200);
    const slotB = new Date("2026-02-11T02:30:00-05:00").getTime();
    check("All by tube logs 0 mL with its note (no hidden chip)", await db(p, t => { const x = __db.feeds[`Bea Joy-${t}`]; return x && x.v === 0 && x.note === "All by tube"; }, slotB));
    await p.waitForTimeout(2700);
    await p.click(`${A} [data-act=full]`); await p.click(`${B} [data-act=full]`); await p.waitForTimeout(300);
    const s5a = new Date("2026-02-11T05:00:00-05:00").getTime(), sBnext = await db(p, () => Object.values(__db.feeds).filter(x => x.twin === "Bea Joy" && x.v === 53).length);
    check("both babies can be logged back to back", await db(p, t => __db.feeds[`Ada Rose-${t}`]?.v, s5a) === 49 && sBnext >= 1, `Bea full feeds: ${sBnext}`);
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
    await p.fill(`${A} .wIn`, "2560"); await p.click(`${A} [data-act=wsave]`); await p.waitForTimeout(900);
    check("tonight's weight saves to the feed day", await db(p, () => __db.weights["Ada Rose-2026-02-10"]?.v) === 2560);
    check("mL/kg/day shows", /\d+ mL\/kg\/day/.test(await p.textContent(`${A} .tsum`)));
    await p.screenshot({ path: path.join(SHOTS, "today-single.png") });
    await p.click("#view button:nth-child(3)"); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(SHOTS, "today-both.png") });

    // ---- questions ----
    await p.fill("#qText", "When is the hearing screen?"); await p.press("#qText", "Enter"); await p.waitForTimeout(200);
    p.answers = ["Monday"]; await p.click("#qList [data-q]"); await p.waitForTimeout(200);
    check("question added and answered", (await p.innerText("#qList")).includes("→ Monday"));

    // ---- milk ----
    await tab(p, "milk");
    check("Milk time boxes stay inside their cards", await p.$$eval("#pmT,#dpT", els => els.every(e => e.getBoundingClientRect().right <= e.closest(".card").getBoundingClientRect().right)));
    check("baby bar hidden on Milk", !(await p.isVisible(".viewbar")));
    check("Log feed button hidden on Milk", !(await p.isVisible("#fab")));
    await p.fill("#pmV", "120"); await p.click("#pmGo"); await p.waitForTimeout(150);
    p.answers = ["1000"]; await p.click("#stkGo"); await p.waitForTimeout(200);
    const stk = await p.$$eval("#mkStats .stat", x => x[2].innerText);
    check("NICU stock from the nurses' count", /1,?000 mL|1000 mL/.test(stk), stk.replace(/\s+/g, " "));

    // ---- progress: checklist ----
    await tab(p, "trends");
    check("old summary tiles are gone", (await p.$$("#tiles")).length === 0);
    await p.click('[data-ck="b0-hearing"]'); await p.waitForTimeout(150); await p.click('[data-na="b0-rsv"]'); await p.waitForTimeout(150);
    check("checklist check + n/a", (await p.$$eval(".home .cl h4", x => x[0].innerText)).includes("1/7"));
    await p.evaluate(() => document.querySelector("#cDaily").scrollIntoView({ block: "center" })); await p.waitForTimeout(250);
    const box = await p.$eval("#cDaily", c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * .4, y: r.y + r.height * .6 }; });
    const tip = () => p.evaluate(() => Chart.getChart("cDaily").tooltip.getActiveElements().length);
    await p.touchscreen.tap(box.x, box.y); await p.waitForTimeout(200); const opened = await tip();
    await p.touchscreen.tap(20, 300); await p.waitForTimeout(200);
    check("chart callout opens on tap and closes on a tap elsewhere", opened > 0 && (await tip()) === 0);

    // ---- more: export ----
    await tab(p, "more");
    await p.evaluate(() => { document.querySelector("details.settings").open = true; });
    await p.click("#csvBtn"); await p.waitForTimeout(200);
    const csv = await p.evaluate(async () => document.querySelector("#csvBox").value || await navigator.clipboard.readText().catch(() => ""));
    check("CSV export quotes names", csv.includes(',"Ada Rose",') && csv.split("\n").length > 50, csv.slice(0, 80));
    check("no page errors in main walk-through", p.errors.length === 0, p.errors.join(" | "));

    // ---- rename moves everything ----
    const other = new Date("2026-02-10T20:00:00-05:00").getTime();
    await db(p, t => { const id = `Ada Rose-${t}`; Store.setFeed(id, { ...__db.feeds[id], by: "parent2@example.com" }); }, other);
    await p.click("#editProfile"); await p.fill("#suN0", "Ada"); await p.fill("#suN1", "Bea");
    p.answers = [true]; await p.click("#suSave"); await p.waitForTimeout(800);
    const names = await db(p, () => [...new Set([...Object.values(__db.weights), ...Object.values(__db.feeds)].map(x => x.twin))].sort().join(","));
    check("rename moves every entry", names === "Ada,Bea", names);
    check("checklist survives the rename", await db(p, () => !!__db.checklist["b0-hearing"]));
    check("rename keeps who logged each feed", await db(p, t => __db.feeds[`Ada-${t}`]?.by, other) === "parent2@example.com");
    check("no page errors after rename", p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();

    // ---- per-phone prefs + large text ----
    const q = await newPage(browser, base, { prefs: { clock: "24", units: "lb", text: "1.3" } });
    await tab(q, "more"); check("Data & settings starts collapsed", !(await q.$eval("details.settings", d => d.open)));
    await importData(q); await tab(q, "feed");
    check("A++ text: baby names in the selector are never truncated", await q.$$eval("#view .nm0,#view .nm1", els => els.every(e => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis")));
    check("24-hour clock", (await q.textContent(`${A} .when`)).includes("02:00"));
    for (const t of ["feed", "weight", "milk", "trends", "more"]) {
      await tab(q, t);
      const over = await q.evaluate(() => [...document.querySelectorAll(".tab.on *")].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > document.documentElement.clientWidth + 1 && !e.closest("[style*='overflow-x']"); }).length);
      check(`A++ text: no sideways overflow on ${t}`, over === 0, `${over} elements`);
    }
    await q.screenshot({ path: path.join(SHOTS, "large-text.png") });
    check("no page errors with prefs", q.errors.length === 0, q.errors.join(" | "));
    await q.context().close();

    // ---- night mode + 4-hour schedule ----
    PROFILE.schedule = { everyH: 4, startH: 9 };
    const r = await newPage(browser, base, { prefs: { night: "auto" } });
    check("night mode turns on automatically at 2 AM", await r.evaluate(() => document.documentElement.dataset.theme) === "night");
    await tab(r, "feed");
    const labels = await r.$$eval("#sheet .tw", t => [...t[0].querySelectorAll("label")].map(l => l.textContent).join(" "));
    check("4-hour schedule builds 6 slots from 9 AM", labels === "9a 1p 5p 9p 1a 5a", labels);
    check("no page errors on night/4-hour", r.errors.length === 0, r.errors.join(" | "));
    await r.context().close();

    // ---- 7 AM day boundary, independent of feed times ----
    PROFILE.schedule = { everyH: 3, startH: 6 };   // feeds at 6a/9a/...: the day still flips at 7
    const v = await newPage(browser, base, { now: "2026-02-11T07:20:00-05:00" });
    await v.evaluate(() => { Store.setFeed("Ada Rose-a", { twin: "Ada Rose", t: new Date("2026-02-11T06:00:00-05:00").getTime(), v: 30, note: "", diet: "" }); });
    await tab(v, "feed"); await v.waitForTimeout(200);
    check("at 7:20 AM the sheet is on the new day", (await v.textContent("#dLabel")).startsWith("Today · Wed, 2/11"), await v.textContent("#dLabel"));
    check("a 6 AM feed counts toward the day before (7 AM boundary)", (await v.textContent('.nx[data-tw="Ada Rose"] .tsum')).includes("0 of 8"), await v.textContent('.nx[data-tw="Ada Rose"] .tsum'));
    const firstSlot = await v.$$eval("#sheet .tw", t => t[0].querySelector("label").textContent);
    check("6 AM feeds land at the end of the day (first slot 9a, last 6a)", firstSlot === "9a", firstSlot);
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
