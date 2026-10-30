# LiveHeart

An interactive, forward-computed 12-lead ECG simulator. The ECG is computed from the heart:
a cellular automaton spreads activation through a CT-derived four-chamber heart. Every
tissue cell carries its own action potential, and the 12 leads come from the resulting
electrical field.

Open `index.html` in a browser. It is a single self-contained file (≈4.7 MB) that loads
Three.js r128 and OrbitControls from CDNs.

## Status: milestone 4 (arrhythmias) on top of milestones 1–3

| Area | Done |
|---|---|
| Anatomy | Average adult four-chamber heart (Rodero et al. 2021), voxelized at 2 mm (≈37k cells), with decimated surfaces for rendering |
| Conduction system | SA node, crista terminalis, Bachmann's bundle, AV node (5 decremental segments), His, LBB → LAF/LPF (two-fascicle model; an optional septal fascicle is off by default), RBB → moderator band, LV/RV Purkinje networks, escape pacemakers |
| Engine | Event-driven automaton with sub-ms arrival times, fibre anisotropy, APD/CV restitution, AV-node decrement and autonomic coupling, per-cell parametric action potential, electrotonic APD modulation |
| ECG | Limb leads from the Einthoven projection of the heart vector (Goldberger augmented leads); precordial leads blend the heart vector projected on distance-weighted lead vectors (70%) with near-field chest-electrode potentials (30%) |
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

Atrial refractoriness now has a floor (APD ≥135 ms at the shortest intervals), and the AV-node post-repolarisation
refractoriness is 180 ms. Limitations: AF fibrillatory waves are fine (low amplitude); clockwise flutter is not offered
(the model's clockwise circuit runs too fast); AF, MAT, VT and VF are driven by foci rather than self-sustaining
re-entry.

## Layout

```
src/engine.js      engine (browser + Node): anatomy, model, simulation, lead fields
src/app.js         Three.js view, ECG paper, interpretation, controls
src/template.html  page shell and styles
src/anatomy.json   generated voxel grid + surfaces + landmarks
src/torso_leadfield.json  limb-lead fields of the insulated torso (tools/torso_leadfield.py)
tools/             build + validation scripts
index.html         built single-file app (python3 tools/build.py)
```

Rebuild the anatomy (needs `average.tar.gz` from the Zenodo record below):

```
python3 tools/parse_vtk.py average.vtk mesh.npz
python3 tools/build_anatomy.py mesh.npz out/ 2.0
```

Headless checks: `node tools/evalecg.js` (intervals and axes), `node tools/sim.js 3000 72 out.json`
plus `python3 tools/plot_ecg.py out.json plot.png 1600 1100`.

## Attribution

Anatomy: Rodero C, Strocchi M, Marciniak M, et al. *Virtual cohort of extreme and average
four-chamber heart meshes from statistical shape model.* Zenodo (2021),
doi:10.5281/zenodo.4593739, licensed CC BY 4.0. The mesh was voxelized, decimated and
re-oriented; the conduction system and electrophysiology are LiveHeart's own.

LiveHeart is an educational model, not a diagnostic device.
