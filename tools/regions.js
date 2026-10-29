// Dipole contributions by region across one QRS (diagnostic)
const fs = require('fs'); const LH = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, params); const S = new LH.Sim(M, { seed: 1 });
// region of each voxel: septum (LV label, faces RV cavity or within 12mm of an RV-cavity voxel), LV free, RV
const reg = new Uint8Array(M.nVox);
const rvEndo = []; for (let c = 0; c < A.n; c++) if (A.endo[c] & (1 << 2)) rvEndo.push(A.p(c));
for (let c = 0; c < A.n; c++) {
  if (M.kind[c] !== LH.KIND.VENT) continue;
  if (A.label[c] === 2) { reg[c] = 3; continue; }
  const p = A.p(c); let near = false;
  for (const q of rvEndo) { const d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2; if (d < 144) { near = true; break; } }
  reg[c] = near ? 1 : 2;
}
const names = ['', 'septum', 'LVfree', 'RV'];
S.run(1800);
const t0 = S.log.vent[S.log.vent.length - 1].on;
while (S.t < t0) S.step();
const h = A.h;
for (let k = 0; k < 100; k++) {
  S.step();
  if (k % 6) continue;
  const D = [null, [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let c = 0; c < M.nVox; c++) {
    if (!reg[c]) continue;
    const vc = S.vm(c, S.t);
    const i = A.ii[c], j = A.jj[c], kk = A.kk[c];
    const nb = [A.at(i + 1, j, kk), A.at(i, j + 1, kk), A.at(i, j, kk + 1)];
    for (let a = 0; a < 3; a++) { const w = nb[a]; if (w < 0 || M.kind[w] !== M.kind[c]) continue; D[reg[c]][a] -= (S.vm(w, S.t) - vc) * h * h * 1e-4; }
  }
  console.log(String(S.t - Math.round(t0)).padStart(3), [1, 2, 3].map(r => names[r] + ' ' + D[r].map(v => v.toFixed(3).padStart(7)).join('')).join(' | '));
}
