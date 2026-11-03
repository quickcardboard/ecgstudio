// Export the heart (tissue and cavity blood) and the electrode positions in the
// torso frame, for tools/torso_v2.py.   node tools/export_heart_torso.js out.json ['{params}']
const fs = require('fs'); const LH = require('../src/engine.js'); if (process.env.RA !== undefined && LH.setRaLayersDefault) LH.setRaLayersDefault(+process.env.RA);
const { lv = LH.hypertrophyOptions({}).anatomy.lvWallLayers, rv = 0, ...MP } = JSON.parse(process.argv[3] || '{}');   // (lv/rv: wall layers, as the tuning tools)
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')), { lvWallLayers: lv, rvWallLayers: rv });
const M = new LH.Model(A, MP);
const [nx, ny, nz] = A.dims, h = A.h, o = A.origin;
const tissue = [], blood = [], tlab = [], fib = [];
for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
  const w = (i * ny + j) * nz + k, p = [o[0] + i * h, o[1] + j * h, o[2] + k * h];
  const c = A.at(i, j, k);
  if (c >= 0 && A.label[c] >= 1 && A.label[c] <= 4) {
    tlab.push(A.label[c]); tissue.push(...(A.label[c] >= 3 && M.toTorsoAtrial ? M.toTorsoAtrial : M.toTorso)(p).map((v) => +v.toFixed(1)));
    // fibre direction in the torso frame (ventricles; zero where undefined)
    const f = [A.fiber[3 * c], A.fiber[3 * c + 1], A.fiber[3 * c + 2]], R = M.rot, fl = Math.hypot(...f) || 1;
    fib.push(...[0, 1, 2].map((d) => +(A.label[c] <= 2 ? (R[3 * d] * f[0] + R[3 * d + 1] * f[1] + R[3 * d + 2] * f[2]) / fl : 0).toFixed(3)));
  }
  else if (c < 0 && A.cavityComp[w] > 0 && A.cavityLabel[A.cavityComp[w]]) blood.push(...(A.cavityLabel[A.cavityComp[w]] >= 3 && M.toTorsoAtrial ? M.toTorsoAtrial : M.toTorso)(p).map((v) => +v.toFixed(1)));
}
fs.writeFileSync(process.argv[2], JSON.stringify({ h, torso: M.torso, electrodes: M.electrodes, tissue, tlab, blood, fib }));
console.log('tissue', tissue.length / 3, 'blood', blood.length / 3, 'electrodes', JSON.stringify(M.electrodes));
