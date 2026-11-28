# The ischaemic (purple) area in a screenshot of the simulator: its median pixel, for tools/promo_vf.js to click.
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); W, H = im.size; px = im.load()
xs, ys = [], []
for y in range(0, int(H * 0.6), 2):            # (the heart pane: the top of the phone layout)
    for x in range(0, W, 2):
        r, g, b = px[x, y]
        if b > 140 and r > 90 and b > r + 25 and g < r - 20: xs.append(x); ys.append(y)
if not xs: print('none'); sys.exit()
xs.sort(); ys.sort(); n = len(xs)
print(f'{xs[n // 2]} {ys[n // 2]} {n}')
