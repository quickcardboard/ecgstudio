const G = require('./logo/gen.js');
const ease = (u) => u * u * (3 - 2 * u);
// The animated ECG Studio logo for the promo videos (tools/promo_store.js, tools/promo_vf.js).
// The logo animation: the mark's voxels (tools/logo/iso.js: the 9-wide upright heart, 2 deep, the wavefront raised one
// voxel) drop in, then the activation wave sweeps across them to the logo's own frame; the name and tagline follow.
const C30 = Math.cos(Math.PI / 6), proj = (x, y, z) => [(x - y) * C30, (x + y) * 0.5 - z];
const FACES = {
  top: { n: [0, 0, 1], q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], k: 0.32 },
  left: { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], k: -0.32 },
  right: { n: [1, 0, 0], q: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]], k: 0 },
};
const H9 = G.heartCells(9), PH = G.phases(H9.cells, [-0.5, -0.8]);
function logoSvg(lt, S = 420) {   // lt: seconds into the logo animation
  const front = lt < 0.75 ? -0.3 : Math.min(G.FRONT, -0.3 + (G.FRONT + 0.3) * ease(Math.min(1, (lt - 0.75) / 0.7)));
  const vox = [];
  H9.cells.forEach((c, k) => {
    const d = front - PH[k], col = G.state(d), crest = Math.exp(-Math.pow((d - 0.05) / 0.07, 2));
    const depth = 2 + Math.round(crest * 1), delay = 0.05 + (c.j * 0.05 + c.i * 0.025), u = (lt - delay) / 0.4;
    if (u <= 0) return;
    const fall = 9 * Math.pow(1 - Math.min(1, u), 3);   // (eased drop from above)
    for (let x = 0; x < depth; x++) vox.push({ x, y: H9.w - 1 - c.i, z: H9.h - 1 - c.j + fall, col, a: Math.min(1, u * 3) });
  });
  // fixed framing: the bounds of the finished mark
  const all = []; H9.cells.forEach((c) => { for (let x = 0; x < 3; x++) all.push({ x, y: H9.w - 1 - c.i, z: H9.h - 1 - c.j }); });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of all) for (const f of Object.values(FACES)) for (const q of f.q) { const [a, b] = proj(v.x + q[0], v.y + q[1], v.z + q[2]); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  const sc = (S - 12) / Math.max(x1 - x0, y1 - y0), ox = (S - (x1 - x0) * sc) / 2 - x0 * sc, oy = (S - (y1 - y0) * sc) / 2 - y0 * sc;
  const P = (x, y, z) => { const [a, b] = proj(x, y, z); return `${(ox + a * sc).toFixed(1)},${(oy + b * sc).toFixed(1)}`; };
  const occ = new Set(vox.filter((v) => v.z % 1 === 0).map((v) => `${v.x},${v.y},${v.z}`));
  let s = '';
  for (const v of [...vox].sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z) || a.z - b.z)) {
    for (const f of Object.values(FACES)) {
      if (v.z % 1 === 0 && occ.has(`${v.x + f.n[0]},${v.y + f.n[1]},${v.z + f.n[2]}`)) continue;
      s += `<polygon points="${f.q.map((q) => P(v.x + q[0], v.y + q[1], v.z + q[2])).join(' ')}" fill="${G.shade(v.col, f.k)}" fill-opacity="${v.a.toFixed(2)}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${s}</svg>`;
}
module.exports = { logoSvg, ease };
