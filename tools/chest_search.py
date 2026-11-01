"""
Chest electrode positions whose heart-averaged lead vectors best match Dower's,
from a SURFACEMAP produced by torso_v2.py (reciprocity).
  python3 tools/chest_search.py surfmap.npz [window_mm=35]
"""
import sys, json, numpy as np
m = np.load(sys.argv[1]); W = float(sys.argv[2]) if len(sys.argv) > 2 else 35
pos, phi = m['pos'], m['phi']; wct = (m['RA'] + m['LA'] + m['LL']) / 3
el = json.loads(str(m['el']))
DW = {'V1': [-0.515, 0.157, -0.917], 'V2': [0.044, 0.164, -1.387], 'V3': [0.882, 0.098, -1.277], 'V4': [1.213, 0.127, -0.601], 'V5': [1.125, 0.127, -0.086], 'V6': [0.831, 0.076, 0.230]}
toT = lambda d: np.array([d[0], -d[1], -d[2]])          # Dower (x left, y inferior, z posterior) -> torso frame
L = phi - wct                                            # lead vectors vs Wilson's terminal at every surface node
front = pos[:, 2] > -20                                  # anterior and lateral chest
def ang(a, b): return np.degrees(np.arccos(np.clip((a * b).sum(-1) / np.linalg.norm(a, axis=-1) / np.linalg.norm(b), -1, 1)))
def az(v): return np.degrees(np.arctan2(v[2], v[0]))
res = {}
for k, d in DW.items():
    t = toT(d); e = np.array(el[k])
    near = front & (np.linalg.norm(pos - e, axis=1) <= W)
    cur = np.argmin(np.linalg.norm(pos - e, axis=1))
    a = ang(L[near], t); j = np.flatnonzero(near)[np.argmin(a)]
    res[k] = pos[j].tolist()
    print('%s  now (%4.0f,%4.0f,%4.0f) off Dower %3.0f° (transverse %4.0f° vs %4.0f°)  ->  best within %d mm (%4.0f,%4.0f,%4.0f) off %3.0f° (transverse %4.0f°), moved %3.0f mm'
          % (k, *e, ang(L[cur], t), az(L[cur]), az(t), W, *pos[j], a.min(), az(L[j]), np.linalg.norm(pos[j] - e)))
print(json.dumps({k: [round(v[0]), round(v[1])] for k, v in res.items()}))
