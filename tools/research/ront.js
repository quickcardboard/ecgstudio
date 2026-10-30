// R-on-T / vulnerable-period probe: does a premature stimulus start re-entry?
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}'); const M = new LH.Model(A, P);
const pick = (f, sc) => { let b = -1, bs = Infinity; for (let c = 0; c < A.n; c++) if (f(c)) { const s = sc(c); if (s < bs) { bs = s; b = c; } } return b; };
const lvSite = pick((c) => A.label[c] === 1 && A.epi[c], (c) => Math.abs(A.zuvc[c] - 0.5) + Math.abs(Math.abs(A.phi[c]) - 2.8));
const laSite = pick((c) => A.label[c] === 3 && A.epi[c], (c) => -A.p(c)[0]);
const count = (S, kind, t0, t1) => { const L = kind === 'v' ? S.log.vent : S.log.atrial; return L.filter((b) => b.on >= t0 && b.on < t1).length; };
console.log('Ventricular stimulus timed across the T wave (single extrastimulus):');
for (const dt of [220, 250, 270, 290, 310, 340, 380]) {
  const S = new LH.Sim(M, { seed: 1 }); S.run(1700); while (!S.log.vent.some((b) => b.on > 1700)) S.step();
  const on = S.log.vent[S.log.vent.length - 1].on; while (S.t < on + dt) S.step();
  const rec = S.stimulate(lvSite); S.run(2500);
  const vb = count(S, 'v', on + dt - 5, on + dt + 2500);
  console.log(`  QRS+${dt} ms: ${rec.captured ? 'captured' : 'no capture'}; ventricular beats in next 2.5 s: ${vb} (sinus alone ≈ 3)`);
}
console.log('Rapid atrial burst (8 stimuli, 150 ms apart) starting during the QRS:');
{ const S = new LH.Sim(M, { seed: 1 }); S.run(1700); while (!S.log.vent.some((b) => b.on > 1700)) S.step();
  for (let k = 0; k < 8; k++) { S.stimulate(laSite); S.run(150); }
  const t0 = S.t; S.run(3000);
  console.log(`  after the burst: atrial activations in 3 s ${count(S, 'a', t0, t0 + 3000)} (sinus ≈ 4), ventricular ${count(S, 'v', t0, t0 + 3000)}`); }
