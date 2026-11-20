// MyChart (Epic) read-only connection helpers — TEST STAGE: Epic's public sandbox with fictional patients only.
// Pure functions (window.MyChart; also require()d by the Node tests). The app keeps whatever it reads in memory and the
// access token in sessionStorage (this tab only); nothing from MyChart is written to the family's data
// (docs/NICULOG-PLAN.md → MyChart exploration; Connected Care guardrails: read-only, never "verified").
(function (root) {
  // Public identifiers, not secrets (a SMART public client uses PKCE instead of a secret).
  const SANDBOX = {
    name: "Epic sandbox (test patients)",
    base: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    authorize: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize",
    token: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
    clientId: "5c05b8de-46e9-48d2-8282-e5363bbd2351"
  };
  const SCOPE = "openid fhirUser launch/patient patient/Patient.read patient/Observation.read";
  const WEIGHT = "29463-7";   // LOINC: body weight

  const b64url = bytes => { let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const randomString = (cr, n = 32) => b64url(cr.getRandomValues(new Uint8Array(n)));
  // PKCE (RFC 7636, S256): a fresh verifier per sign-in; only its SHA-256 goes to the authorize page.
  async function pkce(cr) {
    const verifier = randomString(cr, 32);
    const hash = new Uint8Array(await cr.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    return { verifier, challenge: b64url(hash) };
  }
  function authorizeUrl(endpoint, o) {
    const u = new URL(endpoint);
    const p = { response_type: "code", client_id: o.clientId, redirect_uri: o.redirect, scope: o.scope || SCOPE, state: o.state,
      aud: o.base, code_challenge: o.challenge, code_challenge_method: "S256" };
    Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  }
  function tokenBody(o) {
    return new URLSearchParams({ grant_type: "authorization_code", code: o.code, redirect_uri: o.redirect, client_id: o.clientId, code_verifier: o.verifier }).toString();
  }
  // The app's own address as registered with Epic (exact match), without index.html, query or hash.
  const redirectOf = loc => loc.origin + loc.pathname.replace(/index\.html$/, "");
  function toGrams(q) {
    if (!q || typeof q.value !== "number" || !isFinite(q.value)) return null;
    const u = String(q.code || q.unit || "").toLowerCase();
    if (u === "g") return Math.round(q.value);
    if (u === "kg") return Math.round(q.value * 1000);
    if (u === "[lb_av]" || u === "lb" || u === "lbs") return Math.round(q.value * 453.59237);
    if (u === "[oz_av]" || u === "oz") return Math.round(q.value * 28.349523125);
    return null;
  }
  // Body weights from an Observation search bundle, newest first. Skips anything marked in error or cancelled,
  // other measurements, and values without a usable unit or time.
  function weights(bundle) {
    const out = [];
    ((bundle && bundle.entry) || []).forEach(e => {
      const r = e && e.resource;
      if (!r || r.resourceType !== "Observation" || r.status === "entered-in-error" || r.status === "cancelled") return;
      if (!((r.code && r.code.coding) || []).some(c => c && c.code === WEIGHT)) return;
      const g = toGrams(r.valueQuantity), t = Date.parse(r.effectiveDateTime || (r.effectivePeriod && r.effectivePeriod.start) || r.issued || "");
      if (g == null || !isFinite(t) || g <= 0) return;
      out.push({ t, g });
    });
    return out.sort((a, b) => b.t - a.t);
  }
  function patientInfo(p) {
    const n = ((p && p.name) || []).find(x => x && x.use === "official") || ((p && p.name) || [])[0] || {};
    const name = n.text || [...(n.given || []), n.family].filter(Boolean).join(" ");
    return { name: name || "", birthDate: (p && p.birthDate) || "" };
  }
  const api = { SANDBOX, SCOPE, WEIGHT, b64url, randomString, pkce, authorizeUrl, tokenBody, redirectOf, toGrams, weights, patientInfo };
  root.MyChart = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
