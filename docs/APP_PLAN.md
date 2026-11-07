# ECG Studio app: plan (Android first, Capacitor)

Draft for the author's review, 2026-11-07. Decisions already made are marked **Decided**. The phase 0 answers are recorded
at the end; including the module switcher. Nothing here is built yet.

## Decided

- **Wrapper: Capacitor.** One web codebase in a native shell. Google Play first; iOS much later (no iPhone to test on yet).
- **Free:** the simulator, the training statistics and the daily ECG.
- **Premium (one-time purchase):** Training mode. Later modules (lessons, pacemaker, ...) are separate one-time purchases on top of the free simulator.
- **Payment:** Google Play Billing.
  - A new device restores purchases through the Google Play account, so no user accounts or our own codes are needed.
  - Testers get Play Console promo codes.
- **Orientation:** portrait only, phones and tablets. Tablets should show the whole 12-lead without paging if there is room.
- **The app does not need the simulator's desktop layout.**
- **Name and id:** "ECG Studio" on Google Play, package id `com.ecgstudio.app` (permanent).
- **Developer account:** personal (already created), so a closed test of at least 12 testers for 14 days in a row comes before production.
- **Price:** one-time Training purchase of about US$4.99–9.99, with Google Play's automatic local prices per country.
- **Website after launch:** the simulator only (it works well on a big screen), with a prompt that advertises the app for
  Training and the other modules. Training leaves the website once the app is out.
- **Layouts stay as they are.** The app copies the current phone layouts exactly (the simulator's and Training's, already
  portrait). The only change is how users move between modules.
- **Module navigation:** every module gets equal visual weight, and there is **no start screen** (an extra step). Training is no
  longer behind the ⋯ menu, and its "Back to the ECG Studio simulator" button goes.
- **Tablets:** the phone layout, with the ECG views showing **more leads** where there is room (the full 12-lead without
  paging), not a bigger share of the screen; everything else as on phones.
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

- **Shell:** module tabs (no start screen; the app opens on the last module used), shared top toolbar, menu (Help, Tutorial, Settings, About, Restore purchases), entitlement service, router.
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
| 0 | Decisions and design | Answers to the questions below; the module switcher (decided: option A, dark) | Done |
| 1 | Shell and modules (2–3) | `app-1` branch; one shell page; module registry; simulator and training mounted as modules; shared toolbar; `build.py --app` | Both modules run in one page in a phone browser |
| 2 | Module switcher (1–2) | Header tabs (active: icon and name at the left; inactive: icons on phones, names on tablets) in every module (locked state for paid modules), menu; Training's back-to-simulator button removed | Agreed by the author on a phone |
| 3 | Simulator in the app (1–2) | The current phone layout, unchanged; desktop-only styles dropped from the app build | Identical to the phone site apart from navigation |
| 4 | Tablet portrait (1–2) | The phone layout at ≥ 600 dp wide, the ECG views showing more leads (full 12-lead without paging), same share of the screen | Checked on a 10" tablet viewport (and a real tablet) |
| 5 | First-run tutorial (1–2) | Skippable coach marks per module, replay from the menu, progress stored locally | First launch walks through; replay works |
| 6 | Entitlements and paywall (2) | Entitlement service; locked tiles; purchase sheet; Restore purchases; web unlock for testers | Buying, restoring and the locked states work with Play test accounts |
| 7 | Capacitor Android (2–3) | `app/` project (package id, icons, splash, insets, back button, offline fonts); debug and release builds | Runs on a real Android phone offline |
| 8 | Play Console and release (author + 1–2) | Store listing, screenshots, privacy policy, Data safety form, content rating; internal → closed → production tracks | Live on Google Play |

**Phase 1 status (2026-11-07): done.** Shell, module tabs, both modules framed, `build.py --app`. Preview on a phone:
`https://raw.githack.com/quickcardboard/ecgstudio/app-1/app/index.html`. Details: docs/DEVELOPMENT.md, app-1 round 1.
For phase 4: on tablets (≥ 744 px wide) the simulator still shows its website tablet layout; the app should use the phone
layout there (decided), with more leads in the ECG views.

### Play Console notes

- **New personal developer accounts must run a closed test first:** at least 12 testers opted in for 14 days in a row before
  production access. Start the closed test as early as phase 7 allows (the testers you already have can be those 12).
- **Target API level:** new apps must target a recent Android API level. Check the current requirement when phase 7 starts.
- **Privacy:** the app collects no data (progress lives on the phone). The Data safety form says so; a short privacy policy page
  is still required (it can live on ecgstudio.app).
- **Medical content:** an educational-use statement belongs in the listing and in About (not a diagnostic device).

## Phase 0 answers (2026-11-07)

1. **Website:** simulator only; advertise the app for Training and later modules.
2. **Names:** "ECG Studio", `com.ecgstudio.app`.
3. **Price:** agreed (one-time, about US$4.99–9.99, automatic local prices).
4. **Design:** keep all current layouts; only the navigation between modules changes, with equal weight per module and
   no start screen. Tablets: expanded ECG views only.
5. **Account:** personal, already created.
6. **Phone layout:** the app copies the current phone layout exactly, apart from the module navigation.

### Module switcher (decided)

**Option A: module tabs in the top header, dark style** (Training's theme) in every module. The simulator's bottom bar
(Rhythm, Blocks, View, Ischemia, Conditions) and Training's answer box and keyboard stay where they are, so the tabs belong at the top.

- **Active tab:** expanded, with its icon and full name, at the far left of the header, where the "ECG Studio" title is now.
- **Inactive tabs:** icon only on phones, full names on tablets, to the right of the active tab. The module's own buttons
  (1×, pause, ⋯) stay at the right edge.
- **Switching:** the tapped tab expands and slides to the left, and the previous one shrinks back to its icon (a short animation,
  so it is clear where it went). Inactive tabs keep a fixed order. Tap only: swipes already page the ECG.
- Other options considered: a separate tab row above the header (costs height), icon tabs with small labels, a bottom bar
  (clashes with the simulator's bottom bar and Training's keyboard), a side drawer or title drop-down (hide the modules).

Either way: each module keeps its state when you switch (the simulator pauses while hidden); a paid module shows a small lock
and opens its preview and purchase sheet; Training's **Model** button switches to the Simulator tab with that heart loaded,
and the Training tab returns to the same ECG.
