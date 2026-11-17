"""
Torso v3: the anatomical torso of a real patient for the ECG lead fields (reciprocity, as tools/torso_v2.py).

Geometry: patient 16 of Malik S, Cicci L, Qayyum A, et al., "Body surface potential driven personalisation of
electrophysiological digital twins in hypertrophic cardiomyopathy", Zenodo 10.5281/zenodo.18890229 (CC-BY 4.0:
credit the authors wherever a field built from it ships). Labels found from geometry (the record has no table):
1 soft tissue, 2 skin, 3 bone, 8 liver, 10 lungs, 11/12/13/15 IVC/SVC/pulmonary artery/aorta (blood),
16-23 the patient's heart (replaced by ours), 4-7, 9 oesophagus and abdominal organs (soft tissue).

  1. download 16.zip from the record into its own folder and unzip it; convert with tools/torso_raster.py
     (python3 -I tools/torso_raster.py <dir with pts.npy, elem.npy> heart.json labels.npz; pts.npy/elem.npy:
     the .pts/.elem files as numpy arrays, µm)
  2. LIMB='{"RA":{"c":[-175,219,-20],"r":50},"LA":{"c":[175,219,-20],"r":50},"LL":{"c":[100,-363,0],"r":70}}' \
     LABELS=labels.npz ANISO=1 python3 tools/torso_v3.py heart.json out.json 3
Limb electrodes: the CT was taken arms down (arms against the chest), so RA/LA sit on top of the shoulders, where the
arms join the trunk (patches on the arms beside the heart give a near-Einthoven triangle and leftward axes).
Chest electrodes: the model's (x, y), moved to this torso's anterior skin; V6 at the mid-axillary line.
"""
import os, sys, json, base64, time, numpy as np
import scipy.sparse as sp, pyamg

src, out = sys.argv[1], sys.argv[2]
H = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
d = json.load(open(src))
A, B = float(d['torso']['a']), float(d['torso']['b'])
SIG = dict(torso=0.22, lung=0.05, blood=0.65, heart=0.20, bone=0.02, liver=0.05, skin=0.22)
SIG.update(json.loads(os.environ.get('SIGMA', '{}') or '{}'))
LIMBS = False
# ---- anatomical torso (torso v3): labelled voxels from raster.py (Malik et al. 2026, Zenodo 18890229, CC-BY 4.0)
LB = np.load(os.environ['LABELS'])
xs, ys, zs, LAB = LB['xs'], LB['ys'], LB['zs'], LB['lab']
X, Yg, Z = np.meshgrid(xs, ys, zs, indexing='ij')
YB, Y1 = float(ys[0]), float(ys[-1])
inside = LAB > 0
TAGSIG = {1: 'torso', 2: 'skin', 3: 'bone', 8: 'liver', 10: 'lung', 11: 'blood', 12: 'blood', 13: 'blood', 15: 'blood'}
sig = np.full(X.shape, SIG['torso'])
for t, nm in TAGSIG.items(): sig[LAB == t] = SIG[nm]
lungs = LAB == 10
def surfZ(x, y):
    i = np.abs(xs - x).argmin(); j = np.abs(ys - y).argmin(); col = np.where(inside[i, j, :])[0]
    return float(zs[col.max()]) if len(col) else 0.0
el = dict(d['electrodes'])
for k in ('V1', 'V2', 'V3', 'V4', 'V5'):
    x, y, _ = el[k]; el[k] = [x, y, surfZ(x, y)]
j6 = np.abs(ys - el['V6'][1]).argmin(); k6 = np.abs(zs - 0).argmin()
rib = np.where((LAB[:, j6, k6 - 5:k6 + 6] == 3).any(1) & (xs > 60))[0]
el['V6'] = [float(xs[rib.max()]) + 20 if len(rib) else el['V6'][0], el['V6'][1], 0.0]
d['electrodes'] = el
print('electrodes on the anatomical torso', json.dumps({k: [round(v, 1) for v in p] for k, p in el.items()}))
def rasterise(pts, value):
    p = np.asarray(pts, float).reshape(-1, 3)
    i = np.rint((p[:, 0] - xs[0]) / H).astype(int); j = np.rint((p[:, 1] - ys[0]) / H).astype(int); k = np.rint((p[:, 2] - zs[0]) / H).astype(int)
    ok = (i >= 0) & (i < len(xs)) & (j >= 0) & (j < len(ys)) & (k >= 0) & (k < len(zs))
    m = np.zeros(X.shape, bool); m[i[ok], j[ok], k[ok]] = True
    sig[m] = value
    return m
