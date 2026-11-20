// MyChart (Epic) read-only connection helpers. Two sites: Epic's public sandbox (fictional patients) and Nationwide
// Children's (the twins' records; usable only once the app is marked ready for production and Epic has distributed it).
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
  // Nationwide Children's: R4 patient-access base from Epic's public endpoint directory; production client ID.
  // The authorize/token addresses are read from the server's SMART configuration (fallbacks follow Epic's layout).
  const NCH = {
    name: "Nationwide Children's",
    base: "https://hkc.nationwidechildrens.org/FHIR/MYCHART/api/FHIR/R4",
    authorize: "https://hkc.nationwidechildrens.org/FHIR/MYCHART/oauth2/authorize",
    token: "https://hkc.nationwidechildrens.org/FHIR/MYCHART/oauth2/token",
    clientId: "ae9446fa-4cad-4452-bbf6-ecb7537bd778"
  };
  const SITES = { sandbox: SANDBOX, nch: NCH };
  const SCOPE = "openid fhirUser launch/patient patient/Patient.read patient/Observation.read patient/MedicationRequest.read patient/Medication.read patient/Immunization.read";
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
  const entries = (bundle, type) => ((bundle && bundle.entry) || []).map(e => e && e.resource).filter(r => r && r.resourceType === type);
  const codeName = c => (c && (c.text || ((c.coding || []).find(x => x && x.display) || {}).display)) || "";
  const when = s => { const t = Date.parse(s || ""); return isFinite(t) ? t : null; };
  // Lab results, newest first: name, value as the hospital reports it (number + unit, text or coded), and any flag.
  function labs(bundle) {
    return entries(bundle, "Observation").filter(r => r.status !== "entered-in-error" && r.status !== "cancelled").map(r => {
      const q = r.valueQuantity, value = q && typeof q.value === "number" ? `${q.value}${q.unit || q.code ? " " + (q.unit || q.code) : ""}` : (r.valueString || codeName(r.valueCodeableConcept) || "");
      return { t: when(r.effectiveDateTime || (r.effectivePeriod && r.effectivePeriod.start) || r.issued), name: codeName(r.code), value, flag: codeName((r.interpretation || [])[0]) };
    }).filter(x => x.t != null && x.name && x.value).sort((a, b) => b.t - a.t);
  }
  // Medication orders: active (or on hold) only, newest first; the name from the order itself or the Medication it points to.
  function meds(bundle) {
    const medsById = {}; entries(bundle, "Medication").forEach(m => { if (m.id) medsById["Medication/" + m.id] = codeName(m.code); });
    return entries(bundle, "MedicationRequest").filter(r => r.status === "active" || r.status === "on-hold").map(r => ({
      t: when(r.authoredOn), status: r.status,
      name: codeName(r.medicationCodeableConcept) || (r.medicationReference && (r.medicationReference.display || medsById[r.medicationReference.reference])) || "",
      dose: (((r.dosageInstruction || [])[0]) || {}).text || ""
    })).filter(x => x.name).sort((a, b) => (b.t || 0) - (a.t || 0));
  }
  // Immunizations given (completed), newest first.
  function immunizations(bundle) {
    return entries(bundle, "Immunization").filter(r => r.status === "completed").map(r => ({ t: when(r.occurrenceDateTime || r.recorded), name: codeName(r.vaccineCode) }))
      .filter(x => x.t != null && x.name).sort((a, b) => b.t - a.t);
  }
  function patientInfo(p) {
    const n = ((p && p.name) || []).find(x => x && x.use === "official") || ((p && p.name) || [])[0] || {};
    const name = n.text || [...(n.given || []), n.family].filter(Boolean).join(" ");
    return { name: name || "", birthDate: (p && p.birthDate) || "" };
  }
  const api = { SANDBOX, NCH, SITES, SCOPE, WEIGHT, b64url, randomString, pkce, authorizeUrl, tokenBody, redirectOf, toGrams, weights, labs, meds, immunizations, patientInfo };
  root.MyChart = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
