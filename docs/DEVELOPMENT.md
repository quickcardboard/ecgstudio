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

### Round 18 (branch cs-tune): conduction-system retune and diagnostics

Tools: `tools/cstune.js` (ECG + activation score: normal axis/septal q/R progression,
LAFB/LPFB/LBBB/RBBB, PR/HV/apex/total activation, LAD/RCA/LCx infarct leads, P axis, LVH, RVH),
`tools/acttune.js` (activation only, against Durrer 1970), `tools/es_tune.js` (diagonal CMA-style
optimiser). New engine options, all off or unchanged by default on milestone-1: `apexPurkMul/Z`,
`mbZ`, `ladRvMm`; the septal fascicle already existed.

Findings:
- With the septal fascicle on, a faster apical Purkinje network, a re-oriented heart and adjusted
  torso limb-lead settings, the optimiser reached a set meeting nearly every ECG target at once
  (score 4.07 vs 15.0 for the live model): normal +48° with septal q, R transition V3–V4, LAFB −45°,
  LPFB +100°, apex 24 ms, total 81 ms, P +56°, LVH Sokolow 4.0, RVH +162°, lateral LCx injury,
  distal LAD Q in V4–V5. Still off: LBBB +77°, distal LAD r 0.15–0.19 mV in V2–V3, HV 33 ms.
- Uniform double-layer sources (sigmaRatio 1) are much worse (normal +91°, LAFB disappears,
  distal LAD r ~1 mV): the fibre-anisotropic source model is not the hidden problem.
- Activation alone is under-determined: many conduction set-ups match Durrer exactly (score 0).
  Such an activation, seen through the current forward model, gives a poor ECG (normal +7°/−13°,
  LPFB +32 to +53°, RVH axis 230–248°). The forward model (separate limb/chest physics, no lungs or
  cavity blood, hand-set gains) is the prime suspect; a single boundary-element torso for all 12
  leads is the candidate fix.

Full regression of the pass-3 optimiser set (current cs-tune defaults; NOT for release):
improved normal QRS (septal q, R transition V3–V4) and distal LAD Q in V4–V5, but normal T axis
+72° (tall inferior T, T inverted in aVL), trifascicular block (RBB+LAF+LPF) conducts 1:1 through
the septal fascicle, mid-LAD gives ST elevation in III/aVF at 1 h, and circumflex occlusions give
inferior ST elevation with loss of the distal LCx V6 Q.

### Round 19 (cs-tune): coronary territories against the AHA 17-segment model

`tools/aha_segments.js` measures which artery supplies each AHA wall. The model gave most of the
anterolateral wall to the LAD (64–74%), where the AHA typical assignment is the circumflex. Two
causes: the diagonals reached too far round and OM1 ran too posteriorly; and the proximal LAD,
which curves from the left main round the pulmonary trunk to the anterior groove (anatomically
right), was claiming the basal anterolateral wall through the nearest-node rule although it gives
no free-wall branches on that stretch. Fixes: OM1 down the anterolateral–lateral wall, diagonals
at the anterior–anterolateral junction, proximal-LAD nodes lateral of `ladProxFreeWallPhi` excluded
from free-wall assignment. Agreement with AHA 81% → 88%; anterolateral wall now 78–85% circumflex.

Effect (live conduction model): proximal LCx at 1 h now ST elevation in I, aVL, V5–V6 with
reciprocal III/aVF and posterior (V1–V4) depression (was V6 only); mid LAD loses I/aVL and shows
the wrap-around inferior pattern; distal LCx unchanged. Physical candidate: LCx injury lateral
0.40 vs inferior 0.07 mV; distal LAD QS V3–V4 without lateral Q.

### Round 20 (cs-tune): hypertrophy, LBBB mapping check, chest electrodes against Dower

*Hypertrophy (forward model 2).* The torso conductor gives LVH voltage from the wall mass alone,
so the LV source gain (1.5) is dropped: 5 layers give Sokolow ~4.5–5 mV, Cornell ~2.7 mV and strain
T in V5–V6 (was Sokolow 7.7). A thick RV alone gives only +92°; RVH keeps an RV gain of 1.3 (axis
+142–153°, dominant R in V1, R in aVR, deep S V5). Forward model 1 keeps its old settings.

*LBBB activation against mapping data* (`tools/lbbbmap.js`, AHA segments): LV breakthrough on the
anterior septum, the wavefront round the anterior wall to the lateral wall and round the apex and
inferior wall, latest at the basal inferolateral (posterolateral) wall at ~100 ms. This agrees
with Vassallo 1984 and Auricchio 2004 (septal breakthrough, U-shaped wavefront round a line of
slow conduction/block between septum and lateral wall, the commonest anterior; latest
lateral/posterolateral), so activation is left as fitted. The +90° LBBB axis comes from where
that late posterolateral base sits (inferior, y ≈ −22 mm), not from the order of activation.
Making the RV septum activate early swings LBBB left but reverses normal septal activation (no
septal q, Durrer error 0.16 → 4–17): rejected.

