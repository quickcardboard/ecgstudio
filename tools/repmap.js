// Activation (AT) and repolarisation (RT = AT + APD) times by region
const fs = require('fs'); const LH = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, params); const S = new LH.Sim(M, { seed: 1 });
S.run(1900);
const vb = S.log.vent[S.log.vent.length - 1]; const t0 = vb.on;
const g = {};
for (let c = 0; c < M.nVox; c++) {
  if (M.kind[c] !== LH.KIND.VENT) continue;
  const key = (A.label[c] === 2 ? 'RV' : (Math.abs(A.phi[c]) < 0.8 ? 'LVsep' : A.phi[c] > 2.2 || A.phi[c] < -2.2 ? 'LVlat' : A.phi[c] > 0 ? 'LVant' : 'LVinf')) + (A.tm[c] < 0.33 ? '-endo' : A.tm[c] < 0.66 ? '-mid ' : '-epi ');
  // use the beat that started at t0
  const at = S.tAct[c] - t0 > 400 ? null : S.tAct[c] - t0; if (at === null || at < -5) continue;
  (g[key] = g[key] || []).push([at, at + S.apd[c], S.apd[c]]);
}
const med = (a, i) => { const s = a.map(x => x[i]).sort((x, y) => x - y); return s[s.length >> 1].toFixed(0); };
for (const k of Object.keys(g).sort()) console.log(k.padEnd(12), 'AT', med(g[k], 0).padStart(4), ' APD', med(g[k], 2).padStart(4), ' RT', med(g[k], 1).padStart(4), ' n', g[k].length);
