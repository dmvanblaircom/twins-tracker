// Phase 3 — Parent Support, in the browser (stub Store, fictional babies). Private check-ins, share / unshare with
// interrupted and queued writes, never on a shared surface, supportive message, parent milestones, resources.
// cd tests && npm run support
const fs = require("fs"), path = require("path");
const { serve, newPage, importData, tab } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const APPROVED = ["You don't have to have it all figured out today.", "Some days are about getting through. That's enough.", "It's okay to feel more than one thing at once.",
  "Rest is part of taking care of them. The NICU team is with them right now.", "You're allowed to go home and sleep.", "Asking a nurse to explain something again is part of the job, not a bother.",
  "Eating a real meal and drinking water counts today.", "The time you spend with them matters, even when it's short.", "Small steps still move forward.",
  "When people offer to help, let them. Dinner, laundry, a ride.", "Your partner may be feeling this differently. Both ways are okay.", "A hard moment today isn't the whole story."];
const NOW = "2026-02-10T15:10:00-05:00", SECRET = "zq-secret-note", PARTNER = "zq-partner-note";
const wait = (p, ms = 250) => p.waitForTimeout(ms);
const support = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="support"]'); await wait(p); };
const mine = p => p.evaluate(() => Object.entries((__db.private.u1 || {}).checkins || {}));
const copies = p => p.evaluate(() => Object.entries(__db.events || {}).filter(([, e]) => e.src === "checkin"));
const checkIn = async (p, mood, note) => { await support(p); await p.click(`#ciScale [data-mood="${mood}"]`); await p.fill("#ciNote", note); await p.click("#ciSave"); await wait(p, 300); };
const share = async p => { p.answers = [true]; await p.click('#ciList [data-cia="share"]'); await wait(p, 400); };
const unshare = async p => { await p.click('#ciList [data-cia="unshare"]'); await wait(p, 400); };
const content = r => JSON.stringify({ t: r.t, mood: r.mood, note: r.note });

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`, browser = await chromium.launch();
  try {
    const p = await newPage(browser, base, { now: NOW });
    await importData(p);
    // the other parent's private check-in exists in the family's database
    await p.evaluate(n => { __db.private.u2 = { checkins: { "c-1-abcd": { t: Date.now() - 3600e3, mood: 2, note: n, sharedEv: null, by: "parent2@example.com" } } }; }, PARTNER);

    // ---- check-in ----
    await support(p);
    check("Save is off until a choice is made", await p.$eval("#ciSave", b => b.disabled));
    const before = await p.evaluate(() => ["feed", "weight", "milk", "trends"].map(t => document.querySelector(`.tab[data-tab="${t}"]`).innerText).join("|"));
    await checkIn(p, 1, SECRET);
    let m = await mine(p);
    check("a check-in saves to my private area only, with its time, choice and note", m.length === 1 && m[0][1].mood === 1 && m[0][1].note === SECRET && m[0][1].sharedEv === null && /^c-\d+-[a-z0-9]{4}$/.test(m[0][0]), JSON.stringify(m));
    const orig = content(m[0][1]), cid = m[0][0];
    check("it lists on Support with its word and note", (await p.textContent("#ciList")).includes("Really hard") && (await p.textContent("#ciList")).includes(SECRET));
    check("the other parent's check-ins never show on Support", !(await p.textContent("#ciList")).includes(PARTNER));
    check("no shared collection holds it", await p.evaluate(s => !JSON.stringify(Object.fromEntries(Object.entries(__db).filter(([k]) => k !== "private"))).includes(s), SECRET));

    // ---- never on a shared surface ----
    const after = await p.evaluate(() => ["feed", "weight", "milk", "trends"].map(t => document.querySelector(`.tab[data-tab="${t}"]`).innerText).join("|"));
    check("a check-in changes nothing on Today, Growth, Milk or Journey", before === after);
    const seen = [];
    for (const [t, sub] of [["feed"], ["weight"], ["milk"], ["trends"], ["more", "records"], ["more", "care"], ["more", "settings"]]) {
      await tab(p, t); if (sub) { await p.click(`#moreNav button[data-v="${sub}"]`); await wait(p); }
      if ((await p.evaluate(() => document.querySelector(".tab.on").innerText)).match(/zq-/)) seen.push(sub || t);
    }
    check("no check-in text appears on Today, Growth, Milk, Journey, Records, Care or Settings", !seen.length, seen.join());
    const tl = await p.evaluate(() => document.querySelector("#jRail").innerText);
    check("the Journey timeline never includes a private check-in, even for its author", !tl.includes("zq-"));
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]').then(() => p.evaluate(() => document.querySelectorAll("details.sfold").forEach(d => d.open = true))); await p.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
    await p.click("#csvBtn"); await wait(p, 200); const csv = await p.$eval("#csvBox", x => x.value);
    check("the CSV export carries no check-in", csv.length > 100 && !csv.includes("zq-"));
    const [bk] = await Promise.all([p.waitForEvent("download"), p.click("#bkGo")]); const b = JSON.parse(fs.readFileSync(await bk.path(), "utf8"));
    check("my full backup carries my own check-in in its private section only", JSON.stringify(b.data.private).includes(SECRET) && !JSON.stringify({ ...b.data, private: null }).includes(SECRET));
    check("…and never the other parent's", !JSON.stringify(b).includes(PARTNER));
    check("no flash, alert or dialog came from a check-in", !p.dialogs.length);

    // ---- share / unshare ----
    await support(p); await share(p);
    let c = await copies(p); m = await mine(p);
    const ev = c[0] && c[0][1];
    check("share makes exactly one family copy, under the id the check-in recorded", c.length === 1 && m[0][1].sharedEv === c[0][0], JSON.stringify(c.map(x => x[0])));
    check("the copy is a parent journal with src 'checkin', ref null and i null", ev && ev.kind === "journal" && ev.scope === "parent" && ev.i === null && ev.ref === null && ev.src === "checkin" && ev.title === "Really hard today" && ev.note === SECRET);
    check("the copy carries no private id or link", !JSON.stringify(ev).includes(cid) && !JSON.stringify(ev).includes("private"));
    check("the copy passes the shared event validation", await p.evaluate(e => __nicu.validEvent(e), ev));
    check("Support shows it as shared, with Stop sharing", (await p.textContent("#ciList")).includes("Shared") && !!(await p.$('#ciList [data-cia="unshare"]')));
    await tab(p, "trends"); check("the shared copy appears in the family journey", (await p.textContent("#jRail")).includes("shared a check-in"));
    await support(p); await unshare(p);
    c = await copies(p); m = await mine(p);
    check("unshare removes the copy and clears sharedEv", c.length === 0 && m[0][1].sharedEv === null);
    check("the private check-in's content is unchanged by share and unshare", content(m[0][1]) === orig);
    for (let k = 0; k < 2; k++) { await share(p); await unshare(p); } await share(p);
    c = await copies(p); m = await mine(p);
    check("share / unshare / share repeated leaves exactly one copy", c.length === 1 && m[0][1].sharedEv === c[0][0]);
    await unshare(p);

    // ---- interrupted: the id is recorded, then the copy's write fails ----
    await p.evaluate(() => { const put = Store.put; let once = true; Store.put = async (n, id, r) => { if (n === "events" && once) { once = false; throw Object.assign(new Error("network"), { code: "unavailable" }); } return put(n, id, r); }; });
    await share(p);
    c = await copies(p); m = await mine(p); const rec = m[0][1].sharedEv;
    check("a failure after recording sharedEv leaves no copy and offers Share again", c.length === 0 && !!rec && !!(await p.$('#ciList [data-cia="share"]')));
    await share(p);
    c = await copies(p); m = await mine(p);
    check("the retry makes exactly one copy, reusing the recorded id", c.length === 1 && c[0][0] === rec && m[0][1].sharedEv === rec);
    check("content unchanged after the interrupted share", content(m[0][1]) === orig);
    await unshare(p);

    // ---- queued (offline) writes, applied later in order ----
    await p.evaluate(() => { window.__Q = []; const S = window.Store, orig = { put: S.put, remove: S.remove, putPrivate: S.putPrivate };
      window.__flush = async () => { const q = window.__Q; window.__Q = null; Object.assign(S, orig); for (const f of q) await f(); };
      ["put", "remove", "putPrivate"].forEach(k => { S[k] = (...a) => { window.__Q.push(() => orig[k](...a)); return Promise.resolve({ pending: true }); }; }); });
    await share(p); await p.evaluate(() => __flush()); await wait(p, 300);
    c = await copies(p);
    check("sharing while offline gives exactly one copy once the queue syncs", c.length === 1);
    await p.evaluate(() => { window.__Q = []; const S = window.Store, orig = { put: S.put, remove: S.remove, putPrivate: S.putPrivate };
      window.__flush = async () => { const q = window.__Q; window.__Q = null; Object.assign(S, orig); for (const f of q) await f(); };
      ["put", "remove", "putPrivate"].forEach(k => { S[k] = (...a) => { window.__Q.push(() => orig[k](...a)); return Promise.resolve({ pending: true }); }; }); });
    await unshare(p); await p.evaluate(() => __flush()); await wait(p, 300);
    c = await copies(p); m = await mine(p);
    check("unsharing while offline removes the copy once the queue syncs", c.length === 0 && m[0][1].sharedEv === null && content(m[0][1]) === orig);

    // ---- supportive message: by date only ----
    const msg = await p.textContent("#supMsg");
    await checkIn(p, 5, "zq-good"); check("the message doesn't change with a check-in", (await p.textContent("#supMsg")) === msg);
    check("the message shown is one of the approved twelve", APPROVED.includes(msg), msg);

    // ---- crisis line and resources ----
    await p.evaluate(() => scrollTo(0, 0)); await support(p);
    const r = await p.$eval("#crisis", e => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
    check("the crisis line is visible without scrolling", r.top >= 0 && r.bottom <= r.h, JSON.stringify(r));
    check("988 can be called or texted from it", !!(await p.$('#crisis a[href="tel:988"]')) && !!(await p.$('#crisis a[href="sms:988"]')));
    const ext = []; p.on("request", q => { if (!q.url().startsWith(base)) ext.push(q.url()); });
    await p.context().setOffline(true); await tab(p, "feed"); await support(p);
    check("with no network, Support and the resources render and nothing is fetched", await p.isVisible("#crisis") && await p.isVisible("#resources") && (await p.textContent("#resources")).includes("1-833-TLC-MAMA") && !ext.length, ext.join());
    await p.context().setOffline(false);

    // ---- parent milestones ----
    await tab(p, "trends"); await p.click("#jAdd"); await wait(p); await p.click('#mWho button[data-v="parent"]'); await wait(p, 150);
    const opts = await p.$$eval("#mPick option", o => o.map(x => x.textContent));
    check("'Me' offers the approved parent milestones", ["First time joining rounds", "First care time on my own", "First pumping session", "Met another NICU parent", "Asked for help", "First full night's sleep", "Took time for myself", "First walk outside for me"].every(t => opts.includes(t)), opts.join(" / "));
    await p.selectOption("#mPick", "asked-for-help"); await p.click("#mSave"); await wait(p, 300);
    const pm = await p.evaluate(() => Object.values(__db.events).find(e => e.key === "asked-for-help"));
    check("a parent milestone saves with scope parent, i null and its key", pm && pm.scope === "parent" && pm.i === null && pm.kind === "milestone" && pm.title === "Asked for help");

    // ---- family milestones (Phase 4) ----
    await tab(p, "trends"); await p.click("#jAdd"); await wait(p); await p.click('#mWho button[data-v="family"]'); await wait(p, 150);
    const fo = await p.$$eval("#mPick option", o => o.map(x => x.textContent));
    check("'Our family' offers holding both plus the approved family milestones", ["First time holding both babies at once", "First family photo", "First time we were all together", "Big brother or sister's first visit", "First visit from friends", "Nursery ready", "Last day in the NICU", "First night all home together"].every(t => fo.includes(t)), fo.join(" / "));
    await p.selectOption("#mPick", "nursery-ready"); await p.click("#mSave"); await wait(p, 300);
    const fm = await p.evaluate(() => Object.values(__db.events).find(e => e.key === "nursery-ready"));
    check("a family milestone saves with scope family, i null and its key", fm && fm.scope === "family" && fm.i === null && fm.kind === "milestone" && fm.title === "Nursery ready");

    // ---- NICU social worker's contact details, saved for the family ----
    await support(p);
    check("social worker: an Add button when nothing is saved", (await p.textContent("#swBox")).includes("Add their name, phone and email"));
    await p.click('#swBox [data-sw="edit"]'); await wait(p, 150);
    check("Add opens name, phone and email fields, name focused", (await p.$$("#swName, #swPhone, #swEmail")).length === 3 && await p.evaluate(() => document.activeElement.id === "swName"));
    await p.fill("#swName", "Pat Example"); await p.fill("#swPhone", "(614) 555-0100"); await p.fill("#swEmail", "not-an-email");
    await p.click('#swBox [data-sw="save"]'); await wait(p, 200);
    check("an incomplete email is refused in plain words, nothing saved", (await p.textContent("#banner")).includes("doesn't look complete") && await p.evaluate(() => !(__db.config.contacts)));
    await p.fill("#swEmail", "pat@example.org"); await p.click('#swBox [data-sw="save"]'); await wait(p, 300);
    check("saving stores it for the family in config/contacts", await p.evaluate(() => { const c = __db.config.contacts; return c && c.sw.name === "Pat Example" && c.sw.phone === "(614) 555-0100" && c.sw.email === "pat@example.org"; }));
    check("it shows the name, number and email with Call, Text and Email buttons", await p.evaluate(() => { const b = document.querySelector("#swBox"), h = [...b.querySelectorAll("a")].map(a => a.getAttribute("href"));
      return b.textContent.includes("Pat Example") && b.textContent.includes("(614) 555-0100") && h.includes("tel:6145550100") && h.includes("sms:6145550100") && h.includes("mailto:pat@example.org"); }));
    check("its buttons are 44 px tall", await p.$$eval("#swBox a, #swBox button", x => x.length >= 4 && x.every(e => e.getBoundingClientRect().height >= 44)));
    await p.click("#toast button"); await wait(p, 300);
    check("Undo takes it back off", (await p.textContent("#swBox")).includes("Add their name, phone and email"));
    await p.evaluate(() => Store.setConfig("contacts", { sw: { name: "Sam Example", phone: "614-555-0199", email: "" } })); await wait(p, 300);
    check("details the other parent saves show up on this phone", (await p.textContent("#swBox")).includes("Sam Example") && !(await p.$('#swBox a[href^="mailto:"]')));
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]').then(() => p.evaluate(() => document.querySelectorAll("details.sfold").forEach(d => d.open = true))); await p.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
    const [bk2] = await Promise.all([p.waitForEvent("download"), p.click("#bkGo")]); const b2 = JSON.parse(fs.readFileSync(await bk2.path(), "utf8"));
    check("the family backup carries the social worker's details", b2.data.config.contacts && b2.data.config.contacts.sw.name === "Sam Example");
    // ---- leaving purges my check-ins; shared copies stay ----
    await support(p); await share(p);
    await p.evaluate(() => Store.leave()); await wait(p, 300);
    check("leaving deletes my check-ins and keeps the shared copy", (await mine(p)).length === 0 && (await copies(p)).length === 1);
    check("no page errors", !p.errors.length, p.errors.join("; "));

    const priv = fs.readFileSync(path.join(__dirname, "../privacy.html"), "utf8");
    check("the privacy policy describes check-ins and support resources", /check-in/i.test(priv) && /not end-to-end encrypted/i.test(priv) && /988/.test(priv));
  } finally { await browser.close(); srv.close(); }
  console.log(`\n${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
