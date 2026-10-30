// AVRT induction: node tools/avrt.js [site] [mode atrial|ventricular] — sweeps the premature beat's coupling interval
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, JSON.parse(process.env.P || '{}'));
const site = process.argv[2] || 'left-lateral', mode = process.argv[3] || 'atrial', rate = +(process.argv[4] || 72);
const pick = mode === 'atrial' ? A.nearest(A.landmarks.LAA.c, (c) => A.label[c] === LAB_LA()) : mode === 'ra' ? A.nearest(A.landmarks.SVC.c, (c) => A.label[c] === LH.LAB.RA) : (() => { for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.zuvc[c] < 0.3 && A.epi[c]) return c; })();
function LAB_LA() { return LH.LAB.LA; }
for (let ci = 180; ci <= Math.min(420, 60000 / rate - 100); ci += 20) {
  const S = new LH.Sim(M, { seed: 1 }); S.setRate(rate); S.setAccessoryPathway(site); S.run(2600);
  const ref = mode !== 'ventricular' ? S.log.atrial[S.log.atrial.length - 1].on : S.log.vent[S.log.vent.length - 1].on;
  while (S.t < ref + ci) S.step();
  const r = S.stimulate(pick); const t0 = S.t; S.run(4000);
  const V = S.log.vent.filter((v) => v.on > t0 - 5);
  const rr = V.slice(1).map((v, i) => Math.round(v.on - V[i].on));
  const sinus = S.fireLog.filter((f) => f.name === 'sinus' && f.t > t0).length;
  console.log(mode, rate, ci, 'captured', r.captured, 'beats', V.length, 'RR', rr.slice(0, 10).join(' '), 'QRS', V.slice(0, 6).map((v) => Math.round(v.last - v.on)).join(' '));
}
