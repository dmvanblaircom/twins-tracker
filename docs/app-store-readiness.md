# NICUlog — App Store readiness (Phase 6)

Status: **ready to submit except for the steps that need an Apple Developer account** (Nov 20, 2026). Nothing is published. This page lists what is done, the listing and privacy answers to paste into App Store Connect, and the exact steps for the day the account exists.

## 1. Done in the repo
| Item | Where |
|---|---|
| Name **NICUlog** everywhere users see it (title, sign-in, home-screen name, privacy page, iOS display name). Internal identifiers unchanged: backup `app` tag `twins-tracker` (restore also accepts `niculog`), localStorage keys, Firebase project id. | `index.html`, `manifest.webmanifest`, `privacy.html`, `native/` |
| Bundle ID **`app.niculog.ios`** (permanent once uploaded). | `native/capacitor.config.json`, `native/ios/App/App.xcodeproj/project.pbxproj` |
| App icon 1024 px and launch screen. | `native/ios/App/App/Assets.xcassets` |
| Camera and photo-library permission text. | `native/ios/App/App/Info.plist` |
| Backups in the iOS app: written to a file and handed to the share sheet (Files, AirDrop, Mail) with `@capacitor/filesystem` + `@capacitor/share` 6.0.4. | `index.html` (`bkGo`), `native/package.json`, `native/ios/App/Podfile` |
| Offline in the iOS app: Chart.js and Firebase bundled locally. | `native/build.mjs` |
| Firebase App Check wired but **off** (no key set; enforcement off in the console, so nothing can lock you out). | `firebase-config.js` (`appCheck`), `firebase-store.js` |
| In-app account deletion (Apple requires it): More → Settings → Family → Delete my account. | already shipped |
| Privacy policy covers accounts, family data, check-ins, support resources and photos. | `privacy.html` |

## 2. Still needs you (before submitting)
1. **Support email.** `privacy.html` still says `SUPPORT_EMAIL`. Send me the dedicated address and I'll put it in; it is public.
2. **Apple Developer Program enrollment** (Apple's annual fee). Choose carefully:
   - **Individual:** fastest. The App Store shows **your legal name** as the seller.
   - **Organization** (e.g. an LLC): the store shows the organization's name; needs a D-U-N-S number, which takes longer.
3. **Name check.** No app called "NICUlog" turned up in a web search (Nov 19, 2026); similar names exist (NICU Navigator, NICU Companion, NICUTracker). Before relying on it: search the USPTO trademark database, then create the App Store Connect record, which reserves the name.
4. **Firebase sign-up.** New families (and Apple's reviewer) need Email/Password sign-up switched on in Firebase Authentication. Your own accounts are unaffected.
5. **Free-plan capacity (D2, Spark).** 1 GB of storage and daily read/write quotas are shared by every family. Fine for your family; if other families join, photos will reach the limit first. Decide before going public: stay small, or move to pay-as-you-go.

## 3. The day you have the account (with a Mac)
1. Xcode → `native/ios/App/App.xcworkspace` → Signing & Capabilities → choose your Team. Bundle ID is already `app.niculog.ios`.
2. In `native/`: `npm install`, `npm run sync`, then `cd ios/App && pod install` (CocoaPods; needs the Mac). This links the Filesystem and Share plugins.
3. App Store Connect → My Apps → **+** → New App: name NICUlog, bundle ID `app.niculog.ios`, primary language English (U.S.). This reserves the name.
4. **App Check (optional but recommended before other families join):**
   - Firebase console → Project settings → add an **iOS app** with bundle ID `app.niculog.ios`; download `GoogleService-Info.plist` into `native/ios/App/App/`.
   - Add the `@capacitor-firebase/app-check` plugin (App Attest provider) and enable **App Attest** in Firebase App Check for the iOS app (needs your Apple Team ID).
   - Web app: create a reCAPTCHA v3 key for the GitHub Pages domain and register it in Firebase App Check.
   - Set `appCheck` in `firebase-config.js`, ship it, watch the App Check metrics show verified requests for a week, **then** turn on enforcement for Firestore. Enforcing earlier would lock out phones on the old version.
   - The app code expects the plugin under `Capacitor.Plugins.FirebaseAppCheck` with `getToken({forceRefresh}) → {token, expireTimeMillis}`; confirm against the plugin version you install.
5. On a real iPhone (Xcode → Run): sign in, offline entry and sync, camera and library photos, backup → share sheet → Files, restore, delete account on a test account.
6. Product → Archive → Distribute → App Store Connect → **TestFlight** first; both of you use it for a few days.
7. Fill in the listing (§4), privacy answers (§5), and review notes (§6); add screenshots (`tests/screens.js` makes iPhone-size ones with fictional babies); submit for review.

## 4. Listing draft
- **Name:** NICUlog
- **Subtitle (≤30):** Feeds, growth & NICU journey
- **Category:** Health & Fitness (primary), Lifestyle (secondary). Not Medical: the app records what the family enters and never gives clinical advice.
- **Description:**
  > NICUlog helps parents of twins in the NICU keep track of the days together.
  > Log each feed by mouth in a tap, record the nightly weight, and see both babies' progress at a glance. Track pumping and milk dropped off at the NICU, with an estimate of what's left. Keep questions for rounds and the plan from rounds in one place. Save the moments you want to remember — first hold, first bath, coming home — with photos.
  > Both parents share one family: each signs in on their own phone and sees the same records, even with no signal.
  > Private check-ins and support resources are there for you, too. Your check-ins stay private unless you choose to share one.
  > NICUlog is a family record, not medical advice. Your NICU team's charting and orders are the source of truth.
- **Keywords (≤100 chars):** `NICU,twins,preemie,feeding,tracker,baby weight,pumping,breast milk,milestones,journal`
- **Support URL / marketing URL:** the GitHub Pages address (or a simple page with the support email).
- **Privacy policy URL:** the published `privacy.html`.

## 5. App Privacy answers (App Store Connect)
- **Tracking:** No. No data is used to track people across apps or websites; no advertising or analytics SDKs.
- **Data collected** (all *linked to the user*, purpose **App Functionality** only):
  | Apple category | What |
  |---|---|
  | Contact Info → Email Address | sign-in email; shown to family members as who entered a record |
  | Health & Fitness → Health | babies' feeds, weights, notes, milk records; your check-ins |
  | User Content → Photos or Videos | photos added to moments (resized; location and camera details removed) |
  | User Content → Other User Content | journal entries, moments, questions, plans, check-in notes |
  | Identifiers → User ID | the Firebase account ID |
- **Not collected:** location, contacts, browsing or search history, purchases, financial info, usage data, diagnostics (no crash reporting or analytics).

## 6. Notes for Apple's reviewer
- Provide a **demo account** already in a family with fictional babies and a week of fictional data (never real data). Create it with sign-up on, or in the Firebase console.
- Explain: the app is for two parents of twins sharing one family; the second parent joins with an invite code (More → Settings → Family). Offline works; data syncs when back online.
- Account deletion: More → Settings → Family → Delete my account.
- The app does not provide medical advice; Progress shows family tracking indicators, not discharge criteria.
- Likely questions and our answers:
  - *Guideline 4.2 (minimum functionality, web wrapper):* works offline with local data, camera and photo library, native share sheet for backups, multi-device family sync.
  - *Health data:* nothing goes to Apple Health or third parties; data is used only to show the family their own records.
