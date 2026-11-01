// Hypertrophy: node tools/hyper.js '[{"lv":6,"rv":0,"lvStrain":1}, ...]'
// Prints voltage criteria (Sokolow-Lyon, Cornell), axis, QRS, R/S in V1, T polarity in V1/V5/V6/I/aVL.
const fs = require('fs'); const LH = require('../src/engine.js');
const json = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const cfgs = JSON.parse(process.argv[2] || '[{}]');
for (const cf of cfgs) {
  const A = new LH.Anatomy(json, { lvWallLayers: cf.lv !== undefined ? cf.lv : 2, rvWallLayers: cf.rv || 0 });
  const M = new LH.Model(A, Object.assign({ ecgHighpass: 0 }, cf.P || {}));
  const S = new LH.Sim(M, { seed: 1 }); S.setRate(72);
  const rec = []; S.onSample((t, L) => rec.push(Array.from(L))); S.run(3600);
  const vb = S.log.vent[S.log.vent.length - 2], q0 = Math.floor(vb.on), j = Math.ceil(vb.last) + 6, base = rec[q0 - 12];
  const k = (n) => LH.LEADS.indexOf(n), mm = (n) => { let r = 0, s = 0; for (let t = q0; t < j; t++) { const v = rec[t][k(n)] - base[k(n)]; r = Math.max(r, v); s = Math.min(s, v); } return [r, -s]; };
  const T = (n) => { let tv = 0; for (let t = j + 60; t < j + 420; t++) { const v = rec[t][k(n)] - base[k(n)]; if (Math.abs(v) > Math.abs(tv)) tv = v; } return tv; };
  let aI = 0, aF = 0; for (let t = q0; t <= j; t++) { aI += rec[t][0] - base[0]; aF += rec[t][5] - base[5]; }
  const sok = mm('V1')[1] + Math.max(mm('V5')[0], mm('V6')[0]), corn = mm('aVL')[0] + mm('V3')[1];
  console.log(JSON.stringify(cf).padEnd(40), 'n', A.n, 'QRS', Math.round(vb.last - vb.on), 'axis', Math.round(Math.atan2(aF, aI) * 180 / Math.PI),
    'Sokolow', sok.toFixed(2), 'Cornell', corn.toFixed(2), 'V1 R/S', mm('V1').map((v) => v.toFixed(2)).join('/'), 'RaVR', mm('aVR')[0].toFixed(2),
    'T', ['I', 'aVL', 'V1', 'V2', 'V5', 'V6'].map((n) => n + ':' + T(n).toFixed(2)).join(' '), 'STV6', (rec[j + 40][k('V6')] - base[k('V6')]).toFixed(2));
}
