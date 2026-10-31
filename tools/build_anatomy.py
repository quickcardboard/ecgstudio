"""
Build the embedded anatomy for ECG Studio from the Rodero et al. (2021) average
four-chamber heart mesh (Zenodo 10.5281/zenodo.4593739, CC BY 4.0).

Outputs (to the given directory):
  anatomy.json  - voxel tissue grid + per-voxel attributes + decimated surfaces,
                  arrays base64-encoded, ready to be inlined in index.html.
  preview_*.png - orthographic previews for sanity checks.

Body frame used everywhere in ECG Studio (millimetres):
  +X = patient left, +Y = superior (Three.js "up"), +Z = anterior (toward viewer)
The source mesh is DICOM LPS (+x left, +y posterior, +z superior), so
  X = x, Y = z, Z = -y.
"""
import sys, json, base64, numpy as np
import pyfqmr

H = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0   # voxel edge (mm)

# Source label -> ECG Studio tissue label
#  1 LV, 2 RV, 3 LA, 4 RA  (excitable myocardium)
#  5 aorta, 6 pulmonary artery, 7 mitral, 8 tricuspid, 9 aortic valve,
#  10 pulmonic valve, 11 veins (SVC/IVC/pulmonary veins/LAA cap)
LABEL_MAP = {i: i for i in range(1, 11)}
LABEL_MAP.update({i: 11 for i in range(11, 25)})
NLAB = 12


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def to_body(v):
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def main(src, outdir):
    d = np.load(src)
    pts = to_body(d['pts'].astype(np.float64))
    cells = d['cells']
    lab = np.vectorize(LABEL_MAP.get)(d['ID'].astype(int)).astype(np.uint8)
    fib = to_body(d['fibres'].astype(np.float64))

    # Universal ventricular coordinates (point data, -10 outside ventricles)
    uvc = {k: d[k].astype(np.float64) for k in ('RHO', 'PHI', 'Z', 'V')}

    P = pts[cells]                      # (n,4,3)
    cen = P.mean(1)
    vol = np.abs(np.einsum('ij,ij->i', P[:, 1] - P[:, 0],
                           np.cross(P[:, 2] - P[:, 0], P[:, 3] - P[:, 0]))) / 6.0

    # ---- Voxelisation: bin tet volume by centroid, majority label by volume
    lo = pts.min(0) - 2 * H
    dims = np.ceil((pts.max(0) + 2 * H - lo) / H).astype(int)
    ijk = np.floor((cen - lo) / H).astype(int)
    flat = np.ravel_multi_index(ijk.T, dims)
    ncell = int(np.prod(dims))
    vl = np.zeros((NLAB, ncell))
    for L in range(1, NLAB):
        m = lab == L
        vl[L] = np.bincount(flat[m], weights=vol[m], minlength=ncell)
    tot = vl.sum(0)
    grid = np.where(tot >= 0.3 * H ** 3, vl.argmax(0), 0).astype(np.uint8)

    # Per-voxel ventricular coordinates (volume-weighted mean of valid tets)
    tet_uvc = {}
    for k, v in uvc.items():
        tv = v[cells]
        ok = (tv > -5).all(1)
        tet_uvc[k] = (np.where(ok, tv.mean(1), 0.0), ok)
    occ = np.flatnonzero(grid)
    print('dims', dims, 'voxels', occ.size, {L: int((grid == L).sum()) for L in range(1, NLAB)})

    def vox_mean(k):
        val, ok = tet_uvc[k]
        w = vol * ok
        s = np.bincount(flat, weights=val * w, minlength=ncell)
        n = np.bincount(flat, weights=w, minlength=ncell)
        return np.where(n > 0, s / np.maximum(n, 1e-12), -10.0)[occ]

    rho, phi, zz, vv = (vox_mean(k) for k in ('RHO', 'PHI', 'Z', 'V'))

    # Fibre direction: principal eigenvector of the volume-weighted structure
    # tensor (fibres are axial, so f and -f must not cancel when averaged).
    T = np.zeros((ncell, 6))
    comps = [(0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2)]
    for c, (a, b) in enumerate(comps):
        T[:, c] = np.bincount(flat, weights=vol * fib[:, a] * fib[:, b], minlength=ncell)
    To = T[occ]
    M = np.zeros((occ.size, 3, 3))
    for c, (a, b) in enumerate(comps):
        M[:, a, b] = To[:, c]; M[:, b, a] = To[:, c]
    w, v = np.linalg.eigh(M)
    fdir = v[:, :, 2]
    fdir /= np.maximum(np.linalg.norm(fdir, axis=1, keepdims=True), 1e-9)

    # ---- Surfaces: boundary faces of the tet mesh, grouped by tissue label
    faces = np.concatenate([cells[:, [0, 1, 2]], cells[:, [0, 1, 3]],
                            cells[:, [0, 2, 3]], cells[:, [1, 2, 3]]])
    opp = np.concatenate([cells[:, 3], cells[:, 2], cells[:, 1], cells[:, 0]])
    flab = np.tile(lab, 4)
    key = np.sort(faces, 1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    bnd = cnt[inv.ravel()] == 1
    faces, opp, flab = faces[bnd], opp[bnd], flab[bnd]
    # orient outward: normal must point away from the opposite tet vertex
    a, b, c = pts[faces[:, 0]], pts[faces[:, 1]], pts[faces[:, 2]]
    n = np.cross(b - a, c - a)
    flip = np.einsum('ij,ij->i', n, pts[opp] - a) > 0
    faces[flip] = faces[flip][:, [0, 2, 1]]
    print('boundary faces', len(faces))

    surfaces = []
    budget = {1: 16000, 2: 9000, 3: 7000, 4: 7000, 5: 4000, 6: 2500,
              7: 800, 8: 800, 9: 500, 10: 500, 11: 3000}
    for L in range(1, NLAB):
        fl = faces[flab == L]
        if len(fl) == 0: continue
        used, remap = np.unique(fl, return_inverse=True)
        V = pts[used]; F = remap.reshape(-1, 3)
        s = pyfqmr.Simplify()
        s.setMesh(V, F)
        s.simplify_mesh(target_count=budget[L], aggressiveness=5,
                        preserve_border=True, verbose=False)
        V2, F2, _ = s.getMesh()
        print('surface', L, len(F), '->', len(F2))
        # quantise to uint16 over the grid bounding box (~2 µm steps)
        span = dims * H
        q = np.clip(np.round((V2 - lo) / span * 65535), 0, 65535).astype(np.uint16)
        surfaces.append({'label': L, 'pos': b64(q),
                         'idx': b64(F2.astype(np.uint32)), 'nv': len(V2), 'nf': len(F2)})

    # ---- Anatomical landmarks (centre, plane normal, radius) from source labels
    names = {7: 'MV', 8: 'TV', 9: 'AoV', 10: 'PuV', 11: 'LAA', 12: 'LSPV', 13: 'LIPV',
             14: 'RIPV', 15: 'RSPV', 16: 'SVC', 17: 'IVC'}
    srcid = d['ID'].astype(int)
    landmarks = {}
    for i, nm in names.items():
        q = cen[srcid == i]; m = q.mean(0)
        _, sv, vt = np.linalg.svd(q - m, full_matrices=False)
        landmarks[nm] = {'c': m.round(2).tolist(), 'n': vt[2].round(4).tolist(),
                         'r': float(np.sqrt(sv[0] ** 2 / len(q)) * 1.41)}

    occ_ijk = np.array(np.unravel_index(occ, dims)).T
    out = {
        'source': 'Rodero C. et al. (2021) average four-chamber heart, Zenodo 10.5281/zenodo.4593739, CC BY 4.0',
        'h': H, 'origin': lo.tolist(), 'dims': dims.tolist(), 'count': int(occ.size),
        # voxel arrays (sparse, in raster order of the dense grid)
        'index': b64(occ.astype(np.uint32)),
        'label': b64(grid[occ]),
        'rho': b64(np.clip(np.where(rho > -5, rho, -1) * 127, -127, 127).astype(np.int8)),
        'z': b64(np.clip(np.where(zz > -5, zz, -1) * 127, -127, 127).astype(np.int8)),
        'phi': b64(np.clip(np.where(phi > -5, phi / np.pi, -1.0) * 127, -127, 127).astype(np.int8)),
        'vside': b64(np.where(vv > -5, np.sign(vv), 0).astype(np.int8)),
        'fiber': b64(np.clip(fdir * 127, -127, 127).astype(np.int8)),
        'surfaces': surfaces,
        'landmarks': landmarks,
    }
    with open(f'{outdir}/anatomy.json', 'w') as f:
        json.dump(out, f)

    # ---- previews
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    xyz = lo + (occ_ijk + 0.5) * H
    gl = grid[occ]
    cols = np.array(['k', 'red', 'blue', 'orange', 'green', 'gray', 'purple',
                     'cyan', 'cyan', 'cyan', 'cyan', 'brown'])
    fig, ax = plt.subplots(1, 3, figsize=(18, 6))
    for k, (i, j, t) in enumerate([(0, 1, 'frontal X-Y (anterior view, pt left = +X)'),
                                   (0, 2, 'transverse X-Z (from feet? +Z anterior)'),
                                   (2, 1, 'sagittal Z-Y (+Z anterior)')]):
        o = np.argsort(xyz[:, 3 - i - j])
        ax[k].scatter(xyz[o, i], xyz[o, j], c=cols[gl[o]], s=1)
        ax[k].set_aspect('equal'); ax[k].set_title(t)
    plt.savefig(f'{outdir}/preview_labels.png', dpi=70)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
