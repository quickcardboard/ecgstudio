# Handoff: state on 2026-11-10, for the next chat (the interactive tutorial)

Read first, in this order:
1. `CLAUDE.md`: build, validation and conventions.
2. `docs/TUTORIAL_PLAN.md`: the interactive tutorial (built in Round 58; `src/tutorial.js`).
3. `docs/APP_PLAN.md`: the Android app, releases and signing.
4. `docs/PREMIUM_PLAN.md`: free vs paid, the state of the paywall, and how testers skip paying.

The history of every change is in `docs/DEVELOPMENT.md` ("Round N"; the latest are Rounds 48–57).

## Training "read as is" (branch `claude/training-as-is`, 2026-11-23/24; not merged)

- Cut from `claude/hopeful-brahmagupta-ahil2p` (pull request #24 into `milestone-1`, open). The answer key is read from the
  ECG as it came out instead of discarding ECGs that did not show what was put in (docs/DEVELOPMENT.md, "claude/training-as-is
  round 1–3").
- Validation by reading batches: 20 unanswered ECGs at a time, the author reads them in free text on the claude.ai artifact
  "ECG Reading Batches" (https://claude.ai/artifact/YEUQJ6NTdNy4Ut2Hr8mfgV; reads in its store, collection `reads`,
  `<batch>-<nn>`), and they are scored against the keys. Keys and reviews: `tools/data/reading/batch*_keys.json`,
  `batch*_review.md`. Agreement: batch 1 9/20, batch 2 11/20, batch 3 14/20, batch 4 11/20, batch 5 11/20; batches 4 and 5
  had no wrong keys (the condition set for replacing the live generator).
- Done after batch 3: diffuse ST depression accepts any lead group; non-specific ST-T is an equal answer for ST depression
  under 2 mm. Next: check the J+80 measurement's baseline against the TP segment (the eye saw less depression); then batch 4.

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

## Marketing and video tools (2026-11-16 to 26)

The plan, post drafts and outreach templates are in `docs/MARKETING.md`. The ECG library (`/ecg/`), the app page
(`/training`), `sitemap.xml`, `llms.txt` and `robots.txt` are built by `tools/build.py` (see CLAUDE.md).

**Videos.** All record the real app with Playwright, write MP4 (H.264, 60 fps, silent AAC track) and need ffmpeg and
Python with PIL. Output goes to the folder given (use the scratchpad; the parts are reused with `--skip-take`).

| Tool | Makes | Time | Edit |
|---|---|---|---|
| `node tools/promo_clips.js <out> [stemi,af,chb]` | raw portrait clips 1080×1920 of the phone layout | ~5 min each | `CLIPS` in the file |
| `PROMO_CAM=1 node tools/promo_clips.js <out>` then `node tools/promo_edit.js <out>` | the same with zooms (camera at capture), captions, flash, end card, and `-script.txt` voice-over scripts | ~20 + 1 min | `tools/promo_story.json` |
| `node tools/promo_store.js <out> [--skip-take] [--music song.mp3 [--music-start s]]` | the 30 s Google Play video, 1920×1080: one camera take through the heart, app reveal, Training phone, logo | ~25 min; overlays only ~3 min | tables at the top (`CAM`, `SPEED`, `EVENTS`, `CAPTIONS`) |
| `node tools/promo_vf.js <out> [--skip-take]` | "Recipe for disaster" 19.6 s, 1080×1920: VF cold open, click on the LAD, ischaemia, an R-on-T click that starts VF, logo | ~25 min; overlays ~3 min | `SHOTS`, `CAPTIONS`, `CLICK_*`, `LAD_AT` at the top |
| `node tools/promo_quiz.js <out> [--skip-take]` | "Name this rhythm" quiz 19.8 s, 1080×1920: atrial flutter at half speed, close on the right atrium then cut in to the four-chamber cut; the heart rises to the top half over three unlabelled lead II strips (A sinus 75, B AF ~75, C flutter 4:1, from the engine); captions; logo. No answer shown | ~25 min; overlays ~3 min; stills only: `QUIZ_PREVIEW=0.6,4.6,12` (~3 min) | `HEART` (camera, cut, lift, shift), `CAPTIONS`, `PANEL_IN`, `PEN` at the top |
| `python3 tools/music_loop.py song.mp3 out.wav --start s --length s` | loop part of a song in whole bars (crossfaded joins) | seconds | |

Shared: `tools/promo_logo.js` (the animated logo: voxels drop in, the activation wave sweeps them), `tools/promo_purple.py`
(the ischaemic area's position in a screenshot). The Play Store video's music was "Unconditional" (YouTube Audio Library;
its licence suits YouTube, so the Play video only), the 4-bar drum intro looped: `--start 0.9516 --length 8.20513`, 117 BPM.
The song file is not in the repository; ask the author for it.

**Lessons (each cost a failed render):**
- Time is stepped by hand: `requestAnimationFrame` and `performance.now` are replaced in the page, one frame per capture,
  captured over CDP (`Page.captureScreenshot`; Playwright's own screenshot waits on animation frames and stalls). Load
  `index.html?noworker` so the engine steps on the page (the simulation worker would run on its own clock).
- Pre-roll in steps under 34 ms (`1000 / 32`): bigger steps look like a slow machine to the app's adaptive quality
  (`ECGStudioApp.quality`), which then draws the 3D view only every 4th frame and at lower resolution.
- Zooms are done at capture: the page is drawn at 4× (a temporary copy of `index.html` with the canvas pixel-ratio caps,
  `Math.min(1.5|2, window.devicePixelRatio`, raised to 4) and each frame captures the zoom rectangle, so it stays sharp.
- ffmpeg: set `setsar=1` (zoomed captures' pixel aspect differs by a hair) and reset the timebase after `concat`
  (`settb=1/60,fps=60`) before `xfade`, or the filter graph fails ("Error reinitializing filters").
- Beat timing: `ECGStudioApp.sim.nextSinus()` gives the next sinus firing; spread the simulated time to it over the frames
  of an "align" segment, then slow down. Seen from outside, the ventricular wave reaches the surface 160–220 ms after the
  P wave, so a slow-motion window that ends earlier shows nothing.
- R-on-T VF (`stimulate` / `vulnerable` in `src/engine.js`): a ventricular stimulus between 60% of the beat's
  repolarisation and 20 ms after its end (`log.vent[...].on`, `.repEnd`), in a heart 0.1–48 h after an occlusion, on a
  cell no longer refractory. Aim at 85% of the way (not at `qtEnd()`, which comes later). Tap the purple area found in a
  screenshot: the median of the ischaemic cells' projections can fall on healthy muscle in front of them.
- Camera azimuth is about the screen's vertical, relative to the chest view (`tour.outside()`). The LAD faces the camera
  at +55°; at negative angles it shows through the heart from behind (hidden vessels are drawn see-through).
- Debug the timing with `TAKE_SECONDS=n node tools/promo_store.js …` (logs each speed segment); rehearse clicks on a small,
  1× page before a 25-minute render.

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
