# ECG Studio development notes

Model choices, validation results and per-round revision notes.

## Status: milestone 4 (arrhythmias) on top of milestones 1–3

| Area | Done |
|---|---|
| Anatomy | Average adult four-chamber heart (Rodero et al. 2021), voxelized at 2 mm (≈37k cells), with decimated surfaces for rendering |
| Conduction system | SA node, crista terminalis, Bachmann's bundle, AV node (5 decremental segments), His, LBB → LAF/LPF (two-fascicle model; an optional septal fascicle is off by default), RBB → moderator band, LV/RV Purkinje networks, escape pacemakers |
| Engine | Event-driven automaton with sub-ms arrival times, fibre anisotropy, APD/CV restitution, AV-node decrement and autonomic coupling, per-cell parametric action potential, electrotonic APD modulation |
| ECG | Limb leads from the Einthoven projection of the heart vector (Goldberger augmented leads); precordial leads blend the heart vector projected on distance-weighted lead vectors (70%) with near-field chest-electrode potentials (30%), chest-lead gain 0.95 |
| UI | 3D external and four-chamber cutaway views (stencil-capped cut face), label and lead-vector overlays with a live heart vector, 12-lead + rhythm strip on standard paper, interpretation banner, rate and time-scale controls, resizable split |

### Validation (headless engine: `node tools/evalecg.js`, `node tools/fascsearch.js '[{}]'`)

| Rate | PR | QRS | QT / QTc |
|---|---|---|---|
| 45 bpm | 157 ms | 83 ms | 425 / 368 ms |
| 72 bpm | 140 ms | 86 ms | 376 / 411 ms |
| 100 bpm | 132 ms | 83 ms | 331 / 427 ms |
| 160 bpm | 126 ms | 83 ms | 283 / 462 ms |

Frontal axes at 72 bpm: P +81°, QRS +24° (area) / +45° (net deflection), T +74°. J points and
ST segments within ±0.04 mV in all leads (`node tools/stcheck.js`). Septal q in I and
V6, r in V1, R/S transition at V4, upright T in I, II and V2–V6.

| Condition | QRS axis (area / deflection) | QRS | Pattern |
|---|---|---|---|
| LAFB | −47° / −52° | 113 ms | rS in II, III, aVF; qR in aVL |
| LPFB | +90° / +90° | 104 ms | rS in I and aVL; qR in II, III, aVF |
| LBBB | — | 149 ms | QS-type V1, broad R in I |
| RBBB | — | 112 ms | incomplete; morphology refined in milestone 2 |

Rhythm source is block-dependent: every sinus rate stays sinus; SA- or AV-node block brings out a
junctional escape (48 bpm) and His block a ventricular escape (40 bpm). Plots: `docs/validation-*.png`.

### Model choices behind the fascicular blocks

Realistic LAFB/LPFB axes required, together: fibre-direction-dependent sources (intracellular
along:across ≈ 8.4:1), limb leads from an insulated-torso lead field (`tools/torso_leadfield.py`, a
computed Burger triangle), and an LV free wall thickened by up to ~6 mm on a smooth map that
tapers to the septal junctions, base and apex (`lvThickenWeight`, shared by tissue and display). The heart sits 67° below horizontal
(CT: 52°) with 39° anterior tilt. `tools/research/` reproduces the investigation, and
`tools/data/fascicular_candidate_v2.json` records the parameter set. The ECG output passes a 40 Hz
low-pass (`ecgLowpass`), as on a monitoring ECG.

### Milestone 2: conduction blocks and ectopy

Click a structure in the cutaway (Block mode) to choose a block, or click tissue (Stimulate mode) for
a PAC/PVC. Engine API: `sim.setBlock(site, type, opts)`, `sim.stimulate(cell)`.

| Site | Blocks | Mechanism |
|---|---|---|
| SA node | SA exit block (n:n−1), sinus pause, sinus arrest | node keeps its rhythm but impulses fail to exit / node stops |
| AV node | 1st degree; Mobitz I; 2:1; complete | slowed nodal conduction; AV-nodal recovery curve (Wenckebach emerges and is rate-dependent); 1-in-2 conduction; conduction loss → junctional escape |
| His bundle | Mobitz II (n:n−1); complete | intermittent infranodal failure with fixed PR; conduction loss → ventricular escape 40 bpm |
| Bundle branches, fascicles | complete | segment non-conducting; RBB + LBB → fascicular escape (40 bpm), RBB + LAF + LPF → idioventricular escape (34 bpm), both read as 3rd-degree AV block |

Checked in-app (`tools/blocks.js`, rhythm strips in `docs/m2/`): Wenckebach at 72 bpm runs PR 197→276→327→372→423
ms then drops (1:1 with long PR at 60 bpm, 3:2 at 90 bpm); RBBB 124–128 ms with rsR′ in V1 (axis read from the
first 60 ms); LBBB 143 ms; RBBB+LAFB −69°; PACs reset the sinus node (non-compensatory pause); PVCs give a full
compensatory pause. PACs within ~60 ms of the QRS meet refractory atria; at QRS +100–140 ms they block in the AV
node (non-conducted PAC); later ones conduct with decremental PR prolongation (245 ms at +180 ms, 201 ms at +500 ms).
The cutaway can be rotated freely: the cut plane always faces the viewer and a depth slider moves it along the
view axis; presets give the anterior (four-chamber), lateral and short-axis cuts (the short axis shows the delayed
wall in LAFB vs LPFB). External view presets: front, left, inferior, back. The interpretation banner states rhythm, AV and intraventricular conduction and ectopy.

### Milestone 3: coronary occlusion and ischemia

Click a coronary artery in the external view (Ischemia mode) to occlude it there, or click ventricular muscle on
the cutaway face for a subendocardial patch; the *Time since onset* slider (0–8 h) moves all regions through the
time course. Engine API: `sim.addOcclusion(node)`, `sim.addSubendocardial(cell, radiusMm)`, `sim.setIschemiaTime(h)`,
`sim.removeInsult(id)`, `sim.clearIschemia()`; the tree is `model.coronary`.

| Piece | Model |
|---|---|
| Coronary tree | LM → LAD (D1, D2) and LCx (OM1, OM2); RCA → acute marginal, PDA, posterolateral (right dominant). Geodesic paths on the epicardium, ~3 mm nodes; each ventricular voxel is assigned to its supplying node (LAD wraps the apex, septum split LAD/PDA) |
| Severity | 1 in the core, tapering over a 9 mm border zone |
| Minutes | K-ATP APD shortening → hyperacute T |
| 0.5 h | injury current: resting depolarisation (+22 mV) and a lower plateau (−35%), conduction slowing → ST elevation over the territory, reciprocal depression |
| 0.4–6 h | necrosis advances endocardium → epicardium (inner layer fed by cavity blood survives); necrotic cells stop firing and lose 85% of their coupling in the lead weights → Q waves |
| 3–8 h | ST elevation partly resolves; APD prolongation in the surviving border → terminal T inversion |
| Nodal arteries | occlusion proximal to the SA-node artery slows the sinus rate; proximal to the crux (AV-node artery) lengthens the PR |
| Subendocardial | inner ~25% of a wall patch, stronger injury → ST depression in the leads facing it |
| ECG | 0.05 Hz diagnostic high-pass |

The slider steps through onset, 15 min, 1 h, 4 h, 12 h, 2 days and 1 month: the injury current fades by ~2 days
(ST back to baseline), border-zone APD prolongation peaks at 1–3 days (deep T inversion) and fades over weeks (T
upright in an old infarct), scar uncoupling completes, and nodal ischemia recovers. Only the main arteries (LM, LAD,
LCx, RCA, PDA) are drawn; side-branch territories belong to the parent vessel at the branch origin.

Headless check (`node tools/ischemia.js`, plots in `docs/m3/`): proximal LAD → ST elevation in I, aVL, V2–V5 with
inferior reciprocal depression; mid LAD → V2–V5 only; LCx → ST depression V1–V3 (posterior) with slight V5–V6
elevation; proximal RCA → ST elevation III > II, aVL depression, V1 elevation (RV), sinus slowing and PR lengthening;
distal RCA → inferior elevation with V1–V4 depression. By 6–8 h: Q waves (QS in III for RCA, loss of R in V3–V4 for
LAD) and terminal T inversion. The interpretation reads ST at J + 40 ms, new Q waves and T changes against the
heart's own healthy beat, and names the territory with STEMI thresholds.

### Structural changes

| Toggle | Model | ECG (tools/pwave.js, tools/hyper.js, tools/wpw.js) |
|---|---|---|
| RAE | RA sources ×2.4, RA conduction slightly faster (synchronous) | P 0.30 mV in II, duration unchanged |
| LAE | LA sources ×1.8; RA→LA conduction across every interatrial connection ×1/40 (one way, so no re-entry) | P ≈150 ms, notched in II (humps ~80 ms apart), PR unchanged, modest terminal negativity in V1 |
| LVH | anatomy rebuilt with the LV free wall +6 mm, LV lead-field pair coefficients ×1.6 (more intracellular current), reversed transmural APD gradient | Sokolow–Lyon 3.6 mV, Cornell 2.4 mV, QRS 102–106 ms, T inversion I, aVL, V6 |
| RVH | RV free wall +10 mm, RV pair coefficients ×1.8, 70% reversed gradient | axis +136°, R/S V1 0.63/0.05 mV, T inversion V1–V2 |
| WPW | bidirectional non-decremental atrioventricular strand (6 ms, ERP 280 ms) at left lateral, left posterior, posteroseptal, right free wall or right anteroseptal ring sites | PR 44–101 ms, QRS 121–181 ms, delta waves |

