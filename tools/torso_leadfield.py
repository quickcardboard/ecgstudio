"""
Limb-lead fields of a bounded, insulated, homogeneous torso (reciprocity).

For a lead between electrodes a and b, inject unit current at a and remove it
at b; the resulting potential psi gives the lead field L = grad(psi): the lead
voltage is V_ab = (1/sigma) * integral(L . J_i) dV. Its local direction and
length are the "lead vector" at each point of the heart. Burger's triangle is
the heart-averaged version of these vectors.

Torso: elliptic cylinder in the ECG Studio torso frame (mm; X left, Y up,
Z anterior), half-width 160, half-depth 110, from y=-360 (groin) to y=+220
(shoulders). Limb leads attach at the right/left shoulder and the left groin.

Output: JSON with the gradient fields of lead I (LA-RA) and lead II (LL-RA)
on a box around the heart, for tools/research and the engine's 'torso' option.
"""
import sys, json, base64, numpy as np
import scipy.sparse as sp, scipy.sparse.linalg as spl

H = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
out = sys.argv[1]
A, B, Y0, Y1 = 160.0, 110.0, -360.0, 220.0

xs = np.arange(-A, A + H / 2, H); ys = np.arange(Y0, Y1 + H / 2, H); zs = np.arange(-B, B + H / 2, H)
X, Yg, Z = np.meshgrid(xs, ys, zs, indexing='ij')
inside = (X / A) ** 2 + (Z / B) ** 2 <= 1.0
idx = -np.ones(inside.shape, dtype=np.int64); idx[inside] = np.arange(inside.sum())
N = int(inside.sum()); print('nodes', N)

# Finite-volume Laplacian with no-flux (insulated) boundary: only inside-inside links
rows, cols = [], []
for ax in range(3):
    sl_a = [slice(None)] * 3; sl_b = [slice(None)] * 3
    sl_a[ax] = slice(0, -1); sl_b[ax] = slice(1, None)
    a = idx[tuple(sl_a)]; b = idx[tuple(sl_b)]
    m = (a >= 0) & (b >= 0)
    rows.append(a[m]); cols.append(b[m])
r = np.concatenate(rows); c = np.concatenate(cols)
Lp = sp.coo_matrix((np.ones(len(r)), (r, c)), shape=(N, N)).tocsr()
Lp = Lp + Lp.T
deg = np.asarray(Lp.sum(1)).ravel()
K = sp.diags(deg) - Lp                 # graph Laplacian (conductance 1 per link)

def node_near(p):
    d = (X - p[0]) ** 2 + (Yg - p[1]) ** 2 + (Z - p[2]) ** 2
    d[~inside] = np.inf
    return int(idx[np.unravel_index(np.argmin(d), d.shape)])

# limb junctions on the torso surface
RA = node_near((-150, 200, 0)); LA = node_near((150, 200, 0)); LL = node_near((60, Y0, 0))

def solve(src, snk):
    f = np.zeros(N); f[src] = 1.0; f[snk] = -1.0
    # fix gauge by grounding one node
    g = snk
    keep = np.ones(N, bool); keep[g] = False
    Kr = K[keep][:, keep]; fr = f[keep]
    x, info = spl.cg(Kr, fr, rtol=1e-9, maxiter=20000)
    assert info == 0, info
    psi = np.zeros(N); psi[keep] = x
    full = np.full(inside.shape, np.nan); full[inside] = psi
    return full

fields = {}
for name, (s, t) in {'I': (LA, RA), 'II': (LL, RA)}.items():
    psi = solve(s, t)
    gx, gy, gz = np.gradient(psi, H, H, H)
    fields[name] = (gx, gy, gz)
    print('solved', name)

# box around the heart region (torso frame); the heart sits roughly at
# x -40..140, y -80..160, z -40..110 for the parameter ranges in use
bx = (xs >= -60) & (xs <= 160); by = (ys >= -100) & (ys <= 180); bz = (zs >= -60) & (zs <= 110)
sub = np.ix_(bx, by, bz)
res = {'h': H, 'origin': [float(xs[bx][0]), float(ys[by][0]), float(zs[bz][0])],
       'dims': [int(bx.sum()), int(by.sum()), int(bz.sum())]}
for name, (gx, gy, gz) in fields.items():
    v = np.stack([gx[sub], gy[sub], gz[sub]], -1).astype(np.float32)
    v = np.nan_to_num(v)
    res[name] = base64.b64encode(v.tobytes()).decode()
    m = v.reshape(-1, 3); m = m[np.linalg.norm(m, axis=1) > 0]
    mean = m.mean(0)
    print(name, 'mean lead vector (X left, Y up, Z ant):', mean.round(5), 'frontal angle',
          round(float(np.degrees(np.arctan2(-mean[1], mean[0]))), 1), 'length', round(float(np.linalg.norm(mean)), 5))
json.dump(res, open(out, 'w'))
