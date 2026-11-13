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

## Round 30: coronary artery labels

- With Labels on, the external view names the drawn coronary arteries: left main, LAD, circumflex, RCA and PDA (red dot, `.tag.cor`). Each label sits at a point along its vessel, lifted off the surface, and hides when that surface faces away. Diagonal and obtuse-marginal labels are defined but skipped while those branches are not drawn.
- Labels take an optional viewing cone (`cosMin`). The left main runs behind the pulmonary trunk to the left atrial appendage, so its label shows only within about 60° of a left, slightly superior view (the Lateral preset) and not from the front or behind.

## Round 31: rhythm menu, conditions, marginal arteries, necrosis display, VT and pericarditis fixes

- **Rhythm tab (all layouts):** the eight arrhythmia buttons are replaced by a rhythm menu showing the rhythm running now (`currentRhythm()`: the arrhythmia driver, AVNRT/AVRT from the retrograde logs, sinus after a shock or adenosine), with Sinus rhythm at the top. Choosing Sinus stops a driver (and ends AVNRT/AVRT with a silent cardioversion). The rate slider shows only for sinus, AF, flutter, ectopic atrial rhythm and MAT. Adenosine and Shock sit under their own **Therapy** heading. On phones the sheet goes full height while the list is open.
- **Phone floating buttons:** Shock for AF, flutter, ectopic atrial rhythm, MAT, VT and VF; Adenosine for AVNRT and AVRT only. The lightning icon is gone from the Shock button.
- **Conditions:** choosing a condition returns to the active list. "Accessory pathways" is now **Conduction abnormalities**, holding WPW (one entry, left lateral pathway; the site option is gone) and **Dual AV-nodal pathways**. Dual pathways are off by default (`ui.struct.dual`); starting AVNRT adds them, as AVRT adds WPW. Sinus ECG is identical with and without them (PR 141 ms, QRS 77 ms at 72 bpm). Share links: `s=ap,dual`; old `ap=left-lateral` links load WPW. Recently-used entries saved as `ap:left-lateral` read as WPW.
- **Coronaries:** the obtuse marginals (OM1, OM2) and the acute marginal (AM) are drawn, labelled and can be occluded (`MAIN` in `_buildCoronaries`). Node numbering and every existing territory are unchanged (`ischaudit` identical for the ten standard sites). Occlusion audit (`node tools/ischaudit.js OM1,OM2,AM 1,720`): OM1 1 h STE I, aVL, V4–V6 with inferior reciprocal depression, 30 d Q I, V5–V6; OM2 1 h STE II, III, aVF, V5–V6, 30 d Q II, III, aVF, V5–V6; AM 1 h STE II, III, aVF, V3–V4, 30 d Q II, III, aVF. The AM result is not textbook (isolated RV infarction gives ST elevation in V1/V4R and rarely inferior Q waves): the RV in the model has no transmural depth and the AM territory reaches the inferior RV.
- **Left main:** in the model the left main starts on the ventricle and bifurcates against the aortic root, so its tube was a stub hidden behind the great vessels. It is now drawn from an ostium on the aortic wall facing the Lateral view (`lmOstium()`, ~11 mm away, above the bifurcation) down to the bifurcation, thicker (1.9 mm) and with a 5 mm click target. In the Lateral view at 1440×900 the left main now has its own click area above the bifurcation (it used to resolve to the proximal LAD). Display only: the engine's left main is unchanged.
- **Necrosis display:** `Sim.necrosisDisplay(h)` (display only) gives each occluded-territory cell a necrosis fraction: 1 inside the endocardial-to-epicardial necrosis front, otherwise growing from the centre of the risk zone to its border between 30 min and 12 h (normalised depth from the territory border, `_territoryDepth`). The tissue colour blends from the ischemic tint to the necrotic colour by it, and a change of time stop animates the shown time over 1.2 s (`paintTissue`, `animateNecrosis`; none with reduced motion). Epicardial surface of a proximal LAD infarct, fraction above 0.5: 1 h 0%, 2 h 9%, 4 h 26%, 8 h 100%; it used to switch all at once when the front completed (~6 h).
- **VT turning narrow (tester report):** reproduced. With dual AV-nodal pathways (always on until now), retrograde conduction from the VT entered the slow pathway and started AV-nodal re-entry with a cycle of 304 ms, faster than the VT's 330 ms. After a run of fusion beats (QRS 186 → 159 → 133 → 107 → 81 ms) the ventricles followed the narrow re-entry. Seen at sinus rates of 120–180 bpm, which could be set during VT. The slow pathway is now closed while VT or VF runs (`_ventArr` in `_applyAvn`); `arrhythmia.js` output is unchanged and 30 s VT runs at sinus rates 72–180 bpm stay wide (QRS 186 ms throughout). Dual pathways being off by default and the rate slider hidden in VT also remove the route.
- **Pericarditis ST:** with `pericardAmpDrop` 0.4, ST elevation measured from the PR segment was II 4.4 mm (J 4.7), I 3.2, V3–V4 3.8–3.9 mm. Literature: ST elevation in acute pericarditis is modest, usually well under 5 mm (Spodick, JAMA 2003), with ST/T in V6 above about 0.25 favouring pericarditis (Ginzton and Laks, Circulation 1982) and PR depression around 1 mm. `pericardAmpDrop` 0.3: II 3.1 mm (J 3.5), I 2.0, aVF 2.2, V3 2.1, V4 2.3, V5 1.1 mm; aVR −2.6 mm; PR depression in II −1.5 mm (unchanged). The app still reads the acute pericarditis pattern (eight leads ≥ 0.08 mV). V6 ST/T is low (0.16) because V6 shows almost no ST elevation in the model. Below 0.3 the elevation falls off steeply (0.25: II 2.2 mm, chest leads ≤ 1.2 mm).
- **Help:** a Resources page lists the papers, data and guidelines used (anatomy and activation, ECG criteria, ischemia and infarction, pericarditis and Brugada). The About text says the dual AV-nodal pathways are optional.
- Validation after the changes, identical to before: `evalecg`, `arrhythmia`, `avnrt`, `avrt`, `stcheck`, `ischaudit` (all ten standard sites); reader 18 pass / 3 partial / 1 wrong (unchanged).

## Round 32: phone Help pages, single-row Help tabs, marker tap, Help from the ⋯ menu

- **Help on phones** has its own pages (author's text): Getting started (introduction, panels, speed and pause, gestures, Learn button), Control panel (Rhythm, Blocks, View, Ischemia, Conditions) and About (limitations, educational aid, credits and version, a link to Resources). Desktop keeps Getting started, View controls, Control tabs and About; Resources is shared. Tabs carry `.dk` / `.mo`; `showGuide()` opens the first page of the current layout.
- **Help tabs** sit in one row (no wrapping; scrolls sideways if ever too narrow). On a 390 px phone the four tabs fit (33–364 px).
- **Phones:** a tap on the yellow occlusion marker removes that occlusion, as the Help says (before, only press-and-hold did; a tap stimulated a beat). Markers behind the heart are ignored.
- **Fix:** Help opened from the ⋯ menu closed again at once: the menu's `history.back()` popstate arrived after Help had pushed its own entry and closed it. `swapLayer()` now replaces the menu's history entry with Help's.

## Round 33: Resources from About only; markers removed by press and hold

- The Resources tab is gone from the top of Help (desktop and phone); Resources opens from a link on the About page (both layouts).
- Round 32's tap-to-remove on the occlusion marker is reverted: on phones a marker is removed by press and hold, as before (a tap stimulates a beat). The "Tap the yellow marker" line is removed from the phone Help.

## Round 34: a longer left main (anatomy), share-link compatibility

- The left main was 7 mm and ran the wrong way: from the ventricle to a split against the aortic root. Round 31 drew a separate tube from the aortic wall to make it clickable, which looked odd. That drawing is removed.
- The engine now routes the left main from the aortic root about 1 cm leftward before the LAD and circumflex leave it (`lmRoute` in `DEFAULTS`: start and split as offsets from the aortic-valve centre; `null` restores the old trunk). Path 11.3 mm, 4 nodes (typical adult left main about 10 mm). In the Lateral view the left main's click area is about three times larger, above and beside the bifurcation.
- Effect on the ECG: the normal ECG (`evalecg`) and `fullcheck` are identical; reader 18 pass / 3 partial / 1 wrong (unchanged). `ischaudit`: territories change by 1–2% (pLAD 7738 → 7863 dead cells, pLCx 8133 → 7964, RCA sites +44). Lead patterns are the same, except proximal LAD at 1 h also shows ST elevation in aVR (and T inversion in II).
- Share links: node numbers change with the tree. New links carry `c=2`. Links without it (made on the live site before this change) are mapped by branch and position along it, through `coronary.allBranches` and a table of the old tree's branch sizes (`legacyNode`). Checked: old `o=0` → left main, `o=3` → proximal LAD, `o=18` → mid LAD, `o=60,130` → proximal circumflex and mid RCA, `o=153` → PDA.

## Round 35: reader fix (posterior STEMI), expanded reader (57 scenarios), flutter rate control

- **The one wrong read (distal circumflex at 1 h):** the model already shows the textbook finding: ST depression 0.19–0.26 mV in V1–V4 with ST elevation in V6 alone, a posterior STEMI (a STEMI equivalent in the 4th Universal Definition and the ESC 2023 ACS guideline). The reader had no posterior criterion and read "normal". New criterion: ST depression ≥ 0.05 mV in two of V1–V3, the deepest ST depression of the 12 leads in V1–V4 and at least 0.1 mV. Circumflex and RCA occlusions may read posterior. Result: 19 pass / 3 partial / 0 wrong on the original 22, nothing else changed.
- **Reader, single beat (`tools/reader.js`):** new criteria: WPW pattern (PR < 120 ms, QRS ≥ 110 ms, slurred upstroke ≥ 50 ms; axis, block, hypertrophy and infarct criteria not read under pre-excitation); acute pericarditis (ST elevation in ≥ 4 leads over ≥ 2 territories, ST depression in aVR, no reciprocal depression outside aVR/V1, PR depression in II ≤ −0.08 mV or PR elevation in aVR ≥ 0.08 mV); Brugada type 1 (coved J elevation ≥ 0.2 mV in V1 or V2 descending into a negative terminal T); right (P ≥ 0.25 mV in II), left (P ≥ 120 ms or V1 terminal force ≥ 0.04 mm·s) and biatrial enlargement. Fix: a QRS-onset search starting inside a long P wave (LAE, P ending at the QRS) no longer takes the P as QRS (QRS 117 → 72 ms); other reads unchanged.
- **New single-beat scenarios:** WPW, pericarditis, Brugada, RAE, LAE, biatrial; occlusions of the left main, OM1, OM2, acute marginal, mid and distal RCA at 1 h and 30 days. The acute marginal expects the textbook RV-infarct pattern (V1 ± inferior ST elevation, no Q).
- **Rhythm reader (`tools/rhythmread.js`), blind, 10 s strips:** QRS from spatial-velocity peaks; VF from incoherent QRS morphology; P waves from the residual after subtracting the median QRST (edges tapered; waves inside a T wave kept only if as large as, and shaped like, those outside); atrial waves locked to the QRS (flutter at a fixed ratio) counted in the raw diastolic stretches. Reading order: wide regular fast → VT; flutter waves 170–260 ms → flutter; regular: P before each QRS → sinus (brady/tachy) or ectopic atrial (negative P in II); more P than QRS with fixed PR → 2:1, variable → complete block (junctional or ventricular escape by QRS width); no P before a fast narrow QRS → SVT (AVNRT or AVRT); irregular: dropped P with changing / fixed PR → Mobitz I / II; every P conducted → SA block or sinus arrhythmia; ≥ 3 P shapes, P before most QRS, rate > 100 → MAT; otherwise AF.
- **Rhythm scenarios (`tools/rhythmscen.js`):** sinus brady and tachy, AF, flutter 2:1 and 4:1, ectopic atrial, MAT, AVNRT and AVRT (induced as in the app), VT, VF, Mobitz I, Mobitz II, 2:1, complete block in the AV node and in the His bundle, SA exit block.
- **Engine fix, flutter rate control:** the ventricular-rate setting gave half the set rate (75 → 36 bpm): the 1-in-N gate sat below the AV node's own natural 2:1 block and counted only the waves that got through it, and odd ratios were impossible. The gate is now at the top of the node (and at the slow pathway's entry, which bypassed it) and passes the first wave once the target RR has nearly elapsed: set 40 / 60 / 75 / 100 → 41 / 58 / 72 / 97 bpm, with and without dual pathways. Unforced flutter is unchanged (145 bpm, 2:1).
- **Result: 42 pass / 11 partial / 4 wrong of 57.** Wrong: RAE, LAE and biatrial enlargement (model P waves, below) and flutter at 2:1 (waves hidden in the QRS and T; also a classic miss for human readers). Partial: LAFB (pseudo-infarct, known), AVRT (read only as SVT, below), poor R-wave progression (R in V3 ≤ 0.3 mV) as an extra finding in several left-sided infarcts, RVH or LVH read beside some old infarcts (pLCx, LM, mid/distal RCA at 30 days), left main 1 h with LAE and first-degree AV block, OM1 1 h with anterior ST elevation (V4).
- **Model findings for later rounds:**
  - Atrial enlargement P waves: RAE P is tall (0.36 mV in II) but 135 ms wide, so it reads as biatrial; LAE P is 0.26 mV in II, so it also reads biatrial; with both, P in II is only 0.24 mV and reads as LAE only.
  - Orthodromic AVRT: the retrograde atrial activation starts 45 ms after QRS onset (AVNRT 36 ms). Textbook AVRT has RP > 70 ms (100–140 ms for a left lateral pathway), so the model's AVRT cannot be told from AVNRT. The pathway's ventricular end is reached about 39 ms into the QRS and `apDelay` is 6 ms.
- Validation after the flutter change: `evalecg`, `arrhythmia`, `avnrt`, `avrt`, `stcheck` identical.

## Round 36: atrial enlargement P waves, AVNRT and AVRT rates

- **P waves** (keys: RAE = tall P, LAE = P mitrale shape). `raeGain` 2.4 → 2.6, `laeGain` 2.6 → 2.0, new `laeAvnMul` 1.35: with the LA activated late, AV-nodal conduction is a little longer in LAE, so the broad P ends before the QRS (PR upper-normal, short PR segment, as P mitrale looks on paper; before, the P ran into the QRS and the reader took it as a wide QRS).
  - `pwave.js`, RAE: P in II 0.38 mV, activation 104 ms, no notch. LAE: 0.18 mV, activation 141 ms, notched (humps 75 ms apart), PR 167 ms. Biatrial: 0.26 mV, activation 140 ms, notched 79 ms. Normal unchanged (0.23 mV, 106 ms).
  - App reads: "Right atrial enlargement (P pulmonale): P 0.37 mV"; "Left atrial enlargement (P mitrale): 153 ms wide, notched in II (humps 75 ms apart)"; "Biatrial enlargement: P 0.26 mV and 152 ms wide, notched".
  - Reader: RAE = P ≥ 0.25 mV in II; LAE = P mitrale (≥ 120 ms and notched in II, humps ≥ 40 ms apart; the V1 terminal-force criterion dropped, as tall RAE P waves met it too); biatrial = both.
- **AVNRT vs AVRT by rate** (AVNRT 140–180 bpm, orthodromic AVRT above 200): `avnCvRestK` 4 → 2.4 (less AV-nodal slowing at short coupling). AVNRT 163 → 174 bpm (cycle 344 ms), AVRT 190 → 206 bpm (291 ms); induction windows unchanged (AVNRT premature beats 200–280 ms, AVRT 240–300 ms). The rhythm reader reads an SVT without visible P as AVRT at ≥ 200 bpm and AVNRT below. Learn text: AVNRT typically 140–180 bpm; AVRT often above 200 bpm.
- Side effects (before → after): sinus PR 141 → 140 ms; first-degree PR 259 → 256 ms; Wenckebach PR steps 272–449 → 269–433 ms; AF at 107 bpm RR SD 191 → 145 ms (still irregularly irregular); flutter, MAT, VT, VF, WPW, axes (fascsearch), hypertrophy and fullcheck practically unchanged; `ischaudit`: proximal LAD 48 h loses the last V4 ST elevation, old distal LAD loses R loss in aVL, proximal circumflex Q also in aVL.
- **Rhythm reader:** VF only on incoherent QRS shape (the "no quiet baseline" rule called VT VF once VT conducted back to the atria); flutter from the autocorrelation of the raw atrial leads in diastole (best lag 150–300 ms; 4:1 flutter 0.79 at 220 ms, AF 0.31, other rhythms ≤ 0.21); MAT also needs RR irregularity below AF's (RR CV < 0.2) and PR SD ≤ 95 ms.
- **Reader: 46 pass / 10 partial / 1 wrong of 57** (wrong: flutter at 2:1, waves hidden in the QRS and T). Partial: extra findings beside correct diagnoses (poor R progression, LVH/RVH beside old infarcts, LAFB pseudo-infarct).

