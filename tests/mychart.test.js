// MyChart (test stage) — the helpers in Node, then the whole sign-in flow in the browser against a faked Epic sandbox
// (Playwright routes stand in for fhir.epic.com; fictional patient only). cd tests && npm run mychart
const crypto = require("crypto");
const MC = require("../mychart.js");
const { serve, newPage, importData, tab } = require("./smoke.js");
const { chromium } = require("playwright");

let pass = 0; const fails = [];
const check = (name, ok, detail = "") => { ok ? pass++ : fails.push(name + (detail ? " — " + detail : "")); console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? " — " + detail : ""}`); };
const NOW = "2026-02-10T15:10:00-05:00";
const wait = (p, ms = 250) => p.waitForTimeout(ms);
const sha = s => crypto.createHash("sha256").update(s).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function unit() {
  const k = await MC.pkce(globalThis.crypto);
  check("PKCE: a 43-character verifier, and the challenge is its SHA-256 (base64url)", k.verifier.length === 43 && /^[A-Za-z0-9_-]+$/.test(k.verifier) && k.challenge === sha(k.verifier));
  const u = new URL(MC.authorizeUrl(MC.SANDBOX.authorize, { clientId: "cid", redirect: "https://x.example/app/", state: "st", base: MC.SANDBOX.base, challenge: "ch" }));
  const q = Object.fromEntries(u.searchParams);
  check("the authorize address carries code + PKCE S256, the app's address, state, audience and read-only scopes", q.response_type === "code" && q.client_id === "cid" && q.redirect_uri === "https://x.example/app/" && q.state === "st" && q.aud === MC.SANDBOX.base && q.code_challenge === "ch" && q.code_challenge_method === "S256" && q.scope.includes("patient/Observation.read") && !/write|\*\.\*/.test(q.scope));
  check("the redirect address drops index.html, the query and the hash", MC.redirectOf({ origin: "https://a.example", pathname: "/twins-tracker/index.html" }) === "https://a.example/twins-tracker/");
  check("weights convert to grams from g, kg, lb and oz", MC.toGrams({ value: 2500, code: "g" }) === 2500 && MC.toGrams({ value: 2.5, code: "kg" }) === 2500 && MC.toGrams({ value: 5.5, code: "[lb_av]" }) === 2495 && MC.toGrams({ value: 88, unit: "oz" }) === 2495 && MC.toGrams({ value: 3, code: "stone" }) === null);
  const w = MC.weights({ entry: [
    { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: 2.41, code: "kg" }, effectiveDateTime: "2026-02-08T20:00:00Z" } },
    { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: 2440, code: "g" }, effectiveDateTime: "2026-02-09T20:00:00Z" } },
    { resource: { resourceType: "Observation", status: "entered-in-error", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: 9, code: "kg" }, effectiveDateTime: "2026-02-10T20:00:00Z" } },
    { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "8302-2" }] }, valueQuantity: { value: 46, code: "cm" }, effectiveDateTime: "2026-02-10T20:00:00Z" } },
    { resource: { resourceType: "OperationOutcome" } }] });
  check("weights: newest first, in grams; errors, other measurements and non-observations are left out", JSON.stringify(w.map(x => x.g)) === "[2440,2410]");
  const labs = MC.labs({ entry: [
    { resource: { resourceType: "Observation", status: "final", code: { text: "Bilirubin, total" }, valueQuantity: { value: 8.2, unit: "mg/dL" }, interpretation: [{ text: "High" }], effectiveDateTime: "2026-02-02T10:00:00Z" } },
    { resource: { resourceType: "Observation", status: "final", code: { coding: [{ display: "Blood type" }] }, valueString: "O positive", effectiveDateTime: "2026-02-01T10:00:00Z" } },
    { resource: { resourceType: "Observation", status: "entered-in-error", code: { text: "Wrong" }, valueString: "x", effectiveDateTime: "2026-02-03T10:00:00Z" } }] });
  check("labs: name, value with unit (or text), flag; newest first; errors left out", JSON.stringify(labs.map(x => [x.name, x.value, x.flag])) === JSON.stringify([["Bilirubin, total", "8.2 mg/dL", "High"], ["Blood type", "O positive", ""]]));
  const meds = MC.meds({ entry: [
    { resource: { resourceType: "MedicationRequest", status: "active", medicationReference: { reference: "Medication/m1" }, dosageInstruction: [{ text: "1 mL by mouth daily" }], authoredOn: "2026-02-03" } },
    { resource: { resourceType: "MedicationRequest", status: "stopped", medicationCodeableConcept: { text: "Old drug" }, authoredOn: "2026-02-01" } },
    { resource: { resourceType: "Medication", id: "m1", code: { text: "Vitamin D drops" } } }] });
  check("medications: active only, named from the linked Medication when needed, with the dose", meds.length === 1 && meds[0].name === "Vitamin D drops" && meds[0].dose === "1 mL by mouth daily");
  const im = MC.immunizations({ entry: [{ resource: { resourceType: "Immunization", status: "completed", vaccineCode: { text: "Hepatitis B" }, occurrenceDateTime: "2026-02-01" } }, { resource: { resourceType: "Immunization", status: "not-done", vaccineCode: { text: "Skipped" }, occurrenceDateTime: "2026-02-02" } }] });
  check("immunizations: given ones only", im.length === 1 && im[0].name === "Hepatitis B");
  check("Nationwide Children's is set up with its own address and the production client ID", MC.SITES.nch.base.startsWith("https://hkc.nationwidechildrens.org/") && MC.SITES.nch.clientId !== MC.SANDBOX.clientId && MC.SCOPE.includes("patient/Immunization.read") && !/write/.test(MC.SCOPE));
  check("patient: official name and birth date", JSON.stringify(MC.patientInfo({ name: [{ use: "nickname", text: "Bee" }, { use: "official", given: ["Test"], family: "Baby" }], birthDate: "2026-01-31" })) === JSON.stringify({ name: "Test Baby", birthDate: "2026-01-31" }));
}

async function browserFlow() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`, browser = await chromium.launch();
  const ADA = "Ada Rose", BEA = "Bea Joy";
  const seen = { authorize: [], token: [], fhir: [] };
  let nextPatient = "pt-a", fail401 = 0;
  const PATIENTS = { "pt-a": { given: "Baby Girl A", born: "2026-02-01" }, "pt-b": { given: "Baby Girl B", born: "2026-02-01" }, "pt-x": { given: "Other Child", born: "2025-05-05" } };
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Accept, Content-Type" };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: CORS, contentType: "application/fhir+json", body: JSON.stringify(body) });
  // One fake Epic for either site (sandbox host or NCH host): authorize → back with a code; token → this sign-in's patient.
  const fakeEpic = site => async route => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (u.pathname.endsWith("/.well-known/smart-configuration")) return json(route, { authorization_endpoint: site.authorize, token_endpoint: site.token });
    if (u.pathname.endsWith("/oauth2/authorize")) { const a = Object.fromEntries(u.searchParams); seen.authorize.push(a);
      const back = new URL(a.redirect_uri); back.searchParams.set("code", "c0de-" + seen.authorize.length); back.searchParams.set("state", a.state);
      return route.fulfill({ status: 302, headers: { Location: back.toString() } }); }
    if (u.pathname.endsWith("/oauth2/token")) { const t = Object.fromEntries(new URLSearchParams(req.postData() || "")); seen.token.push(t);
      const a = seen.authorize[seen.authorize.length - 1], ok = t.grant_type === "authorization_code" && sha(t.code_verifier || "") === a.code_challenge;
      return json(route, ok ? { access_token: "t0k-" + nextPatient, token_type: "Bearer", expires_in: 3600, patient: nextPatient } : { error: "invalid_grant" }, ok ? 200 : 400); }
    if (u.pathname.includes("/api/FHIR/R4/")) {
      const auth = req.headers()["authorization"] || "", pid = auth.replace("Bearer t0k-", ""); seen.fhir.push({ path: u.pathname + u.search, pid });
      if (fail401 > 0) { fail401--; return json(route, {}, 401); }
      const pm = u.pathname.match(/\/Patient\/(pt-\w+)$/);
      if (pm) { const p = PATIENTS[pm[1]]; return json(route, { resourceType: "Patient", id: pm[1], name: [{ use: "official", given: [p.given], family: "Testfamily" }], birthDate: p.born }); }
      if (u.pathname.endsWith("/Observation") && u.searchParams.get("category") === "laboratory") return json(route, { resourceType: "Bundle", entry: [
        { resource: { resourceType: "Observation", status: "final", code: { text: "Bilirubin, total" }, valueQuantity: { value: 8.2, unit: "mg/dL" }, interpretation: [{ text: "High" }], effectiveDateTime: "2026-02-09T12:00:00Z" } }] });
      if (u.pathname.endsWith("/Observation")) return json(route, { resourceType: "Bundle", entry: [
        { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: 2.39, code: "kg" }, effectiveDateTime: "2026-02-08T01:00:00Z" } },
        { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: pid === "pt-b" ? 2610 : 2425, code: "g" }, effectiveDateTime: "2026-02-10T01:00:00Z" } }] });
      if (u.pathname.endsWith("/MedicationRequest")) return json(route, { resourceType: "Bundle", entry: [
        { resource: { resourceType: "MedicationRequest", status: "active", medicationReference: { reference: "Medication/m1" }, dosageInstruction: [{ text: "1 mL by mouth daily" }], authoredOn: "2026-02-03" } },
        { resource: { resourceType: "Medication", id: "m1", code: { text: "Vitamin D drops" } } }] });
      if (u.pathname.endsWith("/Immunization")) return json(route, {}, 403);
    }
    return json(route, {}, 404);
  };
  const settings = async p => { await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]').then(() => p.evaluate(() => document.querySelectorAll("details.sfold").forEach(d => d.open = true))); await wait(p); };
  const connect = async (p, i, patient) => { nextPatient = patient; await p.click(`#mcBody [data-mcgo="${i}"]`); await p.waitForURL(u => !String(u).includes("code="), { timeout: 15000 }).catch(() => {}); await wait(p, 1200); };
  try {
    const p = await newPage(browser, base, { now: NOW });
    await importData(p);
    await settings(p);
    check("without the switch, there's no MyChart card and nothing on Care", await p.$eval("#mcCard", c => c.hidden) && await p.$eval("#mcCare", c => c.hidden));
    await p.context().route("https://fhir.epic.com/**", fakeEpic(MC.SANDBOX));
    await p.context().route("https://hkc.nationwidechildrens.org/**", fakeEpic(MC.NCH));
    const before = await p.evaluate(() => JSON.stringify(__db));
    await p.goto(base + "?mychart=sandbox"); await wait(p, 700); await settings(p);
    check("the switch shows a Connect button for each baby (no Refresh yet)", !!(await p.$('#mcBody [data-mcgo="0"]')) && !!(await p.$('#mcBody [data-mcgo="1"]')) && await p.$eval("#mcRefresh", b => b.hidden));
    await connect(p, 0, "pt-a");
    const a0 = seen.authorize[0] || {};
    check("Connect sends the parent to MyChart's sign-in with PKCE, the app's address and read-only scopes", a0.client_id === MC.SANDBOX.clientId && a0.code_challenge_method === "S256" && a0.redirect_uri === base && !/write/.test(a0.scope || ""));
    check("back from MyChart, the code is swapped for a token (PKCE, no secret) and the address is cleaned", seen.token.length === 1 && !("client_secret" in seen.token[0]) && !p.url().includes("code=") && !p.url().includes("state="));
    check(`${ADA} shows as connected, with the MyChart record's name`, (await p.textContent("#mcBody")).includes("MyChart record: Baby Girl A Testfamily"));
    await tab(p, "weight"); await wait(p, 600);
    const grow = await p.evaluate(() => ({ sum: document.querySelector("#grSum").innerText, grid: document.querySelector("#wBody").innerText,
      ds: (window.Chart && Chart.getChart(document.getElementById("cWeight")) || { data: { datasets: [] } }).data.datasets.map(d => d.label) }));
    check("Growth: her latest MyChart weight shows on her summary, marked as not checked by NICUlog", /MyChart: 2,425 g/.test(grow.sum) && grow.sum.includes("not checked by NICUlog"), JSON.stringify(grow.sum.slice(0, 400)));
    check("Growth: the nightly grid shows the MyChart weight on its night, under the family's entry", grow.grid.includes("MyChart 2,425 g"));
    check("Growth: the chart adds MyChart weights as their own series", grow.ds.includes(`${ADA} · MyChart`), grow.ds.join());
    await tab(p, "more"); await p.click('#moreNav button[data-v="care"]'); await wait(p);
    const care = await p.textContent("#mcCare");
    check("Care: her lab results (with the hospital's flag) and medications show under From MyChart", !(await p.$eval("#mcCare", c => c.hidden)) && care.includes(ADA) && care.includes("Bilirubin, total: 8.2 mg/dL") && care.includes("High") && care.includes("Vitamin D drops"));
    check("Care: a record type MyChart won't release says so, without hiding the others", care.includes("Not available from this MyChart"));
    await settings(p);
    await connect(p, 1, "pt-a");
    check("connecting the second baby to the same MyChart record is refused", (await p.textContent("#mcMsg")).includes("same MyChart record") && !!(await p.$('#mcBody [data-mcgo="1"]')));
    await connect(p, 1, "pt-b");
    check(`${BEA} connects with her own record; both show on Care`, (await p.textContent("#mcBody")).includes("Baby Girl B") && await (async () => { await tab(p, "more"); await p.click('#moreNav button[data-v="care"]'); await wait(p); const c = await p.textContent("#mcCare"); return c.includes(ADA) && c.includes(BEA); })());
    check("nothing from MyChart is written to the family's data", !(await p.evaluate(() => /pt-a|pt-b|Bilirubin|Vitamin D|t0k|Testfamily/.test(JSON.stringify(__db)))));
    check("tokens stay in this tab (sessionStorage); the phone remembers only which babies were connected", await p.evaluate(() => /t0k-pt-a/.test(sessionStorage.getItem("mcTok") || "") && !/t0k|pt-/.test(JSON.stringify(localStorage)) && localStorage.getItem("mcWas") === "[0,1]"));
    // the MyChart session runs out: Refresh signs in again, one baby after the other
    await p.evaluate(() => { const m = JSON.parse(sessionStorage.getItem("mcTok")); Object.values(m).forEach(t => { t.exp = 1; }); sessionStorage.setItem("mcTok", JSON.stringify(m)); });
    await p.goto(base); await wait(p, 900); await settings(p);
    check("after the session runs out, each baby shows it and Refresh is offered", (await p.textContent("#mcBody")).includes("sign-in ran out") && !(await p.$eval("#mcRefresh", b => b.hidden)));
    const n0 = seen.authorize.length, t0 = seen.token.length; nextPatient = "pt-a";
    // the first sign-in returns her record; once that token is issued, the next sign-in returns her sister's
    const both = (async () => { const end = Date.now() + 20000; while (Date.now() < end) { if (seen.token.length >= t0 + 1 && nextPatient === "pt-a") nextPatient = "pt-b"; if (seen.token.length >= t0 + 2 && !p.url().includes("code=")) return true; await new Promise(r => setTimeout(r, 30)); } return false; })();
    await p.click("#mcRefresh"); const ok2 = await both; await wait(p, 1500);
    check("Refresh signs in again for both babies, one after the other, and reads both records", ok2 && seen.authorize.length === n0 + 2 && (await p.textContent("#mcBody")).includes("Baby Girl A") && (await p.textContent("#mcBody")).includes("Baby Girl B"), `${seen.authorize.length - n0} sign-ins · ${await p.textContent("#mcBody")} · ${await p.textContent("#mcMsg")} · ${p.url()}`);
    fail401 = 1; await p.click("#mcRefresh"); await wait(p, 1200);
    check("if MyChart refuses a read because the session ended, it says Refresh will sign in again", (await p.textContent("#mcMsg")).includes("Tap Refresh to sign in again"), await p.textContent("#mcMsg"));
    await p.click('#mcBody [data-mcoff="0"]'); await wait(p);
    check("Disconnect forgets that baby: no token, not remembered, gone from Growth", await p.evaluate(() => !/"0"/.test(sessionStorage.getItem("mcTok") || "") && localStorage.getItem("mcWas") === "[1]") && !!(await p.$('#mcBody [data-mcgo="0"]')) && await (async () => { await tab(p, "weight"); await wait(p, 400); return !(await p.textContent("#grSum")).includes("MyChart: 2,425"); })());
    // a returning sign-in whose state doesn't match is refused
    const nt = seen.token.length;
    await p.evaluate(() => sessionStorage.setItem("mcAuth", JSON.stringify({ verifier: "v", state: "right", token: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token", i: 0, t: Date.now() })));
    await p.goto(base + "?code=zzz&state=wrong"); await wait(p, 900);
    check("a sign-in that doesn't match this page is refused, with no token request", seen.token.length === nt && (await p.textContent("#mcMsg")).includes("didn't match") && !p.url().includes("code="));
    // NCH: the record's birth date must be the babies' birth date
    await p.goto(base + "?mychart=nch"); await wait(p, 700); await settings(p);
    check("the Nationwide Children's switch titles the card for NCH and starts fresh", (await p.textContent("#mcHead")).includes("Nationwide Children") && !!(await p.$('#mcBody [data-mcgo="1"]')), (await p.textContent("#mcHead")) + " | " + (await p.textContent("#mcBody")));
    await connect(p, 0, "pt-x");
    const an = seen.authorize[seen.authorize.length - 1];
    check("NCH sign-in uses NCH's MyChart and the production client ID", an.client_id === MC.NCH.clientId && an.aud === MC.NCH.base);
    check("at NCH, a record with a different birth date is refused", (await p.textContent("#mcMsg")).includes(`isn't ${ADA}'s`) && !!(await p.$('#mcBody [data-mcgo="0"]')), await p.textContent("#mcMsg"));
    await connect(p, 0, "pt-a");
    check("at NCH, her own record (matching birth date) connects", (await p.textContent("#mcBody")).includes("Baby Girl A"));
    await p.goto(base + "?mychart=off"); await wait(p, 600); await settings(p);
    check("?mychart=off hides the card again and forgets which babies were connected", await p.$eval("#mcCard", c => c.hidden) && await p.evaluate(() => !localStorage.getItem("mcWas")));
    check("no page errors", !p.errors.length, p.errors.join("; "));
  } finally { await browser.close(); srv.close(); }
}

(async () => {
  try { await unit(); await browserFlow(); } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  console.log(`\n${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
})();
