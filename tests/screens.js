// Screenshot every screen at iPhone size (390×844 @2x) with the fictional test babies.
// Usage: node screens.js <out-dir>     (e.g. node screens.js shots/after)
// Covers: all five tabs, Both + each baby, light / phone-dark / night themes, A++ text, offline header.
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const { serve, newPage, importData, tab } = require("./smoke.js");

const OUT = path.resolve(process.argv[2] || path.join(__dirname, "shots", "screens"));
const DAY = "2026-02-10T15:10:00-05:00", NIGHT = "2026-02-11T02:10:00-05:00";

async function seed(p) {
  await importData(p);
  await p.evaluate(() => {
    const now = Date.now(), h = 3600e3;
    [[-20, 110], [-17, 95], [-14, 120], [-11, 130], [-8, 150], [-5, 105], [-2, 115]].forEach(([d, v], k) => Store.put("pumps", "p-" + k, { t: now + d * h, v }));
    Store.put("drops", "d-1", { t: now - 22 * h, v: 900 });
    ["b0-hearing", "b0-cchd", "b1-hearing", "f-cpr"].forEach(id => Store.put("checklist", id, { s: "done", d: "2026-02-09" }));
    Store.put("checklist", "b1-rsv", { s: "na", d: "2026-02-09" });
    Store.put("questions", "q-1", { text: "When is the car seat test?", done: false, t: now - 5 * h });
    Store.put("plans", "0-" + new Date(now - 7 * h).toISOString().slice(0, 10), { i: 0, day: new Date(now - 7 * h).toISOString().slice(0, 10), text: "Try ad lib tomorrow" });
    Store.setConfig("people", { list: [{ email: "parent1@example.com", name: "Dad" }] });
  });
  await p.waitForTimeout(300);
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + ".png") });
const view = async (p, n) => { await p.click(`#view button:nth-child(${n})`); await p.waitForTimeout(250); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctxOpts = { deviceScaleFactor: 2 };
  for (const theme of ["light", "dark", "night"]) {   // dark = phone set to Dark appearance
    const p = await newPage(browser, base, { now: theme === "night" ? NIGHT : DAY, ctx: { ...ctxOpts, colorScheme: theme === "dark" ? "dark" : "light" }, prefs: { night: "manual" } });
    if (theme === "night") { await p.evaluate(() => localStorage.setItem("night", "1")); await p.reload(); await p.waitForTimeout(600); }
    await seed(p);
    await tab(p, "feed"); await view(p, 3); await p.evaluate(() => scrollTo(0, 0)); await shot(p, `${theme}-1-today-both`);
    await view(p, 1); await shot(p, `${theme}-2-today-baby1`);
    await p.evaluate(() => scrollTo(0, 520)); await p.waitForTimeout(150); await shot(p, `${theme}-3-today-baby1-scrolled`);
    await view(p, 2); await p.evaluate(() => scrollTo(0, 0)); await shot(p, `${theme}-4-today-baby2`);
    await view(p, 3);
    for (const [t, n] of [["weight", 5], ["milk", 6], ["trends", 7], ["more", 8]]) { await tab(p, t); await shot(p, `${theme}-${n}-${t === "trends" ? "progress" : t}`); }
    if (p.errors.length) console.log(theme, "page errors:", p.errors);
    await p.context().close();
  }
  // A++ text and offline header (light)
  const q = await newPage(browser, base, { now: DAY, ctx: ctxOpts, prefs: { text: "1.3" } });
  await seed(q); await tab(q, "feed"); await shot(q, "light-9-today-large-text");
  await tab(q, "trends"); await shot(q, "light-10-progress-large-text");
  await q.context().setOffline(true); await q.waitForTimeout(300); await tab(q, "feed"); await shot(q, "light-11-offline");
  await q.context().close();
  await browser.close(); srv.close();
  console.log("saved to", OUT);
})();
