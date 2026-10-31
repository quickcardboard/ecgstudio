# ECG Studio

Interactive 3D heart and 12-lead ECG simulator, live at https://ecgstudio.app (GitHub Pages,
repo quickcardboard/ecgstudio, deployed from `milestone-1`). Author: Thomas Liou. Proprietary,
all rights reserved (LICENSE).

## Build and layout

- `python3 tools/build.py` assembles `src/template.html` + `vendor/` (Three.js r128,
  OrbitControls) + `src/engine.js` + `src/app.js` + `src/anatomy.json` + `src/torso_leadfield.json`
  into the single self-contained `index.html`. Commit the rebuilt `index.html` with source changes;
  it is what the site serves.
- `src/engine.js`: anatomy, model, simulation and lead fields; runs in the browser
  (`window.ECGStudio`) and in Node (`require('./src/engine.js')`). Parameters live in `DEFAULTS`.
- `src/app.js`: Three.js view, ECG paper, interpretation, controls, share links, PNG export.
  `window.ECGStudioApp` is a handle for automated tests.
- `site.json`: author, contact, year shown in Help → About; the build stamps date + commit.
- `docs/DEVELOPMENT.md`: model choices, validation and per-round notes. Add a section for each
  round of changes.

## Validation (headless, Node)

Run before and after any engine change and compare:

- `node tools/evalecg.js`: normal intervals, axis, per-lead R/S/T/P
- `node tools/fascsearch.js '[{}]'`: normal, LAFB, LPFB, LBBB axes and amplitudes
- `node tools/blocks.js`, `node tools/wpw.js`, `node tools/pwave.js` (also `'{"atria":{"ra":true}}'`)
- `node tools/hyper.js '[{"lv":6,"P":{"lvStrain":1,"lvSourceGain":1.5}},{"lv":3,"rv":5,"P":{"rvStrain":0.7,"rvSourceGain":1.8}}]'`
- `node tools/ischaudit.js [sites] [hours]`: ST/Q/T per lead for every occlusion site and time
  stop (`MP='{...}'` overrides parameters)
- `node tools/stcheck.js`, `node tools/arrhythmia.js`, `node tools/avnrt.js`, `node tools/avrt.js`

Browser checks use the preinstalled Playwright Chromium (launch with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), loading `index.html`
from `file://`; screenshot desktop (1440×900, 1280×720) and phone landscape (844×390).

## Accuracy goals

Both are wanted: textbook-accurate axes and amplitudes, and accurate ischemia lead localisation
and time course. Check both kinds of regression when tuning.

Known limitations (Round 14–15 notes in docs/DEVELOPMENT.md):
- LAFB/LPFB limb voltages about 1.5× textbook (aVL R 2.4, LPFB III R 3.2 mV)
- normal T in III flat to slightly negative
- inferior Q in II appears late in proximal RCA and PDA occlusion
- inferior subendocardial patch leaves a small inferior q
- VT/VF slow the simulation on slower machines

## Conventions

- Keep the Help guide text written by the author (Getting started, View controls, Control tabs)
  and the short tab instructions as they are unless asked.
- Reset returns to sinus rhythm at 72 bpm with no abnormalities.
- Do not put model identifiers in commits, code or docs.
- Branches: `milestone-1` is the live site and takes engine work and bug fixes. Feature work
  lives on branches cut from it (`mobile-1`: phone layout). Keep a feature branch current by
  merging `origin/milestone-1` into it (never cherry-pick between branches: duplicate commits
  conflict later). After any merge, resolve `index.html` by rebuilding with
  `python3 tools/build.py`. A feature reaches the live site through a pull request into
  `milestone-1`. Preview a branch at `https://raw.githack.com/quickcardboard/ecgstudio/<branch>/index.html`.