if os.environ.get('NOHEART'):          # homogeneous heart region (no cavity blood): orientation-independent field
    blood = np.zeros(X.shape, bool); heart = rasterise(d['tissue'], SIG['torso']) & False
else:
    blood = rasterise(d['blood'], SIG['blood'])
    heart = rasterise(d['tissue'], SIG['heart'])
# ANISO=1: myocardium conducts anisotropically (bulk = intracellular + extracellular; Clerc 1976:
# along fibres ~0.80, across ~0.26 S/m); each face between two heart nodes gets n·σ·n from the
# nodes' fibre directions (cross terms neglected)
ANISO = bool(os.environ.get('ANISO')) and 'fib' in d
if ANISO:
    SIG.setdefault('heartL', 0.80); SIG.setdefault('heartT', 0.26)
    FB = np.zeros(X.shape + (3,)); CNT = np.zeros(X.shape)
    p = np.asarray(d['tissue'], float).reshape(-1, 3); fv = np.asarray(d['fib'], float).reshape(-1, 3)
    i = np.rint((p[:, 0] - xs[0]) / H).astype(int); j = np.rint((p[:, 1] - ys[0]) / H).astype(int); k = np.rint((p[:, 2] - zs[0]) / H).astype(int)
    ok = (i >= 0) & (i < len(xs)) & (j >= 0) & (j < len(ys)) & (k >= 0) & (k < len(zs)) & (np.abs(fv).sum(1) > 0)
    # sign-free averaging of fibre orientations: accumulate the outer product's diagonal (f_a²)
    np.add.at(FB, (i[ok], j[ok], k[ok]), fv[ok] ** 2); np.add.at(CNT, (i[ok], j[ok], k[ok]), 1)
    F2 = np.where(CNT[..., None] > 0, FB / np.maximum(CNT, 1)[..., None], 1 / 3)
    sigA = [np.where(heart, SIG['heartT'] + (SIG['heartL'] - SIG['heartT']) * F2[..., a], sig) for a in range(3)]
    print('anisotropic myocardium: along %.2f, across %.2f S/m' % (SIG['heartL'], SIG['heartT']))
# Chest wall and pericardium (optional): STERNUM=1 sternum/costal cartilage in front of the heart
# (bone 0.02 S/m); RIBS=1 rib-cage shell (bone and intercostal muscle, effective ~0.1 S/m);
# FAT=1 pericardial/epicardial fat (0.04 S/m) as a shell round the heart.
front = B * np.sqrt(np.clip(1 - (X / A) ** 2, 0, 1))
if os.environ.get('RIBS'):
    SIG.setdefault('chestwall', 0.1)
    rim = ((X / A) ** 2 + (Z / B) ** 2 <= 1.0) & ((X / (A - 14)) ** 2 + (Z / (B - 14)) ** 2 > 1.0) & (Yg >= -250) & (Yg <= 200)
    sig[rim & ~heart & ~blood] = SIG['chestwall']
if os.environ.get('STERNUM'):
    SIG.setdefault('bone', 0.02)
    sig[(np.abs(X) < 22) & (Z > front - 14) & (Yg >= -110) & (Yg <= 200)] = SIG['bone']
if os.environ.get('FAT'):
    from scipy.ndimage import binary_dilation
    SIG.setdefault('fat', 0.04)
    hb = heart | blood
    shell = binary_dilation(hb, iterations=max(1, int(round(4 / H)))) & ~hb
    sig[shell] = SIG['fat']
print('nodes inside', int(inside.sum()), 'lung', int((lungs & inside & ~heart & ~blood).sum()), 'heart', int(heart.sum()), 'blood', int(blood.sum()))

