// Activation-time analysis of the last ventricular beat
const fs = require('fs'); const LH = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, params); const S = new LH.Sim(M, { seed: 1 });
S.run(+(process.env.RUN || 2150));
const vb = S.log.vent[S.log.vent.length - 1]; const t0 = vb.on;
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return p.map(x => s[Math.floor(x * (s.length - 1))].toFixed(0)); };
const groups = {};
const addg = (k, v) => (groups[k] = groups[k] || []).push(v);
for (let c = 0; c < M.nVox; c++) {
  if (M.kind[c] !== LH.KIND.VENT) continue;
  const ta = S.tAct[c] - t0; if (ta < -5) continue;
  const L = A.label[c] === 1 ? 'LV' : 'RV';
  addg(L, ta);
  addg(L + ' rho' + Math.min(4, Math.floor(A.rho[c] * 5)), ta);
  addg(L + ' z' + Math.min(4, Math.floor(Math.max(0, A.zuvc[c]) * 5)), ta);
}
for (const k of Object.keys(groups).sort()) console.log(k.padEnd(10), 'n', String(groups[k].length).padStart(5), ' p0/10/50/90/100', q(groups[k], [0, .1, .5, .9, 1]).join(' '));
// conduction system timing
const show = (name, ids) => console.log(name, ids.map(i => (S.tAct[i] - t0).toFixed(0)).join(','));
for (const [k, v] of Object.entries(M.csSegments)) show(k.padEnd(4), v);
const pl = M.purkLV.map(i => S.tAct[i] - t0), pr = M.purkRV.map(i => S.tAct[i] - t0);
console.log('purkLV', q(pl, [0, .1, .5, .9, 1]).join(' '), ' purkRV', q(pr, [0, .1, .5, .9, 1]).join(' '));
// latest voxels
let late = []; for (let c = 0; c < M.nVox; c++) if (M.kind[c] === LH.KIND.VENT) late.push([S.tAct[c] - t0, c]);
late.sort((a, b) => b[0] - a[0]);
for (const [t, c] of late.slice(0, 5)) console.log('late', t.toFixed(0), A.label[c], 'rho', A.rho[c].toFixed(2), 'z', A.zuvc[c].toFixed(2), 'phi', A.phi[c].toFixed(2), A.p(c).map(v => v.toFixed(0)));
