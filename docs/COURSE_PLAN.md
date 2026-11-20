# ECG course ("Learn"): plan

Goal: take someone with **no prior knowledge** to reading ECGs by **understanding why** each pattern looks the way it
does, not by memorising criteria. Everything happens on the app's own 3D heart: the student sees the wave move, predicts
what a lead will draw, then watches the heart draw it.

Decided by the author (2026-11-20):
- Audience: complete beginners.
- Place: a **Learn** mode inside Training (module tab), next to Train and the skills.
- Product: premium with a trial, its own purchase separate from Training (the "lessons" add-on of `docs/PREMIUM_PLAN.md`).
- Visuals: **only the 3D heart**, with overlays. No separate 2D diagram model (an arrow-diagram mock-up was tried on
  2026-11-20 and rejected: a second model to learn, and too busy).
- Style: **practical**. Numbers and hard criteria only where a clinician really uses them; recognise by eye first.

## The idea in one line

Learn what one cell does, then what a chain of cells does, then the whole heart. Then, for every new pattern:
**watch the heart, predict the lead, see it drawn.** This makes a normally abstract subject visual and interactive.

## Teaching principles

1. **Five rules carry the whole course.** Every lesson uses them, and the student is reminded which rule a pattern comes from.
   - A wave moving **toward** a lead draws **up**; moving **away** draws **down**; across it draws a small up-down.
   - The ECG is the **sum** of everything active at that moment. The big left ventricle usually wins.
   - The wiring (conduction system) is **fast**, muscle is **slow**: narrow QRS = the wave used the wiring; wide QRS = it
     crawled through muscle somewhere.
   - Recovery runs **outside to inside**, the opposite order to activation, so the normal T points the same way as the QRS.
     When activation is abnormal, the T flips with it.
   - **Injured** muscle leaks current (the ST segment moves); **dead** muscle is silent (a Q wave: a window onto the far wall).
2. **Predict before you see.** Every new pattern is first a question: "what will V1 look like?" The student commits to an
   answer, then the heart shows it. Being wrong and seeing why is the point.
