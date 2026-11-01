// Export the heart (tissue and cavity blood) and the electrode positions in the
// torso frame, for tools/torso_v2.py.   node tools/export_heart_torso.js out.json ['{params}']
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, JSON.parse(process.argv[3] || '{}'));
const [nx, ny, nz] = A.dims, h = A.h, o = A.origin;
const tissue = [], blood = [];
for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
  const w = (i * ny + j) * nz + k, p = [o[0] + i * h, o[1] + j * h, o[2] + k * h];
  const c = A.at(i, j, k);
  if (c >= 0 && A.label[c] >= 1 && A.label[c] <= 4) tissue.push(...M.toTorso(p).map((v) => +v.toFixed(1)));
  else if (c < 0 && A.cavityComp[w] > 0 && A.cavityLabel[A.cavityComp[w]]) blood.push(...M.toTorso(p).map((v) => +v.toFixed(1)));
}
fs.writeFileSync(process.argv[2], JSON.stringify({ h, torso: M.torso, electrodes: M.electrodes, tissue, blood }));
console.log('tissue', tissue.length / 3, 'blood', blood.length / 3, 'electrodes', JSON.stringify(M.electrodes));
