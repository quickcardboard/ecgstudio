# seal one-voxel leaks between the chamber cavities and the outside in an anatomy.json (SSM variants at 2 mm)
import sys, json, base64, numpy as np
from scipy import ndimage as nd
p = sys.argv[1]; a = json.load(open(p)); dims = a['dims']; N = int(np.prod(dims))
dec = lambda k, t: np.frombuffer(base64.b64decode(a[k]), dtype=t)
idx = dec('index', np.uint32); lab = dec('label', np.uint8)
g = np.zeros(N, np.uint8); g[idx] = lab; g = g.reshape(dims)
tissue = g > 0
st6 = nd.generate_binary_structure(3, 1)
def outside_of(empty):   # empty voxels 6-connected to the grid boundary
    lb, n = nd.label(empty, st6); edge = set(np.unique(np.concatenate([lb[0].ravel(), lb[-1].ravel(), lb[:, 0].ravel(), lb[:, -1].ravel(), lb[:, :, 0].ravel(), lb[:, :, -1].ravel()]))) - {0}
    return np.isin(lb, list(edge))
naive = outside_of(~tissue)
far = ~nd.binary_dilation(tissue, structure=np.ones((3, 3, 3)))          # empty and not touching tissue (26-nbhd)
robust = nd.binary_dilation(outside_of(far), structure=np.ones((3, 3, 3))) & ~tissue
cavity = ~tissue & ~robust
plug = robust & nd.binary_dilation(cavity, structure=st6)                  # outside voxels touching a sealed cavity: the gaps
print('naive cavities', nd.label(~tissue & ~naive, st6)[1], '| sealed cavities', nd.label(cavity, st6)[1], '| plug voxels', int(plug.sum()))
add = np.flatnonzero(plug.ravel()).astype(np.uint32)
order = np.argsort(np.concatenate([idx, add]))
def merged(k, t, fill, w=1):
    old = dec(k, t).reshape(-1, w); new = np.full((len(add), w), fill, t)
    return base64.b64encode(np.ascontiguousarray(np.concatenate([old, new])[order]).tobytes()).decode()
a['index'] = base64.b64encode(np.concatenate([idx, add])[order].tobytes()).decode()
a['label'] = merged('label', np.uint8, 11)
for k in ('rho', 'z', 'phi'): a[k] = merged(k, np.int8, -127)
a['vside'] = merged('vside', np.int8, 0); a['fiber'] = merged('fiber', np.int8, 0, 3)
a['count'] = int(len(idx) + len(add))
json.dump(a, open(p, 'w'))
