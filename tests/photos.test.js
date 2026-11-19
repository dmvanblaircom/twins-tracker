// Phase 5 — photos on Journey moments, in the browser (stub Store, fictional babies, generated images only).
// cd tests && npm run photos
const fs = require("fs");
const { serve, newPage, importData, tab } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const NOW = "2026-02-10T15:10:00-05:00";
const wait = (p, ms = 250) => p.waitForTimeout(ms);
// A generated test image (gradient + shapes), w×h, as PNG bytes.
const makeImage = (p, w, h, hue) => p.evaluate(async ([w, h, hue]) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, `hsl(${hue},70%,60%)`); gr.addColorStop(1, `hsl(${hue + 120},70%,40%)`);
  g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let k = 0; k < 40; k++) { g.fillStyle = `hsl(${(hue + k * 9) % 360},80%,50%)`; g.beginPath(); g.arc((k * 97) % w, (k * 53) % h, 20 + k * 3, 0, 7); g.fill(); }
  const b = await new Promise(r => c.toBlob(r, "image/png")); return [...new Uint8Array(await b.arrayBuffer())]; }, [w, h, hue]);
const file = (bytes, name = "photo.png") => ({ name, mimeType: "image/png", buffer: Buffer.from(bytes) });
const photos = p => p.evaluate(() => Object.entries(__db.photos || {}).map(([id, x]) => [id, { ...x, thumbLen: x.thumb.length, thumb: undefined }]));
const data = p => p.evaluate(() => Object.fromEntries(Object.entries(__db.photoData || {}).map(([id, x]) => [id, { len: x.full.length, soi: x.full[0] === 0xFF && x.full[1] === 0xD8, exif: (() => { const s = String.fromCharCode(...x.full.slice(0, 64)); return s.includes("Exif"); })() }])));
const openAdd = async p => { await tab(p, "trends"); await p.click("#jAdd"); await wait(p); };
const evIdOf = (p, title) => p.evaluate(t => (Object.entries(__db.events).find(([, e]) => e.title === t) || [])[0], title);

