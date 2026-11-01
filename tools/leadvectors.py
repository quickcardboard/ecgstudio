"""
Heart-averaged lead vectors of a forward-model-2 field, compared with Dower's
lead vectors (Frank torso model; Dower 1980, rows I, II, V1..V6 for X left,
Y inferior, Z posterior). The forward matrix below reproduces the published
inverse Dower transform (Edenbrandt & Pahlm 1988) as its pseudo-inverse.

  python3 tools/leadvectors.py heart_torso.json torso_v2.json
"""
import sys, json, base64, numpy as np
DOWER = {'I': [0.632, -0.235, 0.059], 'II': [0.235, 1.066, -0.132], 'V1': [-0.515, 0.157, -0.917], 'V2': [0.044, 0.164, -1.387],
         'V3': [0.882, 0.098, -1.277], 'V4': [1.213, 0.127, -0.601], 'V5': [1.125, 0.127, -0.086], 'V6': [0.831, 0.076, 0.230]}
def lead_vectors(ht, tv, sel=None):
    o = np.array(tv['origin']); H = tv['h']; dims = tv['dims']
    pts = np.asarray(ht['tissue'], float).reshape(-1, 3)
    ii = np.clip(np.rint((pts - o) / H).astype(int), 1, np.array(dims) - 2)
    if sel is None and 'tlab' in ht: sel = np.asarray(ht['tlab']) <= 2       # ventricles (the QRS sources)
    if sel is not None: ii = ii[sel]
    G = {}
    for k in tv['psi']:
        a = np.frombuffer(base64.b64decode(tv['psi'][k]), np.int16).astype(float).reshape(dims) * tv['scale'][k]
        g = np.gradient(a, H)
        G[k] = np.array([gg[ii[:, 0], ii[:, 1], ii[:, 2]].mean() for gg in g])
    G['RA'] = np.zeros(3)
    wct = (G['RA'] + G['LA'] + G['LL']) / 3
    L = {'I': G['LA'], 'II': G['LL']}
    for k in ('V1', 'V2', 'V3', 'V4', 'V5', 'V6'): L[k] = G[k] - wct
    return {k: v * np.array([1, -1, -1]) for k, v in L.items()}    # Dower convention
def compare(L):
    names = list(DOWER); D = np.array([DOWER[k] for k in names]); M = np.array([L[k] for k in names])
    s = (M * D).sum() / (M * M).sum()                     # best single gain (one gain for all leads)
    out = []
    for k, m, d in zip(names, M * s, D):
        ang = np.degrees(np.arccos(np.clip(m @ d / np.linalg.norm(m) / np.linalg.norm(d), -1, 1)))
        out.append((k, m, d, ang, np.linalg.norm(m) / np.linalg.norm(d)))
    return s, out
if __name__ == '__main__':
    ht = json.load(open(sys.argv[1])); tv = json.load(open(sys.argv[2]))
    s, out = compare(lead_vectors(ht, tv))
    tot = 0
    for k, m, d, ang, r in out:
        tot += ang
        print('%-3s model %6.2f %6.2f %6.2f   Dower %6.2f %6.2f %6.2f   angle off %3d°  length ×%.2f' % (k, *m, *d, ang, r))
    print('mean angle error %.1f°' % (tot / len(out)))
