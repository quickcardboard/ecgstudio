// Oracle: impose a delay field on the normal activation map and compute the limb leads exactly
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}');
const M = new LH.Model(A, P); const NE = M.NE, W = M.W;
const S = new LH.Sim(M, { seed: 1 }); S.run(1100);
const on = S.log.vent[S.log.vent.length - 1].on;
const LV = (c) => A.label[c] === 1;
function leads(delta) {
  const g = -S.P.ecgGain * S.P.dipoleGain, out = [];
  for (let t = on - 10; t < on + 160; t++) {
    let x = 0, y = 0;
    for (let c = 0; c < M.nVox; c++) {
      if (M.kind[c] !== 2) continue;
      const ta = S.tAct[c] + (delta ? delta(c) : 0), s = t - ta;
      if (s <= 0) continue;
      const up = s < 2 ? (s / 2) * (s / 2) * (3 - s) : 1;   // upstroke only: QRS window
      x += W[c * NE + 9] * up; y += W[c * NE + 10] * up;
    }
    out.push([x * g * 105, y * g * 105]);
  }
  const I = out.map((d) => d[0]), aVF = out.map((d) => -d[1]);
  const rs = (v) => [Math.max(...v), -Math.min(...v)];
  const a = (v) => v.reduce((p, q) => p + q, 0) - v[0] * v.length;
  const net = (v) => rs(v)[0] - rs(v)[1];
  return `area axis ${Math.round(Math.atan2(a(aVF), a(I)) * 180 / Math.PI)}  amp axis ${Math.round(Math.atan2(net(aVF), net(I)) * 180 / Math.PI)}  I ${rs(I).map(v => v.toFixed(2)).join('/')} aVF ${rs(aVF).map(v => v.toFixed(2)).join('/')}`;
}
console.log('normal                 ', leads(null));
// LAF territory: anterior + lateral walls above the apical cap
const inLAF = (c) => LV(c) && A.zuvc[c] > 0.25 && (A.phi[c] > 0.5 || A.phi[c] < -2.3);
const circ = (c) => { const p = A.phi[c]; return p > 0.5 ? (p - 0.5) / (Math.PI - 0.5) : 1 - (p + Math.PI) / (Math.PI - 2.3) * 0.3; };  // 0 at anteroseptal border .. 1 laterally
for (const dmax of [25, 35, 50]) {
  console.log(`LAFB sweep apex->base ${dmax}ms `, leads((c) => inLAF(c) ? dmax * Math.min(1, (A.zuvc[c] - 0.25) / 0.65) : 0));
  console.log(`LAFB sweep around+up ${dmax}ms  `, leads((c) => inLAF(c) ? dmax * Math.min(1, 0.5 * (A.zuvc[c] - 0.25) / 0.65 + 0.5 * circ(c)) : 0));
  console.log(`LAFB uniform ${dmax}ms          `, leads((c) => inLAF(c) ? dmax : 0));
}
const inLPF = (c) => LV(c) && A.phi[c] < 0.3 && A.phi[c] > -2.3;
for (const dmax of [25, 35, 50]) {
  console.log(`LPFB uniform ${dmax}ms          `, leads((c) => inLPF(c) ? dmax : 0));
  console.log(`LPFB sweep base->apex ${dmax}ms `, leads((c) => inLPF(c) ? dmax * Math.min(1, (1 - A.zuvc[c]) / 0.8) : 0));
}