*Lead vectors against Dower* (`tools/leadvectors.py`; Dower's forward matrix, checked: its
pseudo-inverse reproduces the published inverse Dower rows). Limb leads within 8–13°; chest leads
were 18–40° off (V2–V4 read too far right of and above the heart). Chest electrodes 20 mm lower
(`chestLeadY: -20`) with the apex 20 mm more medial (`apexX: 52`) cut the mean error 26° → 19°.
With activation unchanged and the gain recalibrated, that candidate gives normal axis +55/63°,
qI −0.05, V1 rS 0.36/1.31, transition V3–V4, II/V5 ratio 0.71, LAFB −66°, P +62°, LVH Sokolow 4.4,
RVH +153°, circumflex injury lateral; LBBB +89° and LPFB +89/92° are unchanged.

### Round 21 (cs-tune): CT orientation, measured source anisotropy, constrained re-fit

*Why the orientation had drifted.* Orientation moves the normal and LBBB axes together, but the
LBBB axis sat 33–67° right of the normal axis at every orientation (clinically it is at or left of
it). The cause was `sigmaRatio` 10: the intracellular along/across conductivity ratio alone. With
the heart's own bulk anisotropy (treated as isotropic by the torso) the effective source ratio is
(σil/σbl)/(σit/σbt) ≈ 2.9 (Clerc 1976), 3.4 (Roberts 1979), 1.7 (Roberts & Scher 1982). At the CT
orientation (0/0/0) and ratio 3: normal +31°, LBBB −3°, LAFB −49°. The earlier tilt (15°, −25°)
had been compensating the overstated fibre source.

*Torso grid* (CT, ratio 3, activation fixed): lung 0.04/0.1 S/m, liver + spine (ORGANS), chest
leads 0/−20 mm, apex x 52/68, chest gap 20/35 mm. None fixes V1/R progression; lungs 0.04 with
organs score best. Chosen: lungs 0.04, organs, chest leads −20, apex x 68 (mid-clavicular), gap 20.

*Constrained re-fit* (`ACTMAX=0.5`: sets off the mapping targets are rejected; atrial parameters
locked; muscle/Purkinje velocities and PMJ delay within literature ranges): activation score 0;
normal +35/39°, LBBB +16°, LAFB −41°, P +63°, septal q, II/V5 0.57, Sokolow 3.7. Open: R peaks
in V3 (V2 R 1.7), V1 r 0.43, distal-LAD QS lost in V2–V3, RVH +94°, LPFB ~+50°.

*Fascicle territories.* The LPF territory had collapsed to a strip of the inferior septum (83 of
~1060 LV Purkinje nodes) with the LPF landing outside it. Anatomically the LPF is the broad
division (posterior septum, inferior and inferolateral walls, posteromedial papillary muscle).
Widening it alone barely moves LPFB (+54°) because the two networks were linked at near full speed
(purkCrossSlow 1.2): a blocked territory refilled within ~8 ms. Next re-fit: territories and the
LPF landing site held to anatomy, cross-links free only at the apex (`purkCrossApexZ`), R-wave
progression and distal-LAD QS weighted more.

*Second re-fit* (anatomical territories: LPF −0.5 … −2.4/−3.0 with its landing inside;
cross-links free only near the apex): activation score 0; normal +36°, LBBB +8°, LAFB −39°; LPFB
stays +38/52° (QRS 94) and V2 R stays ~1.8 mV. The optimiser drove the cross-link slowing to its
lower bound (2). Conduction-system changes within the mapping limits do not move these two.

*V2 decomposition* (`forward 2`, R peak at 24 ms): RV endocardial side +3.8 mV, RV epicardium
−2.8 mV, every LV region < 0.4 mV: the tall V2 R is the RV free wall's near field. Chest-wall
options in `torso_v2.py` (STERNUM, RIBS, FAT) make it larger, not smaller (sternum V2 R 2.2 → 3.0;
pericardial fat 5.0). Anatomy: 2 mm voxels, RV free wall ~5.4 mm, LV wall ~14 mm with the 2 added
layers, LV/RV mass 2.9. Note: the ES runs scored amplitudes at a gain calibrated on the earlier
activation set (1.96); recalibrated on the re-fitted set it is 3.05, so the gain should be
recalibrated inside each evaluation.
Numerical check: chest electrodes as 8 mm gel patches and/or a 3 mm torso grid leave V2 unchanged
(R 2.2–2.36 mV at the recalibrated gain), so the tall V2 R is not a discretisation artefact.

*Before/after review* (`tools/compare.js` records one beat of 15 teaching scenarios for any engine
version and parameter set; plotted side by side at 25 mm/s, 10 mm/mV). Live (milestone-1,
forward model 1) vs the round-21 physiological set (forward model 2, CT orientation, source ratio
3, lungs/liver/spine torso, gain recalibrated on the Kors heart vector):
better in the new set — LBBB axis (+77 → +8°), proximal LCx lateral ST (I, aVL, V5–V6, reciprocal
inferior and V1–V4), proximal RCA with right-sided V1–V2 ST elevation, old inferior MI QS in III;
worse — chest-lead voltage (normal V2 R/S 2.2/3.7 mV, LVH V2 S 5.8, RVH V1 R 5.5), R peaking in
V2–V3, LPFB +52°, LVH axis +18° without QRS widening, and above all proximal LAD at 1 h: ST
elevation only in V4 (+0.94) with V1–V3 ≤ 0.23 and none in I/aVL (live: V2–V5 +0.5–0.8, aVL
+0.9, inferior reciprocal). The old forward-model-2 set (tilted heart, ratio 10) had the same weak
anterior ST, so this belongs to forward model 2 itself; ischaemia was not in its scoring. Not ready
for the live site.