## Round 37: reader fixes for combined abnormalities (P waves)

Found while generating training ECGs that combine several abnormalities; the 57 validation scenarios
grade the same before and after (PR moves by 1–10 ms in WPW, pericarditis, RAE, BAE and first-degree block).

- `tools/rhythmread.js`
  - P polarity from the first lobe of the atrial complex, not its largest point: the atrial repolarisation
    wave after the P (PR depression of pericarditis) is larger and opposite, and made sinus rhythm read
    as ectopic atrial rhythm.
  - The QRS-T template is subtracted relative to its own baseline (its last sample, after the T wave):
    a TP segment shifted off zero (pericarditis injury current) left a step at the window edges.
  - The T-wave zone runs 40 ms past the measured T end: the tail of a long T wave read as a second P
    wave per beat (LAE read as 2:1 AV block).
  - The template window starts 15 ms before the QRS onset (at least 45 ms before the peak): with a
    delta wave the peak is late and the delta wave stayed in the residual, larger than the P waves.
- `tools/reader.js` (single-beat read)
  - At fast rates the baseline search and the P search start at most RR − 330 ms before the QRS (sinus
    tachycardia at 115/min read the previous T wave as a tall P: RAE and first-degree block).
  - The P wave is the last clear atrial peak before the QRS (a local maximum of at least 30% of the
    largest), up to 15 ms before the onset, not the largest: WPW above 75/min read the previous T wave
    as the P (P running into the delta wave).

## Round 38: atrial fibrosis (AF substrate), flutter that repeats

Testers saw AF that looked like flutter and flutter that looked like AF.

- AF was too organised: its 11 focal drivers sweep the whole atria at every firing (atrial refractory
  floor ~125 ms, atria activated in ~100 ms), so the atrial waves repeated every 160–176 ms (diastolic
  autocorrelation 0.62 in II). New **atrial fibrosis** (`Sim.setAtrialFibrosis`, `fibHet` 0.45): the
  refractoriness of each working atrial cell varies ×(1 ± 0.45) in a fixed pattern from the Sim's seed, so
  AF breaks into wavelets: fine, irregular f-waves (autocorrelation 0.36, ~0.08 mV in II). Slower atrial
  conduction (`fibCv`) is available but left at 1: in this model it made the sinus P taller and shorter
  (read as RAE). Fibrosis is structural: it stays through a shock; with it the sinus P is unchanged.
  In the app it is a condition (Chambers: "Atrial fibrosis (AF substrate)"), drawn as tan patches on the
  atria (legend), shared in links (`s=fib`); starting AF adds it with a note, as AVRT adds the pathway.
