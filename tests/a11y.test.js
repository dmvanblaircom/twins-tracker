// Accessibility sweep (stub Store, fictional babies, milk sources on): every tab, the milk-source and moment sheets,
// and setup, in light, dark, night and A++ text. Per screen: text contrast against its real background (≥4.5:1, or 3:1
// for large text), no text below 12 px, controls ≥44 px tall with an accessible name, no sideways scroll.
// Run when CSS or markup changes.   cd tests && npm run a11y
const { serve, newPage, importData, tab } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const NOW = "2026-02-10T15:10:00-05:00";
const THEMES = [["light", {}], ["dark", { ctx: { colorScheme: "dark" }, prefs: { look: "dark" } }], ["night", { night: true }], ["A++", { prefs: { text: "1.3" } }]];

// Runs in the page: audits the visible part of `root` (a selector; body when absent).
function audit(rootSel) {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(",").map(parseFloat); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const mix = (c, b) => ({ r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a), a: 1 });
  const bgOf = el => { const st = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a >= 1) break; } }
    let b = st.length && st[st.length - 1].a >= 1 ? st.pop() : parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    while (st.length) b = mix(st.pop(), b); return b; };
  const vis = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.visibility !== "hidden" && r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  const name = e => e.id ? "#" + e.id : e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const out = { contrast: [], small: [], noname: [], overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  const root = (rootSel && document.querySelector(rootSel)) || document.body;
  root.querySelectorAll("*").forEach(e => {
    if (!vis(e) || e.closest("canvas,svg")) return;
    const own = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(" ");
    if (own) {
      const s = getComputedStyle(e), fg = parse(s.color);
      if (fg) { const bg = bgOf(e), L1 = lum(mix(fg, bg)), L2 = lum(bg), cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05), size = parseFloat(s.fontSize);
        const need = size >= 24 || (+s.fontWeight >= 700 && size >= 18.66) ? 3 : 4.5;
        if (cr < need - .05) out.contrast.push(`${name(e)} "${own.slice(0, 30)}" ${cr.toFixed(2)}:1`);
        if (size < 12 / zoom - .1) out.contrast.push(`${name(e)} "${own.slice(0, 20)}" ${size}px text`); }
    }
    if (e.matches("button,input:not([type=hidden]),select,textarea,a[href],[role=button]")) {
      const h = e.getBoundingClientRect().height;
      if (h < 43.5 && !e.matches("input[type=checkbox],input[type=radio]")) out.small.push(`${name(e)} ${Math.round(h)}px`);
      if (!(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || (e.labels && e.labels.length) || (e.textContent || "").trim() || e.title || e.placeholder)) out.noname.push(name(e));
    }
  });
  return out;
}

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`, browser = await chromium.launch();
  try {
    for (const [theme, o] of THEMES) {
      const p = await newPage(browser, base, { now: NOW, prefs: { night: "manual", ...(o.prefs || {}) }, ctx: o.ctx });
      if (o.night) { await p.evaluate(() => localStorage.setItem("night", "1")); await p.reload(); await p.waitForTimeout(600); }
      await importData(p);
      await p.evaluate(() => { Store.put("drops", "d-1770296400000", { t: 1770296400000, v: 6000 }); Store.put("clients", "u2", { v: MilkSources.CLIENT_V, t: 1 }); });
      await p.evaluate(() => __nicu.src.setUsual(1, { mom: 60, donor: 40, formula: 0 })); await p.waitForTimeout(300);
      const bad = [];
      const run = async (label, root) => { const r = await p.evaluate(audit, root); for (const k of ["contrast", "small", "noname"]) r[k].forEach(x => bad.push(`${label}: ${x}`)); if (r.overflow) bad.push(`${label}: sideways scroll`); };
      for (const [t, sub] of [["feed"], ["weight"], ["milk"], ["trends"], ["more", "records"], ["more", "care"], ["more", "support"], ["more", "settings"]]) {
        await tab(p, t); if (sub) { await p.click(`#moreNav button[data-v="${sub}"]`); await p.waitForTimeout(250); }
        if (sub === "settings") await p.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
        await run(sub || t, ".tab.on");
      }
      await tab(p, "feed"); await p.$eval('.nx [data-act="src"]', b => b.click()); await p.waitForTimeout(250);
      await p.$eval('#sCard [data-sa="mixed"]', b => b.click()); await p.waitForTimeout(200); await run("milk sheet", "#sSheet");
      await p.evaluate(() => { document.querySelector("#sSheet").hidden = true; });
      await tab(p, "trends"); const add = await p.$("#jAdd"); if (add) { await add.click(); await p.waitForTimeout(250); await run("moment sheet", "#mSheet"); await p.evaluate(() => { document.querySelector("#mSheet").hidden = true; }); }
      await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]').then(() => p.evaluate(() => document.querySelectorAll("details.sfold").forEach(d => d.open = true))); await p.click("#editProfile"); await p.waitForTimeout(250); await run("setup", "#setup");
      check(`${theme}: every screen and sheet passes contrast, 12 px, 44 px, names and no sideways scroll`, !bad.length, bad.slice(0, 8).join("; "));
      check(`${theme}: the moment sheet was reached`, !!add);
      check(`${theme}: no page errors`, !p.errors.length, p.errors.join("; "));
      await p.context().close();
    }
  } finally { await browser.close(); srv.close(); }
  console.log(`\n${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
