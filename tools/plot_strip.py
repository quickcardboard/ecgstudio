"""Rhythm strips (lead II and V1) on ECG paper: python3 plot_strip.py in.json out.png t0 dur title"""
import sys, json, numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
d = json.load(open(sys.argv[1])); L = dict(zip(d['leads'], [np.array(x) for x in d['data']]))
t0, dur, title = int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
fig, axs = plt.subplots(2, 1, figsize=(16, 4.6))
for ax, n in zip(axs, ['II', 'V1']):
    y = L[n][t0:t0 + dur]; ax.plot(np.arange(len(y)), y, 'k', lw=1)
    ax.set_xticks(np.arange(0, dur + 1, 200)); ax.set_xticks(np.arange(0, dur + 1, 40), minor=True)
    ax.set_yticks(np.arange(-2, 2.6, 0.5)); ax.set_yticks(np.arange(-2, 2.6, 0.1), minor=True)
    ax.grid(which='major', color='#f08080', lw=0.8); ax.grid(which='minor', color='#fbd0d0', lw=0.4)
    ax.set_ylim(-1.3, 1.8); ax.set_xlim(0, dur); ax.set_title(n, loc='left', fontsize=10); ax.tick_params(labelsize=6)
fig.suptitle(title, x=0.01, ha='left', fontsize=12)
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=60)
