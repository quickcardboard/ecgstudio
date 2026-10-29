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
| ECG | Precordial leads from chest-electrode lead fields (Wilson terminal); limb leads from the Einthoven projection of the heart vector; Goldberger augmented leads |
| UI | 3D external and four-chamber cutaway views, 12-lead + rhythm strip on standard paper, interpretation banner, rate and time-scale controls, resizable split |

### Sinus-rhythm validation (headless engine, `node tools/sim.js`)

| Sinus rate | PR | QRS | QT / QTc | Frontal axes |
|---|---|---|---|---|
| 55 bpm | 151 ms | 76 ms | 392 / 375 ms | |
| 72 bpm | 142 ms | 76–80 ms | 368 / 403 ms | P +70°, QRS +10–14°, T +73° |
| 100 bpm | 133 ms | 76 ms | 334 / 431 ms | |
| 130 bpm | 129 ms | 76 ms | 308 / 453 ms | |
| < 48 bpm | junctional escape at 48 bpm with retrograde atrial activation | | | |

Morphology at 72 bpm: septal q in I/aVL/V5/V6, rS in V1–V2, transition at V3–V4, negative
aVR, upright T in I, II and V2–V6. See `docs/validation-sinus-72.png`.

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
