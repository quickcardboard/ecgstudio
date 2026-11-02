// Lateral LV wall activation by height and layer (normal sinus beat): mean activation time of
// endocardium (tm < 0.2), mid-wall and epicardium (tm > 0.8) per apicobasal band and side, the share
// of endocardial cells activated directly by a Purkinje junction (within 1 ms of node time +
// pmjAntero), the Purkinje junction density, and the share of endocardial cells whose earliest
// neighbour lies lower (fed from below through the muscle).   node tools/lattime.js '{params}'
const fs = require('fs'); const LH = require('../src/engine.js');
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const P = JSON.parse(process.argv[2] || '{}'); const { lv = LH.hypertrophyOptions({}).anatomy.lvWallLayers, rv = 0, ...mp } = P;
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), n = M.nVox;
const S = new LH.Sim(M, { seed: 1 }); S.run(3000); const on = S.log.vent[S.log.vent.length - 1].on, t = (c) => S.tAct[c] - on;
const E = M.extraEdges, pmjT = new Map();
for (let q = 0; q < E.length; q += 3) { const a = E[q], b = E[q + 1]; if (a >= n && b < n && M.kind[b] === LH.KIND.VENT) pmjT.set(b, t(a) + M.P.pmjAntero); }
const ZB = [0.25, 0.4, 0.55, 0.7, 0.85, 1.01];
const side = (ph) => (ph >= 2.09 ? 'antero-lat' : ph <= -2.09 ? 'infero-lat' : null);
const G = {};
for (let c = 0; c < n; c++) {
  if (M.kind[c] !== LH.KIND.VENT || A.label[c] !== LH.LAB.LV) continue; const z = A.zuvc[c], sd = side(A.phi[c]); if (!sd || z < 0.25) continue;
  const tc = t(c); if (tc < -5 || tc > 200) continue;
  const zb = ZB.findIndex((v, i) => z >= v && z < ZB[i + 1]); const k = sd + ' ' + ZB[zb].toFixed(2); const g = G[k] || (G[k] = { endo: [0, 0], mid: [0, 0], epi: [0, 0], bt: 0, pmj: 0, below: 0, ne: 0 });
  const L = A.tm[c] < 0.2 ? 'endo' : A.tm[c] > 0.8 ? 'epi' : 'mid'; g[L][0] += tc; g[L][1]++;
  if (L !== 'endo') continue;
  g.ne++; if (pmjT.has(c)) { g.pmj++; if (Math.abs(tc - pmjT.get(c)) < 1) g.bt++; }
  // earliest face neighbour (myocardium) and whether it lies lower
  const i = A.ii[c], j = A.jj[c], kk = A.kk[c]; let best = -1, bt = 1e9;
  for (const [a, b, e] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const w = A.at(i + a, j + b, kk + e); if (w < 0 || M.kind[w] !== LH.KIND.VENT) continue; if (t(w) < bt) { bt = t(w); best = w; } }
  if (best >= 0 && bt < tc && !(pmjT.has(c) && Math.abs(tc - pmjT.get(c)) < 1) && A.zuvc[best] < z) g.below++;
}
const m = (x) => (x[1] ? (x[0] / x[1]).toFixed(0) : '-').padStart(5);
console.log('side        zuvc   endo   mid   epi | endo cells  PMJ/100 endo  breakthrough%  fed-from-below%');
for (const k of Object.keys(G).sort()) { const g = G[k]; console.log(k.padEnd(17) + m(g.endo) + ' ' + m(g.mid) + ' ' + m(g.epi) + ' |' + String(g.ne).padStart(8) + (100 * g.pmj / g.ne).toFixed(1).padStart(12) + (100 * g.bt / g.ne).toFixed(1).padStart(13) + (100 * g.below / g.ne).toFixed(0).padStart(14)); }