async function main() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`, browser = await chromium.launch();
  try {
    const p = await newPage(browser, base, { now: NOW });
    await importData(p);
    const big = await makeImage(p, 3000, 2000, 10), tall = await makeImage(p, 900, 1400, 200);

    // ---- add a moment with two photos ----
    await openAdd(p); await p.click('#mWho button[data-v="family"]'); await p.click('#mKind button[data-v="journal"]');
    await p.fill("#mTitle", "Photo day");
    await p.setInputFiles("#mPhFile", [file(big), file(tall)]); await wait(p, 1500);
    check("picked photos show in the sheet before saving", (await p.$$("#mPhotos .phcell")).length === 2);
    check("nothing is written until Save", (await photos(p)).length === 0);
    await p.click("#mSave"); await wait(p, 600);
    const ev = await evIdOf(p, "Photo day"); let ph = await photos(p), pd = await data(p);
    check("Save writes the moment and both photos, attached to it", ev && ph.length === 2 && ph.every(([, x]) => x.ev === ev), JSON.stringify(ph.map(x => x[1].ev)));
    const pb = ph.find(([, x]) => x.w > x.h), pt = ph.find(([, x]) => x.h > x.w);
    check("a 3000×2000 photo is re-encoded to 1600 px on the long side", pb && pb[1].w === 1600 && pb[1].h === 1067, pb && `${pb[1].w}×${pb[1].h}`);
    check("a photo already under 1600 px keeps its size", pt && pt[1].w === 900 && pt[1].h === 1400);
    check("full images are JPEG, under 900 KB, with no Exif block", Object.values(pd).length === 2 && Object.values(pd).every(x => x.soi && !x.exif && x.len <= 921600), JSON.stringify(pd));
    check("thumbnails are under 100 KB and bytes = image + thumbnail", ph.every(([id, x]) => x.thumbLen > 0 && x.thumbLen <= 102400 && x.bytes === pd[id].len + x.thumbLen));
    check("each photo records who added it", ph.every(([, x]) => x.by === "parent1@example.com"));
    await wait(p, 300);
    check("the timeline shows the moment's thumbnails", (await p.$$(`#jRail .jph .phth`)).length === 2);

    // ---- viewer ----
    await p.click("#jRail .phth"); await wait(p, 600);
    const v = await p.evaluate(() => ({ open: !document.querySelector("#phView").hidden, w: document.querySelector("#phImg").naturalWidth, msg: document.querySelector("#phMsg").textContent }));
    check("tapping a thumbnail opens the full-size photo", v.open && v.w >= 900 && !v.msg, JSON.stringify(v));
    check("the viewer steps to the other photo", await p.isVisible("#phNext") && await p.isEnabled("#phNext"));
    await p.click("#phClose");
    await p.evaluate(() => { window.__TEST_PHOTO_OFFLINE = true; }); await p.click("#jRail .phth"); await wait(p, 400);
    check("offline with no copy of the full image, the viewer says it will load later (thumbnail still shown)", (await p.textContent("#phMsg")).includes("isn't on this phone yet") && !!(await p.getAttribute("#phImg", "src")));
    await p.click("#phClose"); await p.evaluate(() => { window.__TEST_PHOTO_OFFLINE = false; });

    // ---- the other parent's photo shows up ----
    await p.evaluate(e => { __db.photos["ph-1-zz99"] = { ev: e, t: 1, w: 10, h: 10, bytes: 3, thumb: new Uint8Array([255, 216, 255]), by: "parent2@example.com" }; }, ev);
    await p.evaluate(() => Store.put("events", "e-9-noop", { kind: "journal", scope: "family", i: null, key: null, t: 1, title: "x", note: "", ref: null, src: null, createdT: 1, editT: 1, editBy: "" })); await wait(p, 300);
    await p.evaluate(() => { delete __db.photos["ph-1-zz99"]; Store.remove("events", "e-9-noop"); }); await wait(p, 300);

    // ---- edit: remove one, Undo, remove again and let it purge ----
    await p.click(`#jRail [data-ev="${ev}"]`); await wait(p);
    check("editing shows the moment's photos with Remove buttons", (await p.$$("#mPhotos [data-phrm]")).length === 2);
    const gone = await p.getAttribute("#mPhotos [data-phrm]", "data-phrm");
    await p.click("#mPhotos [data-phrm]"); await p.click("#mSave"); await wait(p, 400);
    check("removing a photo marks it deleted (Undo still possible) and hides it", (await p.evaluate(id => !!__db.photos[id].deletedT, gone)) && (await p.$$("#jRail .jph .phth")).length === 1);
    await p.click("#toast button"); await wait(p, 400);
    check("Undo brings the photo back", (await p.evaluate(id => !__db.photos[id].deletedT, gone)) && (await p.$$("#jRail .jph .phth")).length === 2);
    await p.click(`#jRail [data-ev="${ev}"]`); await wait(p); await p.click(`#mPhotos [data-phrm="${gone}"]`); await p.click("#mSave"); await wait(p, 400);
    await p.clock.runFor(10000); await wait(p, 300);
    check("after the Undo time, the photo and its full image are purged", await p.evaluate(id => !__db.photos[id] && !__db.photoData[id], gone));

    // ---- the 6-photo limit ----
    await p.click(`#jRail [data-ev="${ev}"]`); await wait(p);
    const many = []; for (let k = 0; k < 7; k++) many.push(file(await makeImage(p, 200, 200, k * 40), `p${k}.png`));
    await p.setInputFiles("#mPhFile", many); await wait(p, 2500);
    check("a moment holds at most 6 photos, and the sheet says so", (await p.$$("#mPhotos .phcell")).length === 6 && (await p.textContent("#mMsg")).includes("Up to 6 photos") && await p.isDisabled("#mPhAdd"));
    await p.click("#mCancel"); await wait(p);
    check("Cancel writes nothing", (await photos(p)).length === 1);

    // ---- an unreadable file ----
    await openAdd(p); await p.setInputFiles("#mPhFile", { name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") }); await wait(p, 600);
    check("an unreadable file is refused in plain words", (await p.textContent("#mMsg")).includes("couldn't be read") && (await p.$$("#mPhotos .phcell")).length === 0);
    await p.click("#mCancel");

    // ---- Undo of a new moment removes its photos ----
    await openAdd(p); await p.click('#mWho button[data-v="parent"]'); await p.click('#mKind button[data-v="journal"]'); await p.fill("#mTitle", "Undo me");
    await p.setInputFiles("#mPhFile", [file(tall)]); await wait(p, 900); await p.click("#mSave"); await wait(p, 400);
    const ev2 = await evIdOf(p, "Undo me");
    check("the new moment's photo is saved", (await photos(p)).some(([, x]) => x.ev === ev2));
    await p.click("#toast button"); await wait(p, 500);
    check("Undo of the new moment removes it and its photo", !(await evIdOf(p, "Undo me")) && !(await photos(p)).some(([, x]) => x.ev === ev2));

    // ---- deleting a moment takes its photos (Undo restores; otherwise purged) ----
    await p.click(`#jRail [data-ev="${ev}"]`); await wait(p); p.answers = [true]; await p.click("#mDel"); await wait(p, 400);
    check("deleting a moment marks its photos deleted", (await photos(p)).every(([, x]) => x.ev !== ev || x.deletedT));
    await p.click("#toast button"); await wait(p, 400);
    check("Undo restores the moment and its photo", !!(await evIdOf(p, "Photo day")) && (await photos(p)).some(([, x]) => x.ev === ev && !x.deletedT));

    // ---- Settings: usage and backup ----
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await wait(p, 500);
    check("Settings shows how much of the free storage photos use", /Photos: 1 · about <?\d+ MB of the 1 GB free storage\./.test(await p.textContent("#phUse")), await p.textContent("#phUse"));
    await p.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#bkGo")]); const bk = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    const meta = Object.values(bk.data.photos || {});
    check("the backup lists photo metadata, without the images", meta.length === 1 && meta[0].ev === ev && meta[0].w > 0 && !("thumb" in meta[0]) && !("full" in meta[0]) && !("photoData" in bk.data), JSON.stringify(meta));
    p.answers = [true]; await p.setInputFiles("#rsFile", await dl.path()); await wait(p, 500);
    check("restoring that backup works and writes no photos", (await p.textContent("#bkMsg")).length > 0 && (await photos(p)).length === 1);
    check("no page errors", !p.errors.length, p.errors.join("; "));
  } finally { await browser.close(); srv.close(); }
  console.log(`\n${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
