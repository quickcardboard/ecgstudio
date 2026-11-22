# geometry screen of the Rodero SSM variants: RV vs LV position (frontal plane, after the engine's orientation), LV long axis
import sys, os, subprocess, numpy as np
D = sys.argv[1]; avg = np.load(f'{D}/avg.npz')
def body(v): return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)
rot, pitch, yaw = [float(x) for x in sys.argv[2:5]]
th = -np.radians(rot); ct, st = np.cos(th), np.sin(th); pa = np.radians(pitch); cp, sp = np.cos(pa), np.sin(pa); ya = np.radians(yaw); cy, sy = np.cos(ya), np.sin(ya)
Rz = np.array([[ct, -st, 0], [st, ct, 0], [0, 0, 1]]); Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]]); Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
Rm = Ry @ (Rz @ Rx)
def metrics(d):
    cells = d['cells']; ID = d['ID'].astype(int); Zu = d['Z']
    P = body(d['pts'].astype(np.float64))[cells]; cen = P.mean(1)
    vol = np.abs(np.einsum('ij,ij->i', P[:, 1] - P[:, 0], np.cross(P[:, 2] - P[:, 0], P[:, 3] - P[:, 0]))) / 6
    c = lambda m: (cen[m] * vol[m, None]).sum(0) / vol[m].sum()
    lv, rv = ID == 1, ID == 2
    d = Rm @ (c(rv) - c(lv))
    zt = Zu[cells].mean(1)
    ax = Rm @ (c(lv & (zt > 0.85)) - c(lv & (zt >= 0) & (zt < 0.12)))   # LV base - apex
    return dict(rvlv_frontal=np.degrees(np.arctan2(d[1], d[0])), rvlv_ant=d[2], rvlv_dist=np.linalg.norm(d), lv_axis_frontal=np.degrees(np.arctan2(-ax[1], -ax[0])), rv_lv_vol=vol[rv].sum() / vol[lv].sum())
def read_points(path):
    with open(path) as f:
        while True:
            t = f.readline().split()
            if t and t[0] == 'POINTS': n = int(t[1]); return np.fromfile(f, sep=' ', count=n * 3, dtype=np.float32).reshape(n, 3)
fmt = lambda name, m: print(f"{name:12s} RV−LV frontal {m['rvlv_frontal']:7.1f}°  anterior {m['rvlv_ant']:6.1f} mm  dist {m['rvlv_dist']:5.1f}  LV axis {m['lv_axis_frontal']:6.1f}°  RV/LV vol {m['rv_lv_vol']:.2f}", flush=True)
fmt('average', metrics(avg))
for name in sys.argv[5].split(','):
    tgz = f'{D}/{name}.tar.gz'
    for attempt in range(4):
        if subprocess.run(['curl', '-sS', '-m', '900', '-L', '-o', tgz, f'https://zenodo.org/records/4593739/files/{name}.tar.gz?download=1']).returncode == 0: break
        import time; time.sleep(10 * (attempt + 1))
    out = subprocess.run(['tar', '-xzf', tgz, '-C', D], capture_output=True); vtk = [f for f in os.listdir(D) if f.endswith('.vtk')]
    subprocess.run(['python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'parse_vtk.py'), f'{D}/{vtk[0]}', f'{D}/{name}.npz'], check=True)
    fmt(name, metrics(np.load(f'{D}/{name}.npz')))
    for f in vtk: os.remove(f'{D}/{f}')
    os.remove(tgz)
