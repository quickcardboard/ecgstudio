# Interactive tutorial: plan (built in Round 58)

Goal: show the main features, Training included, in **one minute or less**, on the first open of the app; afterwards from
a **Tutorial** button in Help.

## Format

- Learn by doing. Each step dims the screen except the target, which gets a pulsing ring and a one-line card. The step
  moves on by itself when the action is done.
- A small **Next** appears after a few seconds if the user is stuck. **Skip** is always visible. A counter ("3 / 7") sits on
  the card.
- The look follows the app: dark, IBM Plex, the accent red, buttons as Training's (14 px, 8 px radius, `--raised`).

## Steps (about 50–60 s)

| # | Step | The user does | They see | ~Time |
|---|---|---|---|---|
| 1 | Welcome: "A beating heart that writes its own 12-lead ECG." | Start (or Skip) | — | 3 s |
| 2 | Turn the heart | Drag the heart | It rotates; card: "Two fingers zoom, pan and twist" | 6 s |
| 3 | Ectopic beat | Tap the heart muscle | A PVC on the ECG, highlighted on the strip | 8 s |
| 4 | Block an artery | Double-tap the ringed LAD | Purple territory; ST elevation in V2–V4 highlighted; card: "Drag the time bar to watch it evolve" | 10 s |
| 5 | Conduction | The cut view opens; tap the ringed left bundle | Wide QRS: "Left bundle branch block" | 10 s |
| 6 | The full ECG | Double-tap the ECG | All 12 leads and the interpretation; double-tap back | 8 s |
| 7 | Training (app only) | Tap the ringed Training tab | Card over Train: "A new ECG every time. Name the rhythm and findings; a rating for each skill." | 8 s |
| End | "Replay any time: Help → Tutorial." | Done | The heart resets to sinus rhythm at 72/min | 3 s |

## Behaviour

- **When it runs:**
  - First open of the app, in the phone layout. Remember it with a `localStorage` flag; wrap every read and write in
    try/catch.
  - Afterwards from a Tutorial button in Help (simulator; perhaps Training's Help too).
- **State:** the tutorial changes the heart (PVC, occlusion, LBBB, cut view). At the end, or on Skip, reset to the Reset state
  (sinus at 72/min, no abnormalities, outside view). Nothing reaches Training's progress.
- **Website:** the same steps 1–6 on phones. Step 7 only in the app, because the website does not link Training.
- **Robust to the user's own taps:**
  - The tap rules are "what is drawn under the finger" (Round 57): conduction system (cut view), then an artery in sight,
    then muscle.
  - Each step listens for its own result: a PVC flash, an insult added (`S.insults`), a block set (`S.blocks`), the
    full-ECG class on `body`, the shell's module change.
  - Each step does not depend on how the user got there.

## Build

- One new file, `src/tutorial.js`, inlined by `tools/build.py` like `src/inapp.js`.
- The overlay and cards are drawn as DOM over the page. Targets get their screen position from the existing hooks:
  - `ECGStudioApp.coronaryScreen(node)` for an artery;
  - `ECGStudioApp.screenOf(id)` for a cell or conduction node (e.g. `M.csSegments.LBB`);
  - element rectangles for buttons and tabs.
- Step 7 runs in the app shell (`src/shell.html`): the simulator page asks the shell (`ECGInApp.post`) to ring the
  Training tab and to report when it is opened. Training then shows its card.
- Test on a phone without an APK at `https://raw.githack.com/quickcardboard/ecgstudio/<branch>/app/index.html` (the app
  shell as a web page, module tabs included); the live copy is ecgstudio.app/app/.
- Headless checks: Playwright with the Pixel 7 profile on `app/index.html`. Synthetic touch `PointerEvent`s on `#c3d` work
  for taps; Playwright's own `touchscreen.tap` is too slow for double taps in the software-rendered browser.

## Decisions (2026-11-10, the author)

1. Step 7 walks through answering one ECG (a fixed one: sinus rhythm with a mid-LAD STEMI, not rated).
2. The app only for now, tried at ecgstudio.app/app/ (and the branch preview of `app/index.html`). No website tutorial.
3. Keep both the artery (4) and the conduction (5) steps.

Built in Round 58 (docs/DEVELOPMENT.md).
