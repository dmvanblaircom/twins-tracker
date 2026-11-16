// Mutation checks for the milk-source rules: weaken one protection at a time and prove sources.rules.test.js catches it.
// Runs inside the emulator (npm test). Each mutation must make at least one test fail; an un-caught mutation fails this run.
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const RULES = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
const M = [
  ["parts must total the stored total", "&& d.total10 == d.mL10.mom + d.mL10.donor + d.mL10.formula", ""],
  ["allocation total must be > 0", "&& d.total10 > 0", ""],
  ["parts must be ≥ 0", "&& m.mom >= 0 && m.donor >= 0 && m.formula >= 0", ""],
  ["parts must be integers", "&& m.mom is int && m.donor is int && m.formula is int", ""],
  ["feed basis ≤ 150 mL (the entry limit)", "(d.basis == 'feed' && d.total10 <= 1500)", "(d.basis == 'feed')"],
  ["allocation id = (baby, time)", "&& id == 'b' + string(d.i) + '-' + string(d.t)", ""],
  ["allocation fields only", "&& d.keys().hasOnly(['i', 't', 'state', 'mL10', 'total10', 'basis', 'rev', 'by', 'editT', 'editBy'])", ""],
  ["rev = stored + 1", "&& request.resource.data.rev == resource.data.rev + 1", ""],
  ["editBy = the signer on change", "&& request.resource.data.editBy == request.auth.token.email.lower()", ""],
  ["usual milk totals exactly 100", "&& d.pct.mom + d.pct.donor + d.pct.formula == 100", ""],
  ["usual-milk id matches", "&& id.matches('u-' + string(d.i) + '-' + string(d.from) + '-[a-z0-9]{4}')", ""],
  ["usual milk is append-only", "allow create: if inFamily(hid) && validUsual(uid, request.resource.data);", "allow create, update: if inFamily(hid) && validUsual(uid, request.resource.data);"],
  ["periods are append-only", "allow create: if inFamily(hid) && validPeriod(pid, request.resource.data);", "allow create, update: if inFamily(hid) && validPeriod(pid, request.resource.data);"],
  ["period interval is 2, 3 or 4 h", "&& d.everyH in [2, 3, 4]", ""],
  ["period offsets are 0 or 30", "&& d.slotMin[0] in [0, 30] && d.slotMin[1] in [0, 30]", ""],
  ["clients: only your own marker", "allow create, update: if inFamily(hid) && request.auth.uid == cuid", "allow create, update: if inFamily(hid)"],
  ["catch-all excludes slotMilk", "'events', 'slotMilk',", "'events',"],
  ["allocations: members only", "match /slotMilk/{aid} {\n        allow read, delete: if inFamily(hid);", "match /slotMilk/{aid} {\n        allow read, delete: if true;"]
];
const run = file => { const r = spawnSync(process.execPath, [path.join(__dirname, "sources.rules.test.js")], { env: { ...process.env, ...(file ? { RULES_FILE: file } : {}), QUIET: "1" }, encoding: "utf8" });
  return { status: r.status, failed: new Set((r.stdout.match(/^✗ .*$/gm) || []).map(l => l.split(" — ")[0])) }; };
// The unmodified rules must pass every test first; a mutation then counts as caught only by tests it newly breaks.
const baseline = run(null);
if (baseline.status !== 0 || baseline.failed.size) { console.log("✗ baseline: the real rules don't pass sources.rules.test.js", [...baseline.failed]); process.exit(1); }
console.log("✓ baseline: the real rules pass every milk-source rules test");
let caught = 0, missed = [];
for (const [name, from, to] of M) {
  if (!RULES.includes(from)) { missed.push(`${name} (pattern not found — update mutate.js)`); continue; }
  const f = path.join(os.tmpdir(), `rules-mut-${caught + missed.length}.rules`); fs.writeFileSync(f, RULES.replace(from, to));
  const r = run(f), failed = [...r.failed];
  if (r.status !== 0 && failed.length) { caught++; console.log(`✓ mutation caught: ${name} — ${failed.length} test(s) now fail, e.g. "${failed[0].slice(2, 90)}"`); }
  else { missed.push(name); console.log(`✗ mutation NOT caught: ${name}`); }
}
console.log(`\n${caught} of ${M.length} mutations caught`);
process.exit(missed.length ? 1 : 0);
