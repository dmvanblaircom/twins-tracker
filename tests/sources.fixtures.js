// Milk-source documents that must be accepted or refused. Used by BOTH tests/sources.unit.js (the app's validators in
// milk-sources.js) and tests/rules/sources.rules.test.js (firestore.rules on the emulator), so the two can't drift apart.
// Synthetic values only.
const T = 1771000000000;                        // an occurrence time (fictional)
const E = "parent1@example.com";
const alloc = (o = {}) => ({ i: 0, t: T, state: "set", mL10: { mom: 300, donor: 100, formula: 50 }, total10: 450, basis: "feed",
  rev: 1, by: E, editT: T, editBy: E, ...o });
const usual = (o = {}) => ({ i: 1, from: T, pct: { mom: 60, donor: 40, formula: 0 }, by: E, ...o });
const period = (o = {}) => ({ from: 0, everyH: 3, startH: 8, dayH: 7, slotMin: [0, 30], full10: [490, 530], src: "first-use", by: E, ...o });
const without = (d, k) => { const c = { ...d }; delete c[k]; return c; };

module.exports = {
  T, E, alloc, usual, period,
  allocOk: [
    ["mixed feed, basis feed (30/10/5 of a 45 mL feed)", `b0-${T}`, alloc()],
    ["single source, basis scheduled", `b1-${T}`, alloc({ i: 1, mL10: { mom: 0, donor: 600, formula: 0 }, total10: 600, basis: "scheduled" })],
    ["back to usual milk", `b0-${T}`, alloc({ state: "usual", mL10: null, total10: null, basis: null })],
    ["feed basis at the 150 mL entry limit", `b0-${T}`, alloc({ mL10: { mom: 1500, donor: 0, formula: 0 }, total10: 1500 })],
    ["scheduled basis above 150 mL (no cap of its own)", `b0-${T}`, alloc({ mL10: { mom: 1700, donor: 100, formula: 0 }, total10: 1800, basis: "scheduled" })],
    ["restored with a later rev", `b0-${T}`, alloc({ rev: 7 })]
  ],
  allocBad: [
    ["a negative part", `b0-${T}`, alloc({ mL10: { mom: 350, donor: -50, formula: 150 }, total10: 450 })],
    ["a non-integer part", `b0-${T}`, alloc({ mL10: { mom: 300.5, donor: 99.5, formula: 50 }, total10: 450 })],
    ["total doesn't equal the parts", `b0-${T}`, alloc({ total10: 460 })],
    ["zero total", `b0-${T}`, alloc({ mL10: { mom: 0, donor: 0, formula: 0 }, total10: 0 })],
    ["feed basis over the 150 mL entry limit", `b0-${T}`, alloc({ mL10: { mom: 1510, donor: 0, formula: 0 }, total10: 1510 })],
    ["unknown basis", `b0-${T}`, alloc({ basis: "guess" })],
    ["unknown state", `b0-${T}`, alloc({ state: "maybe" })],
    ["usual state still carrying amounts", `b0-${T}`, alloc({ state: "usual" })],
    ["an extra field", `b0-${T}`, alloc({ note: "x" })],
    ["an extra source", `b0-${T}`, alloc({ mL10: { mom: 300, donor: 100, formula: 50, other: 0 } })],
    ["a missing source", `b0-${T}`, alloc({ mL10: { mom: 400, donor: 50 } })],
    ["a missing field (rev)", `b0-${T}`, without(alloc(), "rev")],
    ["rev 0", `b0-${T}`, alloc({ rev: 0 })],
    ["baby index not 0/1", `b2-${T}`, alloc({ i: 2 })],
    ["non-integer time", `b0-${T}.5`, alloc({ t: T + 0.5 })],
    ["id doesn't match (baby)", `b1-${T}`, alloc()],
    ["id doesn't match (time)", `b0-${T + 1}`, alloc()]
  ],
  usualOk: [
    ["60 / 40 / 0", `u-1-${T}-ab12`, usual()],
    ["0 / 0 / 100", `u-1-${T}-zz00`, usual({ pct: { mom: 0, donor: 0, formula: 100 } })],
    ["Not recorded from here on", `u-1-${T}-a0a0`, usual({ pct: null })]
  ],
  usualBad: [
    ["totals 99", `u-1-${T}-ab12`, usual({ pct: { mom: 59, donor: 40, formula: 0 } })],
    ["totals 101", `u-1-${T}-ab12`, usual({ pct: { mom: 61, donor: 40, formula: 0 } })],
    ["a share over 100 (with a negative)", `u-1-${T}-ab12`, usual({ pct: { mom: 120, donor: -20, formula: 0 } })],
    ["a fractional share", `u-1-${T}-ab12`, usual({ pct: { mom: 60.5, donor: 39.5, formula: 0 } })],
    ["an extra field", `u-1-${T}-ab12`, usual({ note: "x" })],
    ["id doesn't match from", `u-1-${T + 1}-ab12`, usual()],
    ["id doesn't match baby", `u-0-${T}-ab12`, usual()],
    ["baby index not 0/1", `u-2-${T}-ab12`, usual({ i: 2 })]
  ],
  periodOk: [
    ["first-use period", "s-0-ab12", period()],
    ["setup period", `s-${T}-q9w8`, period({ from: T, everyH: 2, startH: 6, dayH: 0, slotMin: [30, 30], full10: [450, 455], src: "setup" })],
    ["observed period", `s-${T}-0000`, period({ from: T, src: "observed" })]
  ],
  periodBad: [
    ["every 5 h", "s-0-ab12", period({ everyH: 5 })],
    ["start hour 24", "s-0-ab12", period({ startH: 24 })],
    ["day start 13", "s-0-ab12", period({ dayH: 13 })],
    ["slot offset 15", "s-0-ab12", period({ slotMin: [0, 15] })],
    ["three babies' offsets", "s-0-ab12", period({ slotMin: [0, 30, 0] })],
    ["zero scheduled amount", "s-0-ab12", period({ full10: [0, 530] })],
    ["fractional scheduled amount", "s-0-ab12", period({ full10: [490.5, 530] })],
    ["unknown src", "s-0-ab12", period({ src: "guess" })],
    ["an extra field", "s-0-ab12", period({ note: "x" })],
    ["id doesn't match from", "s-5-ab12", period()]
  ]
};
