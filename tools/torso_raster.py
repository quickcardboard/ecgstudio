# Rasterise the labelled torso mesh (Malik et al., Zenodo 18890229, CC-BY 4.0) onto ECG Studio's torso grid.
# Frame: ours X left, Y up, Z anterior (mm); theirs x left, y posterior→ (anterior = −y), z up (µm).
#   python3 -I tools/torso_raster.py <mesh dir with pts.npy, elem.npy> <heart_torso.json> out.npz [H=3]   (tools/torso_v3.py)
import sys, json, numpy as np
from scipy.spatial import cKDTree
md, hj, out = sys.argv[1], sys.argv[2], sys.argv[3]; H = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
pts = np.load(md + '/pts.npy') / 1000.0; el = np.load(md + '/elem.npy')
P = np.stack([pts[:, 0], pts[:, 2], -pts[:, 1]], 1)            # → ours (mm)
tet = P[el[:, :4]]; cen = tet.mean(1); tag = el[:, 4]; rad = np.sqrt(((tet - cen[:, None]) ** 2).sum(2)).max(1)
d = json.load(open(hj))
hp = np.vstack([np.asarray(d['tissue'], float).reshape(-1, 3), np.asarray(d['blood'], float).reshape(-1, 3)])
heart_tags = np.isin(tag, [16, 17, 18, 19, 20, 21, 22, 23])
# their heart (chambers, walls) centroid → ours: translation only (our heart keeps its fitted orientation)
shift = hp.mean(0) - np.average(cen[heart_tags], 0, weights=rad[heart_tags] ** 3)
cen = cen + shift
lo = cen.min(0) - 6; hi = cen.max(0) + 6
Y0 = float(d.get('Y0', -360))
xs = np.arange(np.floor(lo[0] / H) * H, hi[0] + H, H); ys = np.arange(np.floor(min(lo[1], Y0) / H) * H, hi[1] + H, H); zs = np.arange(np.floor(lo[2] / H) * H, hi[2] + H, H)
X, Yg, Z = np.meshgrid(xs, ys, zs, indexing='ij')
q = np.stack([X.ravel(), Yg.ravel(), Z.ravel()], 1)
tree = cKDTree(cen); dist, ii = tree.query(q, k=1, workers=4)
lab = np.where(dist <= np.maximum(rad[ii], 1.5 * H / 2), tag[ii], 0).reshape(X.shape).astype(np.int16)
# extend the trunk below the mesh (it ends at the upper abdomen): repeat the lowest full slice down to Y0 as soft tissue
jb = int(np.argmax((lab > 0).reshape(len(xs), len(ys), len(zs)).any((0, 2))))
base = lab[:, jb + 2, :] > 0
for j in range(0, jb + 2): lab[:, j, :] = np.where(base, 1, 0)
np.savez_compressed(out, xs=xs, ys=ys, zs=zs, lab=lab, shift=shift)
print('grid', lab.shape, 'shift', np.round(shift, 1), 'bottom of mesh at y', ys[jb])
for t in np.unique(lab): print('tag', t, 'voxels', int((lab == t).sum()))
