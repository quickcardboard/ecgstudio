// Which tissue drives lead II through the ST segment? (brute-force regional sums)
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}');
const M = new LH.Model(A, P); const S = new LH.Sim(M, { seed: 1 }); S.run(1700);
const NE = M.NE, W = M.W, g = S.P.ecgGain * S.P.dipoleGain;
const regs = { atria: (c) => M.kind[c] === 1, RV: (c) => A.label[c] === 2, LVendo: (c) => A.label[c] === 1 && A.tm[c] < 0.4, LVepi: (c) => A.label[c] === 1 && A.tm[c] >= 0.4 };
const reg = new Int8Array(M.nVox).fill(-1); const names = Object.keys(regs);
for (let c = 0; c < M.nVox; c++) names.forEach((n, i) => { if (reg[c] < 0 && regs[n](c)) reg[c] = i; });
let on = null;
for (let k = 0; k < 520; k++) {
  S.step();
  if (on === null) { const v = S.log.vent.filter((b) => b.on > 1700); if (v.length) on = v[0].on; else continue; }
  const dt = S.t - Math.round(on); if (dt < 0 || dt % 20) continue;
  const acc = names.map(() => 0);
  for (let c = 0; c < M.nVox; c++) { const r = reg[c]; if (r < 0) continue; const dv = S.vm(c, S.t) - S.vRest[c]; if (dv) acc[r] += -W[c * NE + 13] * dv * g; }
  console.log(String(dt).padStart(4), 'ms after QRS onset |', names.map((n, i) => `${n} ${acc[i].toFixed(2).padStart(6)}`).join('  '), '| total', acc.reduce((a, b) => a + b, 0).toFixed(2));
}