- Flutter looked irregular because the left atrium could not follow the circuit: every atrial cell had
  the flutter refractory floor (185 ms) and the passively driven LA dropped waves at random (LA cycle
  246 ± 15 ms against the circuit's 207 ± 3). The floor now applies to the right-atrial circuit only: the
  LA follows 1:1 and the flutter waves repeat identically (autocorrelation 0.99 in II and V1).
- Open: the flutter waves are ~1.5 mm in II (textbook 2–5 mm) and V1 sees little atrial activity in this
  torso (sinus P in V1 −0.02 mV), so f-waves and flutter waves are small in V1.
- Checks: `evalecg` identical; reader 46/57 as before (2:1 flutter, a known hard case, now read as AVNRT
  instead of "regular tachycardia"); `arrhythmia.js af,flutter` rates unchanged; app: AF adds fibrosis,
  shock keeps it, share link `#r=72&s=fib`.

## Round 39: dual AV-nodal pathways drawn

The slow AV-nodal pathway (`Model.avnSlow`, coronary-sinus ostium to the lower compact node) was modelled
but not drawn. It is now a tube of its own beside the compact node (the fast pathway), yellow like the
rest of the conduction system (not a colour of its own: teal could be taken for a WPW pathway), coloured
by the activation of its own segments, and shown only with the condition "Dual AV-nodal pathways" (also
switched on by AVNRT). In AVNRT the activation front is seen going down the slow pathway and back up the
fast one. Reset hides it again. Checked: page loads without errors, AVNRT turns the pathway on, Reset off.
## training-1 round 1: Training prototype (phones, portrait)

First prototype of the training mode in the design document: one screen, a fixed bank of 10 items, no
ratings kept and no storage. Served at `training/index.html` (ecgstudio.app/training once merged); not
linked from the menu yet.

- Bank: `node tools/trainbank.js` runs 10 scenarios (normal, AF, flutter 4:1, AVNRT, AVRT, Mobitz I,
  complete AV block, LBBB, old inferior infarct at 30 days, proximal LAD STEMI at 1 h), records 10 s of
  12-lead ECG after 4 s settling, and reads it blind (`reader.js` beat read, `rhythmread.js` rhythm read).
  An item is kept only if the reading matches its gate; all 10 pass. Output `src/training_bank.json`
  (250 Hz, µV Int16, base64; about 80 kB per item) with the measurements, answer key, highlight leads,
  caliper and the simulator link for "Show me why". Rerun after engine changes.
- Measurements shown are the reader's. At 170–210/min the single-beat reader has no TP segment, so the
  tachycardias take axis and QRS from the same heart in sinus rhythm and show no QTc; PR is not shown where
  it is not a fixed interval (AF, flutter, SVT, Mobitz I, complete block).
- Vocabulary: `src/training_vocab.txt`, plain text for the author to edit (id | name | synonyms | flags).
- Page: `src/training.html` + `src/training.js`, assembled by `tools/build.py` into `training/index.html`.
  ECG halves (limb leads 0–5 s, chest leads 5–10 s; 2.5 s per lead, lead II rhythm strip), swipe between
  them, double-tap (or the phone held sideways) for the full 12-lead. QWERTY keyboard without space; a
  hardware keyboard also works for desktop testing. Region mode for any finding flagged `region`.
- Scoring as in the design: rhythm 40% (an accepted alternative such as "SVT" for AVNRT: half), required
  findings share 60% (the region is half of a finding's share), optional findings +5%, a finding not present
  −10% (−20% on an ECG with no other abnormality). Session rating Elo-style, not saved.

## training-1 round 2: keyboard, compact ECG, menu, suggestions by frequency

- Keyboard styled like a phone's own: number row, QWERTY, delete, space bar, a magnified key preview, and
  room below for the home indicator. Submit sits beside the text field. "No other abnormality" is removed
  (picking it after a full answer was scored as a wrong finding).
- ECG at the same paper scale (5 s across the width) with the rows 17 mm apart (was a quarter of the free
  height); the space left over goes above the keyboard. The result sits directly under the ECG.
- Menu (⋯): Statistics (this session: rating, answered, average score and time, rhythm accuracy, per ECG),
  How training works, Restart session, the simulator. Session statistics and rating are kept in
  sessionStorage, so they survive "Show me why" and back; nothing is kept beyond the tab.
- Vocabulary ordered by how common each term is (file order = suggestion order); an exact abbreviation
  goes first ("af", "chb", "3avb"). More synonyms and numbered forms (1AVB, 2AVB1, 3AVB, 2:1 as "21");
  "old MI" and "STEMI" are synonyms of Q waves and ST elevation, so they ask for the location.

## training-1 round 3: the first keyboard back, ECG fills the screen

- Keyboard as in round 1 (three letter rows across the full width, no number row) plus a space bar row.
  The key left of z, where Submit was, is now **Add**: it adds the first suggestion (Enter on a hardware
  keyboard does the same).
- The ECG takes all the height between the measurements and the answer area (rows a quarter of it each;
  the paper scale stays 5 s across the width), also on the result screen.

## training-1 round 4: live ECG generation, what a student would see

- No question bank: `src/training_gen.js` builds each ECG on the phone in a background worker (engine,
  `tools/reader.js`, `tools/rhythmread.js` and the generator, assembled by `tools/build.py`), two ahead
  of the user. A scenario is a rhythm plus 0–4 abnormalities, chosen near the user's level: Glicko-2 per
  skill (rhythm, conduction, ischemia, conditions), item rating from the rhythm and the number and type of
  abnormalities (+60 when P waves are hidden), aiming at about 72% expected success.
- The check, "how would a student see this?":
  - rhythm and rate from the engine's activation times; P waves must not lie inside a QRS or T wave
    (≤ 20% of them for sinus rhythms, ≤ 50% for AV block rhythms). The blind rhythm reader runs for the
    record only (it misread Mobitz I/II as AF and sinus rhythm as flutter on visible P waves).
  - morphology on the median beat (all beats aligned at the engine's ventricular onset): each abnormality
    on its own published criteria (no chained rules), and a twin run without it must differ by ≥ 1 mm
    (0.5 mm for P waves). Highlights: the textbook leads where the twin shows the change.
  - the blind beat read of the median beat must not show a finding that was not put in.
- Combination rules (author's clinical calls): at most one QRS-changing condition (LBBB, RBBB, LAFB, LPFB,
  LVH, RVH, Brugada, WPW) except RBBB + LAFB/LPFB; LBBB without ischemia; RBBB with acute STEMI but not
  old infarct or pericarditis; pericarditis only with atrial enlargement or first-degree block; WPW with
  ischemia but not atrial enlargement or first-degree block; LAFB not with an inferior infarct, LPFB not
  with an LAD or circumflex one; at 106–125/min no first-degree block, WPW, BBB, pericarditis or BAE.
- Audit: `node tools/trainlive.js [N] [seed]` (pass rate by rhythm, abnormality, pair, and the stage
  that rejected). Before the median-beat and twin check 25/60 passed; after it 40/60 (every
  single-abnormality ECG), before the combination rules above.
- Open: AF looks organised (11 fixed-rate foci, mostly left atrial: waves repeat every 160–176 ms, tiny
  in V1) and flutter's inferior sawtooth is small and uneven: proposed engine work on milestone-1.

## training-1 round 5: training home

- Home screen (opened first; the heart is built in the background meanwhile): rating, day streak, level
  with experience to the next, Daily ECG, Train, Reviews (due count), practice by skill (the skill's
  rating; ECGs aimed at that skill), Statistics, How it works, the simulator. Prototype: all unlocked.
- Daily ECG: the same for everyone on a date (generator seeded by the date, target 1500), not rated;
  the result can be shared as text (score, streak, link; no answer).
- Reviews: an ECG scored under 80% returns after 1, 3, 7, 16 and 35 days (Leitner boxes; a miss
  starts again at 1 day), rebuilt in the worker from its recipe (same seed: the same ECG).
- Streak: a day counts with the daily ECG or 5 ECGs. Levels (experience = 10 × score × (1 + number of
  abnormalities)): Medical student, Clerk, Intern, Resident, Registrar, Cardiology fellow, Cardiologist,
  Electrophysiologist, Professor of cardiology (0, 150, 400, 900, 1800, 3200, 5500, 9000, 14000 XP).
- Stored on the phone (localStorage `ecgTraining.v1`): ratings, last 300 answers, reviews, days, XP.
- The simulator's phone menu links to Training (milestone-1).
- Testers' bug report (round 5): "⚑ Report a problem with this ECG" under the result and in the ⋯ menu
  opens the share sheet (or copies to the clipboard) with the simulator link, the key, the answer and
  score, the measurements, the reader's checks, the generator recipe and the build version.
- Scoring fix: on an ECG whose only abnormality is the rhythm, the rhythm is the whole score (a wrong
  rhythm scored 60% before: the findings' share was given for naming no finding).
- Round 5 changes: the simulator link is at the top of the home screen; a day counts for the streak
  with one ECG; levels Clerk, Nursing student, Medical student, Intern, Resident, Cardiology fellow,
  Cardiologist, Electrophysiologist, Professor of cardiology (same XP thresholds).

## training-1 round 6: titles, statistics, recent infarct

- Ischemia variety: the generator used only an occlusion at 1 h (STEMI) and 30 days (old infarct). Added
  the infarct at 2 days (`recent`: Q waves and T inversion over the territory, required with their
  regions; residual ST elevation optional), LAD and RCA sites pass, circumflex sites are mostly rejected
  (false RVH/LVH reads). Subendocardial ischemia (ST depression) works in the engine but is switched off
  in the simulator (Round 27: territory-specific reciprocal ST elevation), so "Model" could not show it:
  not generated until decided. Hyperacute T (15 min) is not used: the reader has no criterion for it.
  Isolated T inversion (Wellens-type) is not produced by the model.
- Levels (XP) removed. Titles from the overall rating, like chess titles, and they can be lost: Clerk
  (< 1300), Nursing student (1300), Medical student (1450; a new user is 1500), Intern (1600), Resident
  (1750), Cardiology fellow (1900), Cardiologist (2050), Electrophysiologist (2200), Professor of
  cardiology (2350). First guesses, to be tuned.
- Statistics: skill radar (1100–2100, 1500 dashed), the last 5 ECGs with the rating change (daily: not
  rated). Home: Statistics and How it works set apart below a divider. How it works: the author's text.
- Ratings already weigh the ECG's difficulty (Glicko-2 against the item rating): at 1500, right on a
  1900 ECG +33, wrong −3; wrong on a 1200 ECG −30 (a 2300 player −37).

## training-1 round 7: hyperacute T, circumflex infarcts, speed

- Hyperacute T (occlusion at 15 min) in the generator, with a checker rule: T ≥ 5 mm (limb) or ≥ 10 mm
  (chest) in two contiguous leads of the territory, no ST-elevation criteria met, and at least 1.5× the
  same heart's T without the occlusion (twin). LAD and RCA sites pass (V3–V4 ~10 mm; III 12 mm, aVF
  9 mm); circumflex fails (its lateral T barely grows). Answer: hyperacute T waves with the region.
- Circumflex (and mid RCA) old and 2-day infarcts were rejected for "RVH"/"LVH" in the blind read: the
  infarct moves the axis and the R waves (lateral/posterior loss: right axis and a tall R in V1; inferior
  loss: tall R in aVL) and the reader's voltage rules have no infarct exception. With an old or recent
  infarct these reads are no longer findings; tall R in V1 / posterior MI are accepted as optional.
- Radar: a fifth axis, speed (median time of the last 20 answers scored ≥ 80%; 10 s = edge, 60 s =
  centre, log scale).
- Probed for later: subendocardial ischemia over a whole artery territory ("tight narrowing", partial
  flow) instead of a clicked patch: LAD 1 h gives ST depression 1.5–2 mm in I, aVL, V4–V6, lateral T
  inversion and ST elevation in aVR, fading over 4–12 h; circumflex similar; RCA too strong (8 mm, with
  reciprocal ST elevation in aVL).

## Round 40: coronary narrowing (partial flow)

A narrowed artery is now modelled beside the occlusion. `Sim.addStenosis(node)`: the territory downstream
of the node becomes ischaemic in its inner wall only (the subendocardial time course: injury current that
eases from 3 h and is gone by about a day and a half, no transmural necrosis), at severity `stenosisSev`
0.4 (the injury of a whole territory saturates at full severity; 0.4 brings it to textbook size). This
replaces the clicked subendocardial patch (still off, Round 27) as the way to show demand ischaemia.

- ECG at 1 h (mm): proximal LAD: ST depression I 1.4, aVL 1.1, V4 1.2, V5 0.9, ST elevation aVR 1.0
  (interpretation: "subendocardial ischemia (NSTEMI pattern)"); circumflex: ST depression I/II ~2, aVR
  +2; RCA: inferior ST depression ~4 with inferior T inversion and ~2 mm ST elevation in aVL (still
  deep, and the reciprocal aVL elevation of Round 27 remains: open).
- App: desktop click on an artery narrows it, double-click occludes it (the single click waits 350 ms);
  phone: hold until the ring fills once and release to narrow, keep holding until it fills again in red to
  occlude. The same gesture on a marked artery removes it, the other switches narrowing ↔ occlusion.
  Narrowing: orange marker, orange vessel downstream, "Narrowing" in the legend and the ischemia list;
  share links `n=` (with `c=2`). Tab notes, Help (Control tabs, Gestures) and the Learn entry on
  subendocardial ischemia updated.
- Checks: `evalecg` identical (nothing changes without a narrowing).

## training-1 round 8: narrowing in the quiz

- New ischemia scenario `narrow` (Round 40's `addStenosis` at 1 h, sites proximal/mid LAD, proximal/mid
  RCA, proximal circumflex): answer "ST depression" located where it is deepest, any other lead group that
  shows it accepted (ST depression does not localise the artery); T inversion, flat T and reciprocal
  change optional. Checker: ST depression ≥ 0.5 mm in two contiguous leads (not aVR or V1), no ST-elevation
  criteria met. Not combined with LBBB, RBBB, LVH/RVH (strain), WPW, pericarditis or Brugada. "Model"
  opens the simulator with the narrowing (`n=`).

## Round 41: reader option for the QRS end

`read(rec, hint, rr, { minOff })`: the earliest QRS end when the true end of ventricular activation is
known (the training generator passes the simulation's own timing). With RBBB and ST elevation the slow R′
runs into the raised ST segment and was taken as the end of the QRS (74 ms instead of ~130 ms; the R′ was
then outside the measured QRS and read as a coved Brugada ST). Off by default: validation identical.

## training-1 round 9: audit fixes

- The generator passes the engine's end of ventricular activation to the reader (`minOff`, Round 41):
  RBBB with ST elevation measured 74 ms (the R′ ran into the raised ST) and now ~125 ms.
- Q waves read beside an acute STEMI are optional (they form within hours), not a rejection.
- Rules: LAFB not with a circumflex infarct; first-degree block not with an RCA infarct (nodal
  ischemia sinks the P into the T); hyperacute T not with WPW or hypertrophy, judged in the territory's
  own leads, rise ≥ 1.4× the twin's T; flutter without ischemia (flutter waves on the ST segment);
  complete AV block may have up to 65% of P waves hidden.
- Checker rules made textbook (author's review): ST depression ≥ 1 mm at J+80 ms, horizontal or
  downsloping (< 0.5 mm rise from J to J+80; upsloping is nonspecific), two contiguous leads (not aVR,
  V1); T inversion ≥ 1 mm with R/S > 1 (4th UDMI), two contiguous leads (not aVR, III, V1). With these,
  circumflex and RCA narrowings pass (1–4 mm horizontal); LAD narrowings (~1 mm at J, less at J+80) do
  not.

## Round 42: narrowing tuned per artery; textbook ST depression and T inversion in the panel

- `stenosisSev` per artery family (LAD 0.65, circumflex 0.55, RCA 0.17, left main 0.5): at 1 h the
  proximal arteries give 1.5–2 mm horizontal ST depression at J+80 in two contiguous leads (proximal LAD
  I/aVL/V4 1.7–1.9; circumflex V4–V5 1.7–2.1; RCA III/aVF 1.7–1.9), fading over 4–12 h; side branches
  ~1 mm; left main 3–4 mm widespread with aVR +3. A mid-LAD territory reaches ~1 mm at most at any
  severity (too small). The engine is adjusted rather than the criteria (author's call).
- Interpretation panel, same rules as the training checker: subendocardial ST depression ≥ 1 mm at J+80,
  horizontal or downsloping (< 0.5 mm rise from J), two contiguous leads, not aVR or V1 (otherwise "no
  diagnostic ST change"); T inversion ≥ 1 mm with R/S > 1 (4th UDMI), or behind Q/QS waves. `measureBeat`
  gains the J-point and J+80 levels.
- Checks: `evalecg` identical; panel reads proximal LAD, circumflex and RCA narrowings as subendocardial
  ischemia, mid LAD as no diagnostic change, a 2-day anterior infarct with T inversion V2–V5, acute STEMI
  unchanged.
- Training (round 9): T inversion also counts behind Q/QS waves (as the panel); narrowing questions use
  proximal LAD, proximal circumflex and proximal/mid RCA (mid LAD stays under 1 mm). Narrowings now pass
  with 1.5–2.5 mm horizontal ST depression. Audit before the textbook rules: 40/50 (0–1 abnormalities
  26/28).

## Round 43: non-specific ST-T changes

`Sim.setNonspecificSTT(on)`: the transmural repolarisation gradient that makes T upright (endocardium
85 ms longer than epicardium) is reduced in patches across both ventricles, by up to `nssttGrad` 0.9 of it
(a smooth pattern of three random plane waves, ~4–7 cm, from the Sim's seed, mixed `nssttPatch` 0.5 with a
uniform part), and the plateau sags by up to `nssttSag` 0.06. No territory, no necrosis, no injury current.

- Result over seeds 1–8: T flat (−1 to +1 mm) in V5–V6 in every heart, in II/aVF in most, V3–V4 in some,
  with minimal inferior inversion (−0.5 to −0.8 mm; −2 mm in aVF for one seed), ST sag ≤ 0.4 mm, QTc
  −10 ms. A stronger setting was too uniform; a milder one left only V6 flat.
- App: condition "Non-specific ST-T changes" (Repolarization; share key `s=nsstt`), Learn entry; the panel
  reports "Flat T waves in …: non-specific ST-T changes" when T is between −1 and +1 mm in two contiguous
  leads where it is normally upright (I, II, aVF, V3–V6), without ischemia, WPW, hypertrophy, pericarditis,
  Brugada or bundle-branch block. No false report in the normal heart, LVH or LAFB.
- Checks: `evalecg` identical.

## training-1 round 10: non-specific ST-T changes in the quiz

- Abnormality `nsstt` (Round 43 engine), conditions skill: answer "Non-specific ST-T abnormality" (no
  location). Checker: T between −1 and +1 mm in two contiguous leads where T is normally upright (I, II,
  aVF, V3–V6), and neither the ischemic T-inversion nor the ST-depression rule met. Not combined with
  ischemia, pericarditis, Brugada, bundle-branch block, hypertrophy, WPW or flutter.
- Vocabulary: "Flat T waves" (a region term) is folded into "Non-specific ST-T abnormality" (synonyms
  include flat T, T wave flattening, NSSTTA).

## training-1 round 11: testers' round 1 (75 ECGs)

- Screen: keys 56 px (were 46); the suggestions take the chip row while typing (no row of their own, the
  "Add every abnormality…" hint removed), so the keyboard grows without shrinking the ECG. Result chips are
  buttons: tapping one shows that finding's leads only (the rhythm: the caliper) and its own line (or "not
  present", or "also true: secondary"). Speed on the radar: 15 s = edge, 60 s = centre.
- Scoring: "LVH with strain" counts as LVH (and bifascicular block as RBBB/LAFB); Mobitz II counts for 2:1
  AV block (the more serious reading).
- Generator mix: the rhythm is drawn first by its weight; the number of abnormalities follows the target
  (one per ~300 rating points); abnormalities are drawn by weight. Best-of-many selection had favoured the
  abnormalities with the largest rating bonus (hypertrophy, Brugada, 2:1 block). Weights lowered for
  hypertrophy, Brugada, atrial enlargement, Mobitz II, 2:1 block, LAFB/LPFB, first-degree block; raised
  for narrowing, recent infarct, non-specific ST-T, hyperacute T, WPW.
- New rhythms: VF; SA exit block (3:2); sinus pause (2.6 s, at 3 s into the strip; link `b=SAN.pause`).
  New abnormalities (sinus rhythm only): two PVCs, two PACs, or a ventricular couplet, timed from the
  engine's own beats (PVC ≥ 0.6 RR after the last QRS; PAC 0.35 RR before the next sinus discharge);
  verified from the engine's timing (fired, premature; PVC ≥ 110 ms wide, PAC narrow) and left out of the
  median beat; P waves beside an ectopic beat not counted as hidden. QTc not shown and "long QT" not read
  across pauses (the QT after a pause is longer).
- Rules: no hypertrophy with STEMI (the hypertrophy source gain also amplifies the injury current: ST
  elevation far too tall); no fascicular block with hyperacute T (the territory repolarises in two waves:
  an M-shaped T); Q waves named with an acute STEMI are true (optional).
- Audit (30 scenarios, seed 21): 22 passed, no errors (VF, couplets, PACs, AVRT/AVNRT and narrowings
  among them). From the rejections: no WPW with a circumflex infarct (the left-lateral pathway's insertion
  dies: pre-excitation lost) or with ectopy; flutter's ST/T reads ignored (flutter waves on the ST segment,
  no ischemia in flutter).

## claude/magical-keller-whbpj7 round 1: logo

- Mark: a 9-wide voxel heart in isometric view, two voxels thick, coloured by a wavefront spreading from
  the upper-left lobe (the sinus node's side): green repolarising behind, light blue depolarised, bright
  blue front (raised one voxel), pink resting ahead (the tissue colours of `src/app.js`, a little more
  saturated).
- `tools/logo/iso.js` renders it (unit cubes, hidden faces dropped, painted back to front) into
  `icons/logo/`: `logo.svg` (no tile, no outlines: header and favicon), `app-icon.svg` (rounded tile),
  `app-icon-square.svg` (full bleed: Apple touch icon, Play Store) and `app-icon-maskable.svg` (art inside
  the 80 % safe circle). `tools/logo/gen.js` holds the flat 2D concepts and the shared palette and masks.
- `tools/build.py` inlines `icons/logo/logo.svg` as the header mark and as the favicon data URI of the app
  and of Training. PNGs (`icons/icon-*.png`, `icons/apple-touch-icon.png`, `icons/logo/play-store-512.png`,
  512×512 RGBA for Google Play) are screenshots of the SVGs in Chromium.

## Round 44: non-specific ST-T clearer; RAE P wave noted

- Non-specific ST-T (testers: highlighted leads still showed upright T): `nssttGrad` 1.0, `nssttPatch` 0.4.
  Over seeds 1–8 every heart has T within ±0.5 mm in V3–V6 (often minimal inferior inversion); 2 of 8 go
  past 1 mm of T inversion in II/aVF (the training checker rejects those). Panel: flat = within ±0.5 mm.
- Open (testers): RAE reads like P mitrale in lead I. The model's P axis is ~90° even in the normal heart
  (lead I P ≈ 0 mV; normal ~50–60°): with RAE the early right-atrial part is slightly negative in I and
  the left-atrial part a late positive hump, so lead I shows a dip then a hump. RAE also has a large
  atrial repolarisation wave in II (−0.19 mV after the P). Needs atrial activation / torso work.
- Checks: `evalecg` identical.

## training-1 round 12: testers' round 2 (50 ECGs)

- Screen: the bottom area keeps the typing view's height (chips, field, keyboard) in every phase, so the ECG
  never changes size; the region view puts Cancel/Done under the instruction (they had fallen below the
  screen on phones) and scrolls its buttons; the result view scrolls its chips and line, actions pinned.
  Keyboard: bottom row 123/abc (numbers: 1–0, : / -), a shorter space bar, Clear; 16 px more below it.
  Explanation lines condensed to ≤ ~130 characters (3 lines).
- Suggestions ranked by match: exact abbreviation; the name or a one-word abbreviation starts with the text;
  a whole word of the name is the text; a word of the name starts with it, across spaces ("tw" → T wave
  inversion, hyperacute T waves); a synonym; then commonness. Vocabulary: sinus pause is a finding; AV
  dissociation is a synonym of complete AV block (no longer a finding); non-specific ST-T moved up.
- Generator: sinus pause as a finding on sinus rhythm (timed like ectopy, checked from the engine: one RR
  ≥ 1.6× the usual); AF ventricular rate 60–150 and flutter 60–100 (`v=` in the link); LVH/RVH make T
  inversion true (strain), also in flutter; non-specific ST-T flat = within ±0.5 mm (Round 44 engine).
- Variety: a weight left undefined (sinus pause) made the draw pick the last entry every time (Brugada and
  the couplet: a third of all repeats); missing weights now count as 0.5. The page sends weight multipliers:
  what was in the last 8 ECGs ×0.15, in the last 20 ×0.6; missed or partly right in the last 40 up to ×2.5;
  right 3+ times and never missed ×0.6; a plain normal ECG only ~6% (it was the most repeated). In 200
  simulated 50-ECG sessions: the exact same interpretation within the last 20 fell from 38% to 7%, the same
  non-sinus rhythm within 20 from 33% to 16%, twice in a row from 4% to 0.5%.
- The home screen already prepares Train ECGs (first one ready in ~4–12 s in a desktop browser).


## training-1 round 13: escape rhythms, atrial couplet, SA exit block as a finding, AF pericarditis

- Rhythm weights: flutter 2.5, Mobitz II 1.2, complete AV block 0.9 (flutter above CHB, CHB below Mobitz II).
  Brugada 0.1. At target 1500–1700, the rhythm shares are: flutter 9.0%, Mobitz II 4.2%, CHB 3.0%; Brugada 0.4% of ECGs.
- New rhythms: sinus arrest for the whole strip (`b=SAN.arrest`) with a junctional escape (48/min, narrow).
  Also with a ventricular escape (`b=SAN.arrest,HIS.complete`, 32/min after Round 45, QRS ~124 ms).
  Gate: no atrial activation 60–300 ms before a QRS, and a rate of 40–60 for junctional or 20–40 for ventricular.
  "Sinus pause" is optional there: credited, not required. The wide escape QRS shape is not a finding,
  so the blind read is skipped and the axis is not shown. Simulator rhythm line: "Sinus arrest with junctional/ventricular escape rhythm".
- SA exit block (3:2) is now a finding on sinus rhythm (group ectopy). Check: at least two RRs of 1.7–2.3× the sinus cycle.
  The rhythm label and rate class come from the 25th-percentile RR (the sinus cycle) when a sinus pause or SA block is present.
  QTc is not shown. Not with WPW: the median beat across pauses misreads the PR.
- Atrial couplet (`acouplet`): two PACs, the second max(440 ms, 0.62 RR) after the first. Both must conduct narrow and premature.
  "PACs" is optional. Vocabulary: "Atrial couplet".
- Pericarditis in AF: no PR segment, so the check is diffuse ST elevation (≥ 4 leads, 2 territories) and aVR depression
  without reciprocal depression. The ST must also be concave upward in at least half the elevated leads (J+40 below the chord from J to J+80).
  The blind reader's STEMI read is ignored beside pericarditis. Still not with flutter or AV block.
- Junctional escape with other findings: everything that leaves the QRS narrow (ischemia, fascicular blocks,
  hypertrophy, pericarditis by the no-P check). Not LBBB or RBBB, because a wide QRS would pass for a ventricular escape.
  Not non-specific ST-T, because the inverted retrograde P sits on the inferior ST-T and reads as T inversion. The P-wave
  findings and ectopy are not combined with it (no sinus P waves).
## Round 45: ventricular escape at 32/min

`ventEscapeRate` 40 → 32, the middle of the textbook 20–40/min range for a ventricular escape. The rate was
at the top edge of the range. The pacemaker below a His block or bilateral bundle branch block now fires every 1875 ms.
That covers the escape after His-level complete AV block and after sinus arrest with His block. The junctional
escape is unchanged (48/min). `tools/rhythmscen.js` chbHis: 32/min, QRS 121 ms. The reader still reads
"complete AV block (ventricular escape)" there, and chbAVN still reads as a junctional escape.

## training-1 round 14: rating scale

A tester at 1900 gained 1–2 points per correct ECG, and Professor (2350) was out of reach. The hardest ECG was
rated about 2340, and at 1900 the median ECG offered was about 1700. Also, the rating deviation floor of 40 made each step small.
- Item difficulty above the base 1200 is stretched ×1.32 (`ITEM_SCALE`), so the hardest ECGs reach about 2705. `sample()`
  turns the target back to the unstretched scale before choosing the number of findings. The aim (rating − 168 ± 80)
  is unchanged, by the author's call (aiming closer would narrow the generation and repeat more).
- Glicko-2 RD floor 40 → 60: a perfect answer at 1900 against a 1700 ECG gives +5 (was +2.3).
- Titles compressed so Professor is at 2100. The bands: Nursing student 1300, Medical student 1450, Intern 1550, Resident 1650,
  Fellow 1750, Cardiologist 1850, Electrophysiologist 1975, Professor 2100.
- Simulated single skill from 1500 (rating settles where the average score meets the expected score):

  | Average score | Settles near |
  |---|---|
  | 95% | 2540 |
  | 90% | 2320 |
  | 85% | 2050 |
  | 80% | 1880 |
  | 70% | 1710 |

  Professor needs about 87% sustained. The title uses the mean of the four skills.

## Round 46: RAE without a standing offset; inferior STEMI height

- **RAE P wave.** Before, the enlarged RA's action potential was raised ×2.6 (`vAmp`). While the atria were depolarised,
  the step between that high RA plateau and the normal LA was a standing dipole, through the P wave and into the PR segment.
  In lead I it made a late hump of 1.2 mm (a notched, P-mitrale look), and in II it left a −1.6 mm dip after the P.
  Now the RA keeps the normal action potential, and the extra (`raeGain` − 1)× is summed through lead weights with zero mean
  over the RA (`_raWave`, `_raWbar`, `_raList` in `_ecg`). Like a closed region in the body, the moving wavefront shows
  but a fully depolarised RA adds nothing.

  | RAE | Before | After (`raeGain` 2.2) |
  |---|---|---|
  | P in II | 3.8 mm | 4.0 mm, peaked |
  | P duration | 134 ms | 105–134 ms |
  | Dip after P in II | −1.6 mm | −0.3 to −0.6 mm |
  | Lead I late hump | 1.2 mm | 0.6 mm (normal heart 0.4) |

  BAE: P in II 0.28 mV. LAE and the normal heart are unchanged. Lead I still has the normal heart's small double
  hump (atrial model limitation).
- **Inferior STEMI.** At full strength an RCA occlusion gave 12–15 mm in III (aVL −9 to −10) at 1 h. The inferior wall
  faces the inferior limb leads squarely in this torso. `occlusionInj` scales the early ST/T sources of an occlusion by
  artery family: the injury current (resting rise and plateau drop) and the K-ATP shortening. The LV uses RCA 0.33;
  RV muscle uses ×`occlusionInjRV` 1.8 (≈ 0.6), so RV involvement keeps V1 elevation.

  | 1 h, before → after (mm) | II | III | aVF | aVL |
  |---|---|---|---|---|
  | pRCA | 6.6 → 1.5 | 12.0 → 3.1 | 9.3 → 2.3 | −8.6 → −2.4 |
  | mRCA | 9.7 → 3.5 | 15.3 → 5.6 | 12.5 → 4.6 | −10.4 → −3.9 |
  | dRCA | 9.5 → 3.1 | 14.3 → 4.7 | 11.9 → 3.9 | −9.5 → −3.2 |

  pRCA also shows V1 1.7 mm. Necrosis, Q waves, late T inversion and the time course are unchanged. The fullcheck
  ischaemia lead groups are identical. The reader scores 47/57 (was 46): the acute marginal now reads as a clean inferior STEMI.
  Hyperacute T at pRCA stays under 5 mm, so the training generator no longer asks it there (mid RCA covers it).
  The normal ECG (evalecg) is unchanged.

## training-1 round 15: faster first ECG; vocabulary trimmed

The first ECG took 15–30 s on phones. Profile (Node, 14 scenarios): the main 10 s run was 62% of the time and the twin runs 35%.
The median beat and the blind read were under 3%. AF/flutter/induced tachycardias cost 5–11 s for the strip alone
(the engine: many atrial activations; in AF ~3,000 short-APD atrial cells are summed sample by sample).
- Fail fast: the blind read and every abnormality's criteria now run before any twin, so a rejected scenario costs no twin runs.
- Twins run a 6 s strip (`TWIN_STRIP`): only their median beat is read.
- Flutter and the induced tachycardias settle 1.5 s instead of 4 s (their start-up has already run 3–5 s).
- Two workers where the phone has ≥ 4 cores (`N_WORKERS`). The queued ECGs are made side by side, so the first one shown is
  whichever finishes first. Each worker builds its own heart (~100–150 MB).
- Result: generator time −20% on the same scenarios with the same pass/fail. First ECG in headless Chromium:
  2.9–5.5 s (8 runs), was 5.7–9.8 s.
- Vocabulary: 61 terms that no generated ECG asks or accepts were removed (paced rhythms, electrolytes, MAT, TdP,
  Wellens, Sgarbossa, ...). 51 remain. A term no ECG uses could only ever be marked "not present".
- MAT added back as a training rhythm (it is in the simulator): `mat` w1, rate 105–130, rating 170, link `a=mat`.
  Its four foci are placed in distinct parts of the atria (`matFoci`: high RA near the SVC, low RA near the IVC, LA appendage,
  left inferior pulmonary vein). Random foci often gave P shapes too alike: 1 in 6 strips read as MAT. With the placed foci,
  10 of 12 do. The blind rhythm read must call it MAT (`gateRead`), and the P waves must be visible (≤ 20% hidden).
  No P-wave findings, ectopy or pericarditis with it; QTc not shown. Vocabulary term restored.
  (The simulator's own MAT, opened from the Model link, still picks its foci at random.)

## training-1 round 16: artifacts (a difficulty layer above 1650)

- `artifactLeads(art, seed, n)`: potentials on single electrodes (RA, LA, LL, V1–V6), with the 12 leads formed from them
  as the machine forms them (Einthoven, Goldberger, Wilson's central terminal). RA → I, II, aVR full, aVL/aVF half, V leads a third, not III.
  A V electrode → only its lead. Added to the finished strip after every check: the checks read the clean ECG. The simulator
  never sees artifacts. Not an answer: no vocabulary term, no score.
  - Muscle tremor: 2–4 bursts of 0.6–2 s of a coarse 4–9 Hz shake (size and pace wandering) plus ~15 Hz low-passed muscle noise.
    Slower than mains, as the author asked: the first version, fine EMG noise, looked too much like interference.
  - Baseline wander: breathing (0.15–0.3 Hz) and slower drift on one electrode.
  - Electrical interference: 50 Hz on every electrode, of unequal size, so every lead shows some.
- Maximum strength (`ART_MAX`, level 1), set by the author from galleries of one ECG at rising strength:
  tremor 0.12 mV RMS, wander 1.2 mV peak, mains 0.18 mV peak.
- Who gets them: target ≥ 1482 (rating 1650 − 168). Chance 35% rising to 60% over 800 points. Level 0.25 → 1 over the same span (±0.15).
  One kind, a quarter of the time two (from level 0.5). Electrodes: limb 2 : chest 0.5 each. Not on VF.

  | Player rating | ECGs with artifacts | Mean level |
  |---|---|---|
  | 1650 | 18% (target jitter) | 0.29 |
  | 1950 | 43% | 0.53 |
  | 2300 | 54% | 0.86 |
- Ratings: the stretch drops to `ITEM_SCALE` 1.1 (hardest clean ECG ~2450). Artifacts add `ART_BONUS` 200 × level
  (× 1.25 with two kinds), and the generator takes that share off the target before choosing the number of findings.
  The hardest ECG is 2682 (four findings, tremor + mains at level 1). Simulated settling is unchanged:
  95% → 2600, 90% → 2320, 85% → 2080, 80% → 1860, 70% → 1675. Professor (2100) needs ~86%.

## training-1 round 17: testers' round 3

- Home bar over the keyboard (installed iOS web app, sometimes): `#app` was sized by `100dvh`, which an installed iOS web
  app sometimes reports taller than the screen on a cold start. Now it is pinned to the screen's edges (`position: fixed; inset: 0`).
  The bottom areas keep clear of the home bar themselves, so `#app` adds no bottom padding: when the app did fit, that padding
  had doubled the gap. The bottom area is re-measured on `pageshow` and `visualViewport` resize.
- Complete AV block: the atrial rate was always 72 against the 48/min junctional escape, exactly 3:2, so P waves fell in the
  same two places instead of marching through. The atrial rate is now 60–100, skipping rates within 4% of 1, 1.5, 2 or 2.5×
  the escape (70–74 and 93–99 are skipped).
- Two identical ECGs in a row: the queued ECGs are requested at the same time from the same history (two workers), so both
  could draw the same combination. Now the ECG on screen and the queued ones count as just seen in `adjustments()`, and an
  arriving ECG with the same rhythm family and abnormalities as the one on screen, one in the queue or one of the last two
  answered is dropped and made again (up to 3 times running).
- V6 vs V5 (not fixed; open): V6's chest-lead vector is 0.64 long against V5 1.14 and V4 1.67 (`leadDistExp` 1.5 over 80 → 118 mm),
  and V6 lies ~60° from the T vector. Normal T is V4 6.9, V5 3.8, V6 1.2 mm. After an LAD infarct (48 h) T is V4 −11.9,
  V5 −6.6, V6 −0.7 mm. The heart-vector share (`precordialDipoleW` 0.7–0.8) and `leadDistExp` 0.6–1.0 barely change V6.
  The bundled solved torso has limb fields only, so `chestTorso` falls back. A real fix needs the chest electrodes solved
  on the torso (`tools/torso_v2.py`), then the chest-lead ischaemia patterns revalidated.

## Round 47: post-infarct T inversion trimmed (BANDAGE, not a fix); the V6 problem

**This is a bandage.** Testers saw V6 unlike V5, and giant T inversion after anterior infarcts (V4 −12 to −16 mm at 2–30 days).

**Diagnosis.** Each chest lead is a heart-vector projection plus the electrode's near field. Over a scar it also includes the
cavity window. V3–V5 lie 19–39 mm from the ventricle and V6 77 mm, so V3–V5 follow the tissue under them and V6 follows the
heart vector. V6's dipole vector is short (0.64 against V5 1.14, V4 1.67) and sits ~60° from the T vector. Normal T is
V4/V5/V6 6.9/3.8/1.2 mm. Neither `precordialDipoleW` (0.55 → 0.8) nor `leadDistExp` (1.5 → 0.6) changes V6.

**Solved-torso test.** The chest field re-solved for heartRotation 17 (`export_heart_torso.js` + `ANISO=1 torso_v2.py`, 3 mm,
52 s; Burger triangle I −16°, II 72°, III 104°) and used as the local field (`chestTorso`). The anterior T at 2 days becomes
realistic (V4 −12 → −3 mm), and the normal ECG is unchanged. But V6 is still unlike V5, and the lateral (pLCx) infarct loses its
V5/V6 Q waves. Adopting it means re-tuning the infarct Q/T patterns and revalidating every chest-lead finding: a dedicated round.
The field is not bundled (it would add ~2.8 MB to each page).

**Bandage.**
- `cavityWindowT` 0.25: the cavity window keeps full strength during the QRS (the anterior Q waves) but 0.25 of it from 15 ms
  after the last ventricular activation (40 ms ramp) until the next QRS. Most of the deep anterior T came from the cavity's
  inverted T seen through the scar: without the window, pLAD at 48 h has V4 T −5.5 instead of −11.9.
- `occlusionLate` LAD 0.5: the late APD prolongation (in the infarct and its halo) of LAD occlusions at half strength.

| T at 48 h (mm, V4 / V5) | Before | After |
|---|---|---|
| pLAD | −11.9 / −6.6 | −3.5 / −1.1 |
| mLAD | −15.9 / −7.8 | −6.0 / −2.2 |

pLCx goes from V5/V6 −6.1/−10.9 to −3.7/−6.2. The acute patterns (1 h) and RCA are unchanged. Reader 47/57 as before;
old LAD infarcts no longer read a false "long QT". fullcheck is identical (iErr 4). Training recent/old infarcts pass at every site.

**Still open (the real fix):** V6 vs V5, and the upright giant T in V4–V5 of an inferior (mRCA) infarct at 2–30 days
(V4 +16 mm), both from the chest forward model.

## app-1 round 1: the app shell and module tabs (app phase 1)

The Android app (docs/APP_PLAN.md) starts as one shell page that holds each module in its own frame, so the simulator and
Training keep their phone layouts exactly and the website pages stay as they are.

- **`src/shell.html`** (built by `tools/build.py`): the module tabs and one frame per module. `app/index.html` is a preview that
  frames the website pages (`../index.html?app`, `../training/index.html?app`); `python3 tools/build.py --app` also writes
  `app/www/` (the shell, `simulator.html`, `training.html`) for Capacitor (not in git).
- **Tabs** (dark, Training's colours) sit over the left of the module's own header; the module keeps its buttons on the right.
  The active tab shows its icon and name and comes first; the others follow in a fixed order, icon only on phones and named
  at ≥ 600 px. On a switch each tab slides from where it was (280 ms; none with reduced motion). The app reopens on the
  last module (`localStorage` `ecgApp.module`); a module's frame loads the first time it is opened.
- **`src/inapp.js`** (inlined into both pages): with `?app` inside a frame it sets `html.inapp`, takes the tabs' width
  (`--tabs-w`, the header's left padding) and tells the shell whether the header is showing (whatever covers the top-left
  corner: full-screen views, help, Training's sub-pages hide the tabs; Training home's header is marked `.app-bar`).
- **Simulator in the app:** dark header without the brand, no Training or Install items, no manifest or service worker; while
  hidden it neither simulates nor draws (`ui.offstage`). Shared links point at ecgstudio.app.
- **Training in the app:** no back-to-simulator link or menu item, no page title on home; in the header the mode title
  shortens (ellipsis) and the rating shows without its label. **Model** switches to the Simulator tab on that scenario and
  the Training tab still holds the ECG. Full width on tablets (the tabs need the left edge) until phase 4.
- **Insets:** the frames are inset by the system bars in the shell, so the modules see none.

Checked in Playwright (390×844 and 800×1280): switching, the animation, Model, the tabs hiding over Help/Statistics,
the simulator stopped while hidden, the reopened module; the website pages unchanged (no `html.inapp`, no errors).
Not yet: Android back button, offline fonts, PNG export and sharing in the WebView (phase 7); locked tabs (phase 6).

## app-1 round 2: the author's review of the tabs and Training's header

- **Logo** at the far left of the app header, before the tabs (in the shell).
- **Dark only in the app:** `src/inapp.js` sets `data-theme="dark"` (the simulator's dark theme, whatever the phone's
  setting). The website still follows the phone.
- **Training** (website and app):
  - The header keeps only ‹ (back to Training home) and ⋯: no mode title ("Training", "Daily ECG", ...) and no rating.
  - The rating shows in the result, under the score percentage ("Rating 1518").
  - Home: "Prototype · all unlocked" gone; ⋯ on the home header too (menu without the items about an ECG there);
    "How it works" moved into ⋯ as **Help**; **Statistics** a full-width card under Reviews with a subheading.

## app-1 round 3: Training without a back button; the Android project (app phase 7, first part)

- **Training:** no ‹ button. In the app, tapping the Training tab while it shows returns to Training home; the ⋯ menu has
  Training home (website and app). The result row is as before (score, bar, then "1500+13": the rating before this ECG,
  the change coloured, then the time). The website's Training stays unlocked for testers until the app is published.
- **Android project** (`app/`, Capacitor 8): `com.ecgstudio.app`, "ECG Studio", version 0.1.0; `app/android/` generated by
  `npx cap add android`; icons and splash from `icons/logo` (app/assets, `@capacitor/assets`); dark system bars
  (SystemBars `insetsHandling: css`; the shell reads `--safe-area-inset-*`, falling back to `env()`).
- **Offline fonts:** `build.py --app` copies IBM Plex (from `@fontsource`, `npm install` in app/) to `app/www/fonts` and
  points the pages there instead of Google Fonts.
- **Back button:** the shell asks the showing module; the simulator closes its open layer (menu, sheet, full-screen view,
  help), Training closes its menu, page, full-screen ECG or region picker, else returns home; with nothing to close the app
  goes to the background (`App.minimizeApp`, state kept).
- **Build:** `.github/workflows/android.yml` builds a debug APK on pushes to app-1 (this container cannot download the
  Android SDK). Locally: `cd app && npm install && npm run sync`, then open `app/android` in Android Studio.
- **Sharing in the app:** the WebView has no Web Share, so `src/inapp.js` gives the pages a `navigator.share` that goes
  through the shell (`@capacitor/filesystem` writes image files to the cache, `@capacitor/share` opens the system sheet).
  Covers Save ECG image, Share this scenario, Training's report and daily result.
- **Release:** `app/android/app/build.gradle` signs with the upload key from the environment and takes `VERSION_CODE`;
  the workflow builds the signed AAB when run by hand with "release" (steps for the key: docs/APP_PLAN.md).

## app-1 round 4: Training help as a dialog

Training's help is now a dialog like the simulator's (dimmed page behind, Close at the top right, tap outside to close),
with pages **Train** (the introduction, The ECG, Answering), **Progress** (Scoring, Ratings) and **About** (Other, About
these ECGs). The author's text is unchanged, only regrouped. Opened from ⋯ → Help; Android back and the Training tab close it.
## Lead picker laid out like a 12-lead

The phone's live-lead picker (expanded heart view, tap the lead name) fills its 4×3 grid down the columns, so it reads like
a 12-lead ECG: I/II/III, aVR/aVL/aVF, V1–V3, V4–V6 (it went along the rows: I, II, III, aVR on the top row).
## Privacy policy page

`privacy/index.html` (https://ecgstudio.app/privacy/): the privacy policy for the website and the Android app, needed by
Google Play. No personal data is collected; progress stays on the device; sharing only when the user chooses; purchases
through Google Play; GitHub Pages and Google Fonts see visitors' technical data. Contact: tlioudevelop@gmail.com.

## Join the alpha (website)

The Android app is in closed testing, so the website now recruits testers instead of offering itself as an installable app:
- **Join the alpha** opens the testers' Google Group (https://groups.google.com/g/ecgstudio) in a new tab: in the phone's
  ⋯ menu (last item, in place of Install app) and in the desktop header (in place of Install app).
- The **Training** item is gone from the phone's ⋯ menu; ecgstudio.app/training stays online, unlinked.
- No web-app manifest or install prompts any more; the service worker stays, so the website still works offline once visited.

## Round 48: generator fixes (WAP/MAT, sinus pause, sinus tachycardia combinations)

From the audit of discarded training ECGs (docs/GEN_EXCLUSIONS.md on app-1).

- **WAP/MAT.** The rhythm is now "WAP/MAT" in the simulator (it starts at the current rate; the slider sets it; the
  interpretation says wandering atrial pacemaker below 100/min). Training draws 70–130/min: the key is `wap` below 100,
  `mat` above, both accepted at 95–105 (new vocabulary term "Wandering atrial pacemaker"). The gate is the engine's
  own record, not the blind rhythm read (which took some MAT strips for AF or irregular sinus tachycardia): at least three
  different atrial foci fired in the strip (the MAT driver now logs each firing in `fireLog`), P waves visible.
- **Sinus pause.** Not a timing bug: the junctional escape (48/min, 1.25 s) fired inside the 2.6 s pause, so in slower
  hearts the RR check failed, and the ECGs that passed had an unannounced escape beat. Now both kinds are generated
  (`rec.pauseEscape`): with the escape (a narrow beat without a P inside the pause; "Junctional escape beat" is a new,
  optional finding) or a pure pause (`setBlock('SAN', 'pause', { escape: false })` keeps the junctional pacemaker silent
  too). Checked on the sinus P–P interval; a retrograde P inside an escape QRS no longer counts as a hidden P.
- **Sinus tachycardia** may now carry first-degree AV block, WPW, LBBB or RBBB; SVT (and sinus rhythm) is accepted as the
  rhythm, P waves may be half hidden, and the PR for those findings comes from the engine (the reader's PR is unreliable
  with the P on the T). The blind read's RAE and long PR at sinus tachycardia, WPW's pseudo-infarct Q waves (optional) and
  LBBB's discordant ST elevation are no longer counted as extra findings.
- Audit (seeds 11–13, 60 each): 127/180 → 140/180 kept. WAP/MAT 6/8 (P hidden with infarcts the rest); sinus pause and
  the new sinus tachycardia combinations pass. Reader 47/57 as before.

## Round 49: chest-lead ST-T from the solved torso (V4–V6); Round 47's LAD bandage removed

The V6 problem (V6 unrelated to V5) and the post-infarct T depth, with a solved-torso chest field.

- **Solve.** `node tools/export_heart_torso.js heart.json` + `ANISO=1 python3 tools/torso_v2.py heart.json tv17.json 3` (needs
  `pip install scipy pyamg`; 61 s). Its LA/LL fields are identical to the bundled `src/torso_limb.json`; the V3–V6 fields are
  now bundled with them (plus `chestScale`, the V2-normalised chest scale of that solve, since V2 is not shipped).
  `torso_limb.json` 0.93 → 2.8 MB.
- **Every lead from the torso (`fullTorso`) was tried and not adopted:** V5–V6 alike (correlation 0.99) and a natural T
  progression, but a poor R progression (small R in V4, then a tall R in V5), small QRS, and the anterior and lateral infarct
  Q waves lost (the cavity-window electrode is skipped on that path). `chestTorso` (torso near field for the whole beat):
  iErr 4 → 11 for the same reason.
- **Adopted: `chestTorsoT`.** The QRS of every chest lead stays as it was (blend + cavity window: R progression and Q waves
  unchanged); the ST-T of **V4–V6** comes from the solved torso (electrode − Wilson terminal, without the cavity window),
  ramped in from 40 ms after the last ventricular activation over 80 ms. Separate torso electrodes (`torsoTE`), so the QRS
  path is untouched. V1–V3 keep the blend: with the torso T, Brugada's coved ST read as STEMI (V1–V2), and V3 turned
  upright after an LAD infarct (the solved field's V3 sits on that boundary).
- **Bandage removed:** `occlusionLate` LAD 0.5 → 1. (`cavityWindowT` 0.25 stays for the blend part, so V1–V3 only.)
- Results (normal; T V4/V5/V6, mm): 6.9/3.8/1.2 → 4.9/3.6/2.0; V5–V6 correlation 0.79 → 0.90. Mid LAD 48 h: T V4 −6.0 → −5.9
  with the bandage gone, V5 −2.2 → −2.1, now inverted V2–V5 in the ischaemia audit. Proximal LCx 48 h V6 T −6.2 → −3.0.
  Acute STE smaller in V4 (mid LAD 7.6 → 6.0 mm).
- Validation: reader 47/57 (pLCx 1 h partial → pass, acute marginal 1 h pass → partial), fullcheck iErr 4 (unchanged),
  Brugada passes. Training audit (seeds 11–13): 140 → 134/180, almost all hyperacute T now under 10 mm in V4 (Round 50
  reworks the hyperacute T).
- Still open: the tall upright T in V3–V5 after an inferior (RCA) infarct at 2–30 days (V4 11.6 mm) is unchanged by the
  torso field: it is in the repolarisation model, not the forward model.

## Round 50: ischaemia engine (the author's exclusion list)

- **Hyperacute T, single and broad (was biphasic).** The K-ATP effect of the first minutes is now a smaller APD shortening
  (`ischApdShort` 0.45 → 0.35) plus a sloping plateau in the ischaemic zone (`ischPlateauDrop` 0.25: the T rises from the
  ST), and the RCA's injury scale (0.33, Round 46, for ST height) no longer shrinks it below `ischKatpFloor` 0.7. At 15 min:
  mid RCA II/III/aVF 8.0/9.9/8.7 mm, single-peaked (III was a small down-up wave); mid LAD V3/V4 11.0/9.2. With LAFB the
  anterior T stays single (the "M"-shaped T that excluded fascicular blocks is gone). Inferior ST at 1 h: III 3.8 (proximal)
  and 5.7 mm (mid RCA), within Round 46's target.
- **V4 at half on the torso ST-T** (`chestTorsoTLead` [0, 0, 0, 0.5, 1, 1]): with V4 fully on the solved torso the hyperacute
  T in V4 was no taller than normal (the solved field sees the anterior wall's regional change weakly).
- **Narrowing (subendocardial ischaemia):** `stenosisGlobal` 0.3: the rest of the LV inner wall shares 0.3 of the culprit's
  severity (demand). Proximal LAD narrowing raised III/aVF (the mirror of its deep I/aVL depression); now diffuse ST
  depression with ST elevation in aVR (2.5–3.5 mm) and slightly V1, as taught ("ST depression does not localise"). Mid-LAD
  narrowing now reaches ≥ 1 mm and is used in Training.
- **Hypertrophy with acute ischaemia:** `ischHypComp` 1 divides the injury current by the hypertrophy source gain. LVH + mid
  LAD STEMI ST V3 9.4 → 6.5 mm (normal heart 6.3); LVH + mid RCA III 9.3 → 6.7 mm at J+20 (normal 5.0); the hyperacute floor is compensated too.
- **Inferior infarct T waves:** `occlusionLate` RCA 1 → 0.1. After an RCA infarct, III/aVF inverted by 17–23 mm and aVL/I
  rose 13–18 mm from 12 h to 30 days (live site too): the late APD prolongation over a wall that faces the limb leads squarely.
  Now III ≈ −10 (≈ −7 mm on paper), aVF −6. Still open: the dead region alone leaves aVL/I ≈ +9 mm and V3–V4 ≈ 10 mm (the
  normal T is a small residue of large opposing sources; removing a large territory unbalances it).
- **Training generator:** hyperacute T with fascicular blocks and at the proximal RCA; LVH/RVH with STEMI and narrowing
  (not with hyperacute T: LVH's tall right-precordial T mimics it); RBBB with old/recent infarcts and narrowing (not with
  hyperacute T or pericarditis); LAFB with acute STEMI anywhere and LPFB with LAD/circumflex infarcts (an old/recent inferior
  infarct with LAFB or LPFB stays out: its Q waves mask the block, as in real ECGs); Q waves and T inversion count lead III
  beside aVF or II (4th UDMI); new infarct sites LM, OM1, OM2, distal RCA, PDA (distal circumflex: old infarcts only).
  Not used: distal LAD (inferior ST elevation only), acute marginal (inferior pattern), distal circumflex STEMI (V6 only).
- Validation: reader 47/57 (unchanged per scenario except acute marginal 30 d reads differently, still pass), fullcheck iErr 4,
  hypertrophy presets unchanged. Training audit (seeds 11–13): 138/180 with the wider mix.

## Round 51: electrolytes and hypothermia

`Sim.setElectrolyte(key, level)`; Conditions panel: **Electrolytes** (Hyperkalemia mild/severe, Hypokalemia, Hypocalcemia,
Hypercalcemia) and **Temperature** (Hypothermia: the sinus rate drops to 45/min when it is turned on above 50). Each comes from
its cellular effect:

| Condition | Model | Result (normal: QRS 77, QT 313, PR 140, T II/V3 5.9/5.4 mm, 127 ms wide) |
|---|---|---|
| Hyperkalemia, mild | repolarisation width × 0.5, APD × 0.85, APD gradient × 1.3 | T II/V3 11.9/10.8 mm, 70 ms wide (peaked), QT 289 |
| Hyperkalemia, severe | + ventricular conduction / 2.6, atrial / 1.8, atrial AP amplitude 0.4 | QRS 127, PR 176, P in II 2.5 → 0.9 mm |
| Hypokalemia | repolarisation width × 1.2, 18% of it left to a slow terminal tail 230 ms later (reduced IK1/IKr), plateau sag +0.05 | flat T (V3 3.7 mm), U wave V3 1.6 mm (about 40% of the T; 32% made it as tall as the T: too tall, the author) |
| Hypocalcemia | APD × 1.45 (plateau) | QT 427, T unchanged |
| Hypercalcemia | APD × 0.75 | QT 250, short ST |
| Hypothermia | epicardial notch-and-dome (amplitude 0.5, delayed dome, as Brugada's but over the whole epicardium), APD × 1.3, conduction / 1.25 | J (Osborn) waves, QT 454 at 45/min, PR 165, QRS 83 |

- **The repolarisation kernel.** Most cells repolarise through one shared shape (the convolution kernel built from `repWVent`);
  per-cell `repW` only reached cells on the exact path. Electrolytes now rebuild the ventricular kernel (width, and the
  hypokalaemic tail). Fixed on the way: a plateau slope of 0.05 + 0.05 rounded to 0.1000000015 in Float32 and sent every cell
  down the exact path (threshold now 0.1 + 1e-6).
- **Simulator:** interpretation lines for each pattern, Learn text (features and pitfalls), links (`hyperK=mild|severe`,
  `s=hypoK,hypoCa,hyperCa,hypothermia`).
- **Training:** findings Hyperkalemia (mild and severe, one answer), Hypokalemia, Hypocalcemia (QTc ≥ 460), Hypercalcemia
  (QTc ≤ 370), Hypothermia (sinus bradycardia only); one per ECG, not with ischaemia, pericarditis, Brugada, non-specific ST-T,
  WPW, bundle branch block or hypertrophy. The blind read's LBBB/IVCD in severe hyperkalemia (optional IVCD) and STEMI in
  hypothermia (J waves) are not counted as extra findings. Audit: 8 of 10 electrolyte ECGs kept in a random mix.
- Validation: reader 47/57 and fullcheck iErr 4, unchanged.

## Round 52: Wellens and STEMI in LBBB (Sgarbossa); de Winter dropped (too rare, the author)

- **Wellens** (`Sim.setWellens('A'|'B')`; Conditions → **Ischemia patterns**). A critical proximal LAD lesion that reperfused
  before the muscle died: no necrosis, no Q waves, ST at baseline. The anterior wall (the mid-LAD territory; with the proximal
  LAD's territory the high lateral wall also inverted I/aVL and made II/aVF tall) keeps prolonged action potentials, most in
  the outer wall (`wellensEndo` 0.1 inner share): type A × (1 + 0.65·severity) gives the biphasic T (up, then down) in V2–V3;
  type B × (1 + 1.2·severity) deep symmetric T inversion V2–V5 with normal limb leads. A heart condition rather than an
  insult, so the occlusion tools (time slider, ischemia list) are untouched. Interpretation line, Learn text, link `wellens=A|B`.
- **STEMI in LBBB.** Training allows LBBB with an acute STEMI; its finding is "STEMI in LBBB (Sgarbossa)", checked by the
  Smith-modified criteria on the median beat: concordant ST elevation ≥ 1 mm, concordant ST depression ≥ 1 mm in V1–V3, or
  discordant ST elevation ≥ 1 mm and ≥ 25% of the S. LBBB alone meets none (largest discordant ratio 4%, V3); proximal and
  mid LAD meet the discordant criterion (27–65%), RCA the concordant elevation in II/III/aVF, circumflex the concordant
  V1–V3 depression. The simulator reads the same criteria when LBBB and an occlusion are both present (and no longer lists
  Q/QS waves, lost R waves or T inversion in LBBB). Learn text "STEMI in LBBB: Sgarbossa criteria".
- Training: Wellens types A and B (not with flutter, fascicular blocks, bundle branch blocks, hypertrophy, WPW, electrolytes).
- Validation: reader 47/57, fullcheck iErr 4. Audit (seeds 13–14): 91/120 kept, including LBBB + STEMI at the proximal LAD and OM1.

## Round 53: torsades de pointes; LBBB + STEMI answered separately; hypothermia under "Other"

- **Torsades de pointes** (`startArrhythmia('tdp')`; Rhythm list, Ventricular; link `a=tdp`). One ventricular focus at
  `tdpCl` 230 ms (±8%, about 260/min) whose site moves a step every beat along a loop over the LV epicardium: once around the
  ventricle (rotational UVC −π → π) while swinging between apex and base (apicobasal 0.12–0.72), `tdpSteps` 16 beats per
  turn. The activation direction turns through a full circle, so the QRS grows, shrinks and changes polarity in spindles in
  every lead. Sustained until a shock or another rhythm (AV node blocked as in VT/VF). Interpretation line (no axis or QT
  chip while the axis turns), Learn text (long QT causes, magnesium/pacing), Shock offered. Training rhythm "Torsades de
  pointes" (synonyms TdP, polymorphic VT).
- **LBBB + STEMI in Training** (the author): LBBB and ST elevation are two separate answers, as any other combination; the ST
  elevation's region is the artery's (any territory the criteria flag accepted). The Sgarbossa criteria (Round 52) stay the
  gate for whether the STEMI is visible; "Sgarbossa" is a synonym of ST elevation; the separate term is removed.
- **Hypothermia** moved from "Temperature" to the **Other** heading of the Conditions panel.
- Validation: reader 47/57, `tools/arrhythmia.js` identical.

## Round 54: touch and view fixes, report form, advanced findings in Training

Simulator (`src/app.js`, `src/template.html`):
- **Phone layout from the first paint**: a small script inside `#app` sets `body.m`/`body.ml` before the large scripts are
  parsed (the desktop layout no longer flashes first).
- **Coronary taps**: single tap/click narrows, double tap/click occludes; the same gesture again removes the marker, the
  other converts it. **One marker per region** (`regionNode`: left main, proximal/mid/distal LAD, LCx, RCA by
  `segmentName`, and each side branch); the marker sits at the region's start (distal LAD and RCA: the Training/validation
  site), so a tap anywhere in the region acts on it. On a busy page a late second tap turns the narrowing just made into
  what the double tap means (`ischPress`). On phones these taps work in the Ischemia tab (the hold gestures are removed).
- **Two-finger gestures**: pinch, pan (`enablePan`, screen-space) and twist (`initTwist`: the new `g3.world` group, heart
  and lead vectors, turns about the line of sight). Any view preset clears the twist and pan.
- **Tabs choose the view**: Ischemia → external, Blocks → four-chamber cut (desktop and phone).
- **Lead vectors** shorter (limb 72/64 mm, chest 70 mm, measured chest ×0.65) with the camera at 480 instead of 720.
- **Conduction system see-through**: a faint copy drawn over tissue, so the left bundle under the septum's cut face shows
  (the pick tubes already ignored tissue).
- Lead vectors are removed from the scene on a heart rebuild (an older set no longer stays behind).
- Resources: added Rautaharju 2009 (ST-T/QT), de Zwaan/Wellens 1982, Sgarbossa 1996, Wang 2003, Diercks 2004, Osborn 1953,
  Dessertenne 1966, Drew 2010, McCord 1998.

Training (`src/training_gen.js`, `src/training.js`):
- VT, TdP and VF carry no artifact (they never took abnormalities).
- Tremor duration varies: a quarter of strips shake throughout (slowly swelling), the rest 1–4 bursts of 0.4–3.5 s, each
  of its own strength.
- The electrolytes and Wellens are rarer (`ABN_W` 0.15–0.35; TdP w 0.3): in 20 000 sampled ECGs each now appears about as
  often as atrial enlargement or less.
- **Advanced findings** (`adv`, `ADV = 1700`): Wellens, hypothermia, and the STEMI in LBBB (Sgarbossa). Below 1700 in the
  finding's skill they appear but are not asked: shown as a dotted "advanced" chip, credited (+5%) when named.
- Problem reports: with `reportForm` set in `site.json` (a Google Form prefill link ending in `entry.<id>=`), the report
  opens that form filled in, so no address is shown; without it the share sheet/clipboard as before.
- Home: the Reviews subheading is "ECGs you missed"; the 1–35 day schedule is in Help (Other).
- Validation: engine unchanged; `tools/trainlive.js 40 3` runs, VT/TdP/VF alone in 20 000 samples.
- Follow-up (the author): the phone's first tip reads "Double tap the ECG to expand it, or double tap the empty space beside
  the model to expand the 3D view."; the ischemia stage description under "Time since onset" is hidden (`#ischStage`);
  VT, torsades and VF carry artifacts again; hypo- and hypercalcemia are advanced findings (1700); the report form is set.
- **What is on, outside its tab** (the author): on phones (site and app) a neutral count badge on the Blocks, Ischemia and
  Conditions tabs (`updateBadges`); on desktop a "Conditions" line under the view name lists the active conditions (up to
  three, then "+N"; most do not change the model) and opens the Conditions tab. Option names keep their abbreviations'
  capitals ("wide QRS, flat P (K > 7)", `lowFirst`).

## Round 55: phone taps by location again; one tap removes a marker; Help close button as Training's

- Bug (the author): Round 54 made phone taps act on the arteries only while Ischemia was the chosen tab; with the sheet
  closed that mode was invisible (taps meant for an artery made PVCs, taps meant for PVCs said "tap a coronary artery").
- Back to no mode, as before Round 54 (the author's call): what a tap does depends only on where it lands, from any tab.
  A tap on or within a fingertip of a coronary artery (`arteryAt`: a vessel hit on the visible side, or the nearest vessel
  on screen within 30 px on phones / 20 px with a mouse, among those within 30 mm of the tapped surface) acts on the
  artery: one tap narrows, a double tap occludes. Elsewhere on the muscle, taps stimulate (bursts as before). An artery
  tap no longer opens the Ischemia sheet (the time scrubber shows on the heart; opening the tab would move the view).
  Desktop works the same way (the author): a click on the sinus node (any view) or the conduction system (cut view) opens
  the block choice, on or near an artery narrows/occludes, elsewhere on the muscle stimulates, whatever tab is open; the
  Help sentence "The open tab also decides what a click on the heart does" is corrected to say so.
- A marker in the region: **one tap removes it**, narrowing or occlusion; a double tap turns a narrowing into an
  occlusion (and removes an occlusion).
- The Help dialog's Close button matches Training's (14 px, 8 px radius, raised background `--raised`); the control
  panel's ✕ is unchanged.
- Help → About (phones and app): limitations updated (marginal-branch pattern, apical infarct's inferior Q, deep
  post-infarct T in V3–V5, hyperkalemia T base, torsades).

## Round 56: the mobile website matches the app

- `app-1` merged into `milestone-1` (earlier than planned in docs/APP_PLAN.md, at the author's request), so the website's
  phone pages and /training run the same code as the app; the Android project (`app/`) comes along (no secrets in it).
- **Phones are dark only**, on the website as in the app (`data-theme="dark"` from the first paint, and in `setMode`);
  desktop still follows the system setting.
- **Training on the website**: the logo at the left of its headers, where the app shell puts it; the "Back to the ECG
  Studio simulator" card is gone (as in the app); the ⋯ menu keeps the link to the simulator. No module tabs on the
  website, so Training stays unlinked (ecgstudio.app/training).
- **ecgstudio.app/app/** is the app shell as a web page (module tabs, both modules; `noindex`, unlinked): the app's exact
  look on a phone browser, for trying changes without building an APK. A branch can be tried before it is merged at
  `https://raw.githack.com/quickcardboard/ecgstudio/<branch>/app/index.html`.

## Round 57: only what is drawn under the finger counts

- Bug (the author): in the four-chamber cut, taps on the LBB and RBB narrowed an artery on phones. Two causes: the phone
  checked arteries before the conduction system (Round 54 ordering), and the artery search accepted vessels out of
  sight (the posterior descending and distal RCA behind the cut face, within 30 px on screen).
- Fix: a tap acts on what is drawn where it lands, in either view (no view restriction). Order: the conduction system
  (cut view, drawn see-through over the tissue; the sinus node marker in both views), then a coronary artery or marker
  **in sight** (`inSight`: not cut away, and no tissue or cut face in front of it, with 3 mm slack; `arteryAt` takes the
  nearest in-sight vessel within 30 px on phones / 20 px with a mouse), then the muscle. Desktop and phones alike.
- Phones: the conduction segment is the one nearest the finger on screen (`conductionAt`), before the fat touch tubes,
  which overlap where the left bundle divides (an LBB tap could hit the anterior fascicle's tube first).
- Checked: in the four-chamber cut, taps along the LBB, RBB, fascicles and His block them (none reach an artery); in the
  outside view a tap on the LAD narrows it.

## Round 58: the interactive tutorial (app)

The author's answers to the open questions in docs/TUTORIAL_PLAN.md: Training's step walks through answering one ECG;
the app only for now (tried at ecgstudio.app/app/); keep both the artery and the conduction steps.

- **`src/tutorial.js`** (inlined into the simulator and Training by `tools/build.py`): a dim with a ringed cut-out over the
  target and a one-line card ("3 / 7", Skip; Next after 6 s on the same instruction, and Next does the step for the
  user). Steps watch for their result, not for a particular tap, so the user's own route counts.
- **Simulator (steps 1–6):** welcome; drag to turn the heart (≥ 25°); tap the ringed muscle (a spot in sight, away from the
  arteries and the sinus node) → PVC (or PAC) explained with the ECG ringed; double tap the ringed mid LAD (outside view,
  from the chest) → the strip moves to V1–V3, anterior STEMI; the four-chamber cut opens (ischemia cleared), tap the
  ringed left bundle → V4–V6, LBBB; double tap the ECG for all 12 leads and back.
- **Step 7 (app shell):** the simulator asks the shell to ring the Training tab (`tour` messages: `prep`, `ring`, `end`);
  tapping it hands over to Training, and the simulator goes back to the Reset state (sinus 72/min, no abnormalities) and
  the view it had. Training walks through one fixed ECG, prepared in the background from the start of the tour:
  sinus rhythm at 75/min with a mid-LAD STEMI (`TOUR_RECIPE`; key: Sinus rhythm + ST elevation, anterior). Typing "si",
  Sinus rhythm, "st", ST elevation, Anterior, Done, Submit, the result, then "Replay it any time: Simulator → Help →
  Tutorial". The `tutorial` mode is not rated and leaves no history, review or streak.
- **When:** the first open of the simulator in the app (and ecgstudio.app/app/) on a phone held upright, not opened on a
  scenario link; `localStorage` `ecgstudio.tour` is set when it starts. The first-open phone tip is not shown then.
  Afterwards: a **Tutorial** button beside Close in the simulator's Help (app, phone layout only). The website and
  desktop have no tutorial.
- Simulator hooks for it: `ECGStudioApp.tour` (events `ectopic`, `ischemia`, `blocks`, `layout`; target finders
  `muscleSpot`, `arterySpot`, `conductionSpot`; view, reset and the same actions as the gestures).
- Checked (Playwright, Pixel 7, `app/index.html` over http): the whole tour by touch, by Next alone, Skip mid-way (the heart
  resets), the Help replay, and the website on a phone (no tutorial; the tip still shows). Training history stays empty.
- Follow-up (the author): every card is numbered, 1–12 in the app (1–6 simulator, 7 the Training tab, 8 rhythm,
  9 finding, 10 leads, 11 submit, 12 result), instead of Training staying on "7 / 7". All the text is in `TEXT` at the top
  of `src/tutorial.js`.
- Follow-up (the author): left bundle taps often stepped the AV block instead (phones; also a mouse in the phone layout).
  The model's left bundle trunk is 3 points just below the AV node, and its tap area was a sliver under the AV node's.
  Now the AV node and His are one tap target (they already shared one AV-block cycle), with a smaller reach (×0.75 of the
  22 px fingertip), and the left bundle reaches ×1.7 (`CS_REACH` in `conductionAt`). In the four-chamber cut on a Pixel 7:
  left bundle area 57 → 182 grid cells, AV node + His 201 → 113; taps up to 12 px off the tutorial's ring never reach the
  AV node. Desktop (the block menu on the tube that is hit) is unchanged.
- Follow-up (the author): the tutorial text is the author's own (`TEXT`). Step 10 (lead groups): the card sits at the
  bottom, below the list (compact, its buttons on its header line), and the page is not dimmed, so the ECG stays clear to
  swipe and tap. Help (app): more room between the Tutorial and Close buttons and the page tabs.

## Round 59: the loading heart

- `src/loader.js` (inlined with `src/inapp.js` into the simulator and Training): the app's voxel heart (the 9-wide
  upright mark of `tools/logo/iso.js`, same colours, its wavefront one voxel thicker) drawn live on a canvas. Each cycle
  (2.1 s) the depolarisation wave flows down from the upper-left lobe and the heart returns to resting pink, then it
  spins once about its vertical axis with a small overshoot and hop. Reduced motion: the wave only. Any element with
  `data-ecg-loader="<px>"` gets it; it pauses while hidden.
- It replaces the spinner on the simulator's start-up screen (Building the heart) and on Training's ECG loading screen.
- Training's loading text: "Recording the ECG…" (was "Preparing the (next) ECG…"); the line "Simulating the heart and
  checking the reading" is removed.
- Follow-up (the author): the turn is one even 360° (ease in and out over 0.55 s, no overshoot), with a higher hop
  (2.2 voxels) and a small bounce on landing; one cycle is 2.04 s (wave 1.0 s, turn 0.55 s, landing 0.24 s, pause
  0.25 s). `ECGLoader.at` draws a fixed moment of the cycle (for recording frames).
- Follow-up (the author): the turn starts at 0.52 s, while the heart is still repolarising (frame 15 at 25 fps), and the
  next beat starts as soon as the landing bounce ends: one cycle is 1.31 s, with no pause.

## Round 60: the left atrial appendage cap in tissue colour

- The author asked about a fifth "pulmonary vein": it is the left atrial appendage, which the source mesh (Rodero et al.)
  trims and caps; `tools/build_anatomy.py` puts that cap with the vessel caps (label 11, lilac). In the 3D view
  (`buildSurfaces`) the cap's faces, those near the `LAA` landmark (within 4 mm of its plane and 1.6 × its radius), are
  now drawn as left atrial tissue: live activation colours, and a tap there stimulates the atrium. The four pulmonary
  veins, the SVC and the IVC stay lilac. Anatomy, model and ECG unchanged.
- Follow-up: a drawn appendage pouch was tried and dropped (it looked wrong). Instead, the ridge the trimmed appendage
  left is smoothed (`smoothLAA`, 3D view only): the left atrial wall and the cap within 1.9 cap radii of the opening relax
  into a smooth patch (full strength within 1.15 radii, fading to none at the edge, which is held); points shared with
  any other structure stay, and copies of a point in different meshes move together, so the cut view's caps stay
  closed. Tissue grid, model and ECG unchanged.
- Follow-up (the author): a lilac piece was left beside the smoothed opening: each opening is a disc and a short stub wall
  (separate pieces of the surface), and part of the appendage's stub lay outside the band taken as its cap. Now every
  piece whose centre is nearest the LAA landmark (of the openings' landmarks) is drawn as atrial tissue; only the
  in-plane faces are smoothed, and the rest of the stub (much of it inside the heart; smoothing pulled it out through
  the surface) stays where it is.

## Round 61: tester reports (Training)

From the problem-report form (7 reports, 2026-11-10; one "all good"):
- **PR shown at fast rates** (WPW at 122/min shown as PR 400; first-degree block at 125/min shown as PR 182, which
  contradicted the key): with sinus tachycardia and a block or pre-excitation the P sits on the previous T, so the gate
  already took the PR from the engine (76 and 242 ms), but the measurement chip and the PR caliper showed the reader's.
  Now both show the engine's PR whenever the gate uses it.
- **Findings present but not in the key** cost points: lateral ST depression (1.3–3.2 mm, LVH strain) with LVH and a
  recent inferior infarct; Q waves of 41–42 ms in III and aVF (qR of the right axis) with RVH. Now ST depression, Q waves
  and T inversion that meet the generator's own criteria on the median beat (`stdLeads`, `qLeads`, `twiLeads`) are
  accepted as also true, with a line naming the leads (the right-axis qR is called that, "not an infarct"). Not in
  LBBB or ventricular rhythms.
- **Infarct wall in words:** the Q-wave lines name the wall from the territories the Q waves reach (`wallName`): a second
  obtuse marginal infarct with Q waves in II, III, aVF, V5, V6 is an "old inferolateral infarct" (was "old lateral").
- Kept: atrial flutter with RVH, "inferior Q present": II, III and aVF have no Q (0 ms); the negative flutter wave
  before each QRS most likely looked like one. Old OM2 infarct, "no lateral Q in I": right (none in I); V5–V6 carry it.
  The tall T in V2–V4 there (up to 8 mm) is the known post-infarct T limitation.

## Round 62: premium, first step (behind a switch)

The author's model (docs/PREMIUM_PLAN.md): the simulator and a rated daily ECG free; Training $9.99 one-time; future
modules as add-ons. This round: the locked states, the unlock page and the rated daily ECG, behind a switch that is off
by default (`?premium=1` turns it on for a device), and a stand-in purchase that unlocks the device. Billing next.
- Follow-up (the author): the premium wording is the author's (unlock page: "Maximize your ECG training", …). Statistics is
  locked for free users (they see the rating and title on Training's home), the skill buttons show no ratings while
  locked, and the unlock page shows the logo. The Statistics card reads "Your ratings, statistics, and review recent
  ECGs". The last 5 ECGs in Statistics open their result page again (`openPast`: rebuilt from the recipe, with the
  answer given then and the rating change then; Done returns to Statistics). The history now keeps each ECG's recipe
  and answer; older entries are not linked.

## Round 63: Google Play billing

`@capgo/native-purchases` in the app; the shell owns purchases and tells the modules what the account owns (local
prices included); Training buys and restores through it; debug builds own everything (a debug-only marker file);
`site.json` `"premium"` turns the lock on for everyone. Tested with a stand-in for Google Play in the shell (buy,
cancel, owned elsewhere, debug build). Details and the Play Console steps: docs/PREMIUM_PLAN.md.
- Premium on for everyone (`site.json` `"premium": true`, the author's request), before the next release build. Fixed
  first: without Google Play (the website's /app copy) Training fell back to the preview's stand-in purchase, so one tap
  unlocked it there; now only `?premium=1` previews have the stand-in, and elsewhere the unlock button opens the store page.

## Round 64: tablets

- **Which layout:** phones and 7" tablets (narrower than 744 px when upright) keep the phone layouts. Tablets held upright
  (744 px and wider, the iPad mini up) get the tablet layouts below; tablets held sideways get the desktop simulator and
  the sideways Training layout.
- **Simulator, upright** (`MQ_TAB`, `body.t`, touch screens): the phone layout, with the full 12-lead sheet and a lead II
  rhythm strip in the ECG pane (the desktop canvas `#cecg`) instead of one lead group; no group swiping or 5 s button; the
  heart pane 50%. Double tap still opens the full screen view.
- **Training** (`tabletMode`, `body.tabp` upright / `body.tabl` sideways 900 × 560 and up): one 3 × 4 sheet with a lead II
  rhythm strip (no pages, no swiping; the author asked for no 6 × 2 format), lead groups tapped on the sheet. Upright:
  the ECG above, the answer and a keyboard at most 720 px wide below; the bottom area keeps the typing view's height so
  the ECG does not change size. Sideways: the ECG on the left, a panel (360–420 px) on the right with the answer and
  suggestions at the top and the keyboard at the bottom; the lead groups and the result use the whole panel. Chips and
  suggestions wrap on tablets. Home and the other pages: a 720 px column.
- **Tutorial on tablets** (upright): the three sentences about swiping or expanding the ECG have tablet versions
  (`fullEcgTablet`, `typeSinusTablet`, `anteriorTablet`). Its ring finder now retries at once while no spot is found
  (after a drag the heart can still be coasting).
- Checked (Playwright, touch): 600×960 (phone layout), 768×1024, 800×1280, 820×1180, 1024×768, 1180×820, 1280×800; the
  whole tutorial on a Pixel 7 and on 820×1180.
- Follow-up (the author: "not polished"): sideways, the answer panel is built from the bottom up with no gap: the keyboard
  (larger keys), the field and Submit above it, the suggestions as a list right above the field (the best six), and a
  "Your answer" card filling the top (with the four answering steps while it is empty; it shrinks to fit while the lead
  groups are chosen). Training home sideways is a two-column dashboard: the stats across the top; the daily ECG and a
  large Train card on the left; Reviews, Statistics and the skills on the right. The phase is on the body (`ph-answer`,
  `ph-region`, `ph-result`) for these layouts.
- Left-handed option (the author): ⋯ → "Keyboard on the left" / "Keyboard on the right" (shown only on a tablet held
  sideways) swaps the answer panel and the ECG (`body.lefty`), remembered on the device (`ecgTraining.hand`).

## Round 65: tablet polish, privacy page, small things

- **Tablets held sideways** (the desktop layout on a touch screen): finger taps on the heart follow the phone's rules (the
  conduction segment nearest the finger, blocks set at once, bursts); mouse clicks are unchanged. A double tap on the
  ECG gives it the whole width (`ecgmax`, the heart hidden; double tap or back to return). Controls are finger-sized
  (about 40 px) on touch screens. Upright tablets: the control sheet is centred, at most 680 px wide. Full screen on
  tablets stays the sideways ECG (the author: an upright one only adds empty space).
- **Tutorial on tablets held sideways:** it starts there too (touch, 900 px and wider), and Help → Tutorial is offered.
  Its card sits in the half away from what it points at; step 6 uses the whole-width ECG. Checked end to end at
  1180×820.
- **Privacy page** (11 November 2026): problem reports by Google Form; purchases through Google Play, restore, and what
  is remembered on the device; the app's only network use is Google Play's purchase service.
- **Small things:** the desktop Help's Conditions line and the website description name the newest findings (electrolyte
  disturbances, hypothermia, Wellens' pattern); the store listing draft (`docs/PLAY_LISTING.md`) covers the newest
  findings, the tutorial, the daily ECG and the Training purchase, tablets, and the forms for in-app purchases; tablet
  listing screenshots were made (2560×1600, 1600×2560). The simulator's view bar fades at its right edge when there is
  more to scroll.

## Round 66: tester reports (Training) and the author's list

Training reports (10, 11–12 November), each rebuilt from its recipe and measured:
- **Q waves that nobody sees** (second obtuse marginal and distal circumflex infarcts, "no significant Q in V5", "Q only
  in V6"): V5's q was 31–32 ms and 1.2–1.3 mm, the inferior ones 29 ms. A Q-wave lead now needs a QS, a Q of 40 ms or more,
  or one of 30 ms or more that is at least 2 mm deep (V2–V3 unchanged: 20 ms or QS). Those items are now rejected.
- **T inversion asked in the wrong territory** (recent left main infarct: T inversion in I, aVL, V5, V6 and only V4 of the
  anterior pair, asked as anterior): the territory asked is now one where the inversion shows in at least two of the
  territory's own leads (`terrStrong`), the site's own first, else the one with the most.
- **"This is not Mobitz I"** (Mobitz I with a proximal RCA STEMI read blind as sinus bradycardia with first-degree block):
  Mobitz I now needs the blind rhythm read (`gateRead`).
- Kept: "anterior/lateral ST depression too" with subendocardial ischemia from the proximal RCA (V4–V5 −0.5 mm, below the
  1 mm threshold); "inferior ST depression is true" with the left main infarct (J-point depression with an upsloping ST,
  ST at J+80 above baseline). "V5 to V6 transition looks odd" (recent mid LAD): the chest-lead model limitation.
- **Repeats** ("why so many duplicate ECGs?"): the history keeps each infarct's artery (`site:…`), and an artery seen
  recently is drawn less often (as for rhythms and findings).

The author's list:
- **New rhythms:** ectopic atrial rhythm (62–95/min) and atrial tachycardia (112–150/min), rare (weights 0.7, 0.6): a low
  right-atrial focus 38 mm from the AV node (`lowAtrialCell`; at 30 mm the short PR read as WPW, at 45 mm the P turned
  upright), PR ~145 ms, P inverted in II, III, aVF; gated on the blind read. Vocabulary: "Ectopic atrial rhythm" (EAR, low
  atrial rhythm, …), "Atrial tachycardia" (AT, focal atrial tachycardia, …). Note: the item's simulator link uses the
  simulator's own ectopic focus (25 mm), whose PR is shorter.
- **Less WPW:** the WPW pattern's weight 1.5 → 0.6, orthodromic AVRT 1.5 → 0.8 (missed findings still come back more).
- **2:1 AV block** is no chip of its own: answered as Mobitz II ("2:1 …" synonyms), its line saying why.
- **Extreme axis deviation** ("EAD", northwest axis, …): accepted as also true when the axis is beyond −90° (to ±180°).
- **Initials:** a term of several words is found by its initials ("sp" → Sinus pause; the name's own initials before a
  synonym's).
- **Blocks and Ischemia tabs** only change the cut (cut open / outside); the heart keeps its rotation. Help: "Blocks:
  opens the cut view".
- **Result chip cut off** (Pixel 8): the result's scrolling area clipped the selected chip's outline; it has 4 px room now.
- **⋯ off screen on narrow phones** (below ~370 px, or a large system font): the open module tab shows its icon only there.
- **A past ECG from Statistics** no longer shows the answer field and keyboard while it is rebuilt (phase `wait`).
- **LPFB voltages too large** (to do, engine): R in III 3.4 mV (34 mm) by `tools/fascsearch.js`; textbook about 1–2 mV.

## Round 67: engine round, part 1 (fascicles, post-infarct T): findings, nothing adopted yet

- **Fascicle search** (app config, solved torso). LPFB R III 34 mm / II 31 mm; LAFB S III 30 mm, R aVL 22.5 mm, QS V2–V4
  (read LVH + old anterior MI). Territory parameters barely move them. Voltage falls to ~18–19 mm only with `cvPurkinje` 2.5,
  `purkCrossSlow` 1.2, `fascConnectFrac` 0.9, but the axes go to −28° / +74° (criteria fail). `septalTerrHalf` 0.6 removes
  the LAFB V2–V3 QS but reader 47 → 44/57 (pericarditis read old inferior MI, old inferior MIs read LVH, distal LCx 30 d
  read LAFB; LAFB still read old anterior MI); fullcheck iErr 4 → 3. Not adopted. Root cause: the normal axis (~+12°) needs
  a very large late force to reach the LPFB axis.
- **Post-infarct T after a mid-RCA occlusion** (T mm, normal → 720 h): I 5.1 → 9.0, aVL 2.4 → 10.6, III 1.5 → −12.2,
  aVF 3.3 → −7.7, V3 5.4 → 11.2, V4 6.1 → 10.3. Regional decomposition (230–330 ms): the change is the loss of the dead
  inferior, septal, apical and inferior-RV T forces (III: inferior +0.43 → 0.04, apex +0.23 → 0.01, RV +0.18 → −0.10,
  septum +0.18 → −0.03 mV); anterior and lateral are unchanged and are left uncancelled. Not the cause: `occlusionLate`
  (RCA 0 gives −10.5), `scarWindow`, `cavityWindow`, `ischUncouple`, `ischFrontMax`, a torso with liver and spine
  (`ORGANS=1`: III −10.6). A weaker transmural gradient (`apdVentEndoExtra` 55) shrinks normal and infarct T alike.
- **Infarct size options (off):** `occlusionBorderMm` and `occlusionDeadS` per artery family. RCA border 25 mm / dead
  threshold 0.7 halves the infarct (8687 → 4729 cells), Q III −13 → −6.3 mm, but T III only −12.2 → −9.2, aVL 10.6 → 8.9.

## Round 67, part 2: chest-lead solve (ST-T share of the solved torso); cavityWindowT bandage removed

- A full torso solve (all nine electrodes, `export_heart_torso.js` + `ANISO=1 torso_v2.py`, 57 s) reproduces the bundled
  LA/LL/V3–V6 fields exactly, so V1/V2 could be tried.
- **V1–V2 from the torso: not adopted.** Brugada gets a hump at J+80 in V2 (st40 0.31 → st80 0.40 mV) and reads STEMI
  septal+anterior (reader 46/57, 2 wrong); at 0.3–0.5 of the torso it passes only on V1, by 0.01 mV. V1–V2 do not depend
  on `cavityWindowT` (mid LAD 48 h V2 −5.2 / −5.3 mm either way), so they stay on the blend.
- **V3 from the torso alone** stays upright after an LAD infarct (mid LAD 48 h +4.5 mm between −2.7 in V2 and −5.8 in V4);
  at half weight the progression is smooth (−5.3 / −6.8 / −8.3).
- **Adopted:** `chestTorsoTLead` [0, 0, 0.5, 0.75, 1, 1] (was [0, 0, 0, 0.5, 1, 1]) and `cavityWindowT` 1 (was 0.25, the
  Round 47 bandage). V4 at 0.5 without the bandage gave −10.9 mm at 48 h; at 1, the hyperacute T fell 9.6 → 6.4 mm.
- Results, T mm (before → after): normal V3/V4 5.4/6.1 → 5.3/5.6; mid LAD 1 h V3/V4 11.8/9.6 → 10.3/8.0; mid LAD 48 h
  V3/V4 −9.1/−8.0 → −6.8/−8.3; 30 d −8.0/−7.7 → −6.4/−8.6; distal LAD 48 h V3/V4 −5.8/−6.5 → −4.0/−6.6. QRS unchanged.
- Validation: reader 47/57 (proximal LCx 1 h partial → pass; acute marginal 1 h pass → partial on a borderline poor R
  progression); fullcheck iErr 4, axErr 5.13 (identical lead groups); stcheck unchanged; evalecg only T V4 0.59 → 0.49.
  Training audit (seeds 11–13, 60 each): 137 → 134/180: non-specific ST-T twice (V3 T no longer flat in some seeds), one
  mid-LAD hyperacute T under the "tall" criterion.

## Round 67, part 3: repolarisation refit; fascicles and heart orientation (investigation)

**Repolarisation refit (adopted).** New fit tool (scratch, described here): T height per lead for normal, mid RCA 48 h and
720 h, mid LAD 48 h and proximal LCx 48 h, scored against textbook ranges (normal T I 2–4.5, II 2–5.5, aVL 0.3–2.5,
V5 2.2–5.5, V6 1.5–4 mm …; old inferior MI III −0.5 to −5, I/aVL ≤ 5–5.5 mm; anterior and lateral inversion), plus QTc
380–440. ~6 s per candidate; grids of 192 + 200 + 108 over `apdVentEndoExtra`, `apdVentApexExtra`, `electrotonicK`,
`apdRVoffset` and `occlusionLate.RCA`.
- Adopted: `apdVentEndoExtra` 85 → **40**, `apdVentApexExtra` 20 → **−15** (base longer than apex, as measured),
  `electrotonicK` 1.4 → **1.0**. Score 178 → 0.2. A smaller transmural gradient shrinks each wall's T force, so the T no
  longer comes from the cancellation of large opposing forces, and an infarct no longer unmasks them.
- `occlusionLate` RCA 0.1 is still needed (0.5: score 75; 1: 637).
- Results, T mm (before → after): normal I/II/aVL/V5/V6 5.1/5.7/2.4/3.7/2.0 → 2.4/4.9/0.1/2.1/1.1; mid RCA 30 d I 9.0 → 4.7,
  aVL 10.6 → 4.9, III −12.2 → −5.0, aVF −7.7 → −2.7, V3 11.2 → 7.0; mid LAD 48 h V2–V4 −5.3/−6.8/−8.3 → about the same;
  proximal LCx 48 h V5/V6 −2.4/−3.1 → −2.6/−3.1. Normal T axis 26° → 56°, QTc 414 → 395.
- Validation: reader 47/57 (unchanged count; pLAD 30 d no longer "long QT"; old inferior MIs lose the "T inversion" read,
  their III T is −5 mm, aVF −2.7); fullcheck iErr 4, axErr 5.13 → 5.07; LVH strain T V6 −0.62 → −0.36 mV (still read LVH
  with T inversion), RVH V2 T −0.43 → −0.15 mV; VF faster (V rate 52 → 143 in the 4 s strip); Training audit (seeds 11–13)
  134 → **139/180**.
- `tools/rhythmread.js`: complete AV block also when the P waves march through at > 1.3× the QRS rate with no fixed PR
  and as many found as QRS complexes (sinus 72 against a 48/min escape is an exact 3:2: every third P hides in the T). The
  junctional-escape scenario had passed on a spurious extra P.

**Fascicles (investigation; nothing adopted).**
- Heart orientation, every combination of tilt (`heartRotation` 10–35), pitch (`heartPitch` −30…+5) and yaw (`heartYaw`
  −5…28), 54 orientations, each with its own solved torso (~1 min). Pitch and yaw move the normal axis far more than tilt
  (tilt 17→35 at pitch −10/yaw 8: 13° → 32°; pitch −22/yaw 20 at tilt 17: 66°). Tilt 17 / pitch −22 / yaw 12–20: normal
  52–66°, LAFB −46…−65° (S III 23–25, R aVL 15–18 mm at Kors-calibrated gain), LPFB 93–94°. The full reader there
  (gain scaled to the same calibration): 30–33/57, fullcheck iErr 6–8: inferior STEMI invisible at 1 h (the RCA injury
  scale was fitted for the inferior wall facing the leads squarely), poor R progression in most ECGs, old LAD infarcts read
  LPFB. Adopting an orientation needs the ischaemia scales, chest blend and R progression refitted with it.
- LPFB R III stays 37–55 mm (calibrated) at every orientation, at `sigmaRatio` 4 with `brody` 0 (which brings the RBBB
  axis from −60° to ~0° but takes LAFB's deviation away), with liver and spine in the torso (44 mm) and with arms and legs
  in the torso (lead III 3.2× lead I: worse). Slower Purkinje spread (`cvPurkinje` 0.9–1.2) worsens everything (normal
  axis −32…−66°).
- Mechanism (lead III, regional decomposition): in a normal beat the anterior wall gives −0.75 mV and the inferior wall
  +0.68 mV at 20–25 ms, cancelling; with LPFB the anterior force runs alone (q in III), then the inferior wall, septum and
  apex fire together unopposed (+1.7 mV at 40 ms and rising). QRS only 8 ms wider than normal. The voltage is the axis
  deviation itself; it falls only with the deviation.
- LAFB pseudo-infarct (QS V2–V4) at every orientation and fibre ratio tried.

## Round 67, part 4: heart-orientation round (candidate found, not adopted) and the fascicular blocks

Tools (scratch, described for reproduction): a parallel blind reader over the 40 single-beat scenarios (4 processes,
~25 s), a chest R/S scorer, and a fascicle scorer (normal/LAFB/LPFB at app gain: axes, q durations in I/aVL and
II/aVF, R aVL, S III, R III, r V2–V3, the blind read).

**Orientation candidate** (tilt 17, `heartPitch` −22, `heartYaw` 12; torso re-solved: `node tools/export_heart_torso.js
h.json '{"heartRotation":17,"heartPitch":-22,"heartYaw":12}'` + `ANISO=1 python3 tools/torso_v2.py h.json tv.json 3`,
packed as `src/torso_limb.json`, chestScale 1.8854): `ecgGain` 0.01108, `precordialGain` 0.8, `precordialDipoleW` 0.62,
`precordialDipoleGain` 2.2, `dowerChest` 0.8, `atrialFrontalRot` 45, `atrialLimbGain` 2.15, `occlusionInj` LCx 1.2 /
RCA 0.6, `chestTorsoTGain` 1.4, `occlusionBorderMm` { LAD: 18 }.
- Normal axis +48 to +54°, T axis +39° (concordant), LAFB −48°, LPFB 94°, RVH 148°, P in II 0.23 mV, LAE notched.
- Reader 46/57 (current 47), fullcheck iErr 4 (old apical infarct no longer shows inferior Q; new: PDA ST in V1–V2,
  proximal LCx without Q in aVL), chest R V1–V6 2.7/4.5/4.6/3.5/8.7/8.0 mm.
- **Training audit 113/180** (current 139): not adopted. The remaining misses are the fascicular ones below plus right-
  axis reads (LPFB/RVH) after large anterior and lateral infarcts.

**Fascicular blocks: not fixed by any parameter.** At the candidate orientation the axes and the LAFB limb voltages are
textbook (S III 16–19, R aVL 12–13 mm), but:
- the initial forces last too long: LAFB q in I/aVL 32–39 ms (read old high-lateral MI), LPFB and RBBB q in II/aVF
  30–33 ms (read old inferior MI). Even an LAFB with no axis shift (`purkCrossSlow` 1, `cvPurkinje` 2.8) keeps a 29 ms q
  in aVL: once the LAF is cut, the anterolateral wall is reached ~30–35 ms after QRS onset (real: ~15–20 ms).
- LPFB R III stays 31–35 mm (textbook ~10–20).
- Screened without effect on those: `purkCrossSlow` 1–3, `cvPurkinje` 1.8–2.8, `fascConnectFrac` 0.3–0.6,
  `purkCrossApexZ` 0/0.4, `purkLinkR` 3.2–6, fascicle terminals (`lafZ`, `lpfZ`, `lpfPhi`, `lsfZ`, `lsfPhi`),
  orientation (54 solved torsos), `sigmaRatio` 4, `brody` 0, a q measured against the PR segment.
- `septalTerrHalf` 0.3–0.6 (the left septal fascicle's own mid-septal territory) restores the early septal force in
  LAFB (r V2 0.7 → 2–3.7 mm: the anterior QS goes), but not the long q in I/aVL.
- Next step is structural: the Purkinje network's reach into a blocked division (anastomoses at the paraseptal
  break-through sites, so the blocked territory starts at ~15–20 ms and the deviation comes from the terminal forces).

## Round 68 (started): Purkinje anastomoses for the fascicular blocks

New options (defaults keep the old behaviour): `purkCrossFastPhi` ([[phi, halfWidth], …]: bands of rotational UVC where
links between fascicle territories are not slowed by `purkCrossSlow`) and `lsfTie` (the division whose block takes the
septal fascicle; 'LPF' as before, null: neither). First screen at the 48° candidate (`src/variants/48normalaxis.json`,
fascicle scorer at app gain):
- `septalTerrHalf` 0.3 + `lsfTie` null + fast bands at both territory boundaries ([[0.56, 0.3], [−1.54, 0.3]]):
  LPFB R III 35 → 18 mm, inferior q 31 → 28 ms, no old-MI read, but axis 94 → 78°; LAFB −49°, r V2 0.7 → 3.1 mm
  (no anterior QS), q I/aVL 33/39 → 30/33 ms (still read old high-lateral MI); normal axis 54 → 32°.
- Moving the LAF/LPF boundary (`lpfTerrHi` 0.56–1.2, `lpfTerrLo` −1.54…−2.3) changes little: the early r in aVL comes
  from the LAF's own breakthrough on the anterolateral wall, which LAFB removes, not from the paraseptal edge.
- **Fixed in the 48° variant** (`src/variants/48normalaxis.json`): `septalTerrHalf` 0.3, `purkCrossFastPhi`
  [[0.56, 0.3], [−1.8, 0.15]], `purkCrossSlow` 4.5, `cvPurkinje` 2.1, `lsfZ` 0.35, `lsfPhi` −0.2, `lpfApexZ` 0.35,
  `fascConnectFrac` 0.35, `lpfZ` 0.25, `rvCvMul` 0.8 (the septal fascicle stays tied to the LPF). Fascicle scorer at app
  gain: LAFB −49°, q I/aVL 28/32 ms, r V2 3 mm, read "LAFB, poor R progression" (no old MI, no LVH); LPFB 92°, q II 27 ms,
  read LPFB (R III still ~34 mm: untied or slowed septal fibres give 18–26 mm but an axis of 79–88°); RBBB QRS 122 ms, read
  RBBB; complete His block: ventricular escape 120 ms. Reader 44/57 (11 partial; live 47/57), fullcheck iErr 6 (LAFB −43°
  at fullcheck's calibrated gain), Training audit 113 → **126/180** (live 139). Remaining: inferior q read as old MI in
  pericarditis and RVH, "LVH" after old inferior MIs (aVL R ≥ 11 mm with the axis swung left), right-axis reads after large
  lateral infarcts.
- `pmjRetroRV` 55 widened RBBB but split the late RV activation off the QRS (a quiet gap): the readers measured 68–78 ms.
- **Reader fix** (`tools/reader.js`, `tools/rhythmread.js`, also used by Training's generator): the QRS goes on past a
  pause of up to 25 ms when activity at QRS speed (≥ 20% of peak spatial velocity) resumes; a slow late activation had
  been cut off (the His-block escape, 125 ms in the simulation, read 67 ms). Live model unchanged: reader 47/57, fullcheck
  iErr 4, Training audit 139/180.
- New options: `lsfTieDelay` (>0: the parent division's block slows the septal fascicle instead of cutting it),
  `ventEscapeFrac` (position of the ventricular escape along the LPF; null: the muscle under the idioventricular Purkinje
  node). The RVH preset's RV speed is now relative to the default (`rvCvMul` × 0.8).
- **LAFB precordial pattern** (the author: a small r in V1–V4, no septal q there; q in V5–V6 is lateral and fine).
  Variant now `septalTerrHalf` 0.45, `lsfPhi` 0.3, `purkCrossFastPhi` [[0.7, 0.3], [−1.8, 0.15]]: LAFB −47°, r V1–V4
  2.6/3.6/3.1/1.8 mm, q in aVL −1 mm, read "LAFB" alone (no MI, no LVH, no poor R progression); LPFB 93°; RBBB 123 ms;
  normal axis 34° (was 40–48°). Left: a small q in V4 (17 ms, −0.7 mm) in every setting tried. Brody 0 removes the V5–V6 q
  but also the r in V1–V3 (QS); the fascicles' apical extension (`fascApexZ`) adds no anterior initial force.
- **Reader:** Q measured against the level at QRS onset (the PR segment, as in the Minnesota code), not the TP baseline:
  RVH in the variant no longer reads old inferior MI. Live: Training audit 140/180 (139), single-beat reads unchanged.
- **Not fixed by** infarct size (`occlusionBorderMm` / `occlusionDeadS` for RCA and LCx: no change in the 30-day reads) or
  the fibre ratio (`sigmaRatio` < 10 removes the LAFB deviation; aVL R after a mid-RCA infarct stays 15–16 mm). The LPFB
  R III stays 32–34 mm with a correct read; pericarditis's inferior q is a reader onset effect (the smaller QRS moves the
  detected onset ~6 ms earlier; the normal inferior q is ~29 ms from the true onset).
- **"LVH" after old inferior MIs** (aVL R 13–16 mm at 30 days): infarct size is the lever, but no setting fixes it
  without losing inferior Q elsewhere. `occlusionBorderMm`/`occlusionDeadS` for the RCA also shrink the acute injury
  (proximal RCA loses its inferior STEMI at 1 h). New option `occlusionMarginMm` (per family; off): a rim of the
  territory, in mm from its edge, survives (scar only; the 1-hour injury is unchanged). RCA 5 mm: mid RCA aVL R 16 → 9.3 mm,
  Q III 46 ms / −9 mm, no LVH read; but proximal RCA's q in II falls to 28 ms and the thin PDA territory loses its Q at any
  rim (3 mm: q II 26 ms). RCA 4 mm on the 26 infarct scenarios: 20.5 → 20.5 (proximal RCA fixed, PDA lost).
- Small q waves below the infarct criteria are acceptable (the author): LAFB's V4 q (17 ms, −0.7 mm) stays.
- **Reader changes** (the author): LVH by **Sokolow-Lyon only** (S V1 + R V5/V6 ≥ 3.5 mV; Cornell and R aVL ≥ 1.1 mV
  dropped) in `tools/reader.js`, Training's criteria (`src/training_gen.js`) and the simulator's interpretation and LVH card
  (`src/app.js`); **LPFB and RVH are not called with an old lateral MI** (Q in I+aVL or V5+V6; lateral MI is a textbook cause
  of right axis deviation and its posterolateral tall R in V1 is not RVH); the QRS-pause bridge needs ≥ 20% of peak spatial
  velocity (12% swallowed AVNRT's retrograde P: QRS 122 ms, read VT). Live model: reader 50/57 (score 53), fullcheck iErr 4,
  Training audit 139/180.
- **LPFB R wave** (the author: the most noticeable). Orientation alone does not change it (R III 30–34 mm at every solved
  orientation, normal axis 22–75°): the LPFB axis and R III move together. Slowing the septal fascicle with the LPF block
  (`lsfTieDelay`) trades them: untied 82–87° / 19–24 mm, ×1.5 89–91° / 25–29 mm, ×2 ~92° / ~30 mm. Variant now tilt 24 /
  pitch −15 / yaw 20 (its own solved torso), `lsfTieDelay` 1.8, `ecgGain` 0.01176, `atrialLimbGain` 2.0, `occlusionInj`
  RCA 0.8 / LCx 2.0: LPFB 91°, R III ~28 mm (was 34), read LPFB; LAFB −57°; RBBB 126 ms. Reader 50/57 (score 52.5; live 53),
  but fullcheck iErr 10 (proximal LCx loses its lateral ST and Q, mid LAD adds high-lateral ST, PDA V1–V2 ST) and Training
  audit 116/180 (previous variant 126, live 139).

## Round 68, part 2: textbook scorecard (tools/scorecard.js)

66 fixed checks against textbook ranges (ACC/AHA/HRS 2009, 4th UDMI, Goldberger, Chou), read from the model's
measurements and not from the reader's verdicts; ~1 min per model. Generous ranges: a miss means clearly not textbook.

| | live | 48° preview |
|---|---|---|
| normal | 16/17 (R V4 = R V3) | 16/17 (R V5 6.8 mm) |
| LAFB | 3/8 (q aVL 34 ms −6.5 mm, S III 30, R aVL 22.5, QS V1–V3) | **8/8** |
| LPFB | 3/6 (R III 34, inferior q 30–32 ms) | 4/6 (R III 28, R II/aVF 26–27) |
| LBBB | 5/5 | 3/5 (axis 100°, small r in I) |
| RBBB | 3/5 (axis −57°, inferior q 27 ms) | 3/5 (axis −53°) |
| LVH, RVH | 8/8 | 8/8 |
| mid LAD 1 h / 30 d | 5/5 | 4/5 (axis 99° at 30 d) |
| mid RCA 1 h / 30 d | 6/8 (Q III −12.6, R aVL 11.7) | 6/8 (Q III −19, R aVL 15.9) |
| proximal LCx 1 h / 30 d | 4/4 | 4/4 |
| **total** | **53/66** | **56/66** |

The misses left in both: the fascicular block voltages (LPFB), the RBBB superior axis (a known limitation since
rebuild-1), and the size of the inferior infarct's Q and its aVL R.

## Round 68, part 3: scorecard-driven search (conduction system, orientation, infarct layer)

All steps judged by `tools/scorecard.js` (the 41 block/normal checks per candidate, ~15 s), then the full suites.
- RBBB's superior axis: weaker RV sources help steadily (`rvSourceGain` 1 → 0.75: −53 → −34°) but do not reach −30°;
  an earlier right-septal Purkinje (`rbbSeptalDelay` 10) fixes LBBB in the preview (5/5) but costs LAFB and LPFB.
- Joint random search (120 candidates: the solved orientations × RV source, right-septal delay, septal-fascicle slowing,
  septal territory, Purkinje speed and cross-territory slowing): plateau at 35/41 (preview 34). The same four misses in
  every candidate: LPFB R III 26–31 mm, RBBB axis −34 … −53°, LBBB swinging right (96–100°) wherever the fascicular
  blocks work, RBBB inferior q 30–33 ms. This is the limit of the present conduction system.
- Infarct layer on the best candidate: LCx injury 2.6 drops beats (discarded); an RCA rim (3–5 mm) gives the textbook
  Q III size (scorecard infarcts 14 → 16/17) but costs the reader 4 (the smaller inferior Q is no longer read).
- Best candidate in full: scorecard 56/66 (= preview), reader 44/57 (preview 50), fullcheck iErr 10, Training audit
  107/180 (preview 116): not adopted. Best scorecard: the deployed preview, 56/66; live 53/66.

## Round 68, part 4: ischaemia-first orientation (the 48° preview updated)

The author's priorities: ischaemia detection first; LAFB/LPFB acceptable; bundle-branch axes low priority. Quick checks:
the infarct lead groups of fullcheck alone (scratch copy, 13 s, reproduces fullcheck's iErr exactly) and the block
scorecard subset (15 s).
- Injury scales and the chest dipole weight at the yaw-20 preview: iErr 10 → 8 at best; its misses (mid-LAD high-lateral
  ST, proximal-LCx lateral Q, PDA V1–V2 ST) follow the orientation.
- All 55 solved orientations scored on both: the apex swung far left (yaw 20) costs infarct localisation; yaw ≤ 12
  restores it (tilt 10 / pitch −15 / yaw 12: iErr 3; tilt 17 / −15 / 12: iErr 4), but LPFB stops at 85–89°. Yaw 16
  (solved for tilt 10/17/24): iErr 5–8.
- Adopted for the preview: tilt 17 / pitch −15 / yaw 12, `ecgGain` 0.01167, `purkCrossSlow` 6, `purkCrossFastPhi`
  [[0.7, 0.3], [−1.8, 0.05]], `lsfTieDelay` 2.2 (the rest as part 3).

| | live | preview (yaw 20) | **preview (yaw 12)** |
|---|---|---|---|
| scorecard | 53/66 | 56/66 | **57/66** |
| blind reader | 50/57 | 50/57 | 47/57 |
| infarct lead groups (fullcheck iErr) | 4 | 10 | **4** |
| Training audit | 139/180 | 116/180 | 131/180 |

Its misses: LPFB 89° (reads normal, 1° short; R III 29.5 mm), LAFB's 30 ms q in V5–V6 (read old low-lateral MI, 1 ms
over), RBBB axis −51°, mid-RCA 30 d Q III −20.5 mm and R aVL 16 mm, distal-LCx 30 d lateral Q.
- Near-misses: `lsfTieDelay` 2.2 → 3.0 takes LPFB to 91° (reads LPFB; R III 31.8 mm). LAFB's V5–V6 q stays at 30 ms
  under every LAF-side setting (terminal, anterior band, Purkinje speed; the author accepts it as a lateral q).
  Preview scorecard 57 → **59/66** (live 53). Infarct lead groups unchanged (the setting acts only with an LPF block).
- Misses by distance from textbook: mid-RCA 30 d Q III −20.5 mm (limit −12: +71%), LPFB R III 31.8 mm (≤ 20: +59%;
  II/aVF 28–30), mid-RCA 30 d R aVL 16 mm (< 11: +45%), RBBB inferior q 40 ms in aVF (< 30) and axis −51° (21° outside;
  low priority), LAFB V5–V6 q 30 ms (1 ms; accepted). Not on the scorecard: PDA ST in V1–V2, distal-LCx 30 d lateral Q,
  distal-LAD Q in V2 (live too).
