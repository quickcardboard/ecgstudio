"""
Torso v2: inhomogeneous volume conductor for all ECG electrodes (reciprocity).

For each electrode e (LA, LL, V1..V6) a unit current is injected at e and
removed at RA; the resulting potential psi_e is the lead field potential: a
cardiac current source J_i at r adds (1/sigma) J_i . grad(psi_e)(r) to
V_e - V_RA. One computation gives every limb, augmented and chest lead with
the same physics (Wilson's terminal is formed from LA/LL/RA downstream).

Conductor (torso frame, mm; X left, Y up, Z anterior): elliptic cylinder
(half-width 160, half-depth 110, y -360..220) with
  torso 0.22 S/m, lungs 0.05 S/m, cavity blood 0.65 S/m, myocardium 0.20 S/m.
Lungs: two ellipsoids beside and behind the heart; heart tissue and blood
(from tools/export_heart_torso.js) override them.

  python3 tools/torso_v2.py heart_torso.json out.json [h=4]
Output: psi for each electrode on a box around the heart (int16, per-lead
scale), for the engine's forward model v2.
"""
import os, sys, json, base64, time, numpy as np
import scipy.sparse as sp, pyamg

src, out = sys.argv[1], sys.argv[2]
H = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
d = json.load(open(src))
A, B = float(d['torso']['a']), float(d['torso']['b'])   # chest cross-section from the engine
Y0, Y1 = float(os.environ.get('TORSO_Y0', -360)), float(os.environ.get('TORSO_Y1', 220))   # trunk bottom (pelvis) / top (mm, heart frame)
SIG = dict(torso=0.22, lung=0.05, blood=0.65, heart=0.20)
SIG.update(json.loads(os.environ.get('SIGMA', '{}') or '{}'))   # SIGMA='{"lung":0.08}' overrides

# LIMBS=1: add arms hanging at the sides (joined to the trunk only at the
# shoulder/axilla) and legs below the pelvis, with RA/LA on the wrists and LL on
# the left foot, instead of contact patches on the trunk.
LIMBS = bool(os.environ.get('LIMBS'))
XA, YB = (265.0, -1100.0) if LIMBS else (A, Y0)
xs = np.arange(-XA, XA + H / 2, H); ys = np.arange(YB, Y1 + H / 2, H); zs = np.arange(-B, B + H / 2, H)
X, Yg, Z = np.meshgrid(xs, ys, zs, indexing='ij')
inside = ((X / A) ** 2 + (Z / B) ** 2 <= 1.0) & (Yg >= Y0)
if LIMBS:
    for sx in (-1, 1):
        inside |= ((X - sx * 215) ** 2 + Z ** 2 <= 40 ** 2) & (Yg >= -320) & (Yg <= 185)                      # arm
        inside |= ((X - sx * 185) / 50) ** 2 + ((Yg - 160) / 45) ** 2 + (Z / 50) ** 2 <= 1.0                  # shoulder/axilla
        inside |= ((X - sx * 85) ** 2 + Z ** 2 <= 70 ** 2) & (Yg <= Y0 + 20)                                   # leg
sig = np.full(X.shape, SIG['torso'])

def ellipsoid(c, r):
    return ((X - c[0]) / r[0]) ** 2 + ((Yg - c[1]) / r[1]) ** 2 + ((Z - c[2]) / r[2]) ** 2 <= 1.0
lungs = ellipsoid((-78, 55, -15), (62, 125, 80)) | ellipsoid((108, 55, -30), (50, 120, 72))
sig[lungs] = SIG['lung']
# ORGANS=1: liver under the right hemidiaphragm (its left lobe under the heart)
# and the vertebral column; both conduct poorly (liver ~0.05, bone ~0.02 S/m)
if os.environ.get('ORGANS'):
    SIG.setdefault('liver', 0.05); SIG.setdefault('bone', 0.02)
    liver = ellipsoid((-45, -125, 5), (125, 60, 95))
    sig[liver & ~lungs] = SIG['liver']
    sig[(X ** 2 + (Z + 88) ** 2 <= 22 ** 2) & (Yg >= Y0)] = SIG['bone']

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
    s1 = sig[tuple(sa)][m]; s2 = sig[tuple(sb)][m]
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
    'RA': {'c': [-A, 100, -20], 'r': 70}, 'LA': {'c': [A, 100, -20], 'r': 70}, 'LL': {'c': [100, -300, 0], 'r': 70}}
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
