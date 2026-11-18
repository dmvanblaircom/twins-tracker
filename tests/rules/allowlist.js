// The original family's allowlist lives in Firestore (admin/allowlist), not in firestore.rules. The emulator tests seed it
// with the same fictional placeholder emails the rules file used to carry. Never put real emails here.
const { doc, setDoc } = require("firebase/firestore");
const TEST_ALLOWLIST = ["parent1@example.com", "parent2@example.com"];
const seedAllowlist = env => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "admin/allowlist"), { emails: TEST_ALLOWLIST }));
module.exports = { TEST_ALLOWLIST, seedAllowlist };
