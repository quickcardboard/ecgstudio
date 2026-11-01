# Heart position vs (schematic) rib cage and chest electrodes, frontal and transverse views.
# node tools/heart_position_dump.js <engine dir> <params JSON> <dir>/live.json (and new.json); python3 tools/heart_position_plot.py <dir>
import json, sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Rectangle
S = sys.argv[1]
COL = {1: '#c0392b', 2: '#2e6fbd', 3: '#e3a3a3', 4: '#9ec3ea'}
NAME = {1: 'LV', 2: 'RV', 3: 'LA', 4: 'RA'}
def ribs(ax, el, a):
    ics4 = el['V1'][1]; ics5 = el['V4'][1]; d = ics4 - ics5
    xs = np.linspace(-a + 8, a - 8, 200)
    for k in range(-2, 4):              # rib 3 … rib 7 bands (schematic)
        yc = ics4 + d / 2 - k * d       # rib centre between intercostal spaces
        if k == -2: continue
        y = yc - 0.06 * np.abs(xs)
        ax.fill_between(xs[np.abs(xs) > 22], (y - 5)[np.abs(xs) > 22], (y + 5)[np.abs(xs) > 22], color='#d9cfc1', alpha=0.55, lw=0, zorder=1)
        ax.text(a - 6, y[-1] + 7, f'rib {k + 4}', fontsize=6, color='#8a7a66', ha='right', va='center')
    for nm, y in (('4th ICS', ics4), ('5th ICS', ics5)):
        ax.axhline(y, color='#8a7a66', lw=0.6, ls=':', zorder=1); ax.text(-a + 4, y + 2, nm, fontsize=6.5, color='#6b5d4c')
    ax.add_patch(Rectangle((-20, ics5 - 1.5 * d), 40, 170 - (ics5 - 1.5 * d), color='#cbbfae', alpha=0.6, lw=0, zorder=1))
    ax.text(0, 150, 'sternum', fontsize=6.5, ha='center', color='#6b5d4c')
def view(ax, D, front, title):
    pts = np.array(D['pts']); el = D['el']; a, b = D['torso']['a'], D['torso']['b']
    order = np.argsort(pts[:, 3] if front else -pts[:, 2])      # frontal: posterior first; transverse: superior first
    for L in (4, 3, 2, 1):
        m = pts[order][:, 0] == L; p = pts[order][m]
        ax.scatter(p[:, 1], p[:, 2] if front else p[:, 3], s=1.2, c=COL[L], alpha=0.35, lw=0, zorder=2, label=NAME[L])
    if front:
        ribs(ax, el, a)
        ax.axvline(-a, color='#555', lw=1); ax.axvline(a, color='#555', lw=1)
        ax.set_xlim(-a - 15, a + 15); ax.set_ylim(-110, 180); ax.set_ylabel('superior → (mm)')
    else:
        ax.add_patch(Ellipse((0, 0), 2 * a, 2 * b, fill=False, color='#555', lw=1))
        ax.add_patch(Rectangle((-20, b * np.sqrt(1 - (20 / a) ** 2) - 14), 40, 14, color='#cbbfae', alpha=0.8, lw=0))
        ax.set_xlim(-a - 15, a + 15); ax.set_ylim(-b - 15, b + 25); ax.set_ylabel('anterior → (mm)')
    for k in ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']:
        x, y, z = el[k]; yy = y if front else z
        ax.plot(x, yy, 'o', ms=7, mfc='white', mec='k', mew=1.3, zorder=5)
        ax.text(x, yy + (7 if front else 8), k, fontsize=8, weight='bold', ha='center', zorder=6)
    ap = D['apex']; ax.plot(ap[0], ap[1] if front else ap[2], 'x', color='k', ms=7, zorder=5); ax.text(ap[0] + 4, (ap[1] if front else ap[2]) - 9, 'apex', fontsize=7)
    ax.set_aspect('equal'); ax.set_xlabel("patient's left → (mm)"); ax.set_title(title, fontsize=9.5, loc='left')
    ax.grid(alpha=0.15)
live = json.load(open(S + '/live.json')); new = json.load(open(S + '/new.json'))
fig, axs = plt.subplots(2, 2, figsize=(12.5, 11), gridspec_kw={'width_ratios': [1, 1]})
def t(D, n): P = D['P']; return f"{n}: heart rotation {P['rot']:g}°, pitch {P['pitch']:g}°, yaw {P['yaw']:g}°, apex x {P['apexX']:g} mm, chest gap {P['gap']:g} mm"
view(axs[0, 0], live, True, 'LIVE — frontal view (from the front)'); view(axs[0, 1], live, False, 'LIVE — transverse view (from the feet; anterior up)')
view(axs[1, 0], new, True, 'NEW (cs-tune) — frontal view'); view(axs[1, 1], new, False, 'NEW (cs-tune) — transverse view')
axs[0, 0].legend(loc='lower left', fontsize=7, markerscale=6, frameon=False)
fig.text(0.01, 0.985, t(live, 'Live'), fontsize=8.5); fig.text(0.01, 0.497, t(new, 'New'), fontsize=8.5)
fig.text(0.01, 0.005, 'Ribs and sternum are schematic, placed from the electrode landmarks (V1/V2 in the 4th intercostal space, V4–V6 in the 5th); '
         'the electrical model has no ribs. Torso: elliptic cylinder 320 × 220 mm. Heart: CT-derived voxels (LV red, RV blue, atria pale).', fontsize=7.5, color='#444')
fig.tight_layout(rect=(0, 0.015, 1, 0.98)); fig.savefig(S + '/heart_position.png', dpi=120)
print('ok')
