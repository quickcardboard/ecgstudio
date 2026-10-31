"""Plot a ECG Studio ECG dump (from tools/sim.js) on standard ECG paper."""
import sys, json, numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
d = json.load(open(sys.argv[1])); out = sys.argv[2]
t0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0
dur = float(sys.argv[4]) if len(sys.argv) > 4 else 2500
lead = dict(zip(d['leads'], [np.array(x) for x in d['data']]))
names = d['leads']
fig, axs = plt.subplots(3, 4, figsize=(20, 9))
for i, nm in enumerate(names):
    ax = axs[i % 3][i // 3]
    y = lead[nm][int(t0):int(t0 + dur)]
    t = np.arange(len(y))
    ax.plot(t, y, 'k', lw=1)
    ax.set_xticks(np.arange(0, dur + 1, 200)); ax.set_xticks(np.arange(0, dur + 1, 40), minor=True)
    ax.set_yticks(np.arange(-2, 2.6, 0.5)); ax.set_yticks(np.arange(-2, 2.6, 0.1), minor=True)
    ax.grid(which='major', color='#f08080', lw=0.8); ax.grid(which='minor', color='#fbd0d0', lw=0.4)
    ax.set_ylim(-1.5, 2.0); ax.set_xlim(0, dur)
    ax.set_title(nm, loc='left', fontsize=11); ax.tick_params(labelsize=6)
plt.tight_layout(); plt.savefig(out, dpi=60)
