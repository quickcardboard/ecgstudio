// Orientation scan with oracle delays: which heart positions allow sinus + LAFB + LPFB axes?
const fs = require('fs'); const LH = require('../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync('../../src/anatomy.json')));
const base = JSON.parse(process.argv[2] || '{}');
// activation map is orientation-independent: compute once
const M0 = new LH.Model(A, base); const S = new LH.Sim(M0, { seed: 1 }); S.run(1100);
const on = S.log.vent[S.log.vent.length - 1].on, tAct = Float64Array.from(S.tAct);
const LV = (c) => A.label[c] === 1;
const inLAF = (c) => LV(c) && A.zuvc[c] > 0.25 && (A.phi[c] > 0.5 || A.phi[c] < -2.3);
const inLPF = (c) => LV(c) && A.phi[c] < 0.3 && A.phi[c] > -2.3;
const vent = []; for (let c = 0; c < M0.nVox; c++) if (M0.kind[c] === 2) vent.push(c);
function axes(M, delta) {
  const NE = M.NE, W = M.W, I = [], F = [];
  for (let t = on - 10; t < on + 160; t += 2) {
    let x = 0, y = 0;
    for (const c of vent) { const s = t - tAct[c] - (delta ? delta(c) : 0); if (s <= 0) continue; const up = s < 2 ? (s / 2) * (s / 2) * (3 - s) : 1; x += W[c * NE + 9] * up; y += W[c * NE + 10] * up; }
    I.push(-x); F.push(y);    // sign: lead ∝ −ΣW·Vm
  }
  const net = (v) => Math.max(...v) + Math.min(...v);
  const area = (v) => v.reduce((p, q) => p + q, 0);
  return [Math.round(Math.atan2(net(F), net(I)) * 180 / Math.PI), Math.round(Math.atan2(area(F), area(I)) * 180 / Math.PI)];
}
const res = [];
for (const rot of [-20, -10, 0, 10, 20, 30]) for (const pitch of [-40, -20, 0, 20, 40, 60]) {
  const M = new LH.Model(A, Object.assign({}, base, { heartRotation: rot, heartPitch: pitch }));
  const n = axes(M, null), a = axes(M, (c) => inLAF(c) ? 35 : 0), p = axes(M, (c) => inLPF(c) ? 35 : 0);
  res.push({ rot, pitch, n, a, p });
  console.log(`rot ${String(rot).padStart(3)} pitch ${String(pitch).padStart(3)} | normal amp/area ${n.join('/').padStart(8)} | LAFB ${a.join('/').padStart(8)} | LPFB ${p.join('/').padStart(8)}`);
}