Limitations: the LAE V1 terminal negativity is shallow (the model's left atrium projects little onto V1), and the
delta-wave polarity does not follow localisation algorithms for every site (the model's heart sits fairly vertical).

### Heart orientation (revised)

The long axis now lies ~42° below horizontal in the frontal plane (was 67°), tilted ~52° anteriorly
(rotation +5.9°, pitch −23.1°, apex lower in the chest). The earlier vertical position was compensating for
an over-strong fibre anisotropy of the sources (σ ratio 8.42), which by itself rotated the QRS axis ~55°
superiorly; the effective source anisotropy is smaller than the intracellular ratio because the
extracellular space is anisotropic too. With σ ratio 6, re-searched fascicle sites/territories
(`tools/fasclocal.js`, ROT/PITCH bounds) and no right-bundle septal branches: normal +59°, LAFB −45°,
LPFB +90°, LBBB +82°, RBBB+LAFB −82° (first 60 ms). Atrial sources ×0.6 keep P at 0.21 mV in II.
For isolated RBBB the banner reports the axis of the conducted LV beat.

### Milestone 4: arrhythmias

Buttons in the Arrhythmias panel, or click gestures (≥4 rapid clicks on the LA → AF, RA → flutter, ≥3 separate
atrial sites → MAT, ≥4 on a ventricle → VT, ≥7 → VF; a PVC on the T wave of an acutely ischemic heart → VF).
Engine API: `sim.startArrhythmia(type, opts)`, `stopArrhythmia()`, `shock()`, `giveAdenosine()`, `setDualAVN(on)`,
`stimulateAt(cell, t)`. Checks: `node tools/arrhythmia.js`, `tools/avnrt.js`, `tools/avrt.js`.

| Rhythm | Mechanism | Result |
|---|---|---|
| AF | 11 atrial foci at random 110–230 ms; random concealed conduction in the AV node | irregularly irregular, ~110–130 bpm; with WPW, pre-excited AF ~180 bpm |
| Flutter | true re-entry around the tricuspid annulus: RA conducts one way (counterclockwise), slowed circuit and isthmus, LA entered from the CS side | ~330–360/min, 2:1 conduction; sawtooth in II, revealed by adenosine |
| MAT | four atrial foci taking turns at 380–640 ms | ~120 bpm, varying P waves and PR |
| AVNRT | antegrade slow AV-nodal pathway (CS side, short refractoriness) + retrograde fast pathway; induced by a PAC 220–280 ms after the P | 174 bpm, narrow QRS, retrograde P at the end of the QRS; ends with adenosine |
| AVRT | orthodromic: down the AV node, up a left-sided pathway | ~190 bpm, narrow QRS, RP ~40 ms; ends with adenosine |
| VT | single ventricular focus, 330 ms | 182 bpm, QRS ~160–200 ms, AV dissociation |
| VF | 12 ventricular foci at random 140–240 ms | chaotic |
| Shock | depolarises all excitable tissue and prolongs refractoriness of the rest | terminates every rhythm above; sinus resumes |

| Ectopic atrial rhythm | one low right-atrial focus (≈25 mm from the AV node, near the CS ostium) replaces the sinus node at the set rate | inverted P in II, III, aVF, PR ~125 ms |

Atrial refractoriness now has a floor (APD ≥135 ms at the shortest intervals), and the AV-node post-repolarisation
refractoriness is 180 ms. Limitations: AF fibrillatory waves are fine (low amplitude); clockwise flutter is not offered
(the model's clockwise circuit runs too fast); AF, MAT, VT and VF are driven by foci rather than self-sustaining
re-entry.

### Round 6 revisions

- **Speed:** repolarisation enters the ECG sums as piecewise-linear pieces (8 segments per cell) instead of
  per-step updates, about 3× faster (0.21 ms/step in sinus rhythm, 0.36 ms in AF, headless), ECG within 0.03 mV.
  At most 40 simulation steps per frame, and allocation-free cell colouring.
- **Orientation and sources:** σ ratio 10 and rotation +12° give normal +63°, LAFB −58°, LPFB +95° (reads right axis
  deviation; the LPFB axis does not move past ~+96° with any orientation or fascicle setting tried).
  The chest-lead gain was raised (0.625 → 0.95) toward normal precordial voltages (V4 R 0.7 mV, V5 0.9 mV);
  LVH source gain is 1.5 (Sokolow 4.5 mV). Cornell is not applied when R dominates V1 (RVH).
- **Atria:** the right atrial wall is one voxel layer thicker (also drawn), with atrial source gain 0.4, so in LAE the
  first (right-atrial) hump of P mitrale is as tall as the second; normal P stays 0.21 mV.
- **Ischemia:** stronger injury (action-potential amplitude −55%, APD −45%) gives tombstone ST elevation; the injury
  current starts after ~10 minutes, so the 15-minute stop shows hyperacute T with modest ST elevation. Subendocardial
  patches are larger (radius 55 mm, wider inner-wall spread). Q waves are not called in leads with reciprocal ST
  depression. `node tools/ischaudit.js <sites> <hours>` reads every occlusion site at every slider stop. Limitations:
  mid/distal LAD and LCx infarcts show lost R waves rather than true Q waves; proximal RCA rarely forms inferior Q.
- **Adenosine** blocks the AV node for ~3 s after a 1 s delay. Dual AV-nodal pathways are always present.
- **UI:** four control tabs (Rhythm, Blocks, Ischemia, Structure; clicks stimulate only in Rhythm). Cut slider, view
  presets (Anterior, Lateral, Apex), labels, lead vectors and a legend toggle sit in a bar under the heart.
  Phones: landscape only, with a Heart | ECG switch showing one pane at a time; from iPad mini width both panes
  show (stacked when the tablet is upright).

### Round 7 revisions

- **Heart position:** a yaw about the body's vertical axis (+15°) swings the apex from anterior toward the left, with
  pitch −15° and rotation +14°. The long axis now points 43° below horizontal, 36° anterior (was 51°) and 45° from the
  left in the horizontal plane. Axes: normal +61°, LAFB −67°, LPFB +96°; LBBB reads ~+95° (a known limitation).
  The Anterior preset always looks along the four-chamber direction.
- **Septal blood supply:** septal perforators come from the proximal and mid LAD (the apical third gives few), so the
  septum at apicobasal level z is supplied from a fixed fraction of the LAD's length (not from the LAD node at the same
  level). Mid-LAD occlusions now take the mid and lower septum; distal LAD spares it, reading inferior + V3–V5.
- **Infarct size and Q waves:** cells die above severity 0.38 (was 0.6), necrosis reaches 70% through the LV wall
  (a surviving epicardial rim carries the late T inversion; the thin RV wall dies through), and late APD
  prolongation is 0.9. ST is read at J+20 and J+40 and counted only when both agree. A Q of ≥40 ms (≥0.05 mV) is
  pathological as well as ≥30 ms and ≥0.1 mV. Results (`node tools/ischaudit.js`, 2 days): LM Q I, aVL, V1–V3, V5–V6;
  proximal LAD Q I, aVL, V1–V3, V5; mid LAD QS V1–V3 with T inversion V2–V3; distal LAD Q aVF; LCx Q aVF and V6;
  RCA/PDA Q II, III, aVF. Limitation: LCx infarcts do not produce Q waves in I and aVL.
- **Rhythms:** the rate slider sets the atrial rate for ectopic atrial rhythm and MAT (MAT foci fire at that cycle
  length ±25%; starting MAT raises the rate to 120 and the previous sinus rate returns when it ends). AVNRT is induced
  as in an EP study: PACs after sinus beats at 280, 260 … 160 ms until one starts the tachycardia; slow-pathway delay
  50 ms per segment. Rapid-click gestures are gone; sustained arrhythmias start from the buttons, a timed PAC
  (AVNRT/AVRT) or a PVC on the T wave of an acutely ischemic heart (VF).
- **View bar:** External and Cut at either end of the cut slider jump straight to either state.

### Round 8 revisions (textbook calibration)

- **Limb leads:** the computed bounded-torso lead field made lead II 2.7× and III 3.2× as sensitive as lead I
  (real Burger triangles are within ~20–30%). That one distortion weakened lead I, pulled every axis toward +90°
  (LBBB +95°, LPFB stuck near +90°) and inflated inferior reciprocal changes. Limb leads now blend 60% torso field with
  40% Einthoven projection (`torsoBlend`), limb gain 3.0, chest gain 0.52.
- **Orientation:** yaw +8°, pitch −10°, rotation +14° (long axis ~53° below horizontal, 39° anterior).
- **Atria:** the apex swings about the base, so the atria turn less than the ventricles; atrial source directions are
  turned back 30° in the frontal plane (`atrialFrontalRot`). Atrial gain 0.31, LAE gain 2.6.
- **Normal ECG at 72 bpm:** PR 140, QRS 92, QT/QTc 380/416 ms; P +69°, 0.23 mV; QRS axis +18–24°; R in I 0.85, II 0.77 mV;
  R V1→V6 0.14, 0.36, 0.43, 0.63, 0.61, 0.81 mV (transition V4–V5). Blocks: LAFB −57°, LPFB +92°, LBBB +70°, RBBB LV axis
  unchanged. LVH Sokolow 4.0 / Cornell 3.9 mV with lateral strain; RVH R/S V1 1.06/0.18, R aVR 0.9, axis +154°.
- **Infarct timeline (not reperfused):** ST elevation follows a literature residual (100% at 1 h, 95% at 4 h, 80% at
  12 h, 45% at 2 days, 15% at 1 week, 0 by ~2 weeks). Necrotic muscle stays depolarised and half coupled early, turning
  to fully uncoupled scar as ST resolves. Necrosis is transmural by ~6 h; ahead of the front, severely injured muscle
  (after 2 h) is inexcitable but still drives injury current, so the QRS stays narrow. T inversion comes from the
  textbook "zone of ischemia": living muscle within 10 mm of the territory with prolonged repolarisation (late APD
  ×1.45 at the edge), 35% of which recovers by 1 month. QRS and QT ends with ischemia use the 99.5th activation
  percentile + 10 ms and the 98th repolarisation percentile (a few late or long cells don't set the interval).
  Sample (2 days): mid LAD ST elevation V3–V4 0.4 mV, T inversion V2–V5 to −1.1 mV, QS V1; mid RCA ST elevation III
  0.67 mV, Q II/III/aVF, T inversion aVF −1.35 mV; LCx Q I, aVL (−0.37 mV / 56 ms), V6, T inversion V6. 1 month: ST at
  baseline, Q waves and T inversion persist; QT 420–450 ms. With T inversion and Q waves the interpretation calls the
  infarct's age undetermined.

### Round 9

- **Mid-LAD Q waves:** septal perforators run from the LAD into the septum and fan out a little: the septum at level z
  is supplied from the LAD at z − 0.15 (`septalSpread`), so the drawn LAD and the septal territory stay consistent
  (an occlusion never infarcts septum well above it). The more proximal the occlusion, the more septal Q: just past
  D1 or at 30% of the LAD, QS V1–V3 (V1 from 4 h, V1–V3 by 2 days); at 60%, anterior/apical changes only; proximal
  adds the high lateral wall (Q in I, aVL). Early coupling of necrotic muscle 30% (was 50%), which keeps ST elevation
  clear at 12 h without masking the QS. `tools/ischaudit.js` samples mid LAD at 30%.
- **Smoother QRS at full speed:** phase-transition events are chained (each schedules the next) instead of ten being
  queued per cell during the QRS, the propagation loop skips the recovery term for fully recovered tissue, and the app
  caps simulation work at ~9 ms per frame, carrying the rest into the following frames. Worst 40-step chunk 59 → 33 ms.

### Round 10

- **UI:** control tabs (Rhythm, Blocks, Ischemia, Structure, Learn) sit in the top row of the heart view; clicking the
  open tab hides the panel (no separate header). The view name sits at the bottom left, above the view bar.
- **Learn tab:** generated from the interpreter's measurements of the current beat: a step-by-step reading (rate,
  rhythm, P/PR, QRS, axis, ST/T/Q, QT with this ECG's values), the key features of each active condition (rhythm,
  blocks, ectopy, hypertrophy, enlargement, WPW, ischemia stage) and pitfalls.
- **User guide** in sections (Getting started, Heart view, Control tabs, Rhythms, Ischemia, ECG panel, About).
- **T waves:** the limb-lead T waves were about twice textbook height (II 1.14 mV, taller than the R; aVR −0.86 mV).
  With the apicobasal APD gradient at +20 ms (`apdVentApexExtra`): I 0.48, II 0.61, III 0.30, aVF 0.43, aVR −0.51 mV;
  V3 0.38, V4 0.57 mV (V2 and V6 somewhat small, 0.14–0.15 mV). LVH strain and RVH patterns unchanged.

### Round 11

- **Real time on slower machines:** the ECG paper is drawn incrementally (only the slice swept since the last frame,
  ~0.1 ms/frame instead of a full redraw), the simulation runs first with a 60 ms budget and up to 250 steps per
  frame, and the 3D view adapts: when frames run slower than ~30 fps it is drawn every 2nd–4th frame and then at a
  lower pixel ratio (1.5 → 0.75), recovering when there is headroom. Headless software rendering: 0.43× → ~0.95× real time.
- **Pericarditis** (Structure): injured epicardium (outer 30% of the LV wall, RV and atrial epicardium; depolarised,
  lower or sagging plateau): diffuse ST elevation 0.1–0.27 mV (I, II, aVF, V2–V5), ST depression in aVR, PR depression
  in II (−0.1 mV) with PR elevation in aVR. Read as "acute pericarditis pattern".
- **Brugada type 1** (Structure): RV outflow epicardium under V1–V2 loses its AP dome (plateau starts at 20% and climbs
  back: per-cell plateau slope) and repolarises 50% later: coved J-point elevation ~0.4 mV in V2 descending into a
  negative T (V1 0.15 mV → −0.22 mV). Read as "Brugada type 1 pattern".
- **Flutter:** the circuit turned at the atrial refractory limit (~400/min). While flutter runs the atrial
  refractory floor is 185 ms: 291/min with 2:1 conduction (145 bpm).
- **AV-nodal ischaemia** (proximal RCA) lengthens nodal refractoriness and closes the slow pathway: first-degree AV block
  instead of the spontaneous AVNRT that scrubbing the time slider used to start.
- **Subendocardial ischaemia:** the RV patch now works (inner layers of the thin RV wall, half severity); injury
  scaled to textbook ST depression (0.1–0.4 mV). aVR elevation is −(I + II)/2 of the ST depression in I and II.
- **UI:** short tab instructions; Speed, Pause, Reset in the page header; Reset also clears structural changes and
  returns to 72 bpm; Help (renamed) in separate pages; Learn keeps key features and pitfalls only.

### Round 12

- **Pericarditis ST shape:** the inflamed epicardial plateau starts 40% low and partly recovers (`pericardSag` −0.55,
  a negative plateau slope), so ST elevation is highest at the J point (II 0.31 mV), sags mid-ST (0.14 mV) and rises
  again into the T wave: the concave-upward "saddle", not the early-repolarisation look. PR depression unchanged.
- **Dip before the T wave:** an artefact of the RV action potential being 30 ms longer than the LV's
  (`apdRVoffset`). Set to 0 (RV and LV APDs similar): the ST segment now rises smoothly into the T wave; T heights
  I 0.40, II 0.45, aVF 0.28, aVR −0.42, V3 0.41, V4 0.55 mV.
- **QT:** measured by the tangent method on the drawn ECG (steepest T downslope to baseline, later of II and V5), as
  on paper; normal beat QT 393 ms. QTc uses Fridericia (Bazett over-corrects at fast rates); flagged above 450 ms.
- **Fast rhythms:** repolarisation enters the ECG by convolution: each cell adds its lead weights once (at its
  repolarisation start) to a time histogram, convolved every step with the fixed smoothstep; plateaus stay linear
  pieces. Cells with an unusual plateau (Brugada, inflamed epicardium) keep exact segments. Cost per simulated ms:
  sinus 0.13 → 0.08, VT 0.65 → 0.39, VF 1.55 → 1.0 ms (headless browser ~0.9× real time in VT and VF).

### Round 14: limb-lead recalibration (fascicular block voltage)

LAFB and LPFB limb-lead voltages were about twice textbook values (aVL R 2.7, S aVF 3.0,
R III in LPFB 3.9 mV), larger than the limb leads in hypertrophy. Diagnosis: the 3D heart
vector grows only ~20% in fascicular block (2.6 → 3.1), and the plain Einthoven projection
gives textbook voltages (aVL 1.8, R III 1.6 mV). The inflation came from the computed torso
(Burger) triangle, whose lead II and III vectors were 2.6× and 3.1× the length of lead I,
amplifying the coherent superior/inferior late forces of a blocked fascicle against a normal
beat whose inferior forces largely cancel. The torso's tilt of lead I (−30°) is kept, since it
gives the rS in I of LPFB.

- `torsoIIGain` 0.6 shortens the torso lead II for ventricular sources (`atrialTorsoII` 0.92
  keeps the P-wave calibration); `torsoBlend` 0.6 → 0.7.
- `limbRotation` 8°: the limb leads see the ventricles turned 8° more vertical (source
  directions only), leaving precordial leads and anatomy unchanged. Larger rotations (12°)
  gave a normal axis near +45° but moved the inferior Q out of lead II.
- `torsoUniform` (0, off) blends a heart-averaged torso lead vector into the per-cell field;
  it showed the regional variation of the torso field is not the cause.

| | before | after |
|---|---|---|
| Normal axis (area/net) | 22/13 | 33/26 |
| LAFB axis, aVL R, S II, S aVF | −58, 2.7, 2.2, 3.0 | −48, 2.4, 1.3, 2.1 |
| LPFB axis, R III | +92, 3.9 | +100, 3.2 |
| LBBB axis | 70 | 77 |
| P II, normal | 0.23 | 0.23 |

Precordial leads are unchanged. The ischemia audit keeps every territory. Inferior Q in II now
appears later (pRCA, PDA), and reciprocal aVR depression in RCA occlusion is smaller.

### Round 15: ischemia time-slider descriptors checked against the ECG

Every occlusion site (LM, p/m/d LAD, p/d LCx, p/m/d RCA, PDA) and four subendocardial
patches (anterior, lateral, inferior, RV) were measured at every slider stop (ST at J+40,
T peak, Q by the app's rules). Transmural course: tall T and modest ST at 15 min; ST peak
at 1 h; about two thirds of peak at 4 h with Q waves already forming; about half at 12 h with
T inversion beginning; a quarter at 2 days with deep T inversion; baseline ST, persisting Q
and T inversion at 1 month. The stop texts now say this, and the circumflex gets a note
(ST depression V1–V3, slight V5–V6 elevation, no Q waves for distal occlusions).

Model fixes for subendocardial ischemia:
- The innermost layer (Purkinje junctions) no longer dies under a subendocardial infarct
  (it is fed by cavity blood); its loss had produced Q waves in aVL and V1–V3 from 12 h.
- No late APD prolongation in subendocardial ischemia: prolonging the inner wall only
  steepened the normal transmural gradient, giving T waves 2–4× too tall at 2 days.
- Remaining: the inferior patch deepens the inferior q to ~30 ms, 0.2–0.3 mV with R kept.

### Round 16: share links, ECG export, offline build, licence

- Share (top bar) copies a link whose `#` part holds the scenario: `r` rate, `a` arrhythmia,
  `v` AF/flutter ventricular rate, `b` blocks (`SITE.type`), `o` occluded coronary nodes, `se`
  subendocardial cells, `h` hours, `s` structure flags, `ap` accessory pathway. Every field is
  validated against the app's own lists. With blocks or ischemia, 2.6 s of healthy rhythm run
  first so the interpretation has the heart's normal beat for comparison.
- Save PNG (ECG pane) downloads the tracing with the interpretation above it and a
  "simulated, not a patient record" stamp.
- Three.js r128 and OrbitControls are vendored (`vendor/`) and inlined: the app runs offline.
- `site.json` holds the author, contact and year shown in Help → About and the page metadata;
  the build stamps the version (date + commit). `LICENSE`: all rights reserved.

### Round 17: old-infarct Q waves (scar as an electrical window)

Old LAD infarcts left a small early r (0.05–0.2 mV) in V1–V4, so the tracing read as poor R
progression rather than Q/QS, and V4 never qualified. Cause: with the anterior septum dead, the
surviving RV free wall (moderator band, ~20 ms) and the PDA-supplied inferior septum still push
the anterior leads positive before the posterior LV forces arrive. Near-field weighting,
anisotropy and the Brody effect all scale normal R and infarct r together; moving the
conduction system (LAF toward the apex, faster Purkinje) helps but disturbs the normal axis.

Fix that leaves every non-infarct ECG untouched (`scarWindow` 0.5): a transmural scar acts as
the classic "window". Dead cells are activated as phantoms (from living muscle, Purkinje and each
other, never back into living tissue, `scarRefractory` 200 ms) and add −scarWindow × vAmp × their
pair sources, using only pairs inside the scar, so a fully activated scar sums to exactly zero:
no ST/T contribution and no step when it resets (measured 0.000 mV). Subendocardial scars are
excluded (covered by living muscle).

| Site, 1 month | Q before | Q with scarWindow 0.5 |
|---|---|---|
| LM | I aVL V2 V3 V5 V6 | I aVL V2–V6 |
| pLAD | I aVL V1–V3 V5 | I aVL V1–V5 (clean QS, r ≤ 0.02 mV) |
| mLAD | aVL V1–V3 | aVL V1–V5 |
| dLAD | III aVF | II III aVF |
| pLCx / dLCx | I aVL V6 / none | I aVL V6 / V6 |
| RCA, PDA | II III aVF | II III aVF (II from 12 h) |

Unchanged: normal ECG (identical), blocks, ST/T course of every site, subendocardial patches.
Reciprocal R grows somewhat (proximal RCA: R in I 1.1 → 1.5 mV). Remaining: an apical (distal
LAD) infarct keeps R in V3–V4, because the apex is activated late (20–27 ms) by the Purkinje
network; fixing that needs the conduction-system retune described above. `ladRvMm` (LAD supply of
the anterior RV strip) stays off.

### Round 22: coronary territories against the AHA 17-segment model (from branch cs-tune)

`tools/aha_segments.js` measures which artery supplies each AHA wall. The model gave most of the
anterolateral wall to the LAD (64–74%), where the AHA typical assignment is the circumflex. Two
causes: the diagonals reached too far round and OM1 ran too posteriorly; and the proximal LAD,
which curves from the left main round the pulmonary trunk to the anterior groove, was claiming the
basal anterolateral wall through the nearest-node rule although it gives no free-wall branches on
that stretch. Fixes: OM1 down the anterolateral–lateral wall, diagonals at the anterior–anterolateral
junction, proximal-LAD nodes lateral of `ladProxFreeWallPhi` excluded from free-wall assignment.
Agreement with AHA 81% → 88%; anterolateral wall now 78–85% circumflex. Proximal LCx at 1 h gives ST
elevation in I, aVL, V5–V6 with reciprocal III/aVF and posterior (V1–V4) depression (was V6 only);
mid LAD loses I/aVL and shows the wrap-around inferior pattern; distal LCx unchanged.

### Round 23: LAD in the anterior interventricular groove

The LAD shared its first ~15 mm with the circumflex (LAD–LCx angle 0°, gap 0 mm; 9–14° by
20–30 mm), so the two could not be told apart when clicked. Cause: its first waypoint was given in
the rotational coordinate (angle 1.6 at 75% height), which is distorted near the base and landed
53 mm from the left-main split, round the free wall; the shortest surface path ran out along the
AV groove with the LCx and swept back. The LAD waypoints are now taken from the anatomy: LV
epicardium bordering the RV anteriorly (the anterior interventricular groove) at 80/65/50/35/20%
height, then round the apex as before. The LAD now leaves the left main at ~50° and is 70–75° from
the LCx by 20–30 mm (anatomical bifurcation angle typically 70–90°), passing left of the pulmonary
trunk straight down the groove. AHA agreement 88% → 89%. Ischaemia audit: proximal LCx old infarct
adds Q in V5–V6; mid-LAD old infarct Q in III and V1–V3 (was III, aVF, V1–V4); distal LAD at 1 h
ST elevation V2–V5 (was V1–V5); other sites unchanged.

### mobile-1 round 1: Conditions tab

- The Structure tab is now **Conditions**: a list of active conditions (each removable with ×),
  "+ Add condition" opening a searchable catalogue grouped by category (Chambers, Accessory
  pathways, Pericardium, Channelopathies) showing names only, and up to four recently used
  conditions (kept in this browser's localStorage only).
- Every condition is one entry in `CONDITIONS` (`src/app.js`): id, category, short label, name, extra
  search words, `apply(value)` for the simulation, `options` for a choice such as the WPW pathway location,
  and `rebuild: true` for conditions that rebuild the heart (LVH, RVH). The tab, search, Reset,
  share links and the hypertrophy cache key all read this list. To add a condition: an entry
  here, its engine setter, and its interpretation/Learn text.
- Share links are unchanged (`s=` on/off conditions, `ap=` pathway), so older links still open.
- AVNRT/AVRT set or clear the pathway through `setCondition`, so the active list stays in step.
- Engine untouched; validation tools not affected.
- Fix: a click on the heart surface near an artery could pick a side-branch node (D1, OM1, …),
  which is not offered for occlusion, and throw; only the offered vessels are searched now.

### mobile-1 round 2: phone layout prototype

Phones get their own layout (`body.m`, set by `setMode()` from two media queries: portrait
width ≤ 743 px, or a touch screen ≤ 500 px tall held sideways). Tablets and desktop are unchanged.

- Portrait only: heart (44%) above the ECG, interpretation bar under the ECG, tab bar at the
  bottom. The old landscape-only phone layout and "turn your phone sideways" prompt are gone;
  a phone held sideways shows the full 12-lead ECG instead.
- ECG: one lead group at a time (I–III, aVR–aVF, V1–V3, V4–V6), swiped or picked with the dots,
  drawn swept at 25 mm/s and 10 mm/mV over 2.5, 5 (default) or 10 s (`drawLeads`). A double-tap
  shows the full 12-lead sheet turned 90° (flip button for the other way), interpretation in a
  collapsible column on the left and a fixed lead II rhythm strip; double-tap again to return.
- Interpretation bar: rhythm and measurement chips; a tap expands it with the findings.
- Controls: the tab bar opens the existing panel as a bottom sheet in the page flow (half
  height, so the heart and ECG stay visible), or full height by dragging or tapping the handle.
  Drag down or swipe down at the top of its content to close.
- Header: speed chip (tap to step 1× → 1/50×), ⏯ (tap pause, press and hold reset), ⋯ menu
  (share via the system share sheet, save ECG image via the share sheet or download, help).
  The image export draws the 12-lead sheet offscreen when it is not on screen (`sheetCanvas`).
- Heart gestures (tab-independent; `initTouch`): tap muscle = PAC/PVC; three taps within 0.5 s
  on the right atrium = flutter, left atrium = AF, ventricles = VT, a fourth = VF (each tap still
  stimulates, as in burst pacing). In the cut view, tap the AV node or His bundle to step
  none → 1st degree → Wenckebach → 2:1 → Mobitz II → complete (nodal) → complete (His) → none,
  three quick taps = AVNRT (AVRT with a pathway); tap the SA node to step SA exit block → pause →
  arrest → none; tap a bundle branch or fascicle to toggle it. Conduction paths are drawn 1.6×
  thicker with a wider touch target, and a tap snaps to the nearest conduction point within
  22 px. Press and hold (0.55 s, with a filling ring) = occlusion, or subendocardial ischemia on
  the cut face or inner wall; the Ischemia sheet then opens. Taps are timed by the touch event's
  own timestamp, so a busy frame does not split a burst.
- Opening the Blocks tab cuts the heart and turns to the four-chamber view (not undone on leaving).
- Double-tap empty space beside the heart: full-screen heart with one live lead (tap to change
  lead). Floating Shock (VT/VF) and Adenosine (AVNRT, AVRT, flutter) buttons.
- Each sheet, menu, popover and full-screen view is a history entry, so the system back button
  closes it first. Page pinch-zoom, text selection and long-press callouts are off on the
  touch surfaces.
- `ECGStudioApp.touchTarget(x, y)` reports what a tap at a page point would act on (tests).
- Help guide text is unchanged (written for the desktop); the phone tab notes describe the gestures.

### mobile-1 round 3: phone layout feedback

- Full-screen heart keeps the tab bar and the controls sheet (ischemia, conditions… stay reachable);
  a double-tap on its live lead returns to the two-pane view (a single tap still changes lead,
  after a short wait).
- View controls (cut slider, Anterior/Lateral/Apex, labels, leads, legend) moved from a popover
  over the heart into a **View** tab in the tab bar; Learn moved to the button at the heart's top
  right. The sheet is now as tall as its content (up to 42% of the screen), so the heart's angle
  and cut stay visible while adjusting them.
- Heart pane 44% → 50% of the two-pane view (the three-lead ECG had spare room between leads).

### mobile-1 round 4: phone sheet over the ECG, sliding lead groups

- Heart pane 60% of the two-pane view. Tab bar order: Rhythm, Blocks, View, Ischemia, Conditions.
- The controls sheet now floats over the ECG (fixed above the tab bar, as tall as its content up
  to the ECG pane's top, `--sheetmax` from `sizeSheet()`), so opening a menu never resizes the
  heart. Over the full-screen heart it may cover the lower 45%. Dragging the handle up still
  gives full height.
- Lead groups slide: while swiping, the strip follows the finger with the neighbouring group
  drawn beside it (`#cgroup2`); past a quarter of the width or on a quick flick it slides on
  (0.22 s), otherwise it slides back. Tapping an adjacent page dot slides too.

### mobile-1 round 5: phone ECG controls over the grid, live-lead menu

- The strip under the lead groups is gone: the tracing fills the ECG area and the seconds button,
  smaller page dots (centred) and the one-time double-tap hint float over the grid.
- Full-screen heart: the live lead's label is a button that opens a 12-lead menu (closes with the
  back button or a tap outside); a double-tap on the strip still returns to the two-pane view.

### mobile-1 round 6: ischemia time scrubber on the heart

- While any ischemia is present, a slim time scrubber runs along the bottom of the heart pane
  (above the live lead on the full-screen heart), replacing the view label. It has the same seven
  discrete stops as the Ischemia tab's slider (Onset … 1 month) and stays in step with it in both
  directions, so time can be scrubbed while the ECG stays visible. Floating Shock/Adenosine move
  up above it; it disappears when the last occlusion or patch is removed. Phones only.

### Round 24: chest-lead directions toward Dower; V1/V2 one space higher

The chest leads' dipole directions (heart centre → electrode) pointed 30–35° too far to the
patient's right for V1–V4 compared with Dower's measured lead vectors (V2 at 109° vs 88° in the
transverse plane); I and V6 already matched within ~5°. `dowerChest: 0.5` blends each direction half
way to Dower's (Frank torso; a blend because that torso is not this heart's), and `v12Y: 24` puts
V1/V2 24 mm higher above V4–V6 (4th intercostal space at the sternal edge; the ribs slope down to V4
in the mid-clavicular line). The Leads view draws the chest arrows along these directions.
Normal R/S V1–V6: 0.17/1.10, 0.38/1.48, 0.46/1.56, 0.59/0.62, 0.84/0.03, 0.84/0.06 (was 0.14/1.13,
0.36/1.84, 0.42/2.05, 0.62/1.24, 0.60/0.02, 0.81/0.06): R grows to V5, transition at V4. Limb leads,
blocks and fascicular blocks unchanged; ischaemia audit: LM adds V3 STE, distal LAD at 1 h adds V1,
old distal LAD adds a Q in V6, proximal RCA adds V3 to its reciprocal depression; anterior STE and
old anterior QS kept.

### Round 25: true anterior view; the old "Anterior" preset is now "4-chamber"

The default camera preset looks along the four-chamber plane, which is tilted well away from the
chest. It is now labelled **4-chamber** (still the default, and still used for block clicks on the
phone), and a new **Anterior** preset looks from the front of the chest: camera on the torso's
anterior axis, head up, patient's left on the viewer's right. The 3D scene is already in the torso
frame the lead fields use, so in this view the limb-lead vectors lie in the screen plane, V2 points
almost straight at the viewer and V1–V6 fan from the viewer's left to right; a cut from here is a
coronal (frontal) section. Help → View controls lists the four presets.

### Round 26: textbook lead axes in the Leads view; model lead vectors on request

The Leads view drew the limb leads from the raw torso lead field alone (I −30°, II +81° ×2.6,
III +98° ×3.1 relative to I), more distorted than Burger's measured triangle (via Dower/Frank:
I −20°, II +78° ×1.6, III +107° ×2.0) and not what the ECG uses, which blends that field with
Einthoven's axes (`torsoBlend`, `torsoIIGain`, `limbRotation`): heart-averaged I −23°, II +74° ×1.4,
III +108° ×1.8, close to Burger. (Malmivuo & Plonsey, *Bioelectromagnetism* ch. 18, covers these
distortion factors: torso boundary, heart eccentricity, lungs, intracavitary blood.)
For teaching the view now shows the textbook reference by default: Einthoven's hexaxial frontal
axes and the standard horizontal-plane chest fan (V1 120°, V2 90°, V3 75°, V4 60°, V5 30°, V6 0°
from the patient's left toward anterior). The legend's switch ("Textbook axes" ⇄ "Model lead
vectors") shows the vectors the model computes with: the blended limb vectors (engine exposes
`limbTorsoVec`, the torso part per unit heart vector) and the Dower-blended chest directions.
Textbook chest arrows keep the textbook azimuths but take each electrode's height from the heart
centre: V1/V2 (4th intercostal space) 27–36° up, V3 22°, V4–V6 (5th space, level with the heart
centre) about 0°.

### refine-2 round 1: inferior wall to the PDA; the LAD ends at the apex

Strategy for this branch: fix the LAD misses first, then move position and activation toward
physiology without losing what the live model does well; every change is gated on
`tools/fullcheck.js` (ischaemia lead groups at 1 h and 30 days, axes, QRS shape) and, for activation,
`tools/acttune.js` (mapping data). The checker now expects no inferior ST or Q from LAD occlusions
(the inferior wall is mainly PDA territory in right-dominant hearts).

Changes: the LAD stops at the apex (no wrap onto the inferior wall; drawn shorter too); the PDA runs
down the inferior groove almost to the apex; the apical cap is LAD except its inferior face above the
tip (`apexTipZ` 0.06), which goes to the PDA (AHA: apex 17 = LAD, apical inferior 15 = RCA).
AHA agreement 89% → 91%. Checker misses 13 → 5 (mid LAD: STE V1–V5, Q V1–V3, no inferior changes).
Normal ECG and blocks unchanged.

Still open: old mid-LAD infarct lacks a Q in V4 (r 0.60 → 0.38); old distal LAD (apical) infarct
shows a QS in III instead of Q in V4–V5. Causes: the apex lies ~35 mm below V4 and activates late
(30 ms; Durrer 8–24 ms), so its loss trims the R instead of making a Q. Tried and rejected here
(each alone): stronger scar window (0.7/0.9: no anterior Q, more inferior), chest leads lowered to
the apex (worse, 8–11 misses), faster Purkinje (2.3–3.4 m/s: loses pLAD/mLAD Q), faster apical
Purkinje (`apexPurkMul` 1.8–2.5, added off by default: apex 21–26 ms but normal axis −22 to −49°).
Activation and lead geometry have to move together (next round). New options, off by default:
`chestLeadY`, `apexPurkMul`/`apexPurkZ`.

### refine-2 round 2: joint re-fit of activation, position and lead settings (not adopted)

`tools/refit.js` scores a set (3 × ischaemia misses, +10 per miss beyond the baseline; axes with the
normal axis per 3°; ½ × the QRS checklist; ½ × the activation-mapping score); `tools/es_tune.js`
optimised Purkinje speed, apical Purkinje, junction delay, bundle speed, heart orientation and the
limb/chest lead settings within physiological ranges (40 generations × 8; ~23 s per evaluation after
removing duplicated occlusion runs, caching the hypertrophy anatomies and 3 s ischaemia beats).
Best set (tools/data/refit_round2.json): score 35.5 → 16.2; normal axis +29 → +43° (app reading),
activation score 12.8 → 5.3 (apex 30 → 25 ms, HV 24 → 27 ms, Purkinje 2.25 m/s, PMJ 4 ms); blocks,
WPW, P waves, hypertrophy and arrhythmias keep their patterns, QRS ~6 ms narrower. Not adopted:
LAFB −48 → −37/−40°, old mid-LAD Q V1–V3 → V1–V2, old distal-LAD Q still absent in V4–V5, PDA at 1 h
adds V1/V4 STE. The scoring weighted LAFB lightly and read Q waves on a shorter beat than the audit.

### refine-2 round 3: activation-only re-fit with the septal fascicle (not adopted)

The septal fascicle's block is now tied to its parent division (the posterior one here), as on
cs-tune: RBB + LAF + LPF stays complete, and clearing the block releases the septal fibres (off by
default). Alone it moves Durrer's mid-septal early site from 9.6 to 4–6 ms but delays the anterior
and posterior sites ~3 ms, and the territories are walled off by `purkCrossSlow` 6.8.

Tool fix: the checker, activation score and optimiser had defaulted to a 2-layer LV wall (the test
model's); the app's normal heart has 3. They now take it from `hypertrophyOptions`. On the app heart,
round 1 has 9 checker misses (not 5): old mid-LAD Q missing V3–V4; distal LAD STE/Q in III/aVF and no
STE in V5; PDA STE in V1. Normal +33°, LAFB −49°, LPFB +100°, activation score 15.3, apex 29 ms.

Activation-only re-fit (Purkinje speed, apical network, septal fascicle territory/landing,
cross-link slowing; position and lead settings fixed; tools/data/refit_round3.json): misses 9 → 8
(mid-LAD Q gains V3, distal-LAD inferior Q gone; distal-LCx Q in V6 lost), activation 15.3 → 7.0,
apex 25 ms. Not adopted: LPFB by tools/fascsearch.js +83/75° (no right axis deviation; the re-fit's
own measure read +94°), and the LAD Q waves in V4–V5 are still absent. Activation alone does not fix
them; the apex geometry (apex ~35 mm below V4, facing the inferior leads) is the remaining lever.

### refine-2 round 4: literature target for the distal LAD; more local field in the chest leads

Checker: the distal LAD is tested just past the second diagonal (the apical-anterior infarct) and
judged against the MRI-based classification (Bayés de Luna et al., Circulation 2006): Q waves
V1–V2 extending to V3–V6, none in I/aVL (core V2–V4); ST elevation V3–V4; no inferior changes (the
inferior wall is PDA territory here). Round 1 on this target: 7 misses.

Infarct size is not the limit: at 30 days the whole downstream territory is dead (`ischDeadS` has no
effect then); a distal-LAD infarct is 16% of the LV, yet V4/V5 early r rises slightly and the only Q
is in III. The apex lies ~35 mm below V4, under no chest electrode; V3–V4 overlie mid-anterior wall.
Lowering the chest leads to the apex or turning the heart (pitch −25°, yaw 18°, rotation 4°) and
raising the apex all made the ischaemia pattern worse (10–13 misses).

Change: chest leads take 45% of their signal from the local field (`precordialDipoleW` 0.7 → 0.55).
Misses 7 → 5: mid-LAD old-infarct Q gains V3, PDA occlusion loses its V1 ST elevation. Limb leads,
axes, fascicular and AV blocks, arrhythmias, P waves unchanged. Chest voltages ~15% lower (normal
V2 R/S 0.32/1.28, R V1–V6 0.14, 0.32, 0.30, 0.49, 0.79, 0.73); LVH (lv 6) Sokolow 4.20 → 3.70,
Cornell 2.70 → 2.52; WPW delta polarity in V1–V5 shifts toward ± in some sites. 0.5 dips V3 below V2;
0.6 keeps the PDA V1 ST elevation. Still missing: old mid-LAD Q in V4; old distal-LAD Q in V2–V4
(Q in III instead).

### refine-2 round 5: torso-based local field for the chest leads (option, off)

`chestTorso` takes the electrodes' local potentials from a volume conductor solved for the live
heart (tools/export_heart_torso.js + tools/torso_v2.py → src/torso_v2.json: lungs 0.04 S/m, liver,
spine, cavity blood; its own Burger triangle I −16°, II +68° ×1.7, III +100° ×1.9) instead of point
sources; the heart-vector part and the limb leads are unchanged. At `precordialDipoleW` 0.55 it gives
the same 5 checker misses as the point-source version with better normal progression (R V1–V6 0.14,
0.35, 0.39, 0.53, 0.91, 0.83). Off by default; the browser build does not embed the field yet.

Apical (distal-LAD) Q in V2–V4 still absent with either local field. Diagnostic: with the measured
source ratio (sigmaRatio 3; live 10) the apical infarct removes much more early anterior force
(early r V2 0.67 → 0.41, V3 0.99 → 0.76, V5 0.59 → 0.36) but still no Q, and the whole normal ECG
changes (V3 R ~1 mV, axes). The test model's apical Q came from its combination: CT orientation,
measured source ratio, early apex (16–20 ms) and a physical torso for every lead.

### refine-2 round 6: explicit septal perforators (option, off) and what they show

`septalPerf` (fractions along the LAD, e.g. [0.14, 0.3, 0.45, 0.6]; default off) gives the septum to
explicit perforators: each supplies the septal band from its origin down to the next, S1 also the
basal septum above it. No necrosis above an occlusion. Checker misses 5 → 12: mid- and distal-LAD
infarcts lose all anterior Q and show QS in II/III/aVF (mid LAD early r V1–V4 0.14/0.32/0.30/0.49 →
0.11/0.29/0.29/0.43; II/III/aVF → ~0). Not fixed by a silent scar (`scarWindow` 0: 11 misses), the
measured source ratio (3 or 5: 11–12), or the torso chest field (12). The anterior Q waves of the
default rule come from the extra, early-activating septal necrosis (upward reach `septalSpread`);
loss of anterior free wall, D2 territory and the apical cap projects onto the inferior leads (the
apex faces down as well as forward in this CT heart). The default rule is kept as a documented
compensation; making the anterior free wall's early forces visible to V2–V4 needs a forward-model
rebuild with re-tuned activation rather than further parameter search.

### refine-2 round 7: regional decomposition of the LAD infarct signal (diagnostics only)

Following an outside review, each lead was split by region (sum over voxel pairs, exact to 1e-8;
`tools/regiondecomp.js`), with activation geometry (`tools/actgeom.js`), Purkinje breakthroughs
(`tools/purkbreak.js`) and a transmural/tangential source split (`tools/srcsplit.js`). Septal
perforators on (`septalPerf` [0.14, 0.3, 0.45, 0.6]).

- The early r in V2–V3 comes from the upper (zuvc ≥ 0.5) anterior wall and septum (20–25 ms: V2
  +0.17–0.23, V3 +0.27–0.31 mV), which mid- and distal-LAD infarcts leave alive.
- The lower anterior wall and septum (0.25–0.5), which they kill, are activated from above
  (anterior endocardium 19 → 23 → 26 ms base to apex; apex median 29 ms) and point down
  (Y −0.12 to −0.22): losing them gives the inferior Q. The apex itself projects correctly
  (forward-left, V3–V4).
- Not the cause: source anisotropy (sigmaRatio 1/3/10 give the same anterior loss), the
  heart-vector part of the chest leads (the local part agrees), Purkinje speed alone
  (cvPurkinje 3, purkCrossSlow 1: breakthroughs 11–16 ms, anterior forces unchanged).
- Apical Purkinje links faster (apexPurkMul 4, apexPurkZ 0.5) turns the lower anterior forces
  forward-left and fits mapping better (acttune 15.3 → 6.5, apex median 13 ms). Full check
  (ISCH_MS 3600): misses 15 → 10, no inferior Q from LAD infarcts, V4 Q appears; but the normal
  axis swings to −53° (LPFB 80°). With cvPurkinje 3 and purkCrossSlow 1 as well: 8 misses, V1–V3 Q
  in proximal/mid LAD, axis −26°, LPFB 40°. Next: why an apex-first sequence moves the normal
  axis left (late basal/superior forces) rather than tuning further.

LAD supply of the anterior RV strip (`ladRvMm`, perforators on, ISCH_MS 3600). The strip (4–12% of
the RV) adds little to V2–V3 at 20–40 ms (≤ 0.01 mV) and slightly deepens the inferior Q; its 1-h
injury current adds inferior ST elevation. Misses: 15 → 18 (10 mm), 19 (20 mm). With the apex-first
sequence (apexPurkMul 4, apexPurkZ 0.5): 10 → 11 / 13; at 20 mm mid LAD gains Q V1–V5 (all core
leads) but Q and ST in II, distal LAD Q V3–V5. Kept off; worth revisiting once the axis of the
apex-first sequence is understood.

Why the apex-first sequence moves the normal axis left (QRS area per region in I/aVF, mV·ms over
0–100 ms, `AREA=1 TMAX=100 REG=time tools/regiondecomp.js`). Current model: net aVF only +8.4 out of
regional terms of ±15 (septum I −15.6, RV I −14.9, lateral I +21.3); the inferior share comes from the
apex (+6.7), anterior wall (+5.6) and inferior wall (+3.0), the first two because they are activated
base → apex. Apical cap alone 4× faster (apexPurkZ 0.25): apex +1.6, anterior +1.9, lateral −0.7 →
axis −19°. Below 0.5 (4×): the lateral wall fills apex → base (18/23/28 ms) and its aVF area goes
+2.6 → −29.3, RV −3 → −11 → −60° (−42° with pure Einthoven limb leads, so not the torso field).
Limiting the speed-up to the paraseptal wall (new `apexPurkPhi`, default off) does not help
(−53° to −57°). So the normal inferior axis and the wrong LAD Q share one cause: forces pointing
down because the lower walls are activated from above. A literature apex-first sequence needs an
inferior force the model is missing (candidates: oversized rightward septal and RV areas, the
heart's frontal tilt within the normal range, the inferior wall's late upward basal sweep).

Candidate 1, earlier right-septal activation (`rbbSeptalFrac`/`rbbSeptalDelay`, RV septal Purkinje
from the right bundle). The septum's lead-I area goes −15.6 → +4.6 and the RV's −14.9 → −0.2, but
aVF barely moves, so the axis turns toward 0° (current sequence 32° → 7–26°) and the apex-first
sequence stays left (−28° to −49°, from −60°). It also reverses septal activation (right face 15–16
ms before the left 23–35 ms; acttune 15.3 → 23–67). Rejected: the missing inferior force is not the
septum. The apex-first deficit is the lateral wall (aVF −29.3, unchanged by any septal setting).

Lateral wall and wall thickness (`tools/lattime.js`): transmural transit is 35–40 ms (endocardium
20–37, epicardium 50–74 ms), and only ~10% of endocardial cells are Purkinje breakthroughs. The CT
heart's own LV wall is 9.5–10.8 mm (cavity-to-epicardium); the +3 layers make the mid lateral and
inferior walls 14–15 mm (hypertrophy range). Without them transit is 20–25 ms and acttune improves
(15.3 → 11.3), but the area axis is −81° (apex-first −78°): the extra layers compensate for missing
inferior force. Frontal tilt (`heartRotation` −6…44, long axis 33–80°) does not rescue apex-first
(−68° … −24°); torsoIIGain 1 only scales.

Brody effect (`brody`, radial sources ×(1+B), uniform through the wall; off until now) restores it.
Area axis, current/apex-first: +3 layers B 2: 56°/6°, B 3: –/26°; normal wall B 2: 52°/−34°, B 4:
–/25°. Full check (perforators on, ISCH_MS 3600; misses, normal/LAFB/LPFB axes by the standard
measure):

| variant | misses | N / LAF / LPF | LAD Q |
|---|---|---|---|
| perforators (reference) | 15 | 33 / −49 / 100 | II III aVF (mid, distal) |
| B 1 | 11 | 49 / −29 / 92 | III aVF (mid, distal) |
| apex-first, B 2 | 10 | 8 / −8 / 60 | none (mid, distal) |
| apex-first, B 3 | 14 | 25 / 15 / 58 | none |
| normal wall, B 2 | 10 | 53 / −19 / 90 | none; R V1 0.39 |
| normal wall, apex-first, B 3–4 | 14 | 7–25 / −16…24 / 47 | mid LAD V1–V2 |

The Brody term removes the inferior Q of LAD infarcts but not the missing V2–V4 Q (the upper
anterior wall that makes the early r survives these infarcts), and it costs the fascicular axes.
Not adopted. The uniform B overstates the effect away from the cavity; a cavity-distance-weighted
form would be the physical version.

Coronary anatomy of the anterior wall. The septal territory rule is phi 0.1–1.7 and the LAD runs
at phi ≈ 1.7, so the AHA "anterior" 60° sector of the earlier tables (1.05–2.09) is half anterior
septum. Split by supply (`SUPPLY=0.18,0.3,0.45 SEPT=1 REG=time`), the normal early r in V2–V4
(25 ms: V2 +0.28, V3 +0.39, V4 +0.33) comes almost entirely from tissue fed before 18% of the LAD:
the S1 septal band and D1's upper free wall. The mid-LAD test site (`Math.round(0.3·len)`, node 10)
lies one node below S2 (node 9), so S2's septal band (395 cells at zuvc 0.5–0.67) survives it, and
D1 (waypoints phi 1.8–1.9 down to zuvc 0.4) runs beside the LAD and takes the mid-anterior wall.

Options (off): `d1Path`/`d2Path` replace the diagonal waypoints; tools/fullcheck.js and
regiondecomp.js take `MLAD_F` (mid-LAD site as a fraction of the LAD) and fullcheck `QDBG=site`
(prints the Q/QS measures); tools/earlyqrs.js prints early QRS samples normal vs infarct.
Diagonals across the anterior wall (D1 [[2.05,0.65],[2.3,0.45]], D2 [[1.95,0.38],[2.15,0.18]]; AHA
agreement 91 → 89%) and the mid-LAD site just after S1/D1 (MLAD_F 0.22): mid LAD r40 V1–V4
0.19/0.44/0.41/0.66 → 0.04/0.16/0.11/0.42 mV (V1 QS, V2–V3 poor R progression just above the QS
threshold r40 < 0.1), inferior Q only in III; misses 15 → 13 (with Brody 1: 10, mid LAD r 0.06/0.18/
0.28/0.40, no inferior Q). Distal LAD r in V1–V4 is unchanged in every variant: its territory (apex
and lower walls) does not make the early anterior forces.

Full regression of the lateral diagonals as default (candidate eaef6ef, reverted). Identical:
evalecg, fascsearch, blocks, wpw, pwave (both), hyper, stcheck, arrhythmia, avnrt, avrt. Changed:
AHA agreement 91 → 89% (mid anterolateral LCx 95 → 79%, apical lateral LCx 69 → 58%: the diagonals
take marginal territory); full check on the live septal rule 7 → 8 misses (mid LAD adds ST elevation
in I; MLAD_F 0.22: 7), with perforators 15 → 15 (0.22: 13); ischaudit: proximal LAD gains Q in aVL/V4
at 12 h (good), mid LAD gains ST elevation in I/aVL at 1 h, distal LAD in II at 1 h, proximal LCx
loses 500 cells and V5 ST elevation at 12 h. The V2–V3 r loss needs the perforators as well, so the
change is a trade-off, not a pure gain; a shorter diagonal course that stays out of the
anterolateral sector is the next variant to try.

D1-only course (variant H, `d1Path` [[2.0,0.66],[2.1,0.52]], D2 unchanged; AHA 90%, apical lateral
LCx 69% kept, mid anterolateral 95 → 88%). No gain: full check 7 → 8 on the live rule (mid LAD ST
elevation in I), 7 at MLAD_F 0.22 (same as the built-in diagonals at 0.22); with perforators 15 → 16,
and 14 at 0.22 (built-in at 0.22: also 14). It still costs the proximal LCx (8140 → 7929 cells, V5 ST
elevation lost at 12 h) and gives proximal LAD a V4 Q at 12 h. The diagonal course is not what
limits the anterior Q waves; the mid-LAD site after S1/D1 (MLAD_F 0.22) is neutral on the live rule
(7 → 7) and gains one miss with perforators (15 → 14). Built-in diagonals kept.

Mid-LAD test site now 22% of the LAD (just after S1/D1) in every tool (`MLAD_F` overrides).

Fading Brody effect (`brodyFade`: enhancement × exp(−depth/brodyFade), depth = transmural UVC; off).
Axis screen (CS_LITE, perforators on): normal 10 mm wall with B 4 / fade 0.25 gives N 34°, LAFB −45°,
LPFB 102° (uniform B 2 had LAFB −19°); every apex-first combination loses LPFB (33–57°). Full check
(calibrated gain; misses with the live septal rule / with perforators):

| variant | live | perf | normal/LAF/LPF | R V1–V6 | notes |
|---|---|---|---|---|---|
| reference | 7 | 14 | 33/−49/100 | 0.19/0.44/0.41/0.66/1.07/0.99 | |
| normal wall, B 4, fade 0.25 | 11 | 14 | 34/−45/102 | 0.86/1.61/1.80/1.63/1.15/0.66 | tall V1–V2 R; proximal RCA loses its inferior Q |
| normal wall, B 2, fade 0.5 | 13 | 13 | 29/−43/100 | 0.66/1.38/1.63/1.64/1.14/0.77 | same |
| +3 layers, B 2, fade 0.25 | 8 | 11 | 43/−44/96 | 0.28/0.56/0.60/0.72/1.06/0.97 | no inferior Q from LAD; distal LCx Q in I not V6; mid LAD Q in aVL |

The fade keeps the fascicular axes, but with a normal wall the chest R waves become too tall in
V1–V3 and the inferior Q of proximal RCA occlusion is lost. On the live wall, B 2 / fade 0.25 removes
the inferior Q from LAD infarcts (perforators: 14 → 11) at the cost of distal-LCx and aVL errors.
Mid/distal LAD still have no V2–V4 Q in any variant. Not adopted.

### rebuild-1 round 1: physiological base (branch cut from refine-2)

Defaults on this branch (R0), from the refine-2 round 7 diagnostics:
- septal perforators `septalPerf` [0.14, 0.3, 0.45, 0.6] instead of the upward-reach rule;
- LV free wall +2 layers (~12 mm, upper normal; the CT wall is ~10 mm, +3 gave 14–15 mm);
- right-bundle septal Purkinje `rbbSeptalFrac` 0.3, `rbbSeptalDelay` 25: right septal face 31 ms,
  10 ms after the left (was 39 ms: the left-to-right septal front ran unopposed, and with the
  thinner wall V1–V2 R reached 0.9–1.6 mV);
- fading Brody effect `brody` 2, `brodyFade` 0.25 (radial sources near the cavity enhanced);
- `ecgGain` 0.0174 → 0.0194 (calibrated heart-vector gain ratio R0/live).

Full regression against refine-2 (live defaults):
- normal: QRS 92 → 86 ms, axis 29 → 22°, II R 0.73 → 1.13, T III −0.14 → +0.26 (limitation fixed),
  q I/V6 −0.05/−0.04 → −0.07/−0.08, R V1–V6 0.14/0.32/0.30/0.48/0.79/0.73 → 0.23/0.47/0.52/0.62/
  0.83/0.74; fascsearch score 4.06 → 2.2 (LAFB −49 → −44°, LPFB 100 → 93°, aVL R 2.4 → 2.9);
  activation score 15.3 → 12.5;
- LVH Sokolow 3.72 → 4.51, Cornell 2.53 → 2.77; RVH axis 165 → 149°, V1 R/S 0.98/0.12;
- blocks, arrhythmias, AVNRT/AVRT, WPW, P waves: same behaviour (sinus QRS 89 → 83 ms; VT QRS
  167 → 183 ms); stcheck within 0.04 mV; AHA agreement 91% (unchanged);
- ischaemia (full check, mid LAD at 22%): 7 → 9 misses. Gone: inferior Q of distal LAD, PDA ST in
  V1. New: mid LAD Q only in V1 (the live rule's V1–V3 came from the septal-reach compensation;
  r in V1–V3 now halved), distal LAD Q in aVF, mid LAD ST elevation in I. ischaudit: RCA sites show
  a III Q from 1 h; distal LCx adds inferior ST at 1 h and III/aVF Q at 30 days (inferolateral).
Remaining core problem: V2–V4 Q for mid and distal LAD. Apex-first activation still moves the
normal axis left on R0 (apexPurkMul 1.5–3: −43° … +15°), so it stays off.

Rear-only wall (`lvRearLayers`, inferior + inferolateral, rotational UVC < −0.8; option, off; Node
override LV_REAR). Thickness (cavity to epicardium, anterior/lateral/inferior mid): R0 12.4/13.3/13.3
mm; +0 & rear +2: 9.5/10.8/13.3; +1 & rear +1: 10.9/12.0/13.5. The rear wall barely moves the axis
(no Brody: −15° … +4°); the Brody term still sets it. Matching R0's axes with a thinner anterior wall
(+1 & rear +2, Brody 2: 26/−46/93°) gives 10 misses (R0 9); +0 & rear +3: 10; +0 & rear +2 with
Brody 4: 9 (LPFB 88°). Mid/distal LAD V2–V4 Q missing in all: anterior wall thickness does not decide
which early forces survive the infarct. Not adopted.

### rebuild-1 round 2: what keeps the V2–V4 r after mid- and distal-LAD infarcts (R0, diagnostics)

Mid LAD (22%, `SUPPLY=0.18,0.3,0.45 SEPT=1 tools/regiondecomp.js '{}' mLAD`): all LAD territory past
D1 dies (4748 cells, 21% of LV). The surviving S1 septal band (1740 cells), D1 free wall (1155) and
RV still push V1–V3 positive at 20–40 ms (S1 +0.09/0.13/0.14, upper D1 +0.03/0.09/0.16, RV
+0.10/0.15/−0.08 mV) against the inferior and LCx walls; V4 also gets +0.27 from the lateral (LCx)
wall. So the residual small r in V1–V2 comes from tissue that does survive a post-S1/D1 occlusion;
V3–V4 keep r from D1 and the lateral wall.

Distal LAD (`scratchpad dsize`): the checker's site (45%, just past D2) kills 11.8% of the LV (apex
77%, apical anterior 73%, apical septal 53%, mid anterior 28%), a realistic apical-anterior infarct;
ischaudit's 70% site kills only the apex tip (4.4%). Timing (`REG=dead`): the dying tissue adds to
V2–V4 only from 30 ms (apex 35–40 ms: V4 +0.43–0.51), after the r peak (V2–V3 at 20–25 ms), and its
anterior part pulls V2–V3 negative at 20–30 ms. Infarct V4 loses its late r (35 ms 0.44 → 0.05) but
not the initial r. Apex endocardium mean 30 ms (earliest 14) against Durrer's early apex: distal
LAD Q waves need the apex earlier, which (apexPurkMul) still costs the normal axis and LPFB.

Fascicle terminals to the apex (options, off): `fascApexZ` continues LAF and LPF toward the apex,
each giving off Purkinje branches in its own territory (the extension carries its fascicle's segment,
so a fascicular block blocks it); `fascApexFrom` lets it branch part-way along the fascicle;
`fascApexLafPhi`/`fascApexLpfPhi` aim it. LAFB/LPFB keep their axes (−45°/93°) in every variant,
but the apex is not earlier (apical endocardium median 30 → 27–31 ms; target 8–24): the fascicles
reach their terminals at +10 ms and the extension delivers to the apical network at ~20 ms, no
sooner than the network itself (apical Purkinje median 22 ms). Branching earlier (fascApexFrom
0–0.6) lowers the normal axis (6–16°) without an earlier apex.
`apexPurkSameTerr` (apical speed-up only within one fascicle's territory, option): apex median 13–25
ms, LPFB a little better than with bridging (m4/z0.5: 67° vs 51°), but the normal axis still falls
(−1° … −45°). So the conflict is not the territory bridge: whenever the apex fires early, this
model's normal axis turns left (lateral wall filled apex → base, refine-2 round 7).

Lateral wall against the literature (R0, `tools/lattime.js`; tools now default to the model's own
wall). Literature (abstracts/secondary sources; full texts not reachable from this environment):
Durrer 1970 — three LV endocardial sites at 0–5 ms, confluent by 15–20 ms, the posterobasal area
activated last; intraoperative mapping — terminal epicardial activation in the basal lateral wall
at 62–74 ms; ECGI in normal hearts — apex-to-base activation of the posterior LV, LV base last.
Model: anterolateral endocardium 20–31 ms (mid-height first), inferolateral endocardium 33–36 ms at
every height; latest epicardium at the mid inferolateral wall (67–68 ms) while the basal lateral
epicardium finishes at 36 (anterolateral) / 50 ms (inferolateral). So the model's base is early,
the opposite of the literature (the added wall layers taper off toward the base, leaving it thin).
An earlier basal lateral wall would move away from the literature, so that direction is dropped.
A late base adds upward terminal force, so the normal axis would need its inferior force from
elsewhere.

### rebuild-1 round 3: late base, apical thickening, limb-lead forward model (screens on R0)

Options (off; Node overrides): `LV_BASE_FULL` (the added layers reach the valve rings: basal lateral
epicardium 36/50 → 45/59 ms, late region 73 → 76 ms, as the literature has the base last) and
`lvApexLayers`/`LV_APEX` (apical cap; note the normal apex is the thinnest part of the LV).
Axes (CS_LITE, normal/LAFB/LPFB/LBBB), current sequence; apex-first (apexPurkMul 4, z 0.5, same
territory) in brackets:
- R0 26/−44/93/59 (−45/−55/67/11); base full 26/−45/93/56 (−38); apex +2 36/−39/92/60 (−37);
  both 34/−41/92/57 (−30).
- limb leads: torsoBlend 0 (Einthoven) 14/−26/69/29; 0.35: 18/−36/84/42; 1 (torso field only)
  38/−48/98/74; torsoIIGain 0.8/1: 36/−47/92/65, 44/−50/92/70; limbRotation 0/16: 6/−49/86/44,
  47/−36/98/70. Apex-first stays at −25° … −53° in every variant.
- Torso field only with no adjustments (torsoBlend 1, torsoIIGain 1, limbRotation 0): 32/−60/92/73.
Full check: torso field only 9 misses; with precordialGain 0.66 (restores chest R after the
calibration) 8 misses (mid/distal LAD V2–V4 Q, mid LAD aVL ST, distal LAD III ST), R V1–V6
0.31/0.62/0.68/0.82/1.08/0.97. Its limb voltages at app scale (calibrated gain ×0.76): normal II R
1.2, LAFB aVL R 3.1, LPFB III R 4.2 mV (R0: 2.9/3.2; textbook ~1.5), i.e. the fascicular-amplitude
limitation grows. torsoBlend 1 alone: 12 misses (proximal RCA/PDA lose the II Q), fascsearch 1.8.

Adopted on rebuild-1 (round 3): wall layers reach the base (`LV_BASE_TAPER` restores the taper),
limb leads from the torso field alone (`torsoBlend` 1, `torsoIIGain` 1, `limbRotation` 0),
`precordialGain` 0.66, `ecgGain` 0.0194 → 0.0143 (calibrated ratio). Full regression against R0:
normal axis 22 → 29°, T axis 39 → 60°, T III +0.26 → +0.49, T aVL +0.18 → −0.10, II R 1.13 → 1.14;
LAFB −44 → −62° (aVL R 2.9 → 3.1), LPFB 93 → 91° (III R 3.2 → 4.5); RVH axis 149 → 121°, R aVR
1.42 → 0.21; LVH Sokolow 4.60, Cornell 2.80; blocks, WPW, P waves, arrhythmias, AVNRT/AVRT
unchanged in behaviour (sinus QRS 84 ms); AHA 90%; checker 9 → 10 (proximal RCA loses the II Q,
distal LAD a III Q).

### rebuild-1 round 4: cavity window (Wilson) for transmural scars

A chest electrode over a transmural scar looks through it at the LV cavity, whose potential is
negative from the start of LV activation; that, not the late would-be activation of the dead
tissue, is what removes the initial r. New `cavityWindow` k: a virtual electrode at the LV cavity
centroid (point-source field, one more lead weight), and per chest electrode the share Ω_e of its
view of the LV epicardium (facing cells, cosθ/r², line of sight not crossing living ventricular
muscle on a 2 mm grid) that is necrotic; the chest lead becomes (1 − kΩ)·V + kΩ·g·(φ_cav − WCT).
Ω (k 1, 30 days): proximal LAD V3–V5 0.72/0.99/0.54; mid LAD 0.71/0.98/0.44; distal LAD 0.49/0.78/
0.15; proximal LCx V5/V6 0.45/0.89; distal LCx V6 0.44; PDA none; proximal RCA V1 0.52 (the dead RV
opens the view). The normal ECG is unchanged (no scar, no window); the activation sequence and axes
are untouched.
Full check (k 0.3/0.45/0.6/1): 6/5/5/5 misses (10 without). At 0.45: mid LAD Q V1–V5 (all core
leads), distal LAD Q V3–V5 (V2 missing) and III; remaining: mid LAD aVL ST, distal LAD III Q and ST,
proximal RCA no II Q. ischaudit: mid LAD Q V1–V5 from 12 h, ST/T course as before (ST elevation at
48 h slightly shorter); proximal LCx unchanged. Default k 0.45 (QS depth ~ −2 mV in V3–V4).

### rebuild-1 round 5: contiguous-lead checker; fascicular block voltages

tools/fullcheck.js now counts a finding in a lead that should not have it only when a contiguous
lead shows it too (II/III/aVF, I/aVL/V5/V6, neighbouring chest leads; clinical two-contiguous-lead
rule; CONTIG=0 restores the per-lead count). Core leads still count one by one. Rebuild: 5 → 2
misses (distal LAD no Q in V2, proximal RCA no Q in II); the lone aVL ST (mid LAD) and lone III
Q/ST (distal LAD, III ST +0.12 mV, II/aVF +0.09/+0.11) no longer count.

Fascicular-block limb voltages (fascsearch at calibrated app scale; textbook ~1–1.5 mV): LAFB aVL R
3.1, LPFB III R 4.5 (R0 2.9/3.2, live 2.4/3.2). New `setBlock(site, 'delay', {mul})` (fascicle
slowed instead of cut; `fascDelayMul` 2; tools: FASC_DELAY). Amplitude follows the axis shift:
delay ×2 LAFB −45°/aVL 2.1, LPFB 83°/III 2.6; ×3 −55°/3.0, 89°/3.9; complete −62°/3.1, 91°/4.5.
Levers screened (purkCrossSlow 1.5–6.8, torsoUniform 0–1, torsoIIGain 0.8–1, brody 2–3): none
keeps normal 30–75°, LAFB ≤ −45° and LPFB > 90° together with lower voltages; the best lower
the voltages by ~20–30% (e.g. cross 1.5, uniform 1, Brody 3: 24/−52/90°, aVL 2.1, III 3.7).
In this model a fascicular block reaches its axis only with a frontal QRS vector ~2.5× the normal
one (real LAFB: ~1–1.3×); not adopted, kept as a known limitation.

Over-cancellation investigation (block/normal voltage ratio at equal gain, fascsearch; textbook
LAFB aVL R / normal II R ~1–1.3). Rebuild 2.6 (LPFB III/II 3.7). The block amplitudes stay ~3–4
across settings; the ratio is high because the normal net forces are small: brody 0 → normal II
0.7 (ratio 4.0), sigmaRatio 5/3/1 → 2.2/3.2/5.7 (ratio 1.6/1.1/0.75). The fibre-direction source term
(sigmaRatio 10, κ = 9; the measured effective ratio is ~3) both drives the cancellation and makes
the fascicular axis shifts: at sigmaRatio 3 LAFB no longer deviates (+21°).
At sigmaRatio 3–4 without the Brody term the normal axis is 54–62° and LAFB −40 … −58° with aVL/II
1.1–1.7, but LPFB stays at 79–87° (LPF territory 0.25/0.4 apical cap, phi −1.54/−1.2 … 0.56/0.9,
purkCrossSlow 10–20). purkCrossSlow ≥ 25 gives sustained Purkinje re-entry after the first beat
(runs from 578 ms to the end), so the apparent LPFB > 100° results at 40 were invalid; screens now
check for it. Full check sigmaRatio 4, brody 0, purkCrossSlow 15: 1 miss (distal LAD V2 Q;
proximal RCA regains the II Q), normal 54°, LAFB −42°, LPFB 84°, RVH 104°, R V1–V6
0.21/0.47/0.61/0.60/0.89/0.86 (gain ×0.70 of the adopted calibration). Not adopted: LPFB loses its
right axis deviation.

LPFB at the measured fibre ratio (sigmaRatio 4, brody 0, purkCrossSlow 15). Anatomical LPF variants
(terminal at the posteromedial papillary level, phi −1.9…−1.3, zuvc 0.29–0.5; territory to phi −2.0/
−2.4; left septal fascicle with or without a mid-septal territory) all give 84–87°. Regional QRS
areas (`AREA=1 BLOCK=LPF REG=time tools/regiondecomp.js`): the inferior wall's late forces turn
down-right (I −18.6, aVF +41 mV·ms) and the septum loses its left-to-right force (I +16.2, as in
LPFB's rS in I / qR in III), but the anterior and lateral walls keep I +45, so lead I stays positive.
A more vertical heart moves the normal axis three times faster than LPFB (heartRotation 14 → 26:
normal 54 → 80°, LPFB 85 → 92°). Read as a cardiologist would: LPFB I R/S 1.0/0.7 (no rS) and
LAFB QRS 124 ms with II R/S 1.6/2.0 (QRS ≥ 120 ms excludes LAFB) — neither block is recognisable,
whereas the current rebuild gives LAFB QRS 112 ms, II rS 0.8/2.7, and LPFB I 0.6/0.7, III qR 4.5.
Not adopted. The axis numbers alone hid this; a criteria-based reader is needed for scoring.

### rebuild-1 round 6: blind criteria-based reader (tools/reader.js)

Scoring by "would a cardiologist's reading match the pathology?". The reader sees only the 12
leads: baseline from the flattest TP stretch; QRS onset/end from the spatial velocity (QRS within
~5 ms of the simulator's activation span); P wave around the largest atrial peak (PR reads ~15 ms
shorter than atrial activation, as on paper); T end; per-lead q (duration/depth), R, S, R′, QS,
R-peak time, J-point ST and T. Criteria: ACC/AHA/HRS 2009 (LAFB, LPFB, LBBB, RBBB, IVCD), Sokolow-
Lyon/Cornell LVH (not in BBB; with RVH only Sokolow), RVH, PR > 200, QTc > 460 (narrow QRS only),
Fourth Universal Definition STEMI and pathological Q (two contiguous leads; III, aVR, V1 not used
for Q). Scenarios: normal, 1st-degree AVB, LAFB, LPFB, LBBB, RBBB, LVH, RVH, seven occlusions at 1 h
(STEMI territory) and 30 days (Q territory), with required/allowed territories and associated
findings allowed where they follow from the occlusion (LAFB/RBBB with proximal/mid LAD, 1st-degree
AVB with RCA/PDA, T inversion, long QT). `node tools/reader.js [engine.js] ['{params}'] [scen,...]`.
Results (tools/data/reader_*.json): live 14/22 read correctly, 4 partial, 4 wrong; rebuild 14/22,
6 partial, 2 wrong; physiological fibre ratio (sigmaRatio 4, brody 0, purkCrossSlow 15) 12/22, 7, 3.
- all: normal, RBBB, LVH, pLAD, pLCx 1 h, PDA 1 h read right; dLCx (1 h and 30 d) reads normal in all
  three (distal LCx occlusion is often ECG-silent clinically); mid LAD 1 h adds lateral ST
  elevation (I/aVL) in all three; LAFB reads LAFB + a pseudo-infarct (broad q 34–45 ms in I/aVL,
  q in V2–V3/V5–V6) in all three.
- live only: LBBB fails (reads IVCD + septal/anterior Q), RVH with an inferior Q, distal LAD 30 d
  without Q.
- rebuild: LBBB right; new partials: lateral Q added to mid/distal LAD at 30 d, RVH reading after
  proximal LCx (loss of lateral forces with tall V1 R, the posterior-MI mimic), LVH after proximal
  RCA, LAFB reading after distal LCx.
- physiological: LPFB fails (reads an inferior old MI), LAFB widens to IVCD.

LAFB pseudo-infarct (rebuild). The reader's "old MI" in LAFB is q 34 ms / −0.23 mV in I and 45 ms /
−0.53 mV in aVL (textbook LAFB: small, narrow q), q 25–32 ms in V5–V6, and QS-like V2–V3 (r 0.06–0.09
mV). Regional forces in the first 35 ms (`BLOCKT=LAF LIMB=1 REG=time tools/regiondecomp.js`): the
inferior wall's early forces (aVL −0.3 … −0.47 mV) are no longer cancelled, because the LAF
territory's endocardium activates 30–40 ms late (anterior free wall 54–61 ms vs 15–28, anterolateral
50–64 vs 21–28; its Purkinje nodes median 33 ms). Interconnection (purkCrossSlow 6.8 → 1.5), Purkinje
speed (1.82 → 2.5–3 m/s) and LBB-trunk septal branches (lbbSeptalFrac with a septal territory: the
normal QRS widens to ~145 ms, the territory is cut off) do not narrow the q without losing the
deviation: q width and LAFB axis both follow the territory delay (cross 1.5 + Purkinje 3 m/s: delay
18 ms, axis −23°, q aVL 33 ms). Real LAFB reaches −60° with a ~20 ms delay and q ≤ 20 ms; this model
needs ~35 ms for the same deviation — the over-cancellation of round 5 again. Not fixed.

Mid-LAD "lateral" ST was V5 (+0.23 mV next to V4 +0.66), not I/aVL (aVL +0.17, I +0.05: no two
contiguous). The reader now splits high lateral (I, aVL) from low lateral (V5, V6): V5–V6 are
allowed with LAD sites ("anterolateral"), I/aVL only with proximal LAD; the circumflex needs either.
Re-score: live 15/22 (3 partial, 4 wrong), rebuild 17/22 (3, 2), physiological fibre ratio 15/22 (4, 3).
Rebuild remaining: LAFB pseudo-infarct; RVH reading after proximal LCx; LVH after proximal RCA;
distal LCx reads normal (1 h) / LAFB (30 d).

### rebuild-1 round 7: measured fibre ratio, reader-scored structural search (tools/fibresearch.js)

96 variants at sigmaRatio 3–4, brody 0, sampled over physiological/anatomical ranges (purkCrossSlow
6.8–15, cvPurkinje 1.82–2.8, lafPhi 2.1–2.75, lafZ 0.54–0.75, lpfPhi −2.23…−1.6, lpfZ 0.29–0.4,
lpfTerrLo −1.54…−2.2, heartRotation 14–22), each checked for re-entry (none), calibrated and read
by tools/reader.js on normal, LAFB, LPFB, LBBB, RBBB (tools/data/fibresearch_stage1.json). Best 3/5
(46 variants): normal, LBBB, RBBB read right; LAFB and LPFB fail in every variant — LPFB reads
normal at 85–88°, LAFB reaches −4 … −32° with a narrow QRS and reads as an old high-lateral/
anterior MI. Limb-lead model at sigmaRatio 4 (torsoBlend 0/0.5, torsoUniform 1, torsoIIGain 1.3,
limbRotation ±10): LPFB 47–90° (90 only with the normal axis at 73°); heart yaw −2…18 and pitch
−20…0: LPFB 82–86°. At the measured fibre ratio LPFB has a ~85° ceiling in this heart that no
conduction-system structure, orientation or limb-lead setting tested moves; sigmaRatio 10 stays.

### rebuild-1 round 8: conductivities, a full torso conductor for every lead, and the reader

Conductivities (literature check). Clerc 1976 (calf trabeculae; cable analysis: intra/extra
resistance ratios 3.6 along and 12.6 across fibres), as usually tabulated: intracellular ~0.17/0.02 S/m
(ratio ~9), extracellular ~0.63/0.24 S/m (~2.6); bulk ~0.80/0.26 S/m (~3). The "measured effective
~3" quoted in earlier rounds is the bulk tissue ratio; the impressed source uses the intracellular
tensor, so sigmaRatio 10 is physiological for the sources. What the model lacked is the medium: an
anisotropic heart inside a torso instead of an isotropic infinite medium (chest) and a fitted
limb-lead field.

Full torso conductor. tools/export_heart_torso.js exports fibre directions; tools/torso_v2.py
ANISO=1 gives the myocardium a bulk tensor (n·σ·n per face, Clerc bulk 0.80/0.26 S/m), with lungs
0.05, blood 0.65, torso 0.22 S/m, 3 mm grid (1.5 min per solve set). Computed Burger triangle: I −15…
−18°, II 71–74°, III 104–106°, |II|/|I| 1.6. Engine `fullTorso` (with `chestTorso`, off): every lead
from the solved electrode potentials (I = LA − RA, II = LL − RA; chest V − WCT), no heart-vector blend,
limb rotation, lead II gain or chest gain; one calibrated gain. Electrode–ventricle distances: V1 42,
V2 26, V3 19, V4 20 (LV), V5 39, V6 77 mm.
Reader, activation unchanged (tools/data/reader_fulltorso_*.json): isotropic heart 13/22 (1 partial,
8 wrong); anisotropic 14/22 (1, 7); anisotropic + Brody 2: 11/22 (2, 9); rebuild 17/22 (3, 2). In the
torso: LAFB (pseudo-infarct), LPFB (reads normal, 84°), LBBB (reads IVCD + LVH), and the 30-day Q
of mid/distal LAD fail; V5 R ~2.5 mV. (The cavity window has no cavity electrode in the torso path:
pairCoef returns before it, so it only attenuates; a solved cavity lead field would be needed.)
So the physical conductor alone does not fix the fascicular blocks with today's activation, and
it loses the anterior Q that the window provided.

Activation re-validated in the torso conductor (tools/fibresearch.js with BASE/SPACE/TV2; results
tools/data/fibresearch_torso.json). Fixed: fullTorso + chestTorso, anisotropic myocardium,
sigmaRatio 10 (intracellular), brody 0, cavityWindow 0; heart pose fixed (the field belongs to it).
64 variants over purkCrossSlow 3–10, cvPurkinje 1.82–2.8, LAF/LPF terminals and LPF territory,
apexPurkMul 1–2, rbbSeptalFrac 0.3–0.5; no re-entry. Best 3/5 (3 variants): normal, LAFB and RBBB
read right — LAFB now without the pseudo-infarct (e.g. purkCrossSlow 6.8, lafPhi 2.4, lafZ 0.65,
lpfPhi −1.9, lpfZ 0.29, lpfTerrLo −2.2, apexPurkMul 2, rbbSeptalFrac 0.3: LAFB −50°, QRS 99 ms) —
but LPFB reads normal/LVH at 64–86° in every variant and LBBB reads IVCD (QRS 147 ms, V5/V6 R-peak
time 42–44 ms instead of > 60: the torso near field gives V5/V6 an early peak). Normal axes −13 …
+30°; LVH read in most blocks (V5 R ~2.5 mV). The ~85° LPFB ceiling is the same in the hybrid and
in the torso conductor, so it comes from the heart (geometry/activation of the posterior territory),
not the forward model.

### rebuild-1 round 9: Durrer-root conduction system (literature roots, near-continuous endocardial layer)

What our activation was validated against: Durrer 1970 summary times (three early LV sites at 0–5
ms, confluence by 15–20 ms, posterobasal last) and LBBB/RBBB mapping. The Purkinje network itself
(territory boundaries in UVC, 6.8× slowed cross-links, fascicles ending at the papillary muscles,
LAF phi 2.75, LPF −2.23) is not from literature. Root-node models (Cardone-Noott et al. 2016,
Europace) place a few roots at Durrer's early sites (anterior paraseptal high, central septal,
posterior paraseptal at one third from the apex) on one fast endocardial layer; fascicular block
removes roots. (Full text not reachable from this environment: pmc.ncbi.nlm.nih.gov blocked.)
Search over Durrer-type roots (tools/data/fibresearch_durrer_*.json: lafPhi 1.2–1.8, lafZ 0.7–0.8,
lpfPhi −0.5…−1.2, lpfZ 0.33–0.4, septal fascicle on/off, purkCrossSlow 1–2.5, fascConnectFrac 0.3–
0.59), 48 each in the hybrid and torso forward models, no re-entry. Hybrid: LPFB 77–90° (none > 90);
torso: 63–85°. Best hybrid variant (purkCrossSlow 1.5, cvPurkinje 1.82, lafPhi 1.8, lafZ 0.7, lpfPhi
−1.2, lpfZ 0.4, septalFascicle, fascConnectFrac 0.3): reader 17/22 (= rebuild; LPFB fails at 90°,
I r/S 0.4/0.4; LAFB −63° with the pseudo-infarct; dLCx 30 d now right), full checker 1 miss (rebuild
2), activation score 8.0 (rebuild 12.5; early anterior/septal/posterior sites 4.1/8.2/4.1 ms, LV
endocardium 75% at 30 ms, apex median 27 ms, total 80 ms), R V1–V6 0.26/0.50/0.51/0.57/1.20/0.96.

Cardone-Noott et al. 2016 (Europace 18 Suppl 4: iv4–iv15, PMC5225966), checked in full: root points
"four LV earliest activation sites (LV mid septum, LV basal anterior paraseptal, and two LV
mid-posterior) and three in the RV (RV mid septum, two RV free wall)", from Durrer's "basal anterior
paraseptal, the mid-septum and the posterior apex regions"; each endocardial node activates at a time
proportional to its distance to the nearest root (Dijkstra), the speed tuned to Durrer's endocardial
times. LAFB by knocking out the anterior root: QRS < 120 ms, late axis −50°, qR aVL, R-peak time aVL
42 ms. LPFB by knocking out the posterior roots: "right-deviated late QRS axis to 100°; Rs or RS
patterns in leads I and aVL; qR patterns in leads III and aVF". So the published model's LPFB also has
lead I equiphasic/R-dominant and meets LPFB by the late axis; our Durrer-root variant (LPFB 90°, I r/S
0.4/0.4) sits at the same place. LBBB = both LV branches knocked out.

Frontal tilt with the Durrer-root variant (reader, tools/data/reader_durrer_tilt*.json): heartRotation
14 (now): LPFB 90° fails, LBBB passes (17/22); 15, 16, 17: LPFB 91° passes, normal 54/57/59°, but LBBB
(axis 76–79°) reads IVCD — lead I upright for only 53% of the QRS and aVL mostly negative — (17/22
each); 20/23: 16/22, 14/22. LPFB and LBBB trade places within one degree: both depend on the same
balance of lead I, so with this heart one of the two is borderline.

## rebuild-1 round 10: why LBBB swings right

- Across every model so far, LBBB axis minus normal axis is positive (rebuild +26°, full torso +35°, live +59°); textbook LBBB keeps or shifts the axis left. The forward model is therefore not the cause.
- `BLOCK=LBB ZSPLIT=1 node tools/actgeom.js '{}'`: under LBBB every LV region propagates posteriorly and slightly downward; none propagates superiorly. The LV is entered at the anterior RV–LV junction (LV endo 25 ms, about 8 ms after the RV); the inferior septum activates at about 60 ms. The wave sweeps one way, anterior → lateral → inferior, and ends inferolaterally (110 ms). Mapping studies (Vassallo 1984, Auricchio 2004, ECGI) describe septal entry about 35–48 ms after QRS onset, spread both ways around the LV, and the lateral base last.
- LV Purkinje distal to the block is entered retrogradely only late (59–90 ms). pmjRetro 3–8 shortens the QRS (136–141 ms) but moves the axis only 3–4°.
- New option `mbPhi` (moderator-band insertion angle; default off keeps the old placement). Moving the band to 20–30° gives septal LV entry, but the **normal** axis also swings: mbPhi 75 → 34°, 65 → 7°, 55 → −41°, 45 → −55° (default rule 50°). rbbSeptalDelay 10 moves normal to 4° and LBBB to 46°. Placing the RV's early breakthrough a few millimetres differently swings the normal frontal axis by tens of degrees, so the normal limb-lead axis is set by small RV forces rather than by the LV. This is the over-cancellation problem again: the LV's net frontal force is too small.
- RBBB reads −74° in the rebuild (the reader passes RBBB on morphology); textbook RBBB keeps a normal axis, so this would read as bifascicular block.

## rebuild-1 round 11: left-ventricle vs RV frontal forces, and the limb-lead field

- `REG=rv AREA=1 node tools/regiondecomp.js` (new mode: RV split by height and side). In the normal beat the left ventricle's net frontal QRS area is I +30 / aVF +17.5 mV·ms. Single RV sub-regions contribute up to aVF −18; moving the moderator band to 45° takes the RV from −10/−2 to −1/−21 and the left ventricle from aVF 17.5 to 4.2.
- RV Purkinje spreads at about 1.8 m/s straight-line (`cvPurkinje` 1.82). cvPurkinje 2.5 / 3.2 reduces the band sensitivity only partly (normal 61° → −27°, 63° → −9° with mbPhi 45) and fails LAFB/RBBB at 3.2.
- RBBB: the late RV wave travels rightward and anterior (direction −0.42, +0.09, +0.45) but gives aVF −36 against I −20 mV·ms: the limb leads overweight vertical forces.
- Heart-mean limb lead vectors (lead I = 1). Cylinder torso field used by the app (`torso_leadfield.py`: RA/LA on the top face of the cylinder, LL on the bottom): I (0.87, 0.49, −0.07), aVF length 2.75, so lead I is tilted 29° upward and aVF is 3.2× its Einthoven length. The full torso conductor (`torso_v2.py`, shoulder/axilla side patches): I (0.94, 0.35, −0.03), |aVF|/|I| 1.6.
- Same activation, Einthoven limb leads (`torsoBlend` 0): normal 14°, LBBB 32°, LPFB 59°, LAFB −42°, RBBB −48°; mbPhi 45 moves the normal axis 35° (against about 90° with the cylinder field). The cylinder field roughly triples the axis sensitivity, and the heart tilt was fitted around it. The activation still puts LBBB about 18° right of normal.

## rebuild-1 round 12: limb leads from the solved torso (option, not adopted)

- New option `limbTorso2` (default off): limb leads I and II from the solved torso's LA/LL reciprocity fields (`torso_v2.py`, anisotropic myocardium, shoulder/axilla and hip patches); chest leads, cavity window and the rest unchanged. Normalised like the cylinder field (mean |lead I| over the heart). Supply the field with `TV2=<file>` (`tools/reader.js`) or `setDefaultTorso2`; the bundled `src/torso_v2.json` is an older 4 mm solve.
- The solved field holds only for the heart position it was solved at: a tilt scan with the 14° field gave nonsense (more vertical → axis further left). Each tilt was therefore re-exported and re-solved (`export_heart_torso.js` + `ANISO=1 torso_v2.py`, about 1.5 min each).
- Burger triangle of the solved torso (lead I = 1): I at −15°, II 1.5–1.7 at 71°, III 1.8–1.9 at 104°.
- Reader (normal / LAFB / LPFB / LBBB / RBBB axes):

  | tilt | normal | LAFB | LPFB | LBBB | RBBB |
  |---|---|---|---|---|---|
  | 8 | 30 | −39 (fail) | 75 (fail) | 63 | −53 |
  | 14 | 41 | −31 (fail) | 80 (fail) | 65 | −40 |
  | 20 | 46 | −21 (fail) | 84 (fail) | 69 | −29 |
  | 26 | 52 | −13 (fail) | 87 (fail) | 73 (IVCD) | −24 |
  | cylinder field, 14 | 50 | −65 | 91 | 76 | −74 |

- With the more anatomical limb field, the LAFB-to-LPFB axis span is about 110° at every tilt (textbook about 160–170°); with the cylinder field it is 156°. The cylinder field's 3× vertical gain was what carried LAFB and LPFB past −45° and +90°. LBBB stays 21–33° right of normal, and the band sensitivity remains (mbPhi 45 moves the normal axis 41° → −19°). Not adopted: the activation, not the limb field, is the remaining cause. The fascicular blocks' late forces are too weak relative to the normal beat, and RBBB's terminal RV forces point upward.

## rebuild-1 round 13: why LAFB/LPFB axes fall short with the realistic limb field

- Activation delays under block (`BLOCK=LAF|LPF ZSPLIT=1 node tools/actgeom.js`): LAFB delays the anterior/lateral base by about 28 ms and the mid lateral wall by 17 ms; LPFB delays the inferior wall by 28 ms and the apex by 18 ms. Both are in the literature range; the delay is not the problem.
- Block − normal frontal area by region (`TV2=... REG=time AREA=1 BLOCK=LAF node tools/regiondecomp.js '{"limbTorso2":true}'`; regiondecomp now honours TV2): in LAFB the lateral wall adds aVF −48 (upward, as it should) but the anterior wall adds aVF +31, so the area axis only reaches −29°. In LAFB the anterior wall is reached from the septum and swept circumferentially (direction left, posterior, slightly down). With the cylinder field the lateral term was −84, which hid the anterior one.
- Apical anastomoses (`purkCrossApexZ` 0.35 / 0.45 / 0.55) and a narrower LPF territory (`lpfTerrHi` 0.2) with the realistic limb field: LAFB −36° at best, LPFB 74–81°. Normal 27–41°, LBBB 65°, RBBB −40° to −50°. No pass.
- LV long axis in the torso frame: 52° below horizontal in the frontal plane, 39° anterior (CT literature about 40–50° and 30–45°), so the heart's placement is not grossly off.
- The 1.5× fascicular limb voltages and the textbook fascicular axes come from the same cause, the cylinder field's 3× vertical gain. Under a realistic limb field the activation gives LAFB about −35° and LPFB about 80°.

## rebuild-1 round 14: literature on calibrated ECG models, and the joint refit

Read in full (arXiv): Camps et al. 2020 (2010.15214), Camps et al. 2023 (2306.13740, digital twins from 12-lead ECG + MRI with realistic Purkinje networks), Zappon et al. 2024 (2407.17146, ECG variability), Grandits, Gillette et al. 2024 (2411.00165, identifiability of the conduction system).

- The field fixes the structure (anatomy, torso, Purkinje network, root regions) and the ranges from data, then fits a few parameters jointly to the ECG: root nodes / Purkinje–muscle junctions and conduction speeds. Generic literature values are not expected to reproduce an ECG on their own.
- Purkinje speed: 2–4 m/s (Durrer); the best QRS fits came at 4 m/s or with the roots firing at once. Ours is 1.82.
- Myocardium: fibre 0.50–0.65, cross-fibre 0.29–0.48, transmural 0.25–0.60 m/s (anisotropy ratio about 1.35–1.7); fast endocardial layer 0.7–1.5 (sparse) to 1.0–1.9 m/s (dense). Ours is 0.62 / 0.26 (ratio 2.4), with the cross-fibre speed at or below the bottom of the published range.
- Grandits et al.: different activation maps can give identical ECGs, so a prior on Purkinje–muscle junctions is needed (our activation-map score plays that role).
- Zappon et al.: diagnostic ECG features are fairly robust to realistic heart position/orientation and conductivity uncertainty in a calibrated model. Our model's sensitivity is therefore a model defect, not the norm.
- `tools/physfit.js`: joint random search with the solved-torso limb leads (field re-solved per tilt: `TV2DIR/tv<tilt>.json`), score = reader passes + ½ partials − axis shortfall/30°. Stage 1 (old speed ranges, 16 candidates) stalled at LAFB about −30°, LPFB about 75°; stage 2 uses the published speed ranges.

### Joint refit results (round 14, continued)

- Stage 2 (96 candidates, published speed ranges; `tools/data/physfit_stage2.json`): with cross-fibre 0.45 m/s, LAFB reaches −46° to −61° and LPFB 78–96° under the realistic limb leads, but the QRS shortens (normal 62–70, LBBB 118–122, RBBB 108–116 ms) and the blocks fail the 120 ms rule. With cross-fibre 0.29, QRS is realistic but LAFB is only −30° to −45°.
- New option `cvVentSheet` (default 0 = off): a separate transmural (sheet) speed, with `cvVentTrans` then the sheet-normal speed. Split test (`physfit_sheet.json`): the **transmural** speed sets the fascicular axes (sheet 0.45: LAFB −49° to −56°, LPFB 85–96°; sheet 0.25: LAFB −1° to −13°); the sheet-normal speed matters little. A slow transmural wave adds large through-wall forces that dilute the blocks' directional sweep.
- With sheet 0.45, sheet-normal 0.29, fibre 0.65 and Purkinje 1.5 m/s at tilt 20 (`physfit_purk.json`; shorter basal Purkinje coverage swung the normal axis to −70° and was dropped): normal 31° / 78 ms, LAFB −57°, LPFB 101°, but LBBB 79° (reads IVCD: aVL negative) and RBBB −69°.
- Full 22-scenario reader on that candidate: **12 pass, 6 partial, 4 wrong** (current defaults 17/3/2). New failures: RVH (axis −155°), pRCA 30 d (no inferior Q), LBBB. Not adopted. The LBBB axis (one-way left-ventricle sweep) and the RBBB superior axis remain the open activation problems under the realistic limb field.

## rebuild-1 round 15: jointly refitted model adopted

- Reader changes (how a cardiologist reads): LBBB = QRS ≥ 120, QS/rS in V1, dominant q-free R in V6 or I with a late R peak (aVL/V5 may be transitional; axis not used). New finding "poor R progression" (narrow QRS, R in V3 ≤ 0.3 mV), counted against normal, 1st-degree AVB, LPFB and non-LAD infarcts.
- Refit round 2 (`physfit_round2.json`, 48 candidates scored on all 22 scenarios with the solved-torso limb leads) gave 18/2/2 with the old reader; adopted as defaults: `limbTorso2` true (limb leads from `src/torso_limb.json`, the LA/LL fields of the 3 mm anisotropic solve at heartRotation 14), `cvVentLong` 0.6, `cvVentSheet` 0.4 (transmural), `cvVentTrans` 0.26 (sheet-normal), `cvPurkinje` 1.8, `purkCrossSlow` 3, `septalFascicle` true, `fascConnectFrac` 0.45, LAF 1.8/0.7, LPF −1.8/0.3, `ecgGain` 0.01348, `atrialLimbGain` 1.85 (P in II back to 0.23 mV; RAE 0.36). The page ships the 0.9 MB limb field instead of the 2.9 MB cylinder field (index.html 5.5 → 3.6 MB); `src/torso_leadfield.json` stays for Node experiments, `src/torso_v2.json` (old 4 mm solve) removed.
- Reader, both models scored with the new reader (`reader_physfit.json`): **old defaults 17 / 3 / 2, new 17 / 3 / 2**. The new model fixes dLCx 30 d (lateral Q instead of reading as LAFB) and pLCx 30 d (no false RVH); it loses LPFB (axis 89°, one degree short); pLCx 1 h gains poor R progression.
- Activation-map score 11.6 (old 13.2, lower is better); normal total activation 77 ms.
- Validation suite before → after: normal QRS 87 → 80 ms, axis 29° → −6° (normal, but lead III now negative); LAFB −59° → −47°/−51°, aVL R 3.1 → 2.3 mV; LPFB 91° → 87–89°, III R 4.5 → 3.4 mV (the fascicular limb voltages move towards textbook); LVH Cornell 2.8 → 6.0 with deeper lateral T inversion; hyper.js RVH preset axis 121° → 88° (the reader's RVH scenario still reads RVH at 154°); fullcheck: pRCA now has Q in II (old limitation fixed); dLAD old infarct adds inferior Q (wrap-around LAD pattern); arrhythmia, AVNRT, AVRT, WPW and ST baseline unchanged.
- Browser check (1440×900, 1280×720, 844×390): loads without errors, reads "Normal sinus rhythm, axis −2°".

## rebuild-1 round 16: LPFB fix attempt (not adopted)

- Grid tilt 14/17/20 × LPF φ −1.6/−1.8/−2.0 × z 0.25/0.3, each tilt with its own solved field (`tools/data/physfit_tilt_lpf.json`, 22 scenarios): at tilt 17 and 20, LPFB passes (91°, 93°) and the score is 18 / 2 / 2, but **RVH fails** at every such candidate. Its axis wraps past 180° (−157° to −178° at tilt 17, −106° to −122° at tilt 20) and the reader calls LVH. At tilt 14, LPFB stays at 89°.
- RVH preset at tilt 17 with rvSourceGain 1.0 / 1.2 / 1.4 / 1.6: axis −17° / −23° / −51° / −135°. The RV's added force points **up and right**, not down and right as in textbook RVH (+110° to +150°); the 154° at tilt 14 is reached from the superior side. Same defect as the RBBB axis (−57° to −74°): the RV's late forces are superior. Not pushed to milestone-1: fixing LPFB this way trades it for RVH.

## rebuild-1 round 17: tilt 17, reader axis fix, release to milestone-1

- RV forces: by sub-region (`REG=rv AREA=1 node tools/regiondecomp.js`) the RVH preset's added force comes from the upper RV (outflow/base, facing up) and the posterior RV (facing right and down); the anterior mid RV faces forward and slightly left. The RV centroid sits right, above and in front of the LV centroid (frontal −147°), which is where the RVH axis goes. Thickening only the RV body (`rvThickZmax` 0.55–0.7, option, off) gives no RVH at all (axis 28–52°).
- Reader fix: axes beyond −90° are **extreme ("northwest")**, not left axis deviation; RVH accepts right or extreme axis with a dominant/tall R in V1 (extreme axis occurs in severe RVH). The RVH ECG at tilt 17 (axis −163°, R/S in V1 0.80/0.20, V1–V2 T inversion) is read as RVH.
- Defaults: `heartRotation` 17 with `src/torso_limb.json` re-solved for that tilt; P wave unchanged (II 0.23, RAE 0.36 mV).
- Reader, all with the fixed reader: **tilt 17: 18 pass / 3 partial / 1 wrong**; tilt 14: 16 / 4 / 2; old (live) model: 17 / 3 / 2 (`tools/data/reader_tilt17.json`). Remaining: LAFB pseudo-infarct (partial), pLCx 1 h poor R progression (partial), pLCx 30 d extra RVH read (partial; extreme axis), dLCx 1 h STEMI not visible.
- Validation (tilt 17 vs tilt 14 defaults): normal QRS 80 ms, axis −12° (evalecg) / 9–15° (reader); LAFB −46°/−48°, aVL R 2.2 mV; LPFB 89°/91°, III R 3.4 mV; arrhythmia, AVNRT, AVRT, WPW, ST baseline and the ischaemia lead groups unchanged.

## rvh-1 round 1: RVH out of the extreme axis

- Diagnosis (`tools/data/reader_rvh1.json`, RVH-only runs): with the old preset (uniform RV thickening of 5 layers up to the outflow tract), the RVH axis came from the outflow tract (facing up) and swung to −110° to −164°. Stopping the thickening below the outflow (`rvThickZmax` 0.8) removed RVH altogether (axis 0–20°): the RV body's walls face opposite ways (anterior paraseptal: forward and left; inferior/posterior free wall: right and down) and cancel when thickened uniformly.
- Physiology used: pressure-overload RVH is free-wall hypertrophy, with the septal insertions at the interventricular grooves not part of the free wall, and hypertrophied RV muscle conducts more slowly (RV activation delay in RVH). New options: `rvThickPhiC` / `rvThickPhiW` (Anatomy: Gaussian weighting of the thickening around the RV in rotational UVC) and `rvCvMul` (RV muscle conduction speed factor). Both are off by default; the normal heart is unchanged (evalecg identical).
- Free-wall weighting alone (centre 0.2–0.4 rad, width 0.6–0.8, 6–8 layers) gives axis +124° to +138° with R > S in V1; with `rvCvMul` 0.7–0.8 the R in V1 rises to 0.7–1.2 mV.
- RVH preset now: 6 layers centred at 0.4 rad (width 0.8), `rvCvMul` 0.8, `rvStrain` 0.7, `rvSourceGain` 1.8. Read: RVH, axis +142°, QRS 84 ms, V1 R/S 0.95/0.09, R in aVR 1.2 mV, T inversion V1–V2. App: "right axis deviation" with the RVH finding.
- Reader: 18 / 3 / 1 (unchanged; RVH passes with a textbook axis instead of an extreme one). `tools/hyper.js` accepts `an` (extra anatomy options); the CLAUDE.md command now runs the LVH and RVH presets.

## Round 27: subendocardial ischemia switched off

- Clicking the cut face or the inner wall no longer starts subendocardial ischemia (`SUBENDO_ON = false` in `src/app.js`); share links with `se=` load without it. The engine's `addSubendocardial` and the related interpretation and Learn text stay in place for when it returns.
- Reason: the local patch produced territory-specific reciprocal ST elevation that real subendocardial ischemia does not show (ST change from normal at 1 h, 55 mm patch: true lateral patch III +0.30, aVR +0.33 mV; inferior patch aVL +0.45 mV; posterolateral patch aVR +0.40 mV). Clinically, subendocardial ST depression does not localise (widest in V4–V6 and I/II) and only aVR (± V1) rises, by about 1–2 mm for a single region; ≥ 1 mm aVR elevation with widespread depression suggests left main or three-vessel disease. Planned rework: a circumferential band of the inner LV layer, strongest at the clicked region, checked against those criteria.
- Text: the Ischemia tab note (desktop and phone) and Help → Control tabs no longer mention subendocardial patches.

## Round 28: WPW left lateral only

- The Conditions list offers one accessory pathway, left lateral; the posteroseptal option is removed to keep things simple for now. The engine's `setAccessoryPathway` keeps its other sites; share links or recently-used entries naming another site load without a pathway.

### mobile-1 round 7: installable app (PWA)

- `manifest.webmanifest` (name, standalone display, theme colours, icons) and `sw.js` sit beside
  `index.html` at the site root, with icons in `icons/` (192, 512, maskable 512, Apple touch 180,
  drawn from the favicon's heart and trace). The app adds the manifest link and registers the
  service worker only when served over http(s), so `file://` loading is unchanged.
- Service worker: same-origin requests network-first with the cache as the offline fallback (so
  a new deploy shows at once); Google Fonts cache-first. Bump `CACHE` in `sw.js` only to drop
  old caches; updates do not need it.
- Phone ⋯ menu: **Install app** (download icon). Android/Chrome: the browser's own install
  prompt. iOS Safari (no prompt API) and other cases: a short how-to. Hidden when already
  running as the installed app.
- Checked over http://127.0.0.1: no manifest or installability errors in Chrome; after one
  visit the page reloads and simulates offline.

### mobile-1 round 8: steady interpretation, shock/adenosine cues, gesture changes

- Interpretation (all layouts): a change of rhythm, block or condition, a shock, Reset or a new
  run starts a full 10 s acquisition (`ACQ_MS`, simulated time; `markChange()`) showing only
  "Acquiring…"; afterwards a reading that cannot be made (too few beats, e.g. a slow escape in
  complete heart block) keeps the last one instead of flipping back to "Acquiring…". VF is read at
  once. The phone interpretation bar keeps its height while acquiring.
- Heart-view background: a yellow flash on a shock (0.7 s) and a blue tint fading from the dose to
  the end of the adenosine AV-nodal block (`stageColour()`), in the Shock/Adenosine button
  colours. Shock button text centred.
- Phone tab notes shortened (Rhythm, Blocks). Gestures: taps count as a burst only within 40 px
  of the first; either atrium 3 taps = flutter, 4 = AF; ventricles 3 = VT, 4 = VF; AV node 3 taps
  = AVNRT; accessory pathway marker (any view) 3 taps = orthodromic AVRT, 1–2 taps explain this.
  The model induces AVRT over a left lateral pathway only (a posteroseptal one does not re-enter
  from an atrial premature beat, `tools/avrt.js posteroseptal`), so the posteroseptal pathway is
  switched to left lateral, with a message, as the AVRT button already did.
- 3D view: panes narrower than 0.85 (width/height) widen the vertical field of view so the heart
  keeps the two-pane framing (whole heart visible in the full-screen phone view).

### mobile-1 round 9: sheets close from the handle only, desktop Install button, link fix

- Phone sheets no longer close when their content is dragged down (scrolling the Conditions
  catalogue closed it); only dragging the handle down (or ✕, or back) closes a sheet.
- Desktop header: an **Install app** button appears when the browser offers installation
  (`beforeinstallprompt`, Chrome/Edge) and opens its prompt; the phone ⋯ menu item is unchanged.
- Share links: an occlusion on a coronary node that is not an offered vessel (a side-branch node,
  e.g. links made before the anatomy changes) is skipped instead of throwing in `segmentName`
  and leaving the page on the loading screen (`#o=40` reproduced it).

## Round 29: septal fascicle hidden and tied to the LPF

- The septal fibres (Durrer's mid-septal root, `septalFascicle`) stay in the model but are no longer drawn or labelled, and have no block menu of their own; share links with `b=LSF.complete` load without that block.
- Their block behaviour is tied explicitly to the left posterior fascicle (`lsfTie = 'LPF'`, previously chosen by distance and already the LPF): an LPF block blocks the septal fibres too. ECGs are unchanged (fascsearch: LAFB −46°/−48°, LPFB 89°/91°).
