// Purkinje breakthroughs per LV region (normal sinus beat): junctions whose muscle cell is activated
// by the Purkinje node (within 1 ms of node time + pmjAntero), their mean time from QRS onset, and the
// endocardial activation time of the region by apicobasal band.   node tools/purkbreak.js '{params}'
const fs = require('fs'); const LH = require('../src/engine.js');
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const P = JSON.parse(process.argv[2] || '{}'); const { lv = 3, rv = 0, ...mp } = P;
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), n = M.nVox;
const RN = ['sept', 'ant', 'lat', 'lat', 'inf', 'sept'];
const region = (c) => { if (A.label[c] === LH.LAB.RV) return 'rv'; if (A.label[c] !== LH.LAB.LV || A.zuvc[c] < 0) return null; if (A.zuvc[c] < 0.25) return 'apex'; const d = ((A.phi[c] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return RN[Math.min(5, Math.floor(d / (Math.PI / 3)))]; };
const S = new LH.Sim(M, { seed: 1 }); S.run(3000); const on = S.log.vent[S.log.vent.length - 1].on, t = (c) => S.tAct[c] - on;
const E = M.extraEdges, pmj = {}, endo = {};
for (let q = 0; q < E.length; q += 3) {
  const a = E[q], b = E[q + 1]; if (a < n || b >= n || M.kind[b] !== LH.KIND.VENT) continue;   // Purkinje node -> muscle
  const r = region(b); if (!r) continue; const g = pmj[r] || (pmj[r] = { n: 0, bt: 0, tb: 0 });
  g.n++; if (Math.abs(t(b) - (t(a) + M.P.pmjAntero)) < 1.0) { g.bt++; g.tb += t(b); }
}
for (let c = 0; c < n; c++) { if (M.kind[c] !== LH.KIND.VENT || A.tm[c] > 0.2) continue; const r = region(c); if (!r || t(c) < -5 || t(c) > 200) continue;
  const band = Math.min(3, Math.floor(A.zuvc[c] / 0.25)); const k = r + ' z' + (band * 0.25).toFixed(2); const g = endo[k] || (endo[k] = { n: 0, s: 0, mn: 1e9 }); g.n++; g.s += t(c); g.mn = Math.min(g.mn, t(c)); }
console.log('region   junctions  breakthroughs  mean breakthrough time (ms)');
for (const [r, g] of Object.entries(pmj)) console.log(r.padEnd(8) + String(g.n).padStart(8) + String(g.bt).padStart(12) + '   ' + (g.bt ? (g.tb / g.bt).toFixed(1) : '-'));
console.log('\nendocardium (tm<0.2) activation by region and apicobasal band: mean / earliest ms');
for (const k of Object.keys(endo).sort()) console.log(k.padEnd(14) + (endo[k].s / endo[k].n).toFixed(0).padStart(5) + ' /' + endo[k].mn.toFixed(0).padStart(4) + '  (' + endo[k].n + ' cells)');
