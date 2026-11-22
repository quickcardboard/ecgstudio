# Statistical shape variants of the heart (Rodero et al. 2021, Zenodo 4593739)

Tools from the 2026-11-22 remodeling test (docs/DEVELOPMENT.md, "round 20"). Work directory: `SSM_WORK` (large files:
each variant ~100 MB as .npz; the meshes are downloaded from Zenodo).

- `ssm_screen.py <work>/ssm 17 -15 12 <names,…>`: downloads each variant (e.g. `mode4+3SD`), converts it with
  `tools/parse_vtk.py` to `<work>/ssm/<name>.npz` and prints its geometry in the engine's orientation (RV−LV frontal angle,
  LV long axis, RV/LV volume). Needs `<work>/ssm/avg.npz` (the average mesh, converted the same way).
- `make_variant.sh <name>`: a working copy of the model on that variant in `<work>/var/<name>/` (src/ and tools/ copied):
  `tools/build_anatomy.py`, `seal.py`, then the torso re-solve (`export_heart_torso.js` + `ANISO=1 torso_v2.py`); the
  copy's own validation tools then run unchanged in it. Needs `pip install pyfqmr scipy pyamg`.
- `seal.py <anatomy.json>`: plugs one-voxel gaps between the chamber cavities and the outside with vein-cap voxels
  (label 11); the variants' RV/RA cavities otherwise leak at 2 mm and lose the right bundle and RV Purkinje network.
  On the average heart it changes the quick read by ≤ 5° (it is applied to every heart compared, the average included).
- `quickread.js <model dir> ['{params}']`: normal, LAFB, LPFB, LBBB, RBBB: axis, QRS, R/S in I, II, III, aVF, V1, V5, the
  blind read.

The pipeline reproduces the live model exactly from the average mesh (anatomy.json and the torso field identical).
