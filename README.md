# LiveHeart

An interactive, forward-computed 12-lead ECG simulator. The ECG is computed from the heart:
a cellular automaton spreads activation through a CT-derived four-chamber heart. Every
tissue cell carries its own action potential, and the 12 leads come from the resulting
electrical field.

Open `index.html` in a browser. It is a single self-contained file (≈1.8 MB) that loads
Three.js r128 and OrbitControls from CDNs.

## Status: milestone 1

| Area | Done |
|---|---|
| Anatomy | Average adult four-chamber heart (Rodero et al. 2021), voxelized at 2 mm (≈37k cells), with decimated surfaces for rendering |
| Conduction system | SA node, crista terminalis, Bachmann's bundle, AV node (5 decremental segments), His, LBB → LAF/LPF/septal fascicle, RBB → moderator band, LV/RV Purkinje networks, escape pacemakers |
| Engine | Event-driven automaton with sub-ms arrival times, fibre anisotropy, APD/CV restitution, AV-node decrement and autonomic coupling, per-cell parametric action potential, electrotonic APD modulation |
| ECG | Limb leads from the Einthoven projection of the heart vector (Goldberger augmented leads); precordial leads blend the heart vector projected on distance-weighted lead vectors (70%) with near-field chest-electrode potentials (30%) |
| UI | 3D external and four-chamber cutaway views (stencil-capped cut face), label and lead-vector overlays with a live heart vector, 12-lead + rhythm strip on standard paper, interpretation banner, rate and time-scale controls, resizable split |

### Sinus-rhythm validation (headless engine, `node tools/sim.js`)

| Sinus rate | PR | QRS | QT / QTc | Frontal axes |
|---|---|---|---|---|
| 55 bpm | 151 ms | 76 ms | 392 / 375 ms | |
| 72 bpm | 142 ms | 76–80 ms | 368 / 403 ms | P +70°, QRS +10–14°, T +73° |
| 100 bpm | 133 ms | 76 ms | 334 / 431 ms | |
| 130 bpm | 129 ms | 76 ms | 308 / 453 ms | |

Morphology at 72 bpm: septal q in I/aVL/V5/V6; normal R-wave progression (V1 0.3/0.9 →
V2 0.5/1.6 → V3 0.8/1.7 → V4 0.9/0.8 → V5 1.2/0.3 → V6 0.9/0.3 mV R/S); negative aVR; upright T
in I, II and V2–V6.

Rhythm source is block-dependent, not rate-dependent: every slider rate stays sinus; blocking
the SA or AV node brings out a junctional escape (48 bpm), and blocking the His bundle a
ventricular escape (40 bpm, QRS ≈ 117 ms) dissociated from the sinus P waves. See `docs/validation-sinus-72.png`.

## Layout

```
src/engine.js      engine (browser + Node): anatomy, model, simulation, lead fields
src/app.js         Three.js view, ECG paper, interpretation, controls
src/template.html  page shell and styles
src/anatomy.json   generated voxel grid + surfaces + landmarks
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
