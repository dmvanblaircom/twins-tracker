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
  check("patient: official name and birth date", JSON.stringify(MC.patientInfo({ name: [{ use: "nickname", text: "Bee" }, { use: "official", given: ["Test"], family: "Baby" }], birthDate: "2026-01-31" })) === JSON.stringify({ name: "Test Baby", birthDate: "2026-01-31" }));
}

async function browserFlow() {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/`, browser = await chromium.launch();
  const seen = { authorize: null, token: null, fhir: [] };
  try {
    const p = await newPage(browser, base, { now: NOW });
    await importData(p);
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await wait(p);
    check("without the test switch, there's no MyChart card", await p.$eval("#mcCard", c => c.hidden));
    const ctx = p.context(), CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Accept, Content-Type" };
    await ctx.route("https://fhir.epic.com/**", async route => {
      const req = route.request(), u = new URL(req.url());
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (u.pathname.endsWith("/.well-known/smart-configuration")) return route.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify({ authorization_endpoint: MC.SANDBOX.authorize, token_endpoint: MC.SANDBOX.token }) });
      if (u.pathname.endsWith("/oauth2/authorize")) { seen.authorize = Object.fromEntries(u.searchParams);
        const back = new URL(seen.authorize.redirect_uri); back.searchParams.set("code", "c0de"); back.searchParams.set("state", seen.authorize.state);
        return route.fulfill({ status: 302, headers: { Location: back.toString() } }); }
      if (u.pathname.endsWith("/oauth2/token")) { seen.token = Object.fromEntries(new URLSearchParams(req.postData() || ""));
        const ok = seen.token.grant_type === "authorization_code" && seen.token.code === "c0de" && sha(seen.token.code_verifier || "") === seen.authorize.code_challenge;
        return route.fulfill({ status: ok ? 200 : 400, headers: CORS, contentType: "application/json", body: JSON.stringify(ok ? { access_token: "t0k", token_type: "Bearer", expires_in: 3600, patient: "pt-1" } : { error: "invalid_grant" }) }); }
      if (u.pathname.includes("/api/FHIR/R4/")) { seen.fhir.push({ path: u.pathname + u.search, auth: req.headers()["authorization"] });
        if (u.pathname.endsWith("/Patient/pt-1")) return route.fulfill({ headers: CORS, contentType: "application/fhir+json", body: JSON.stringify({ resourceType: "Patient", id: "pt-1", name: [{ use: "official", given: ["Testbaby"], family: "Sandbox" }], birthDate: "2026-01-31" }) });
        if (u.pathname.endsWith("/Observation")) return route.fulfill({ headers: CORS, contentType: "application/fhir+json", body: JSON.stringify({ resourceType: "Bundle", entry: [
          { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: 2.39, code: "kg" }, effectiveDateTime: "2026-02-08T01:00:00Z" } },
          { resource: { resourceType: "Observation", status: "final", code: { coding: [{ code: "29463-7" }] }, valueQuantity: { value: 2425, code: "g" }, effectiveDateTime: "2026-02-10T01:00:00Z" } }] }) });
      }
      return route.fulfill({ status: 404, headers: CORS, body: "{}" });
    });
    const before = await p.evaluate(() => JSON.stringify(__db));
    await p.goto(base + "?mychart=sandbox"); await wait(p, 700);
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await wait(p);
    check("the test switch shows the MyChart card on this phone", !(await p.$eval("#mcCard", c => c.hidden)) && await p.isVisible("#mcGo"));
    await Promise.all([p.waitForURL(u => !String(u).includes("code="), { timeout: 15000 }).catch(() => {}), p.click("#mcGo")]); await wait(p, 1200);
    check("Connect sends the parent to MyChart's sign-in with PKCE, the app's own address and read-only scopes", !!seen.authorize && seen.authorize.client_id === MC.SANDBOX.clientId && seen.authorize.code_challenge_method === "S256" && seen.authorize.redirect_uri === base && !/write/.test(seen.authorize.scope), JSON.stringify(seen.authorize));
    check("back from MyChart, the code is swapped for a token using the PKCE verifier", !!seen.token && seen.token.client_id === MC.SANDBOX.clientId && seen.token.redirect_uri === base && !("client_secret" in seen.token));
    check("the code and state are removed from the address afterwards", !p.url().includes("code=") && !p.url().includes("state="), p.url());
    const body = await p.textContent("#mcBody");
    check("the card shows the patient and her weights in grams, newest first", body.includes("Testbaby Sandbox") && body.includes("born Jan 31") && body.indexOf("2,425 g") > -1 && body.indexOf("2,425 g") < body.indexOf("2,390 g"), body.replace(/\s+/g, " ").slice(0, 200));
    check("MyChart data is labelled as not checked by NICUlog", body.includes("From MyChart · not checked by NICUlog"));
    check("every MyChart read uses the token, and only Patient and vital-sign weights are read", seen.fhir.length === 2 && seen.fhir.every(f => f.auth === "Bearer t0k") && seen.fhir.some(f => f.path.includes("category=vital-signs") && f.path.includes("code=29463-7")));
    check("nothing from MyChart is written to the family's data", (await p.evaluate(() => JSON.stringify(__db))) === before.replace(/"x"/g, "\"x\"") || !(await p.evaluate(() => /Testbaby|Sandbox|2425|t0k/.test(JSON.stringify(__db)))));
    check("the token is kept for this tab only (sessionStorage), never in localStorage", await p.evaluate(() => !!sessionStorage.getItem("mcTok") && !/t0k/.test(JSON.stringify(localStorage))));
    await p.click("#mcOff"); await wait(p);
    check("Disconnect forgets the token and the data", await p.evaluate(() => !sessionStorage.getItem("mcTok")) && (await p.textContent("#mcBody")).trim() === "" && await p.isVisible("#mcGo"));
    // a returning sign-in whose state doesn't match is refused (no token request)
    seen.token = null;
    await p.evaluate(() => sessionStorage.setItem("mcAuth", JSON.stringify({ verifier: "v", state: "right", token: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token", t: Date.now() })));
    await p.goto(base + "?code=zzz&state=wrong"); await wait(p, 700);
    check("a sign-in that doesn't match this page is refused, with no token request", !seen.token && (await p.textContent("#mcMsg")).includes("didn't match") && !p.url().includes("code="));
    await p.goto(base + "?mychart=off"); await wait(p, 600);
    await tab(p, "more"); await p.click('#moreNav button[data-v="settings"]'); await wait(p);
    check("?mychart=off hides the card again", await p.$eval("#mcCard", c => c.hidden));
    check("no page errors", !p.errors.length, p.errors.join("; "));
  } finally { await browser.close(); srv.close(); }
}

(async () => {
  try { await unit(); await browserFlow(); } catch (e) { fails.push("crashed: " + e.message); console.error(e); }
  console.log(`\n${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
})();
