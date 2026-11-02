// Early QRS samples (every 5 ms from onset) in chosen leads, normal vs old infarct, with the
// checker's Q/QS measures.   [MLAD_F=0.3] node tools/earlyqrs.js '{params}' site [leads]
const fs = require('fs'); const LH = require('../src/engine.js');
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const P = JSON.parse(process.argv[2] || '{}'), SITE = process.argv[3] || 'mLAD', SH = (process.argv[4] || 'V1,V2,V3,V4,II,III').split(',');
const { lv = 3, rv = 0, ...mp } = P;
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), br = M.coronary.branches;
const SITES = { pLAD: br.LAD[0], mLAD: br.LAD[Math.round(br.LAD.length * +(process.env.MLAD_F || 0.3))], dLAD: br.LAD[Math.round(br.LAD.length * 0.45)] };
function beat(occ) { const S = new LH.Sim(M, { seed: 1 }); if (occ) { S.addOcclusion(occ); S.setIschemiaTime(720); } const rec = []; S.onSample((t, v) => rec.push(Array.from(v))); S.run(3600);
  const vb = S.log.vent[S.log.vent.length - 2], q0 = Math.floor(vb.on), b0 = rec[q0 - 15]; return (k, t) => rec[q0 + t][k] - b0[k]; }
const n = beat(null), i = beat(SITES[SITE]);
console.log('ms     ' + SH.map((s) => (s + ' norm/inf').padStart(16)).join(''));
for (let t = 0; t <= 60; t += 5) console.log(String(t).padEnd(7) + SH.map((s) => { const k = LH.LEADS.indexOf(s); return (n(k, t).toFixed(2) + '/' + i(k, t).toFixed(2)).padStart(16); }).join(''));
