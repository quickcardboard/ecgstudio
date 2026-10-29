// QRS area vector (frontal X,Y of the heart vector, mV·ms) for normal / LAFB / LPFB
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const M = new LH.Model(A, JSON.parse(process.argv[2] || '{}'));
const run = (blk) => {
  const S = new LH.Sim(M, { seed: 1 }); const v = []; S.onSample(() => v.push([S.dipole[0], S.dipole[1]]));
  for (const c of blk) S.blocked[c] = 1; S.run(2150);
  const vb = S.log.vent[S.log.vent.length - 1]; let ax = 0, ay = 0;
  for (let t = Math.floor(vb.on); t < Math.ceil(vb.last) + 3; t++) { ax += v[t][0]; ay += v[t][1]; }
  // activation delay field statistics in the LV
  return { ax, ay, tAct: Float64Array.from(S.tAct), on: vb.on };
};
const n = run([]), a = run(M.csSegments.LAF.slice(0, 3)), p = run(M.csSegments.LPF.slice(0, 3));
const ang = (x, y) => Math.round(Math.atan2(-y, x) * 180 / Math.PI);
console.log('normal area', n.ax.toFixed(0), n.ay.toFixed(0), 'axis', ang(n.ax, n.ay));
console.log('LAFB   area', a.ax.toFixed(0), a.ay.toFixed(0), 'axis', ang(a.ax, a.ay), ' delta', (a.ax - n.ax).toFixed(0), (a.ay - n.ay).toFixed(0), 'dir', ang(a.ax - n.ax, a.ay - n.ay));
console.log('LPFB   area', p.ax.toFixed(0), p.ay.toFixed(0), 'axis', ang(p.ax, p.ay), ' delta', (p.ax - n.ax).toFixed(0), (p.ay - n.ay).toFixed(0), 'dir', ang(p.ax - n.ax, p.ay - n.ay));
// delay distribution in LV voxels
for (const [nm, r] of [['LAFB', a], ['LPFB', p]]) {
  const d = []; for (let c = 0; c < M.nVox; c++) if (A.label[c] === 1) d.push((r.tAct[c] - r.on) - (n.tAct[c] - n.on));
  d.sort((x, y) => x - y); console.log(nm, 'LV delay p10/50/90/max', [0.1, 0.5, 0.9, 0.999].map(q => d[Math.floor(q * d.length)].toFixed(0)).join('/'));
}
