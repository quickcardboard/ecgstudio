// WPW pre-excitation per pathway site: node tools/wpw.js [sites]
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, { ecgHighpass: 0 });
const sites = (process.argv[2] || 'none,left-lateral,left-posterior,posteroseptal,right-free-wall,right-anteroseptal').split(',');
for (const loc of sites) {
  const S = new LH.Sim(M, { seed: 1 }); S.setRate(72); if (loc !== 'none') S.setAccessoryPathway(loc);
  const rec = []; S.onSample((t, L) => rec.push(Array.from(L))); S.run(3600);
  const vb = S.log.vent[S.log.vent.length - 2], ab = S.log.atrial.filter((a) => a.on < vb.on).pop();
  const q0 = Math.floor(vb.on), base = rec[Math.floor(ab.on) - 5];
  // delta polarity: mean of the first 30 ms of the QRS
  const delta = LH.LEADS.map((n, k) => { let s = 0; for (let t = q0; t < q0 + 30; t++) s += rec[t][k] - base[k]; return s / 30; });
  let aI = 0, aF = 0; for (let t = q0; t <= vb.last; t++) { aI += rec[t][0] - base[0]; aF += rec[t][5] - base[5]; }
  const sgn = (v) => (v > 0.02 ? '+' : v < -0.02 ? '−' : '±');
  console.log(loc.padEnd(19), 'PR', Math.round(vb.on - ab.on), 'QRS', Math.round(vb.last - vb.on), 'axis', Math.round(Math.atan2(aF, aI) * 180 / Math.PI),
    'delta', LH.LEADS.map((n, k) => n + sgn(delta[k])).join(' '), loc !== 'none' ? 'sites v' + S.ap.v + ' a' + S.ap.a : '');
}
