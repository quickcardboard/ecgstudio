// How much does each fascicular block delay its own territory? (LV voxel activation, last beat)
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}'); const M = new LH.Model(A, P);
const act = (site) => { const S = new LH.Sim(M, { seed: 1 }); if (site) S.setBlock(site, 'complete'); S.run(2150); const on = S.log.vent[S.log.vent.length - 1].on; return Float64Array.from(S.tAct, (t) => t - on); };
const n = act(null);
// territory of each LV voxel = territory of its nearest LV Purkinje node
const terrOf = new Int8Array(M.nVox).fill(-1);
for (let c = 0; c < M.nVox; c++) {
  if (A.label[c] !== 1) continue; let best = 1e9, t = -1;
  for (const id of M.purkLV) { const d = (M.x[id] - A.pos[3 * c]) ** 2 + (M.y[id] - A.pos[3 * c + 1]) ** 2 + (M.z[id] - A.pos[3 * c + 2]) ** 2; if (d < best) { best = d; t = M.purkTerritory.get(id); } }
  terrOf[c] = t;
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return p.map((v) => s[Math.floor(v * (s.length - 1))].toFixed(0)).join('/'); };
for (const site of ['LAF', 'LPF']) {
  const b = act(site);
  for (const k of [0, 1]) {
    const d = []; for (let c = 0; c < M.nVox; c++) if (terrOf[c] === k) d.push(b[c] - n[c]);
    console.log(`${site} block -> ${k ? 'LPF' : 'LAF'} territory (${d.length} voxels) extra delay p10/50/90: ${q(d, [0.1, 0.5, 0.9])} ms`);
  }
}
