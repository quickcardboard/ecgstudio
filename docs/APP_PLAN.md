# ECG Studio app: plan (Android first, Capacitor)

Draft for the author's review, 2026-11-07. Decisions already made are marked **Decided**. The questions for the author
are at the end, and phase 0 needs those answers. Nothing here is built yet.

## Decided

- **Wrapper: Capacitor.** One web codebase in a native shell. Google Play first; iOS much later (no iPhone to test on yet).
- **Free:** the simulator, the training statistics and the daily ECG.
- **Premium (one-time purchase):** Training mode. Later modules (lessons, pacemaker, ...) are separate one-time purchases on top of the free simulator.
- **Payment:** Google Play Billing.
  - A new device restores purchases through the Google Play account, so no user accounts or our own codes are needed.
  - Testers get Play Console promo codes.
- **Orientation:** portrait only, phones and tablets. Tablets should show the whole 12-lead without paging if there is room.
- **The app does not need the simulator's desktop layout.**
- **V6 / chest-lead engine work waits** until after the app work (Round 47 is a bandage; reminder set for 2026-11-14).

## Branch, not a new repository (recommendation)

Work on a new branch **`app-1`** cut from `milestone-1`, in this repository, with the native project under `app/`.

- **One engine.** The app wraps the same engine, training generator and build. A second repository would fork them, and every engine fix
  (most of the work so far) would have to be copied by hand.
- **Fits the existing conventions** (CLAUDE.md): feature work on a branch, `origin/milestone-1` merged in to keep it current,
  and a pull request into `milestone-1` when shared code is ready.
- **The live site is unaffected.** It serves `index.html` and `training/index.html`; an `app/` folder is not part of it.
- **Secrets stay out of git.** The upload keystore and passwords are kept outside the repository (GitHub Pages sites are usually
  public repositories). Play App Signing holds the real signing key.

A separate repository would only be worth it if the app's code had to stay private while the site's repository is public.
If so, say so: a private repository can pull this one in as a submodule.

## Architecture

### One app shell with modules

Today the simulator (`index.html`, 3.7 MB) and Training (`training/index.html`, 3.0 MB) are separate pages, each carrying its own
copy of the engine and anatomy. The app gets one shell page:

- **Shell:** start screen, shared top toolbar, menu (Help, Tutorial, Settings, About, Restore purchases), entitlement service, router.
- **Modules,** each registered with `{ id, title, icon, entitlement: 'free' | productId, mount(el), unmount(), help, tutorial }`:
  - `simulator`: free.
  - `training`: Train, Reviews and the skill drills are premium. Daily ECG and Statistics are free.
  - Later: `lessons`, `pacemaker` (each its own Play product).
- **Shared:** the engine, anatomy and torso data loaded once; the training worker created on demand; one theme
  (tokens from the training page: dark, IBM Plex).
- **Build:** a new `python3 tools/build.py --app` writes `app/www/` (the shell, modules, local fonts, icons). The web builds stay as they are.

### Entitlements

- **Interface:** `entitlements.has(id)`, `entitlements.buy(id)`, `entitlements.restore()`, and an event when they change.
- **Android:** a Capacitor billing plugin. The candidate is `cordova-plugin-purchase` (CdvPurchase, works in Capacitor, no server
  needed); `@capgo/native-purchases` is the alternative. Each module is one non-consumable product.
  - Purchases are queried at start-up and on "Restore purchases".
  - The result is cached locally, so the app works offline.
- **Web and development:** everything unlocked (as the testers have it now), or a `?unlock=` flag for testing the locked screens.
- **Promo codes:** redeemed in the Play Store app; the purchase then shows up through the same query.
- **No receipt server at first.** A local check suits a small one-time purchase without accounts; a server can be added later.

### Offline and the WebView

- **Fonts:** the Google Fonts link becomes local font files in `app/www` (the app must work offline).
- **Workers:** the training workers already come from a Blob URL (works in the Android WebView).
- **Service worker:** `sw.js` is not needed inside the app.
- **Edge-to-edge:** Android 15+ draws edge-to-edge. The WebView needs the system-bar insets as CSS variables
  (a safe-area plugin or a small native snippet). The layout uses `env(safe-area-inset-*)` today; switch to `var(--inset-*)` fed by
  the plugin, falling back to `env()`.
- **Performance:** check a low-end Android phone (the engine is heavy, Training uses two workers). Adapt the worker count to the device's memory.

## Phases

Rough sizes are working sessions. Each phase ends with a phone test (and a tablet test where it applies) and the author's review.

| # | Phase | What it delivers | Done when |
|---|---|---|---|
| 0 | Decisions and design | Answers to the questions below; the author's mock-ups (start screen, toolbar, simulator phone layout, tablet) | Mock-ups agreed |
| 1 | Shell and modules (2–3) | `app-1` branch; one shell page; module registry; simulator and training mounted as modules; shared toolbar; `build.py --app` | Both modules run in one page in a phone browser |
| 2 | Start screen and toolbar (1–2) | Equal-weight module tiles (locked state, daily ECG card), the standard toolbar in every module, menu | Matches the mock-ups |
| 3 | Simulator, phone first (3–5) | Portrait phone layout from the existing phone work (`mobile-1`); desktop-only styles dropped from the app build | All simulator controls usable one-handed in portrait |
| 4 | Tablet portrait (1–2) | Layout at ≥ 600 dp wide; full 12-lead without paging in Training; larger simulator view | Checked on a 10" tablet viewport (and a real tablet) |
| 5 | First-run tutorial (1–2) | Skippable coach marks per module, replay from the menu, progress stored locally | First launch walks through; replay works |
| 6 | Entitlements and paywall (2) | Entitlement service; locked tiles; purchase sheet; Restore purchases; web unlock for testers | Buying, restoring and the locked states work with Play test accounts |
| 7 | Capacitor Android (2–3) | `app/` project (package id, icons, splash, insets, back button, offline fonts); debug and release builds | Runs on a real Android phone offline |
| 8 | Play Console and release (author + 1–2) | Store listing, screenshots, privacy policy, Data safety form, content rating; internal → closed → production tracks | Live on Google Play |

### Play Console notes

- **New personal developer accounts must run a closed test first:** at least 12 testers opted in for 14 days in a row before
  production access. Start the closed test as early as phase 7 allows (the testers you already have can be those 12).
- **Target API level:** new apps must target a recent Android API level. Check the current requirement when phase 7 starts.
- **Privacy:** the app collects no data (progress lives on the phone). The Data safety form says so; a short privacy policy page
  is still required (it can live on ecgstudio.app).
- **Medical content:** an educational-use statement belongs in the listing and in About (not a diagnostic device).

## Questions for the author (phase 0)

1. **The website after launch.** Does ecgstudio.app keep Training free and unlocked (a way around the purchase)? Should it show
   only the simulator plus the daily ECG? Or should it stay a free preview with a "Get the app" prompt?
2. **Names:** the app name on Google Play (e.g. "ECG Studio") and the package id (e.g. `app.ecgstudio`; it cannot change later).
3. **Price** of the Training module (and the region pricing, if any).
4. **Design:** will you provide mock-ups for the start screen, toolbar, phone simulator and tablet layouts? Or should I make
   clickable prototypes for you to mark up?
5. **Developer account:** personal or organisation (an organisation account skips the 12-tester rule but needs a D-U-N-S number).
6. **The simulator's phone work on `mobile-1`:** reuse it as the starting point for phase 3, or start the phone layout fresh from the mock-ups?
