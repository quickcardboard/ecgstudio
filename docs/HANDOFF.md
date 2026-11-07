# Handoff: state on 2026-11-07, for the next chat

Read first: `CLAUDE.md` (build, validation, conventions), then `docs/APP_PLAN.md` (the next two weeks: the Android app).
The history of every change is in `docs/DEVELOPMENT.md`: engine "Round N", training "training-1 round N".

## Where things are

- **`milestone-1`** (the live site, ecgstudio.app) and **`training-1`** are the same commit: the newest commit on `milestone-1`.
  Training is live at ecgstudio.app/training and linked from the simulator's phone ⋯ menu. Everything is unlocked for the testers.
- **App work** is on **`app-1`** (see `docs/APP_PLAN.md`): phase 0 answered, phase 1 done (the app shell `src/shell.html` and
  module tabs; `src/inapp.js` in both pages; preview `app/index.html`). Next: phase 2 (menu, polish of the tabs) or phase 7 early
  (Capacitor, so the closed test's 14 days can start).
- **Training's parts:**
  - Page: `src/training.html`, `src/training.js`
  - Generator and checker: `src/training_gen.js`, shared by Node and the browser workers
  - Vocabulary: `src/training_vocab.txt`
  - `tools/build.py` writes `training/index.html`, with the engine, the readers and the generator inlined as a worker.

## Working with the author

- The author is a UI designer, not a coder. Explain choices in plain clinical/visual terms; give recommendations, not surveys.
- **Ask before large computational steps** (long searches and refits). Save compute for tester bug fixes.
- **Show before/after diagrams** (ECG traces on paper grid) for engine changes before publishing them.
- Engine work goes on `milestone-1` and is merged into the feature branch, never cherry-picked. After any merge, rebuild
  `index.html` with `python3 tools/build.py`. Before every push, parse-check the built scripts: each `<script>` and the
  training worker (`#worker-src`) through `new Function`. A syntax error once reached the live site.
- Keep the author's own Help and How-it-works text unless asked.
- Don't bundle ready-made ECGs in the page (rejected). Speed came from the checker and two workers instead.
- No model identifiers in commits, code or docs.

## Recent work (this chat)

- **Engine:**
  - Round 45: ventricular escape at 32/min.
  - Round 46: RAE without a standing atrial offset; inferior STEMI height scaled (`occlusionInj` RCA 0.33, RV ×1.8).
  - Round 47: post-infarct T inversion trimmed (`cavityWindowT` 0.25, `occlusionLate` LAD 0.5). **A bandage, not a fix.**
- **Training rounds 13–17:**
  - Rhythms and findings: junctional and ventricular escape rhythms (sinus arrest), atrial couplet, SA exit block as a finding,
    pericarditis in AF and junctional rhythm, MAT (foci placed in four atrial regions).
  - Generator: weights; vocabulary trimmed to the 52 terms any ECG uses; faster generation (cheap checks before twins, 6 s twins, two workers).
  - Ratings: item difficulty stretched (`ITEM_SCALE` 1.1); artifacts above rating 1650 (tremor, wander, 50 Hz, per electrode, not answerable)
    add up to 250, so the hardest ECGs are rated ~2700. Titles: Professor at 2100. Glicko RD floor 60.
  - Testers' round 3: the app pinned to the screen edges (iOS home bar), the complete AV block atrial rate never a simple multiple
    of the escape, no repeated combination in a row.

## Open items

- **V6 / chest leads (planned after the app work).** V3–V5 are dominated by the near field (and the cavity window), V6 by the
  heart vector, so V6 can look unrelated to V5. Also open: the upright giant T in V4–V5 of a mid-RCA infarct at 2–30 days.
  - The fix: a solved-torso chest field (`node tools/export_heart_torso.js heart.json` + `ANISO=1 python3 tools/torso_v2.py heart.json out.json 3`,
    ~1 min; needs `pip install scipy pyamg`), then the infarct Q/T patterns re-tuned and revalidated.
  - Round 47 has the test results; `tools/chestsim.js` measures V4/V5/V6.
  - **The reminder for this is scheduled for 2026-11-14 in the old chat**, not the new one. Raise it then if the author doesn't.
- **Distal LCx** (V6 weak): waiting for more tester feedback.
- **Atrial model:** lead I P wave is a small double hump even in the normal heart.
- **Not modelled:** isolated Wellens T, hypokalaemia/U waves.
- **Known limitations** list: `CLAUDE.md`.

## Quick checks

- Engine: `node tools/reader.js` (47/57 expected), `ISCH_MS=3600 node tools/fullcheck.js '{}'` (iErr 4), `node tools/evalecg.js`.
- Training generator: `node tools/trainlive.js 30 <seed>` (an audit of random ECGs: pass rate and rejection reasons).
- Browser: Playwright Chromium on `file://.../training/index.html`; `window.ECGTraining` (`startMode('train')`, `nextItem()`, `st`)
  and `window.ECGStudioApp` (the simulator: `sim`, `model`, `ischemia`).
