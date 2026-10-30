// Arrhythmia drivers: node tools/arrhythmia.js af,flutter,mat,vt,vf [ms]
// Reports atrial and ventricular rates, RR irregularity, QRS widths and AV relation; DUMP=file saves lead II/V1.
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A);
const dump = {};
for (const type of (process.argv[2] || 'af,flutter,mat,vt,vf').split(',')) {
  const S = new LH.Sim(M, { seed: 3 }); S.setRate(72);
  const rec = []; S.onSample((t, L) => rec.push([L[1], L[6]]));
  S.run(2000); S.startArrhythmia(type); S.run(+(process.argv[3] || 8000));
  const V = S.log.vent.filter((v) => v.on > 4000), rr = V.slice(1).map((v, i) => v.on - V[i].on);
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length, sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length);
  // atrial rate from activations of one RA cell
  let ra = -1; for (let c = 0; c < M.nVox; c++) if (A.label[c] === LH.LAB.RA && M.kind[c]) { ra = c; break; }
  console.log(type.padEnd(8), 'V rate', Math.round(60000 / mean), 'RR sd', Math.round(sd), 'QRS', V.slice(0, 6).map((v) => Math.round(v.last - v.on)).join(' '), 'beats', V.length);
  dump[type] = rec.slice(4000, 10000);
  S.shock(); S.run(4000);
  const V2 = S.log.vent.filter((v) => v.on > S.t - 3000), fires = S.fireLog.filter((f) => f.t > S.t - 3000).map((f) => f.name);
  console.log('   after shock: beats', V2.length, 'fired', [...new Set(fires)].join(','));
}
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(dump));
