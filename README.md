# LiveHeart

An interactive, forward-computed 12-lead ECG simulator. The ECG is computed from the heart:
a cellular automaton spreads activation through a CT-derived four-chamber heart. Every
tissue cell carries its own action potential, and the 12 leads come from the resulting
electrical field.

Open `index.html` in a browser. It is a single self-contained file (≈4.7 MB) that loads
Three.js r128 and OrbitControls from CDNs.

## Status: milestone 1

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
| 72 bpm | 140 ms | 86 ms | 371 / 406 ms |
| 100 bpm | 132 ms | 83 ms | 331 / 427 ms |
| 160 bpm | 126 ms | 83 ms | 283 / 462 ms |

Frontal axes at 72 bpm: P +79°, QRS +34° (area) / +42° (net deflection), T +51°. Septal q in I and
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
computed Burger triangle), and an LV free wall thickened by ~6 mm. The heart sits 67° below horizontal
(CT: 52°) with 39° anterior tilt. `tools/research/` reproduces the investigation, and
`tools/data/fascicular_candidate_v2.json` records the parameter set. The ECG output passes a 40 Hz
low-pass (`ecgLowpass`), as on a monitoring ECG.

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
