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
  ["allocations: members only", "match /slotMilk/{aid} {\n        allow read, delete: if inFamily(hid);", "match /slotMilk/{aid} {\n        allow read, delete: if true;"],
  // Activation (config/sources). Not listed: requiring member(hid) rather than inFamily(hid) on create is an
  // equivalent mutant (accountReady already forces the signer to be a member); it's kept as defence in depth.
  ["activation: each named account must be a member", "return exists(/databases/$(database)/documents/households/$(hid)/members/$(u))\n        && ", "return "],
  ["activation: each named account's marker must be current", ".data.v >= 1;\n    }", ".data.v >= 0;\n    }"],
  ["activation: the signer must be named", " && request.auth.uid in d.phones", ""],
  ["activation: the second named account is checked", "&& (d.phones.size() < 2 || accountReady(hid, d.phones[1]))", ""],
  ["activation: by = the signer", "&& d.on == true && d.t is number && d.by == request.auth.token.email.lower()", "&& d.on == true && d.t is number"],
  ["activation: exact fields", "&& d.keys().hasOnly(['on', 't', 'by', 'phones'])", ""],
  ["activation: at most 4 accounts", "&& d.phones.size() <= 4", ""],
  ["activation: create-only", "allow create: if member(hid) && validActivation", "allow create, update: if member(hid) && validActivation"],
  ["activation: only members delete it", "allow delete: if inFamily(hid);\n      }\n      // Which app version", "allow delete: if true;\n      }\n      // Which app version"],
  ["config writes exclude the activation", "allow write: if inFamily(hid) && cfg != 'sources';", "allow write: if inFamily(hid);"],
  ["catch-all excludes config", "'clients', 'config']) && inFamily(hid);", "'clients']) && inFamily(hid);"],
  ["membership: the email is the signer's own", "&& d.email == request.auth.token.email.lower() && ", "&& "],
  ["membership: exact fields", "&& d.keys().hasOnly(['email', 't', 'code'])", ""],
  // Not listed: dropping hasAll(['email']) is an equivalent mutant (the email comparison reads the missing field and denies).
  ["membership: the time is a number", " && (!('t' in d) || d.t is number);", ";"],
  ["membership: the check applies to every join path", "request.auth.uid == uid && validMember(request.resource.data) && (", "request.auth.uid == uid && ("],
  ["allowlist: membership of the list is checked", "return exists(list) && request.auth.token.email.lower() in get(list).data.emails;", "return exists(list);"],
  ["allowlist: no client reads it", "match /admin/{doc} {\n      allow read, write: if false;", "match /admin/{doc} {\n      allow read: if true;\n      allow write: if false;"],
  ["allowlist: no client writes it", "match /admin/{doc} {\n      allow read, write: if false;", "match /admin/{doc} {\n      allow read: if false;\n      allow write: if true;"],
  // Not listed: dropping exists(list) is an equivalent mutant (get() of a missing document fails, which denies).
  ["photos: the full image is written with the metadata", "        && existsAfter(/databases/$(database)/documents/households/$(hid)/photoData/$(pid))\n", ""],
  ["photos: the moment must exist", "&& d.ev is string && exists(/databases/$(database)/documents/households/$(hid)/events/$(d.ev))", "&& d.ev is string"],
  ["photos: exact fields", "&& d.keys().hasOnly(['ev', 't', 'w', 'h', 'bytes', 'thumb', 'by'])", ""],
  ["photos: at most 1600 px", "&& d.w <= 1600 && d.h <= 1600", ""],
  ["photos: thumbnail ≤ 100 KB", "&& d.thumb.size() <= 102400", ""],
  ["photos: full image ≤ 900 KB", "&& d.full.size() <= 921600", ""],
  ["photos: by = the signer", "&& d.thumb.size() > 0 && d.thumb.size() <= 102400\n        && d.by == request.auth.token.email.lower();", "&& d.thumb.size() > 0 && d.thumb.size() <= 102400;"],
  ["photos: only the delete marker changes", "request.resource.data.diff(resource.data).affectedKeys().hasOnly(['deletedT'])", "true"],
  ["photos: members only", "match /photos/{pid} {\n        allow read, delete: if inFamily(hid);", "match /photos/{pid} {\n        allow read, delete: if true;"],
  ["photo data: members only", "match /photoData/{pid} {\n        allow read, delete: if inFamily(hid);", "match /photoData/{pid} {\n        allow read, delete: if true;"],
  ["photo data: never edited", "allow create: if inFamily(hid) && validPhotoData(pid, request.resource.data);", "allow create, update: if inFamily(hid) && validPhotoData(pid, request.resource.data);"],
  ["catch-all excludes photos", "'revoked', 'photos', 'photoData', 'events',", "'revoked', 'events',"],
  ["other config stays members-only", "match /config/{cfg} {\n        allow read: if inFamily(hid);", "match /config/{cfg} {\n        allow read: if true;"]
];
const run = file => { const r = spawnSync(process.execPath, [path.join(__dirname, "sources.rules.test.js")], { env: { ...process.env, ...(file ? { RULES_FILE: file } : {}), QUIET: "1" }, encoding: "utf8" });
  return { status: r.status, failed: new Set((r.stdout.match(/^✗ .*$/gm) || []).map(l => l.split(" — ")[0])) }; };
// The unmodified rules must pass every test first; a mutation then counts as caught only by tests it newly breaks.
const baseline = run(null);
if (baseline.status !== 0 || baseline.failed.size) { console.log("✗ baseline: the real rules don't pass sources.rules.test.js", [...baseline.failed]); process.exit(1); }
console.log("✓ baseline: the real rules pass every milk-source rules test");
let caught = 0, missed = [];
for (const [name, from, to] of M) {
  if (!RULES.includes(from)) { missed.push(`${name} (pattern not found — update mutate.js)`); console.log(`✗ mutation pattern NOT FOUND: ${name} — update mutate.js`); continue; }
  const f = path.join(os.tmpdir(), `rules-mut-${caught + missed.length}.rules`); fs.writeFileSync(f, RULES.replace(from, to));
  const r = run(f), failed = [...r.failed];
  if (r.status !== 0 && failed.length) { caught++; console.log(`✓ mutation caught: ${name} — ${failed.length} test(s) now fail, e.g. "${failed[0].slice(2, 90)}"`); }
  else { missed.push(name); console.log(`✗ mutation NOT caught: ${name}`); }
}
console.log(`\n${caught} of ${M.length} mutations caught`);
process.exit(missed.length ? 1 : 0);
