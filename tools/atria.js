// Atrial activation sequence + P-wave dipole (diagnostic)
const fs = require('fs'); const LH = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, params); const S = new LH.Sim(M, { seed: 1 });
const vcg = []; S.onSample(() => vcg.push(Array.from(S.dipole)));
S.run(1000);
const ab = S.log.atrial[S.log.atrial.length - 1], t0 = ab.on;
const san = A.p(M.sanCell), lm = A.landmarks;
console.log('SAN at', san.map(v => v.toFixed(0)).join(','), ' SVC', lm.SVC.c.map(v => v.toFixed(0)).join(','));
const reg = {};
for (let c = 0; c < M.nVox; c++) {
  if (M.kind[c] !== LH.KIND.ATRIAL) continue;
  const p = A.p(c), lab = A.label[c] === 3 ? 'LA' : 'RA';
  const vert = p[1] > (lab === 'LA' ? 45 : 25) ? 'sup' : 'inf', lat = lab === 'LA' ? (p[0] > 0 ? 'lat' : 'sep') : (p[0] < -40 ? 'lat' : 'sep');
  (reg[lab + '-' + vert + '-' + lat] = reg[lab + '-' + vert + '-' + lat] || []).push(S.tAct[c] - t0);
}
for (const [k, v] of Object.entries(reg).sort()) { v.sort((a, b) => a - b); console.log(k.padEnd(12), 'p10/50/90', [0.1, 0.5, 0.9].map(q => v[Math.floor(q * v.length)].toFixed(0)).join('/'), 'n', v.length); }
for (let t = 0; t < 110; t += 10) { const d = vcg[Math.round(t0) + t]; console.log('P', t, d.map(x => x.toFixed(3)).join(','), 'frontal', (Math.atan2(-d[1], d[0]) * 180 / Math.PI).toFixed(0)); }
// RA vs LA contributions to the P vector (brute force, torso frame)
const R = M.rot, NE = M.NE;
const S2 = new LH.Sim(M, { seed: 1 }); S2.run(Math.round(t0));
const g = -S2.P.ecgGain * S2.P.dipoleGain;
for (let t = 10; t <= 90; t += 10) {
  while (S2.t < t0 + t) S2.step();
  const acc = { RA: [0, 0, 0], LA: [0, 0, 0] };
  for (let c = 0; c < M.nVox; c++) {
    if (M.kind[c] !== LH.KIND.ATRIAL) continue;
    const dv = S2.vm(c, S2.t) - S2.vRest[c]; if (!dv) continue;
    const a = acc[A.label[c] === 3 ? 'LA' : 'RA'];
    for (let d = 0; d < 3; d++) a[d] += M.W[c * NE + 9 + d] * dv * g;
  }
  console.log('t', t, 'RA', acc.RA.map(x => x.toFixed(3)).join(','), ' LA', acc.LA.map(x => x.toFixed(3)).join(','));
}
