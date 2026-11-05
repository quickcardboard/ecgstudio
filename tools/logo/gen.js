// Generates the ECG Studio logo concepts as SVG (node tools/logo/gen.js).
// Voxel heart on the app background; a travelling wavefront colours the voxels in the
// simulator's tissue states: green repolarising (behind), blue depolarised, bright blue
// front, pink resting (ahead).
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'icons', 'logo');
fs.mkdirSync(OUT, { recursive: true });

const PAL = {
  bg0: '#16222f', bg1: '#0b131a',
  rest: '#f4a3bd', restLo: '#c9728f',
  front: '#2f6bff', dep: '#7aa2ff',
  rep: '#2fcf8a',
  ecg: '#ffffff',
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const shade = (h, k) => toHex(hex(h).map((v) => (k > 0 ? v + (255 - v) * k : v * (1 + k))));

// Hand-drawn pixel hearts (X = voxel), keyed by width.
const MASKS = {
  13: ['..XXX...XXX..', '.XXXXX.XXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX',
       '.XXXXXXXXXXX.', '..XXXXXXXXX..', '...XXXXXXX...', '....XXXXX....', '.....XXX.....', '......X......'],
  9: ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'],
  7: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
};
function heartCells(n) {
  const m = MASKS[n], cells = [];
  m.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') cells.push({ i, j }); }));
  return { cells, w: m[0].length, h: m.length };
}
// Wave phase 0..1 for each cell: distance from a pacing site at the upper-left lobe
// (the sinus node sits in the right atrium, the viewer's upper left).
function phases(cells, src) {
  const r = cells.map((c) => Math.hypot(c.i - src[0], c.j - src[1]));
  const lo = Math.min(...r), hi = Math.max(...r);
  return r.map((v) => (v - lo) / (hi - lo));
}

// Tissue state along the wave: d = distance behind the front (in wave units).
function state(d) {
  if (d < 0) return PAL.rest;                       // resting, ahead of the front
  if (d < 0.11) return PAL.front;                   // the front itself
  if (d < 0.30) return PAL.dep;                     // depolarised
  if (d < 0.36) return mix(PAL.dep, PAL.rep, 0.5);
  return PAL.rep;                                   // repolarising, trailing
}

const bgRect = (S, r, id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${PAL.bg0}"/><stop offset="1" stop-color="${PAL.bg1}"/></linearGradient></defs>
  <rect width="${S}" height="${S}" rx="${r}" fill="url(#${id})"/>`;

// ---------- Concept A: flat voxel heart, curved wave from the sinus node, optional ECG trace ----------
const FRONT = 0.62;
function conceptA({ n = 13, ecg = true, bg = true, gap = 0.13, box = 344 } = {}) {
  const S = 512;
  const { cells, w: W, h: H } = heartCells(n);
  const cell = box / W, ox = (S - cell * W) / 2, oy = (S - cell * H) / 2 + 4;
  const ph = phases(cells, [-0.5, -0.8]);
  let s = '';
  cells.forEach((c, k) => {
    const col = state(FRONT - ph[k]);
    const g = cell * gap, x = ox + c.i * cell + g / 2, y = oy + c.j * cell + g / 2, w = cell - g;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${w.toFixed(1)}" rx="${(w * 0.2).toFixed(1)}" fill="${col}"/>`;
  });
  const d = 'M78 292 H176 l12 -18 l12 18 h14 l10 16 l24 -150 l26 196 l16 -62 h30 q24 -40 48 0 H434';
  const trace = ecg ? `<path d="${d}" fill="none" stroke="${PAL.bg1}" stroke-width="28" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${d}" fill="none" stroke="${PAL.ecg}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  return svg(S, (bg ? bgRect(S, 112, 'bgA') : '') + s + trace);
}

// ---------- Concept B: shallow voxel cubes; the wavefront is a raised crest ----------
function conceptB({ n = 13, bg = true, crest = 0.75 } = {}) {
  const S = 512;
  const { cells, w: W, h: H } = heartCells(n);
  const cell = 330 / W, ox = (S - cell * W) / 2 - 12, oy = (S - cell * H) / 2 + 22;
  const ph = phases(cells, [-0.5, -0.8]);
  const items = cells.map((c, k) => {
    const d = FRONT - ph[k];
    const h = 0.22 + crest * Math.exp(-Math.pow((d - 0.05) / 0.07, 2));
    return { ...c, col: state(d), h };
  });
  // depth points up-right: paint bottom rows first, and right-to-left within a row
  items.sort((a, b) => (b.j - a.j) || (b.i - a.i));
  let s = '';
  const g = cell * 0.1, w = cell - g;
  for (const it of items) {
    const x = ox + it.i * cell, y = oy + it.j * cell, e = it.h * cell * 0.7;
    const top = `M${x},${y}L${x + e},${y - e}L${x + w + e},${y - e}L${x + w},${y}Z`;
    const side = `M${x + w},${y}L${x + w + e},${y - e}L${x + w + e},${y + w - e}L${x + w},${y + w}Z`;
    s += `<path d="${top}" fill="${shade(it.col, 0.35)}"/><path d="${side}" fill="${shade(it.col, -0.32)}"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${w.toFixed(1)}" fill="${it.col}"/>`;
  }
  return svg(S, (bg ? bgRect(S, 112, 'bgB') : '') + s);
}

// ---------- Concept C: voxel tissue sheet, circular wave from a pacing site ----------
function conceptC({ n = 9, bg = true } = {}) {
  const S = 512, pad = 70, box = S - 2 * pad, cell = box / n;
  const cx = 1.2, cy = 1.4;                         // pacing site (grid units)
  const R = 6.2;                                    // current front radius
  let s = '';
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const r = Math.hypot(i - cx, j - cy);
    const d = (R - r) / 9;                          // behind the front, wave units
    const col = state(d);
    const gg = cell * 0.16, w = cell - gg;
    s += `<rect x="${(pad + i * cell + gg / 2).toFixed(1)}" y="${(pad + j * cell + gg / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${w.toFixed(1)}" rx="${(w * 0.2).toFixed(1)}" fill="${col}"/>`;
  }
  return svg(S, (bg ? bgRect(S, 112, 'bgC') : '') + s);
}

// Small-size variant (favicon 16–32 px): coarse 7-cell heart, no trace.
function favicon() { return conceptA({ n: 7, ecg: false, gap: 0.1, box: 400 }); }
function small() { return conceptA({ n: 9, ecg: false, gap: 0.12, box: 380 }); }

function svg(S, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">\n  ${body}\n</svg>\n`;
}

const out = {
  'concept-a-voxel-heart.svg': conceptA(),
  'concept-a-voxel-heart-plain.svg': conceptA({ ecg: false }),
  'concept-b-voxel-crest.svg': conceptB(),
  'concept-c-tissue-sheet.svg': conceptC(),
  'favicon-voxel-heart.svg': favicon(),
  'small-voxel-heart.svg': small(),
};
for (const [f, t] of Object.entries(out)) fs.writeFileSync(path.join(OUT, f), t);
console.log(Object.keys(out).map((f) => path.join('icons/logo', f)).join('\n'));
