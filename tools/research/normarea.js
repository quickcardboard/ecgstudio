// Normal QRS area vector (Σ W·t_act, torso frame) split by region, for several parameter sets
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const region = (c) => A.label[c] === 2 ? 'RV' : (Math.abs(A.phi[c]) < 0.6 ? 'LVsept' : A.zuvc[c] > 0.75 ? 'LVbase' : A.zuvc[c] < 0.3 ? 'LVapex' : A.phi[c] > 0 ? 'LVant' : A.phi[c] < -2.4 ? 'LVlat' : 'LVinf');
for (const p of JSON.parse(process.argv[2])) {
  const M = new LH.Model(A, p); const NE = M.NE, W = M.W, K = 1e4;
  const S = new LH.Sim(M, { seed: 1 }); S.run(1100); const on = S.log.vent[S.log.vent.length - 1].on;
  const acc = {}; let X = 0, Y = 0;
  // reference time = mean activation so the split is translation-invariant per region pair
  for (let c = 0; c < M.nVox; c++) {
    if (M.kind[c] !== 2) continue; const t = S.tAct[c] - on, r = region(c);
    const a = acc[r] || (acc[r] = [0, 0]); a[0] += W[c * NE + 9] * t * K; a[1] += W[c * NE + 10] * t * K;
  }
  for (const a of Object.values(acc)) { X += a[0]; Y += a[1]; }
  console.log(JSON.stringify(p), '\n  TOTAL', X.toFixed(0), Y.toFixed(0), 'axis', Math.round(Math.atan2(-Y, X) * 180 / Math.PI), '|', Object.entries(acc).map(([k, v]) => `${k} ${v[0].toFixed(0)},${v[1].toFixed(0)}`).join('  '));
}
