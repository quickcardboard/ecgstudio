// long-axis tilt (degrees below horizontal, frontal-plane angle) for given orientation params
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
module.exports = (p) => {
  const M = new LH.Model(A, p);
  let apex = [0, 0, 0], n = 0; for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.zuvc[c] >= 0 && A.zuvc[c] < 0.04 && A.epi[c]) { const q = M.toTorso(A.p(c)); apex = apex.map((v, i) => v + q[i]); n++; }
  apex = apex.map((v) => v / n); const base = M.toTorso(A.landmarks.MV.c);
  const d = apex.map((v, i) => v - base[i]);
  return { below: +(Math.atan2(-d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI).toFixed(1), frontal: +(Math.atan2(-d[1], d[0]) * 180 / Math.PI).toFixed(1), anterior: +(Math.atan2(d[2], Math.hypot(d[0], d[1])) * 180 / Math.PI).toFixed(1) };
};
if (require.main === module) for (const r of [17.4, 5, -5, -15, -25]) console.log(r, JSON.stringify(module.exports({ heartRotation: r })));
