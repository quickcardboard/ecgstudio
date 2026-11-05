// Isometric voxel renderer for the ECG Studio app icon (node tools/logo/iso.js).
// Voxels are unit cubes at integer (x, y, z), z up; the viewer looks from +x +y +z, so
// the visible faces are +z (top), +y (left) and +x (right). Faces hidden by a neighbour
// are dropped and the rest are painted back to front.
const fs = require('fs');
const path = require('path');
const G = require('./gen.js');
const OUT = path.join(__dirname, '..', '..', 'icons', 'logo');

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const proj = (x, y, z) => [(x - y) * C30, (x + y) * S30 - z];

// faces: corner lists (unit cube offsets) and shading
const FACES = {
  top: { n: [0, 0, 1], q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], k: 0.30 },
  left: { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], k: 0.0 },
  right: { n: [1, 0, 0], q: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]], k: -0.30 },
};

function render(vox, { S = 512, margin = 64, bg = true, radius = 112, edge = true, light = { top: 0.32, left: -0.32, right: 0 }, dy = 0 } = {}) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const occ = new Set(vox.map((v) => key(v.x, v.y, v.z)));
  // bounds
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of vox) for (const f of Object.values(FACES)) for (const q of f.q) {
    const [px, py] = proj(v.x + q[0], v.y + q[1], v.z + q[2]);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const sc = (S - 2 * margin) / Math.max(x1 - x0, y1 - y0);
  const ox = (S - (x1 - x0) * sc) / 2 - x0 * sc, oy = (S - (y1 - y0) * sc) / 2 - y0 * sc + dy;
  const P = (x, y, z) => { const [a, b] = proj(x, y, z); return `${(ox + a * sc).toFixed(1)},${(oy + b * sc).toFixed(1)}`; };
  const order = [...vox].sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z) || a.z - b.z);
  let s = '';
  for (const v of order) {
    for (const [name, f] of Object.entries(FACES)) {
      if (occ.has(key(v.x + f.n[0], v.y + f.n[1], v.z + f.n[2]))) continue;
      const col = G.shade(v.col, light[name]);
      const pts = f.q.map((q) => P(v.x + q[0], v.y + q[1], v.z + q[2])).join(' ');
      s += `<polygon points="${pts}" fill="${col}"${edge ? ` stroke="${G.shade(v.col, -0.45)}" stroke-width="${(sc * 0.05).toFixed(2)}" stroke-linejoin="round"` : ''}/>`;
    }
  }
  return G.svg(S, (bg ? G.bgRect(S, radius, 'bgI') : '') + s);
}

// Heart cells with their tissue colour and crest height (0..1, peaking at the front).
function heart(n = 13, front = G.FRONT, src = [-0.5, -0.8], width = 0.07) {
  const { cells, w, h } = G.heartCells(n);
  const ph = G.phases(cells, src);
  return {
    w, h, cells: cells.map((c, k) => {
      const d = front - ph[k];
      return { ...c, col: G.state(d), crest: Math.exp(-Math.pow((d - 0.05) / width, 2)) };
    }),
  };
}

// D1: heart standing upright (in the x–z plane), a slab `depth` voxels thick; the front
// pushes out toward the viewer by up to `rise` voxels.
function upright({ depth = 2, rise = 2, ...o } = {}) {
  const H = heart(o.n, o.front);
  const vox = [];
  for (const c of H.cells) {
    const extra = Math.round(c.crest * rise);
    for (let y = 0; y < depth + extra; y++) vox.push({ x: c.i, y, z: H.h - 1 - c.j, col: c.col });
  }
  return render(vox, o);
}

// D2: heart standing upright on the other face (y–z plane), so it leans the other way.
function uprightR({ depth = 2, rise = 2, ...o } = {}) {
  const H = heart(o.n, o.front);
  const vox = [];
  for (const c of H.cells) {
    const extra = Math.round(c.crest * rise);
    for (let x = 0; x < depth + extra; x++) vox.push({ x, y: H.w - 1 - c.i, z: H.h - 1 - c.j, col: c.col });
  }
  return render(vox, o);
}

// D3: heart lying flat as a height field; the front is a wave of taller columns.
function flat({ base = 1, rise = 3, ...o } = {}) {
  const H = heart(o.n, o.front, undefined, 0.09);
  const vox = [];
  for (const c of H.cells) {
    const hgt = base + Math.round(c.crest * rise);
    for (let z = 0; z < hgt; z++) vox.push({ x: c.i, y: c.j, z, col: c.col });
  }
  return render(vox, o);
}

// D4: heart-shaped field of voxel columns on the floor. Which floor cells belong to the heart
// is decided in screen space, so the silhouette reads as an upright heart in the isometric
// view; the wavefront spreads from the upper-left lobe as a crest of taller columns.
function field({ R = 9, base = 1, rise = 2, front = 0.6, width = 0.075, src = [-0.95, 0.75], ...o } = {}) {
  const vox = [];
  const heartF = (u, v) => Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v;
  const cells = [];
  for (let x = -R * 2; x <= R * 2; x++) for (let y = -R * 2; y <= R * 2; y++) {
    const [sx, sy] = proj(x + 0.5, y + 0.5, 0);
    const u = sx / (R * 0.95), v = -sy / (R * 0.95) * 1.0 + 0.15;   // floor cell centre in heart units
    if (heartF(u * 1.0, v) <= 0) cells.push({ x, y, u, v });
  }
  const r = cells.map((c) => Math.hypot(c.u - src[0], c.v - src[1]));
  const lo = Math.min(...r), hi = Math.max(...r);
  for (const [k, c] of cells.entries()) {
    const d = front - (r[k] - lo) / (hi - lo);
    const crest = Math.exp(-Math.pow((d - 0.05) / width, 2));
    const col = G.state(d);
    const h = base + Math.round(crest * rise);
    for (let z = 0; z < h; z++) vox.push({ x: c.x, y: c.y, z, col });
  }
  return render(vox, o);
}

// The chosen mark: the 9-wide upright heart (D2), the front raised one voxel.
const MARK = { n: 9, depth: 2, rise: 1 };
const out = {
  // concepts kept for reference
  'iso-field-r9.svg': field({ R: 9 }),
  'iso-upright-13.svg': uprightR({ depth: 2, rise: 2 }),
  // final: header/favicon (no background, no outlines: outlines blur below ~64 px)
  'logo.svg': uprightR({ ...MARK, edge: false, bg: false, margin: 6 }),
  // app icon (rounded tile), and full-bleed tiles for platforms that round the corners themselves
  'app-icon.svg': uprightR({ ...MARK }),
  'app-icon-square.svg': uprightR({ ...MARK, radius: 0, margin: 72 }),
  // maskable / adaptive: artwork inside the central safe circle (80 % of the tile)
  'app-icon-maskable.svg': uprightR({ ...MARK, radius: 0, margin: 118 }),
};
for (const [f, t] of Object.entries(out)) fs.writeFileSync(path.join(OUT, f), t);
if (require.main === module) console.log(Object.keys(out).join('\n'));
module.exports = { render, heart };
