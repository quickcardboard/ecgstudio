// AVNRT induction with dual AV-node pathways: node tools/avnrt.js [rate]
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, JSON.parse(process.env.P || '{}'));
const rate = +(process.argv[2] || 72);
const pac = A.nearest(A.landmarks.SVC.c, (c) => A.label[c] === LH.LAB.RA);
const S0 = new LH.Sim(M, { seed: 1 }); S0.setRate(rate); S0.setDualAVN(true); S0.run(3000);
console.log('sinus PR with dual pathways', Math.round(S0.log.vent[S0.log.vent.length - 1].on - S0.log.atrial.filter((a) => a.on < S0.log.vent[S0.log.vent.length - 1].on).pop().on));
for (let ci = 200; ci <= Math.min(600, 60000 / rate - 80); ci += 20) {
  const S = new LH.Sim(M, { seed: 1 }); S.setRate(rate); S.setDualAVN(true); S.run(2600);
  const ref = S.log.atrial[S.log.atrial.length - 1].on; while (S.t < ref + ci) S.step();
  const r = S.stimulate(pac), t0 = S.t; S.run(4000);
  const V = S.log.vent.filter((v) => v.on > t0 - 5), rr = V.slice(1).map((v, i) => Math.round(v.on - V[i].on));
  const pr = (() => { const v = V[0], a = S.log.atrial.filter((x) => x.on < v.on - 20).pop(); return v && a ? Math.round(v.on - a.on) : null; })();
  console.log(ci, 'captured', r.captured, 'PR of premature beat', pr, 'beats', V.length, 'RR', rr.slice(0, 8).join(' '));
}
