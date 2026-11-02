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