3. **By eye first, numbers only when needed.** Clinicians do not measure every wave. The course teaches the look ("this
   QRS is wide", "the PR is long") and keeps a short list of numbers that are worth knowing (below). Everything else is
   described, not measured.
4. **The same heart all the way through.** Colours, views and gestures are the simulator's. What the student learns in a
   lesson works in the simulator and in Training straight away.
5. **Short.** One idea per lesson, 3–5 minutes on a phone, ending with a few real ECGs to try.

### The numbers worth keeping (the whole list)

| What | By eye | Number, for when you are unsure |
|---|---|---|
| Rate | Count big squares between beats | 300 ÷ big squares |
| Wide QRS | Looks broad and blunt | More than 3 small squares |
| Long PR | P far from the QRS | More than 1 big square |
| ST elevation | The segment sits above the baseline | 1 small square (2 in V2–V3) |
| Long QT | The T ends past halfway to the next beat | — |
| Axis | Leads I and aVF both upright = normal | — |

Everything else in the course (pathological Q size, voltage criteria, Sgarbossa and so on) is shown as a pattern with its
reason, and the number is optional "reference" text the student can open, never a quiz question.

## Lesson format

Every lesson follows the same five beats, so the student always knows where they are:

| Beat | What happens | Interaction |
|---|---|---|
| 1. **Set-up** | One sentence and a view of the heart: "This is the right bundle. It carries the wave to the right ventricle." | The heart turns to the right view by itself; the target is ringed (as in the tutorial) |
| 2. **Predict** | A question about one lead: "The right bundle is cut. What will **V1** draw?" | Pick one of 3–4 small tracings, each labelled with the lead |
| 3. **Watch** | The change is made (by the student where possible: tap the bundle, double-tap the artery) and plays in slow motion | Time bar to scrub one beat; overlays on the heart (below) |
| 4. **Why** | Two or three sentences linking what they saw to one of the five rules | Tap a lead to see it on the heart; the matching part of the trace is highlighted |
| 5. **Try it** | 2–3 ECGs from Training's generator with that finding, answered the Training way | Not rated; a miss links back to the lesson's Watch step |

### Interaction types

- **Pick the morphology** (the core one): 3–4 single-beat tracings for one named lead. The correct one is the engine's
  own output for the scenario; the wrong ones are the same lead from other scenarios (for example V1 in normal, RBBB,
  LBBB). The tracings are drawn by the engine, so they always match what the student then sees.
- **Pick the baseline / rhythm strip**: for rhythms. Example: the atria flutter on the heart; pick the lead II strip
  (sawtooth, wavy and irregular, flat with P waves, flat with no P waves).
- **Pick the leads**: a tappable 12-lead map. "The LAD is blocked. Which leads will show ST elevation?" Then the heart
  and the ECG show it.
- **Make it happen**: the student does the action on the heart (tap the muscle for an ectopic, cut a bundle, occlude an
  artery, drag the ischaemia time). This reuses the simulator's tap rules and the tutorial's step machinery.
- **Scrub one beat**: drag through a single beat in slow motion. The wave moves on the heart and a cursor moves along the
  chosen leads.

### Overlays on the 3D heart (to build)

- **Wavefront colours**: already there (resting pink, the blue wavefront, green recovery).
- **Heart vector arrow**: the sum arrow from the centre of the heart, growing and turning through the beat. The
  simulator already computes it (`S.dipole`) and shows lead vectors in the "leads" layer.
- **One lead's eye**: a line from the heart toward the chosen electrode, with the heart vector's shadow on it coloured up
  (toward) or down (away). This is the "toward = up" rule made visible.
- **Region highlight**: the part of the heart that the step is about (septum, RV free wall, a fascicle's territory, an
  artery's territory), dimming the rest.
- **Trace cursor**: the moment shown on the heart, marked on the chosen leads; the trace before it dark, after it faint.
- **Cell and chain view** (units 1–2): zoom into the wall in the cut view, ring a short row of real model cells, and
  show the chosen cell's action potential beside the heart. The engine already holds each cell's membrane potential.

## Curriculum

The order follows the heart's own sequence. Each unit opens with its rule, then breaks it. The systematic read (rate,
rhythm, axis, intervals, QRS, ST-T) is built up along the way, each step taught where its physiology is.

| Unit | Lessons (each 3–5 min) | Main interactions |
|---|---|---|
| **1. One cell** | Charged and at rest · Firing (depolarisation) · The plateau · Recovering (repolarisation) | Cell view; pick what the cell's trace does next |
| **2. A chain of cells** | A wave moving along a strip · Toward up, away down, across small · Recovery and the T wave (why it is upright) | Chain view with one electrode at each end; pick the deflection |
| **3. The whole heart** | Leads are viewpoints (limb, then chest) · The sum: why the LV wins · The normal beat wave by wave (P, PR, septal q, R, S, ST, T) · R progression V1–V6 · Axis with I and aVF · Rate by eye | Lead's eye overlay; scrub one beat; pick each lead |
| **4. Who sets the pace** | Sinus, slow and fast · Ectopic beats (tap the muscle) · Atrial fibrillation · Atrial flutter · Re-entry (AVNRT, AVRT) · VT and VF · Escape rhythms | Pick the rhythm strip / baseline; make it happen |
| **5. Breaking the wiring** | The AV node delay: first degree · Wenckebach · Mobitz II and 2:1 · Complete block · RBBB · LBBB · LAFB · LPFB · Bifascicular · WPW (a short-cut) | Cut the bundle; pick V1/V6/I/aVF |
| **6. Bigger muscle** | LVH and strain · RVH · Atrial enlargement (the P wave) | Pick the P wave in II/V1; pick V1/V5 |
| **7. Injured muscle** | Occlusion: which leads and why (territories) · Reciprocal changes · Time course (hyperacute T → ST → Q → T inversion) · Inferior, lateral, posterior · Wellens · Old infarct Q waves | Pick the leads; drag the time bar |
| **8. Cell chemistry and more** | Potassium high and low · Calcium · Hypothermia · Long QT and torsades · Pericarditis · Brugada | Back to the cell view: pick the cell's trace, then the ECG |
| **9. Putting it together** | The systematic read on whole ECGs · Common combinations | Full 12-lead questions, leading into Training |

Rough size: about 50 lessons, 3–4 hours in all.

Example lessons, as the student meets them:
- **Atrial flutter (unit 4):** a wave circles the right atrium on the heart, one lap every 200 ms. Predict: "What does
  the baseline look like in lead II?" Four strips. Watch: each lap draws one sawtooth; every second lap gets through the
  AV node. Why: the circuit never stops, so there is no flat baseline. Try it: three flutter ECGs.
- **RBBB (unit 5):** the cut view; tap the right bundle to cut it. Predict V1. Watch the left side fire as normal, then
  the right ventricle fire late and alone, toward V1. Why: the R′ is the right ventricle on its own; toward V1 it draws
  up, away from I and V6 it draws a broad S. The QRS is wide because muscle is slow.
- **Anterior STEMI (unit 7):** "The LAD is blocked. Which leads will show ST elevation?" Tap the leads, then
  double-tap the LAD and watch the territory and the ST rise. Drag the time bar: hyperacute T, ST elevation, Q waves, T
  inversion.

## Model accuracy rules

The course must never teach a model quirk as fact.

- **Every lesson scenario is checked** with `tools/scorecard.js` and `tools/reader.js` before its text is written. Where
  the model is weak, the lesson avoids showing that feature, or uses a lesson preset.
- **Lesson presets**: extra engine settings used only inside one lesson, reset when the lesson ends; never in the free
  simulator or Training's ratings. They change conduction and source strength only, never the heart's position.
  Two exist (2026-11-20 search; development notes: `docs/DEVELOPMENT.md`, branch round 1):

  | Preset | Settings | Result (current model → preset) |
  |---|---|---|
  | `lpfb` | `{"lpfTerrLo":-2.9,"lpfTerrHi":1.2,"purkCrossSlow":10,"lsfTie":"LPF","lsfTieDelay":3,"septalTerrHalf":0.2,"lpfApexZ":0.2,"lvSourceGain":0.6,"lpfPhi":-1.8,"lpfZ":0.4,"fascConnectFrac":0.35,"cvVentLong":0.45,"rvSourceGain":0.7,"purkCrossFastPhi":null}` | Axis 92° → 100° (normal beat in the preset 29°), clear rS in I, R III 31 → 20 mm. Normal beat has low voltage |
  | `rbbb` | `{"rvSourceGain":0.9,"pmjRetroRV":50,"purkZmaxRV":0.8,"septalTerrHalf":0.85,"lsfPhi":1.1,"lsfZ":0.25,"rvCvMul":1,"cvVentTrans":0.34,"cvVentSheet":0.25,"precordialDipoleW":0.6,"dowerChest":0,"rbbSeptalFrac":0}` | V1 r 2.7 / R′ 4.9 → r 4.1 / R′ 6.2 mm; axis −51° → −19° (normal beat in the preset 63°); upright inferior leads |

- **Known gaps to design around**:
  - RBBB moves the axis left in this heart (its late RV forces point up). The RBBB lesson teaches V1, I and V6 and does
    not show the axis; the text says the axis is usually unchanged.
  - Old apical infarct also shows inferior Q; the acute marginal (RV) branch gives an inferior pattern. Avoid both as
    lesson examples.
  - Training's hyperacute mid-LAD T is often not tall enough: check before using it in the time-course lesson.
  - The LAFB lesson works in the live model (−55°); the bifascicular lesson needs the `rbbb` preset (RBBB −19° → with
    LAFB −54°), since the live model's RBBB alone already reads about −51°.

## Where it lives and what it costs

- **Training → Learn** (a module tab beside Train and the skills). Progress: lessons completed per unit. Each skill
  rating in Training links to the lessons for that skill ("Your bundle branch blocks are weak: RBBB lesson").
- **Product**: its own one-time purchase ("lessons" in `docs/PREMIUM_PLAN.md`), with a trial. Proposed trial: units 1–3
  free (the cell, the chain, the normal beat). The author to confirm.
- Lessons never change Training's ratings. "Try it" ECGs are unrated.
- Lesson content (text, steps, scenarios, choices) lives in one data file, like `src/learn/topics.json`, so text can be
  edited without touching code.

## Build order

1. **This plan** (done).
2. **Prototype on a branch**, previewed on a phone at `app/index.html`:
   - the lesson player (the five beats), built on `src/tutorial.js`'s ring, card and step-listener machinery;
   - overlays: heart vector arrow, one lead's eye with the shadow, trace cursor, region highlight;
   - "pick the morphology" choices drawn by the engine;
   - lesson presets (set on lesson start, reset on exit);
   - two lessons: **the normal beat** (unit 3) and **RBBB** (unit 5).
3. **Units 1–2** (the cell and the chain): the cell view needs the most new work, so it comes after the player is proven.
4. **The other units**, a few lessons at a time, each checked against the model first.
5. **Premium**: the Learn product and its trial, in the shell's `PRODUCTS`.

## Open questions for the author

1. The trial: units 1–3 free, or a time limit, or the first lesson of each unit?
2. The cell and chain views: zoom into the real heart wall (proposed), or a separate close-up panel of real model cells?
3. Should "Try it" use Training's generator (varied, sometimes with extra findings) or a fixed set per lesson (cleaner)?
