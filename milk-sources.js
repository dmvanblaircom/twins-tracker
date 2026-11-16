// Milk sources engine (Phase 2b). Pure functions only: no DOM, no Store, no globals read or written.
// Loaded by index.html as window.MilkSources and by the Node tests via require().
//
// Two quantities are kept apart:
//   actual    = what a parent recorded (feeds.v, and an allocation's mL per source) — never changed here;
//   scheduled = a baby's scheduled feed amount at a scheduled feed occurrence — the basis of the stock estimate.
// At each occurrence the stock is charged scheduled × the mother's-milk share of that occurrence's composition.
//
// All source arithmetic is in integer tenths of a mL. A split always returns three integers that total exactly the
// scheduled amount (largest remainder; ties go mother's → donor → formula), so every phone gets the same numbers.
(function (root) {
  "use strict";
  const SRC = ["mom", "donor", "formula"];
  const pad = n => String(n).padStart(2, "0");
  const dKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const isInt = v => Number.isInteger(v);
  const hrOk = (h, lo, hi, def) => Number.isInteger(+h) && +h >= lo && +h <= hi ? +h : def;

  // ---------- schedule: the same grid the app builds in setSchedule()/slotT() ----------
  // Feed hours from a feed day's midnight, within [dayH, dayH + 24), on the grid anchored at startH.
  const slotHours = (everyH, startH, dayH) =>
    [...Array(24)].map((_, k) => dayH + k).filter(h => ((h - startH) % everyH + everyH) % everyH === 0);
  const feedDayOf = (t, dayH) => { const d = new Date(t); if (d.getHours() < dayH) d.setDate(d.getDate() - 1); return dKey(d); };
  const nextDay = k => { const d = keyDate(k); d.setDate(d.getDate() + 1); return dKey(d); };

  // The schedule values a period holds, derived from config/profile exactly as the app derives them on load.
  function periodFromProfile(p) {
    const s = (p && p.schedule) || {};
    const everyH = [2, 3, 4].includes(+s.everyH) ? +s.everyH : 3, perDay = 24 / everyH;
    const tw = (p && Array.isArray(p.twins)) ? p.twins : [];
    const full = k => { const t = tw[k] || {}; return +t.fullMl || Math.round(150 * t.birthG / 1000 / perDay); };
    return {
      everyH, startH: hrOk(s.startH, 0, 23, 8), dayH: hrOk(s.dayH, 0, 12, 7),
      slotMin: [0, 1].map(k => +((tw[k] || {}).slotMin) === 30 ? 30 : 0),
      full10: [0, 1].map(k => Math.round(full(k) * 10))
    };
  }
  const SCHED_KEYS = ["everyH", "startH", "dayH"];
  const samePeriod = (a, b) => !!a && !!b && SCHED_KEYS.every(k => a[k] === b[k])
    && [0, 1].every(k => a.slotMin[k] === b.slotMin[k] && a.full10[k] === b.full10[k]);

  // Periods ordered by (from, id). The one in effect at t is the last with from ≤ t (ties: greater id wins).
  const cmpId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sortPeriods = ps => ps.slice().sort((a, b) => a.from - b.from || cmpId(a, b));
  function periodAt(sorted, t) { let hit = null; for (const p of sorted) { if (p.from <= t) hit = p; else break; } return hit; }

  // Scheduled occurrences for baby i with start < t ≤ end. Each period generates only within [from, next period's from).
  // Within one period this is exactly the app's grid walk (feed day by feed day, setHours), so DST behaves the same.
  function occurrences(periods, i, start, end) {
    const ps = sortPeriods(periods), out = [];
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k], hi = k + 1 < ps.length ? ps[k + 1].from : Infinity;
      const lo = Math.max(start, p.from - 1), top = Math.min(end, hi - 1);   // t in (lo, top]
      if (top <= lo) continue;
      const hours = slotHours(p.everyH, p.startH, p.dayH);
      let day = feedDayOf(lo + 1, p.dayH); const last = feedDayOf(top, p.dayH);
      for (let guard = 0; day <= last && guard < 400; guard++) {
        for (const h of hours) {
          const d = keyDate(day); d.setHours(h, p.slotMin[i], 0, 0); const t = d.getTime();
          if (t > start && t <= end && t >= p.from && t < hi) out.push({ i, t, S10: p.full10[i], pid: p.id });
        }
        day = nextDay(day);
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // Is t a scheduled occurrence for baby i (under the period in effect at t)? Returns it, or null.
  function occurrenceAt(periods, i, t) {
    const ps = sortPeriods(periods), p = periodAt(ps, t); if (!p) return null;
    return occurrences(ps, i, t - 1, t).find(o => o.t === t) || null;
  }

  // ---------- deterministic split ----------
  // Split S10 (tenths) in proportion to weights w = [mom, donor, formula] (integers ≥ 0, total > 0).
  function split(S10, w) {
    const W = w[0] + w[1] + w[2];
    if (!isInt(S10) || S10 < 0 || !w.every(x => isInt(x) && x >= 0) || !(W > 0)) throw new Error("split: bad input");
    const q = w.map(x => Math.floor(S10 * x / W)), r = w.map(x => (S10 * x) % W);
    const left = S10 - q[0] - q[1] - q[2];
    const order = [0, 1, 2].sort((a, b) => r[b] - r[a] || a - b);
    for (let k = 0; k < left; k++) q[order[k]]++;
    return q;
  }
  const partsOf = m => SRC.map(s => m[s]);

  // ---------- validation (mirrors firestore.rules exactly) ----------
  const keysOnly = (d, ks) => Object.keys(d).every(k => ks.includes(k)) && ks.every(k => k in d);
  const ALLOC_KEYS = ["i", "t", "state", "mL10", "total10", "basis", "rev", "by", "editT", "editBy"];
  function validAlloc(id, d) {
    if (!d || typeof d !== "object" || !keysOnly(d, ALLOC_KEYS)) return false;
    if (!(d.i === 0 || d.i === 1) || !isInt(d.t) || id !== `b${d.i}-${d.t}`) return false;
    if (!isInt(d.rev) || d.rev < 1 || typeof d.by !== "string" || typeof d.editBy !== "string" || typeof d.editT !== "number") return false;
    if (d.state === "usual") return d.mL10 === null && d.total10 === null && d.basis === null;
    if (d.state !== "set") return false;
    const m = d.mL10;
    if (!m || typeof m !== "object" || !keysOnly(m, SRC) || !SRC.every(s => isInt(m[s]) && m[s] >= 0)) return false;
    if (!isInt(d.total10) || d.total10 <= 0 || d.total10 !== m.mom + m.donor + m.formula) return false;
    if (d.basis === "feed") return d.total10 <= 1500;          // = the app's existing 0–150 mL by-mouth entry limit
    return d.basis === "scheduled";
  }
  function validPct(p) {
    return p === null || (!!p && typeof p === "object" && keysOnly(p, SRC)
      && SRC.every(s => isInt(p[s]) && p[s] >= 0 && p[s] <= 100) && p.mom + p.donor + p.formula === 100);
  }
  const USUAL_KEYS = ["i", "from", "pct", "by"];
  function validUsual(id, d) {
    return !!d && typeof d === "object" && keysOnly(d, USUAL_KEYS) && (d.i === 0 || d.i === 1) && isInt(d.from) && d.from >= 0
      && typeof d.by === "string" && validPct(d.pct) && new RegExp(`^u-${d.i}-${d.from}-[a-z0-9]{4}$`).test(id);
  }
  const PERIOD_KEYS = ["from", "everyH", "startH", "dayH", "slotMin", "full10", "src", "by"];
  function validPeriod(id, d) {
    return !!d && typeof d === "object" && keysOnly(d, PERIOD_KEYS) && isInt(d.from) && d.from >= 0
      && [2, 3, 4].includes(d.everyH) && isInt(d.startH) && d.startH >= 0 && d.startH <= 23 && isInt(d.dayH) && d.dayH >= 0 && d.dayH <= 12
      && Array.isArray(d.slotMin) && d.slotMin.length === 2 && d.slotMin.every(m => m === 0 || m === 30)
      && Array.isArray(d.full10) && d.full10.length === 2 && d.full10.every(v => isInt(v) && v > 0)
      && ["setup", "first-use", "observed"].includes(d.src) && typeof d.by === "string"
      && new RegExp(`^s-${d.from}-[a-z0-9]{4}$`).test(id);
  }

  // ---------- history ----------
  // The usual-milk entry in effect for baby i at time t: greatest from ≤ t (ties: greater id). null = none / Not recorded.
  function usualAt(usual, i, t) {
    let hit = null;
    for (const u of usual) if (u.i === i && u.from <= t && (!hit || u.from > hit.from || (u.from === hit.from && u.id > hit.id))) hit = u;
    return hit;
  }

  // ---------- resolving one occurrence ----------
  // 1. a per-feed allocation (state "set") → its proportions; 2. the usual-milk default in effect → its percentages;
  // 3. Not recorded → the whole scheduled amount counts as mother's milk (today's behaviour).
  function resolve(occ, alloc, usual) {
    if (alloc && alloc.state === "set") return { parts: split(occ.S10, partsOf(alloc.mL10)), how: "alloc" };
    const u = usualAt(usual, occ.i, occ.t);
    if (u && u.pct) return { parts: split(occ.S10, partsOf(u.pct)), how: "usual" };
    return { parts: [occ.S10, 0, 0], how: "none" };
  }

  // The estimate over (start, end]: mother's milk charged, with the working by how each occurrence resolved.
  // src = {periods, usual, alloc (map id → doc)}. All sums are integers (tenths).
  function usage(src, start, end) {
    const sum = { n: 0, mom10: 0, donor10: 0, formula10: 0, by: { alloc: { n: 0, mom10: 0 }, usual: { n: 0, mom10: 0 }, none: { n: 0, mom10: 0 } }, sched10: 0 };
    for (const i of [0, 1]) for (const o of occurrences(src.periods, i, start, end)) {
      const r = resolve(o, src.alloc[`b${i}-${o.t}`], src.usual);
      sum.n++; sum.sched10 += o.S10;
      sum.mom10 += r.parts[0]; sum.donor10 += r.parts[1]; sum.formula10 += r.parts[2];
      sum.by[r.how].n++; sum.by[r.how].mom10 += r.parts[0];
    }
    return sum;
  }
  // The next occurrence after `now` (within two feed days) that draws on mother's stock, and how much.
  function nextDraw(src, now) {
    const occ = [0, 1].flatMap(i => occurrences(src.periods, i, now, now + 2 * 864e5)).sort((a, b) => a.t - b.t || a.i - b.i);
    for (const o of occ) { const r = resolve(o, src.alloc[`b${o.i}-${o.t}`], src.usual); if (r.parts[0] > 0) return { t: o.t, i: o.i, mom10: r.parts[0] }; }
    return null;
  }
  // Need / day (mother's milk): the current period's scheduled amount × feeds per day × the current default share.
  function needPerDay10(src, now) {
    const p = periodAt(sortPeriods(src.periods), now); if (!p) return 0;
    const perDay = 24 / p.everyH;
    return [0, 1].reduce((a, i) => { const u = usualAt(src.usual, i, now);
      return a + perDay * (u && u.pct ? split(p.full10[i], partsOf(u.pct))[0] : p.full10[i]); }, 0);
  }

  // ---------- reconciliation and housekeeping ----------
  // An allocation reconciles when its parts total exactly its reference: the logged by-mouth amount (basis feed) or the
  // occurrence's scheduled amount (basis scheduled). A mismatch is reported, never silently "fixed".
  function reference(occ, feedV) { return feedV > 0 ? { basis: "feed", total10: Math.round(feedV * 10) } : { basis: "scheduled", total10: occ.S10 }; }
  const reconciles = (alloc, ref) => !!alloc && alloc.state === "set" && alloc.basis === ref.basis && alloc.total10 === ref.total10;
  // After a feed edit, a single-source allocation follows the new reference (unambiguous: 100% of one source);
  // a mixed one is left alone and shows as a mismatch. Returns the new mL10 / basis / total10, or null for "leave it".
  function follow(alloc, ref) {
    if (!alloc || alloc.state !== "set" || reconciles(alloc, ref)) return null;
    const nz = SRC.filter(s => alloc.mL10[s] > 0); if (nz.length !== 1) return null;
    const mL10 = { mom: 0, donor: 0, formula: 0 }; mL10[nz[0]] = ref.total10;
    return { mL10, total10: ref.total10, basis: ref.basis };
  }
  // Allocations whose (i, t) is no longer a scheduled occurrence (a schedule change removed that feed time):
  // kept, never counted, listed for the parent. A later change that restores the time counts them again.
  const stranded = src => Object.entries(src.alloc).filter(([, a]) => a && a.state === "set" && !occurrenceAt(src.periods, a.i, a.t)).map(([id]) => id);
  // Undo of a usual-milk entry may delete it only when no occurrence for that baby fell in [from, now];
  // otherwise it must append an entry restoring the previous setting, so no estimate already shown changes.
  const undoCanDelete = (src, entry, now) => occurrences(src.periods, entry.i, entry.from - 1, now).length === 0;
  // The profile's schedule no longer matches the period in effect (a phone on an older app version changed it).
  // Reported only — the effective time is never assumed.
  function drift(src, profile, now) {
    if (!src.periods.length) return null;
    const cur = periodAt(sortPeriods(src.periods), now), want = periodFromProfile(profile);
    return cur && !samePeriod(cur, want) ? { inEffect: cur, profile: want } : null;
  }
  // Milk-source tracking may begin only once every current member's phone runs a version that understands it.
  const allReady = (memberUids, clients, v) => memberUids.length > 0 && memberUids.every(u => clients[u] && isInt(clients[u].v) && clients[u].v >= v);

  const api = { SRC, slotHours, periodFromProfile, samePeriod, sortPeriods, periodAt, occurrences, occurrenceAt, split,
    validAlloc, validPct, validUsual, validPeriod, usualAt, resolve, usage, nextDraw, needPerDay10,
    reference, reconciles, follow, stranded, undoCanDelete, drift, allReady, CLIENT_V: 1 };
  if (typeof module === "object" && module.exports) module.exports = api; else root.MilkSources = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);
