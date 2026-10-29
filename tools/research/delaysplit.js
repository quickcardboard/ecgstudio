// Decompose the simulated block-induced delay field's effect on the QRS area by region
const fs = require('fs'); const LH = require('../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync('../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}');
const M = new LH.Model(A, P);
const NE = M.NE, W = M.W, K = 1e4;
const acts = (blk) => { const S = new LH.Sim(M, { seed: 1 }); for (const c of blk) S.blocked[c] = 1; S.run(2150); const on = S.log.vent[S.log.vent.length - 1].on; return Float64Array.from(S.tAct, (t) => t - on); };
const n = acts([]);
{ let x = 0, y = 0; for (let c = 0; c < M.nVox; c++) { if (M.kind[c] !== 2) continue; x += W[c * NE + 9] * n[c] * K; y += W[c * NE + 10] * n[c] * K; } console.log('NORMAL QRS area (same units) X', x.toFixed(0), 'Y', y.toFixed(0), 'dir', Math.round(Math.atan2(-y, x) * 180 / Math.PI)); }
const region = (c) => A.label[c] === 2 ? 'RV' : A.label[c] !== 1 ? null : (Math.abs(A.phi[c]) < 0.6 ? 'LV septum' : A.phi[c] > 0.6 && A.phi[c] < 2.4 ? 'LV anterior/anterolat' : A.phi[c] < -0.6 && A.phi[c] > -2.4 ? 'LV inferior/inferolat' : 'LV lateral');
for (const [name, blk] of [['LAFB', M.csSegments.LAF.slice(0, 3)], ['LPFB', M.csSegments.LPF.slice(0, 3)]]) {
  const b = acts(blk), acc = {};
  for (let c = 0; c < M.nVox; c++) {
    const r = region(c); if (!r) continue; const d = b[c] - n[c];
    const a = acc[r] || (acc[r] = { x: 0, y: 0, d: 0, n: 0 });
    a.x += W[c * NE + 9] * d * K; a.y += W[c * NE + 10] * d * K; a.d += d; a.n++;
  }
  let tx = 0, ty = 0;
  console.log(name);
  for (const [r, a] of Object.entries(acc)) { tx += a.x; ty += a.y; console.log('  ', r.padEnd(24), 'mean delay', (a.d / a.n).toFixed(1).padStart(5), 'ms   area contribution X', a.x.toFixed(0).padStart(6), ' Y', a.y.toFixed(0).padStart(6)); }
  console.log('   TOTAL X', tx.toFixed(0), 'Y', ty.toFixed(0), 'dir', Math.round(Math.atan2(-ty, tx) * 180 / Math.PI));
}