idx = -np.ones(X.shape, np.int64); idx[inside] = np.arange(inside.sum()); N = int(inside.sum())
rows, cols, vals = [], [], []
for ax in range(3):
    sa = [slice(None)] * 3; sb = [slice(None)] * 3; sa[ax] = slice(0, -1); sb[ax] = slice(1, None)
    a = idx[tuple(sa)]; b = idx[tuple(sb)]; m = (a >= 0) & (b >= 0)
    sg = sigA[ax] if ANISO else sig
    s1 = sg[tuple(sa)][m]; s2 = sg[tuple(sb)][m]
    g = 2 * s1 * s2 / (s1 + s2) * H            # face conductance (harmonic mean) × area/length (H²/H)
    rows.append(a[m]); cols.append(b[m]); vals.append(g)
r = np.concatenate(rows); c = np.concatenate(cols); g = np.concatenate(vals)
Off = sp.coo_matrix((g, (r, c)), shape=(N, N)).tocsr(); Off = Off + Off.T
K = (sp.diags(np.asarray(Off.sum(1)).ravel()) - Off).tocsr()

def node_near(p):
    dd = (X - p[0]) ** 2 + (Yg - p[1]) ** 2 + (Z - p[2]) ** 2; dd[~inside] = np.inf
    return int(idx[np.unravel_index(np.argmin(dd), dd.shape)])
import os
# Limb electrodes: the arm joins the torso over the shoulder girdle and axilla,
# the leg over the hip; model each as a surface contact patch (current spread
# over the patch), the chest electrodes as points.
LIMB = {'RA': {'c': [-215, -320, 0], 'r': 25}, 'LA': {'c': [215, -320, 0], 'r': 25}, 'LL': {'c': [85, -1100, 0], 'r': 30}} if LIMBS else \
    json.loads(os.environ.get('LIMB', 'null') or 'null') or {
    'RA': {'c': [float(xs[0]), 100, -20], 'r': 70}, 'LA': {'c': [float(xs[-1]), 100, -20], 'r': 70}, 'LL': {'c': [100, float(ys[0]), 0], 'r': 70}}
surf = inside & ~np.roll(inside, 1, 0) | inside & ~np.roll(inside, -1, 0) | inside & ~np.roll(inside, 1, 2) | inside & ~np.roll(inside, -1, 2)
surf |= inside & (~np.roll(inside, 1, 1) | ~np.roll(inside, -1, 1) | (Yg <= YB + H / 2) | (Yg >= Y1 - H / 2))
def patch(c, rad):
    dd = (X - c[0]) ** 2 + (Yg - c[1]) ** 2 + (Z - c[2]) ** 2
    m = surf & (dd <= rad * rad)
    if not m.any(): return [node_near(c)]
    return list(idx[m])
E = {}
for k, v in d['electrodes'].items():
    CP = float(os.environ.get('CHESTPATCH', 0) or 0)   # chest electrode radius (mm): gel contact patch instead of a point
    E[k] = patch(LIMB[k]['c'], LIMB[k]['r']) if k in LIMB else (patch(v, CP) if CP > 0 else [node_near(v)])
ref = E['RA'][0]
keep = np.ones(N, bool); keep[ref] = False
Kr = K[keep][:, keep].tocsr()
t = time.time(); ml = pyamg.smoothed_aggregation_solver(Kr, symmetry='symmetric'); print('AMG setup %.1fs' % (time.time() - t))

