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

## Next

1. Google Play billing in the app (a Capacitor in-app purchase plugin; the shell talks to it, as for sharing): buy,
   restore on start and from the unlock page, the entitlement kept on the phone and re-checked with Play.
2. Products in the Play Console (`training` first; one id per future module), prices, and the store listing's
   "In-app purchases" flag.
3. The website's Training locked; the daily ECG there points to the app.
4. Turn the switch on for everyone.

## Testing without paying (the author and the testers)

- **Until billing ships:** nothing is locked unless a preview turns it on. No change for testers.
- **Builds from Google Play (closed test, later production): license testers.** Add each tester's Google account under
  Play Console → Settings → License testing. On "Unlock Training" they see Google's purchase sheet with a test card
  ("Test card, always approves"): one tap, no charge, and the purchase stays with their account (reinstalls and new
  phones restore it). This is the only bypass that is safe in a store build.
- **The author's own debug APKs and the preview links** (raw.githack, ecgstudio.app/app before launch, `file://`):
  unlocked automatically, so development never meets the purchase sheet (planned with the billing step).
- **Not used:** secret codes or hidden switches in store builds (they leak), and a "tester build" with Training
  unlocked (the AAB tested in the closed track is the one promoted to production).
