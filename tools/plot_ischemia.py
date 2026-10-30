import json, sys, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
d = json.load(open(sys.argv[1])); L = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6']
keys = list(d); occl = list(dict.fromkeys(k.split('@')[0] for k in keys))
for o in occl:
    ks = [k for k in keys if k.startswith(o + '@')]
    fig, ax = plt.subplots(len(ks), 12, figsize=(22, 2.0 * len(ks)), sharey=True)
    for r, k in enumerate(ks):
        for c in range(12):
            a = ax[r][c]; y = [row[c] for row in d[k]]
            a.plot(y, 'k', lw=0.8); a.axhline(0, color='r', lw=0.4); a.set_xticks([]); a.set_ylim(-2, 2.5)
            if r == 0: a.set_title(L[c])
            if c == 0: a.set_ylabel(k.split('@')[1] + ' h')
    fig.suptitle(o); fig.tight_layout(); fig.savefig(sys.argv[2] + '_' + o + '.png', dpi=60)
