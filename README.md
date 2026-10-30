# LiveHeart

**See the ECG come from the heart.** LiveHeart is an interactive 3D heart and 12-lead ECG
simulator for students and teachers of electrocardiography. Every complex on the tracing is
computed live from a CT-derived four-chamber heart: block a fascicle, occlude a coronary
artery or start a tachycardia, and watch the wavefront change in 3D while the 12 leads
redraw on standard ECG paper.

It runs entirely in the browser as a single self-contained file. No install, no account,
no data leaves the device.

## What you can do

- **Rhythms:** sinus rhythm at any rate, sinus arrhythmia, PACs and PVCs (click anywhere on the
  heart to pace an ectopic beat), atrial fibrillation and flutter, ectopic atrial rhythm, MAT,
  junctional and ventricular escape, AVNRT, AVRT and WPW pre-excitation, ventricular
  tachycardia and fibrillation.
- **Conduction blocks:** first-, second- (Wenckebach and Mobitz II) and third-degree AV block,
  right and left bundle branch block, left anterior and posterior fascicular block. Click the
  conduction system in 3D to cut it anywhere.
- **Ischemia and infarction:** occlude the LAD, LCx or RCA at proximal, mid or distal sites (or
  click an artery), then scrub through time to follow hyperacute T waves, ST elevation and
  reciprocal depression, Q-wave formation and T-wave inversion. Subendocardial ischemia,
  posterior and right-ventricular involvement are included.
- **Structure:** left and right ventricular hypertrophy, atrial enlargement, pericarditis and
  the Brugada type 1 pattern.
- **Learn:** a live interpretation banner with rate, intervals, axis and QTc, plus a Learn tab
  that explains the key features and common pitfalls of whatever is on screen.
- **Explore the anatomy:** rotate the heart, cut it open in four-chamber, lateral or short-axis
  views, show lead vectors and the live heart vector, and colour cells by their electrical state.

Works on desktop, tablets and phones (landscape).

## How it works

A cellular automaton spreads activation through about 37,000 tissue cells (2 mm voxels) of an
average adult heart, with fibre anisotropy, restitution, a decremental AV node and a full His–Purkinje
system. Each cell carries its own action potential, and the 12 leads are computed from the
resulting electrical field through torso and chest lead fields. Nothing is drawn from templates,
so combinations (say, an inferior infarct with LAFB in atrial fibrillation) produce their own
ECG. Model choices and validation against textbook values are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Running it

Open `index.html` in a modern browser. The file (≈4.7 MB) loads Three.js r128 and
OrbitControls from a CDN; everything else is inlined.

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
