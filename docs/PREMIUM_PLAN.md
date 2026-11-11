# Premium: plan and state

Decided by the author (2026-11-11):

- **Free:** the simulator, the tutorial, and the daily ECG (rated; the rating is shown as provisional until 20 rated
  ECGs). Free users see their rating and title on Training's home only: Statistics and the skill ratings are locked.
- **Training, $9.99 one-time** (a non-consumable Google Play product): Train, practice by skill, Reviews.
- **Later add-ons**, each its own one-time product: pacemakers, pharmaceuticals, lessons.
- **Website** (ecgstudio.app/training): locked the same way once billing is live; the daily ECG stays as the teaser that
  points to the app.

## State (Round 62)

- In `src/training.js`, behind a switch that is **off by default** (`ecgstudio.premiumPreview`; `?premium=1` in the
  address turns it on for that device, `?premium=0` off). Off: everything as before (nothing locked, the daily ECG not
  rated), so the branch can be merged at any time.
- On: Train, the skills, Reviews and Statistics show a lock and open the unlock page (`#paywall`, with the logo); the
  skill buttons show no ratings; the daily ECG is rated (the day's
  first answer only); the home rating reads "Rating · provisional" below 20 rated ECGs; no Train ECGs are made in the
  background while locked.
- The purchase is a stand-in: "Unlock Training" unlocks this device (`ecgstudio.owned.training`); opening the
  `?premium=1` link again locks it again. "Restore purchase" is a placeholder.

## Billing (Round 63)

- Plugin `@capgo/native-purchases` (Capacitor 8; Google Play Billing 9.1; acknowledges purchases itself). The shell
  (`src/shell.html`) owns it: on start and on every return to the app it lists the account's purchases
  (`getPurchases`, state 1 = purchased; 2 = payment pending, not owned yet) and the local prices (`getProducts`), keeps
  what is owned on the phone (`ecgApp.ents`, for starts without a connection) and sends it to the modules (`ents`). The
  modules ask to `buy` (Google Play's own sheet) or `restore`; the answers are `bought` and `restored`.
- Products, by module: `training` → Play product id **`training`** (one-time, $9.99). A new module adds a line to
  `PRODUCTS` in the shell.
- Training: in the app, what Play says decides; the price shown is Play's, in the local currency. On the website, with
  premium on for everyone, the unlock button reads "Get ECG Studio on Google Play" (the store page); previews
  (`?premium=1`) keep the stand-in purchase.
- **Premium for everyone:** `"premium": true` in `site.json` (now false), then rebuild: the build writes it into
  Training (`<meta name="premium">`).
- **Debug builds own everything:** `app/android/app/src/debug/assets/public/dev-unlock.json` exists only in debug APKs;
  the shell finds it and treats every product as owned. Play builds (release AABs) never have it.
- No server-side receipt check (a one-time purchase on one platform; Play's own records are the check).

## For the author (Play Console), before testing purchases

1. Upload a release AAB that contains billing (any build from Round 63 on) to the closed test track: Play only lets you
   create in-app products once an uploaded build uses billing.
2. Monetize → Products → In-app products → Create product: product id `training` (it cannot be changed later), name
   "ECG Studio Training", a description, price $9.99 (Play converts other countries), Activate.
3. Settings → License testing: add your own and each tester's Google account; License response "RESPOND_NORMALLY".
4. Set `"premium": true` in `site.json` when you want the lock on for everyone (testers included), and release a new
   build. Until then nothing is locked.

## Testing without paying (the author and the testers)

- **Until billing ships:** nothing is locked unless a preview turns it on. No change for testers.
- **Builds from Google Play (closed test, later production): license testers.** Add each tester's Google account under
  Play Console → Settings → License testing. On "Unlock Training" they see Google's purchase sheet with a test card
  ("Test card, always approves"): one tap, no charge, and the purchase stays with their account (reinstalls and new
  phones restore it). This is the only bypass that is safe in a store build.
- **The author's own debug APKs** (the workflow's artifact): everything owned automatically (the debug-only marker
  file). The preview links keep the stand-in purchase, so the paywall can still be seen there.
- **Not used:** secret codes or hidden switches in store builds (they leak), and a "tester build" with Training
  unlocked (the AAB tested in the closed track is the one promoted to production).