# SURFACEMAP=out.npz: by reciprocity, the heart-averaged lead vector of an electrode at any surface
# point equals the potential there produced by a uniform dipole density over the ventricles. Three
# solves (x, y, z) map it over the whole body surface (for choosing electrode positions).
if os.environ.get('SURFACEMAP'):
    tl = np.asarray(d.get('tlab') or [1] * (len(d['tissue']) // 3))
    vp = np.asarray(d['tissue'], float).reshape(-1, 3)[tl <= 2]
    vi = np.rint((vp - [xs[0], ys[0], zs[0]]) / H).astype(int)
    phis = []
    for ax in range(3):
        f = np.zeros(N); off = np.zeros(3, int); off[ax] = 1
        for sgn in (1, -1):
            q = vi + sgn * off; ok = np.all((q >= 0) & (q < [len(xs), len(ys), len(zs)]), axis=1)
            nid = idx[q[ok, 0], q[ok, 1], q[ok, 2]]; nid = nid[nid >= 0]
            np.add.at(f, nid, sgn / (2 * H))
        f -= f.mean()
        x = ml.solve(f[keep], tol=1e-9, accel='cg'); ph = np.zeros(N); ph[keep] = x; phis.append(ph)
    P3 = np.stack(phis, 1)
    sidx = idx[surf]; spos = np.stack([X[surf], Yg[surf], Z[surf]], 1)
    limb = {k: P3[np.asarray(E[k])].mean(0) for k in ('RA', 'LA', 'LL')}
    np.savez(os.environ['SURFACEMAP'], pos=spos, phi=P3[sidx], RA=limb['RA'], LA=limb['LA'], LL=limb['LL'], el=json.dumps(d['electrodes']))
    print('surface map saved', spos.shape); sys.exit(0)

# heart box (20 mm margin, covers hypertrophy) for the output
hp = np.vstack([np.asarray(d['tissue'], float).reshape(-1, 3), np.asarray(d['blood'], float).reshape(-1, 3)])
lo = np.floor((hp.min(0) - 20) / H) * H; hi = np.ceil((hp.max(0) + 20) / H) * H   # 20 mm: room for hypertrophied walls
bi = [(np.abs(xs - lo[0]).argmin(), np.abs(xs - hi[0]).argmin() + 1), (np.abs(ys - lo[1]).argmin(), np.abs(ys - hi[1]).argmin() + 1), (np.abs(zs - lo[2]).argmin(), np.abs(zs - hi[2]).argmin() + 1)]
res = {'version': 2, 'h': H, 'origin': [float(xs[bi[0][0]]), float(ys[bi[1][0]]), float(zs[bi[2][0]])],
       'dims': [int(bi[0][1] - bi[0][0]), int(bi[1][1] - bi[1][0]), int(bi[2][1] - bi[2][0])], 'ref': 'RA', 'sigma': SIG, 'psi': {}, 'scale': {}}
for name, node in E.items():
    if name == 'RA': continue
    f = np.zeros(N); f[node] += 1.0 / len(node); f[E['RA']] -= 1.0 / len(E['RA'])
    t = time.time(); x = ml.solve(f[keep], tol=1e-9, accel='cg'); psi = np.zeros(N); psi[keep] = x
    full = np.zeros(X.shape); full[inside] = psi[idx[inside]]
    box = full[bi[0][0]:bi[0][1], bi[1][0]:bi[1][1], bi[2][0]:bi[2][1]]
    box = box - box.mean()                       # gauge: only gradients matter
    s = float(np.abs(box).max()) / 32000.0
    res['psi'][name] = base64.b64encode(np.rint(box / s).astype(np.int16).ravel().tobytes()).decode()
    res['scale'][name] = s
    print('%-3s solved %.1fs  psi range %.3g' % (name, time.time() - t, np.ptp(box)))
json.dump(res, open(out, 'w'))
# Burger triangle (heart-averaged lead vectors over the myocardium)
def meangrad(name):
    a = np.frombuffer(base64.b64decode(res['psi'][name]), np.int16).astype(float).reshape(res['dims']) * res['scale'][name]
    gx, gy, gz = np.gradient(a, H)
    o = np.array(res['origin']); hp_ = np.asarray(d['tissue'], float).reshape(-1, 3)
    ii = np.clip(np.rint((hp_ - o) / H).astype(int), 0, np.array(res['dims']) - 1)
    return np.array([g[ii[:, 0], ii[:, 1], ii[:, 2]].mean() for g in (gx, gy, gz)])
LI, LII = meangrad('LA'), meangrad('LL'); LIII = LII - LI
for nm, v in (('I', LI), ('II', LII), ('III', LIII)):
    print('Burger %-3s len %.3g (×I %.2f) frontal angle %4d°' % (nm, np.linalg.norm(v), np.linalg.norm(v) / np.linalg.norm(LI), round(np.degrees(np.arctan2(-v[1], v[0])))))
print('wrote', out, 'box dims', res['dims'], 'origin', res['origin'])
