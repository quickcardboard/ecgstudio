# Handoff: state on 2026-11-10, for the next chat (the interactive tutorial)

Read first, in this order:
1. `CLAUDE.md`: build, validation and conventions.
2. `docs/TUTORIAL_PLAN.md`: the interactive tutorial (built in Round 58; `src/tutorial.js`).
3. `docs/APP_PLAN.md`: the Android app, releases and signing.
4. `docs/PREMIUM_PLAN.md`: free vs paid, the state of the paywall, and how testers skip paying.

The history of every change is in `docs/DEVELOPMENT.md` ("Round N"; the latest are Rounds 48–57).

## Where things are

- **`milestone-1`** is the live site (ecgstudio.app) and now holds everything.
  - **`app-1` was merged into it** (Round 56, at the author's request), so the website and the app run the same pages.
  - `app-1` is kept equal to `milestone-1`: merge `origin/milestone-1` into it. Its pushes build a debug APK, and release
    builds run from it.
  - The other branches (`training-1`, `mobile-1`, `claude/*`) are history.
- **Website:**
  - Desktop follows the system light/dark setting; **phones are dark only**, like the app.
  - Training is live but **unlinked**: ecgstudio.app/training, unlocked for testers until the app is published.
  - **ecgstudio.app/app/** is the app shell as a web page (module tabs; `noindex`, unlinked): the app's exact look in a phone
    browser.
- **Previews before merging:** `https://raw.githack.com/quickcardboard/ecgstudio/<branch>/app/index.html` (and
  `.../index.html`, `.../training/index.html`). Use these for every tutorial iteration; the author tries them on a phone.
- **Android app:**
  - Capacitor 8, package `com.ecgstudio.app`, project in `app/`; `versionName` 0.1.0.
  - Workflow `.github/workflows/android.yml`: run it by hand with "release" ticked for a signed AAB. The version code is
    the run number.
  - The upload key is in the repository secrets only.
  - **Closed test:** 12+ testers in the Google Group https://groups.google.com/g/ecgstudio; the 14-day period started
    about 2026-11-03.
  - Testers stay on **version 6**. The author tests **version 12** (artifact of run 12) privately.
  - Store listing drafts: `docs/PLAY_LISTING.md`. Public contact: tlioudevelop@gmail.com. Privacy page: ecgstudio.app/privacy/.
- **Problem reports** (Training ⋯ → Report a problem) open a prefilled Google Form (`site.json` `reportForm`), so no email
  address is shown.

## The tap rules (recent and important for the tutorial)

What a tap or click does depends only on what is drawn where it lands, in any tab and either view (Rounds 55–57):
1. **Conduction system:** shown in the cut view, drawn see-through over the tissue; the sinus node dot counts in both views.
   It opens the block choice; on phones, taps cycle through the blocks.
2. **A coronary artery or its marker, if in sight** (`inSight`, `arteryAt` in `src/app.js`): one tap narrows, a double tap
   occludes, and one tap on a marker removes it. There is one marker per region (proximal/mid/distal LAD, LCx, RCA, left
   main, each side branch).
3. **Muscle:** an ectopic beat. On phones, three or four quick taps start flutter/VT or AF/VF.

Other recent UI:
- Two-finger pinch, pan and twist; view presets undo them.
- The Ischemia tab opens the outside view; the Blocks tab opens the four-chamber cut.
- Phones show count badges on the Blocks, Ischemia and Conditions tabs; desktop shows a "Conditions" summary line under
  the view name.
- The Help dialog's Close button matches Training's.
- The phone tip on first open reads "Double tap the ECG to expand it, or double tap the empty space beside the model to
  expand the 3D view."

## Training (recent)

- New findings (Rounds 48–53): WAP/MAT, sinus pauses, electrolytes, hypothermia, Wellens, Sgarbossa (LBBB + STEMI as two
  answers), torsades. They are rare.
- **Advanced findings** (`adv`, `ADV = 1700` in `src/training_gen.js`): Wellens, hypothermia, STEMI in LBBB, and hypo- and
  hypercalcemia. Below 1700 in the finding's skill they are shown as "advanced" and not required.
- The author agreed this difficulty scale:

  | Level | Rating |
  |---|---|
  | Foundation | below 1400 |
  | Core | 1400–1700 |
  | Advanced | 1700–1900 |
  | Expert | 1900 and above |

  Combinations of findings start around 1700.
- VT, torsades and VF never have other abnormalities, but can have artifacts. Tremor varies in length and strength.

## Settled questions (check here before proposing a rebuild)

The author asked: remember what has been tried before suggesting full rebuilds. Each of these was tried and documented
in docs/DEVELOPMENT.md; do not propose it again without new evidence.
- **Another 3D heart / mesh**: earlier hearts (refine-2's CT heart and others) had the same weaknesses; the LPFB ceiling
  is the same in the hybrid and the solved-torso forward models (rebuild-1 round 8), so it is not the mesh or torso.
- **Conduction-system rebuild from the literature** (Durrer roots on a fast endocardial layer, Cardone-Noott 2016):
  done in rebuild-1 round 9; LPFB ~90° with lead I equiphasic, LPFB and LBBB trade within a degree of tilt. The
  published root-node model has the same LPFB.
- **Fibre ratio of the sources** (`sigmaRatio`): 10 is physiological for the intracellular (source) tensor (Clerc
  ~9, rebuild-1 round 8); the ~3 often quoted is the bulk tissue ratio, used in the torso. Lowering it removes the
  fascicular deviation.
- **Brody factor, torso organs, arms/legs, orientation alone**: none shrinks the LPFB R (Round 67 part 4, Round 68).
- **Over-cancellation** (large regional forces, small net normal QRS) is the model's character; the fascicular block R,
  inferior-MI unmasking and post-infarct T sizes follow from it. Round 67's repolarisation refit fixed the T part.
- **Priorities (the author, Round 68)**: ischaemia detection matters most; LBBB/RBBB axes are low priority; LAFB/LPFB
  look acceptable (more deviation welcome); small Q waves below the infarct criteria are fine; V5–V6 q in LAFB is lateral
  and fine; LVH by Sokolow-Lyon only.
- **Measure with** `tools/scorecard.js` (textbook targets) plus the reader, fullcheck and the Training audit; the quick
  scratch checks of Round 68 (block scorecard subset ~15 s, infarct lead groups ~13 s) before any full run.

## Working with the author

- The author is a UI designer, not a coder: explain choices in plain clinical and visual terms, and give recommendations, not
  surveys.
- They answer quickly and change direction when something feels wrong in use. Keep each change small, with a preview link.
- **Ask before large computational steps** (searches, refits).
- **Show before/after ECG diagrams** for engine changes.
- Feature work goes on a branch cut from `milestone-1`, reaching the site through a pull request. Merge, never cherry-pick.
  After any merge, rebuild with `python3 tools/build.py` (the built pages conflict on every merge; rebuilding resolves them).
- Before every push, parse-check the built scripts of `index.html`, `training/index.html` and `app/index.html` through
  `new Function`.
- Keep the author's own Help text unless asked. When a feature makes a sentence untrue, change only that sentence and say so.
- No model identifiers in commits, code or docs.
- Screenshots for the author: phone (Pixel 7 profile) in app mode, i.e. `app/index.html`, which is dark like the app.

## Open items (besides the tutorial)

- **V6 / chest leads:** a solved-torso chest field is the planned fix (see `CLAUDE.md` known limitations). The scheduled
  reminder for it was removed at the author's request (2026-11-10).
- Distal LCx (V6 weak); the lead I P wave is a small double hump; after an infarct, the V3–V5 T can be too deep.
- Desktop help text and the store listing do not mention the newest findings yet.

## Quick checks

- Engine: `node tools/reader.js` (47/57), `ISCH_MS=3600 node tools/fullcheck.js '{}'` (iErr 4).
- Training generator: `node tools/trainlive.js 30 <seed>`.
- Browser: Playwright Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - Test hooks:
    - `window.ECGStudioApp`: `sim`, `model`, `ischemia`, `screenOf`, `coronaryScreen`.
    - `window.ECGTraining`: `st`, `score`, `startMode`.
    - `window.ECGAppShell` in `app/index.html`: `open('training')`.
  - Synthetic touch: `new PointerEvent('pointerdown'|'pointerup', { pointerType: 'touch', clientX, clientY, bubbles: true })` on `#c3d`.
