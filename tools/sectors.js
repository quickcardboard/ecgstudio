// QRS-integrated dipole by LV/RV sector (diagnostic)
const fs = require('fs'); const LH = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, params); const S = new LH.Sim(M, { seed: 1 });
const sect = (c) => {
  if (A.label[c] === 2) return 'RV';
  const ph = A.phi[c], z = A.zuvc[c];
  const s = Math.abs(ph) < 0.8 ? 'sept' : ph >= 0.8 && ph < 2.2 ? 'ant' : ph <= -0.8 && ph > -2.2 ? 'inf' : 'lat';
  return s + (z < 0.33 ? '-apex' : z < 0.66 ? '-mid' : '-base');
};
const key = new Array(M.nVox), acc = {}, tim = {};
for (let c = 0; c < M.nVox; c++) if (M.kind[c] === LH.KIND.VENT) key[c] = sect(c);
S.run(1800); const t0 = S.log.vent[S.log.vent.length - 1].on; while (S.t < t0) S.step();
const h = A.h;
for (let k = 0; k < 110; k++) {
  S.step();
  for (let c = 0; c < M.nVox; c++) {
    const g = key[c]; if (!g) continue;
    const vc = S.vm(c, S.t), i = A.ii[c], j = A.jj[c], kk = A.kk[c];
    const nb = [A.at(i + 1, j, kk), A.at(i, j + 1, kk), A.at(i, j, kk + 1)];
    const a = acc[g] || (acc[g] = [0, 0, 0]);
    for (let d = 0; d < 3; d++) { const w = nb[d]; if (w < 0 || M.kind[w] !== M.kind[c]) continue; a[d] -= (S.vm(w, S.t) - vc) * h * h * 1e-4; }
  }
}
for (let c = 0; c < M.nVox; c++) { const g = key[c]; if (!g) continue; (tim[g] = tim[g] || []).push(S.tAct[c] - t0); }
let tot = [0, 0, 0];
for (const g of Object.keys(acc).sort()) {
  const a = acc[g]; tot = tot.map((v, i) => v + a[i]);
  const ts = tim[g].sort((x, y) => x - y);
  console.log(g.padEnd(10), a.map(v => v.toFixed(0).padStart(6)).join(''), '  act p10/50/90', [0.1, 0.5, 0.9].map(q => ts[Math.floor(q * ts.length)].toFixed(0)).join('/'), ' n', ts.length);
}
console.log('TOTAL     ', tot.map(v => v.toFixed(0).padStart(6)).join(''), ' frontal', (Math.atan2(-tot[1], tot[0]) * 180 / Math.PI).toFixed(0));
