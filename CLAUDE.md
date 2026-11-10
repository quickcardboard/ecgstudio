# ECG Studio

Interactive 3D heart and 12-lead ECG simulator, live at https://ecgstudio.app (GitHub Pages,
repo quickcardboard/ecgstudio, deployed from `milestone-1`). Author: Thomas Liou. Proprietary,
all rights reserved (LICENSE).

## Build and layout

- `python3 tools/build.py` assembles `src/template.html` + `vendor/` (Three.js r128,
  OrbitControls) + `src/engine.js` + `src/app.js` + `src/anatomy.json` + `src/torso_limb.json` (solved-torso limb-lead fields)
  into the single self-contained `index.html`. Commit the rebuilt `index.html` with source changes;
  it is what the site serves.
  It also writes `training/index.html` and the app shell `app/index.html` (`src/shell.html`, a preview framing both pages
  with `?app`; `src/inapp.js` handles that mode); `--app` adds `app/www/` for the native app (not in git).
- `src/engine.js`: anatomy, model, simulation and lead fields; runs in the browser
  (`window.ECGStudio`) and in Node (`require('./src/engine.js')`). Parameters live in `DEFAULTS`.
- `src/app.js`: Three.js view, ECG paper, interpretation, controls, share links, PNG export.
  `window.ECGStudioApp` is a handle for automated tests.
- `site.json`: author, contact, year shown in Help → About; the build stamps date + commit.
- `docs/DEVELOPMENT.md`: model choices, validation and per-round notes. Add a section for each
  round of changes (`Round N` on `milestone-1`; `<branch> round N` on a feature branch, so merges
  do not clash).

## Validation (headless, Node)

Run before and after any engine change and compare:

- `node tools/evalecg.js`: normal intervals, axis, per-lead R/S/T/P
- `node tools/fascsearch.js '[{}]'`: normal, LAFB, LPFB, LBBB axes and amplitudes
- `node tools/blocks.js`, `node tools/wpw.js`, `node tools/pwave.js` (also `'{"atria":{"ra":true}}'`)
- `node tools/reader.js`: blind cardiologist-style read of 57 scenarios: single-beat reads (blocks, hypertrophy,
  WPW, pericarditis, Brugada, atrial enlargement, thirteen occlusion sites at 1 h and 30 days) and 10 s rhythm
  reads (`tools/rhythmread.js` on the strips of `tools/rhythmscen.js`: sinus, AF, flutter, ectopic, MAT,
  AVNRT, AVRT, VT, VF, AV and SA blocks); `tools/physfit.js` is the joint refit that set the current defaults
- `node tools/hyper.js '[{"lv":6,"P":{"lvStrain":1,"lvSourceGain":1.5}},{"lv":2,"rv":6,"an":{"rvThickPhiC":0.4,"rvThickPhiW":0.8},"P":{"rvStrain":0.7,"rvSourceGain":1.8,"rvCvMul":0.8}}]'` (the LVH and RVH presets of `hypertrophyOptions`)
- `node tools/ischaudit.js [sites] [hours]`: ST/Q/T per lead for every occlusion site and time
  stop (`MP='{...}'` overrides parameters; the marginal branches `OM1,OM2,AM` only when named)
- `node tools/stcheck.js`, `node tools/arrhythmia.js`, `node tools/avnrt.js`, `node tools/avrt.js`
- `ISCH_MS=3600 node tools/fullcheck.js '{}'`: ischaemia lead groups (ST at 1 h, Q at 30 days) for seven
  occlusion sites against textbook/MRI criteria, plus axes and QRS shape (`tools/refit.js` adds the
  activation-mapping score from `tools/acttune.js`)

Browser checks use the preinstalled Playwright Chromium (launch with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), loading `index.html`
from `file://`; screenshot desktop (1440×900, 1280×720) and phone landscape (844×390).

## Accuracy goals

Both are wanted: textbook-accurate axes and amplitudes, and accurate ischemia lead localisation
and time course. Check both kinds of regression when tuning.

Known limitations (rebuild-1 rounds 10–17 in docs/DEVELOPMENT.md):
- limb leads come from a solved torso (`limbTorso2`, field solved for heartRotation 17): changing
  heartRotation needs a re-solved field (`tools/export_heart_torso.js` + `ANISO=1 tools/torso_v2.py`)
- normal axis about 0–15° (normal range, lead III negative)
- LAFB shows a pseudo-infarct (Q/poor R progression) read as old anterior MI
- distal LCx STEMI at 1 h is not visible; LBBB and RBBB axes are not textbook (read on morphology)
- old apical (distal-LAD) infarct also shows inferior Q (wrap-around LAD pattern)
- acute marginal (RV branch) occlusion gives inferior ST elevation and, at 30 days, inferior Q instead of
  the V1/V4R pattern of isolated RV infarction
- VT/VF slow the simulation on slower machines
- chest leads: the QRS is a heart-vector + near-field blend (with the cavity window over a scar); the ST-T of V4–V6 comes
  from the solved torso (`chestTorsoT`, Round 49; V3–V6 fields in `src/torso_limb.json`). V1–V3 ST-T stay on the blend
  (Brugada, LAD T inversion in V3); `cavityWindowT` 0.25 is still a bandage there. After an inferior (RCA) infarct the T in
  V3–V5 is too tall at 2–30 days (repolarisation model)

## Conventions

- Keep the Help guide text written by the author (Getting started, View controls, Control tabs)
  and the short tab instructions as they are unless asked.
- Reset returns to sinus rhythm at 72 bpm with no abnormalities.
- Do not put model identifiers in commits, code or docs.
- Branches: `milestone-1` is the live site and takes engine work and bug fixes. Feature work
  lives on branches cut from it (`mobile-1`: phone layout; `training-1`: Training at /training; `app-1`: the
  Android app, see `docs/APP_PLAN.md`). State and working notes for a new chat: `docs/HANDOFF.md`. Keep a feature branch current by
  merging `origin/milestone-1` into it (never cherry-pick between branches: duplicate commits
  conflict later). After any merge, resolve `index.html` by rebuilding with
  `python3 tools/build.py`. A feature reaches the live site through a pull request into
  `milestone-1`. Preview a branch at `https://raw.githack.com/quickcardboard/ecgstudio/<branch>/index.html`.
