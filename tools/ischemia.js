// Ischaemia time course per occlusion: node tools/ischemia.js [LAD,LCx,RCA,...] [hours,...]
// Prints ST (J+60 vs PR baseline), Q depth and T amplitude per lead, in mV.
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, { ecgHighpass: 0 }); const C = M.coronary;
const first = (b, k = 0) => C.nodes.map((n, i) => [n, i]).filter(([n]) => n.branch === b)[k][1];
const OCC = {
  'pLAD': () => first('LAD', 0), 'mLAD': () => first('LAD', 14), 'LCx': () => first('LCx', 0),
  'pRCA': () => first('RCA', 0), 'dRCA': () => first('RCA', 22), 'subendo': null,
};
const hours = (process.argv[3] || '0,0.15,0.5,1,2,4,6,8').split(',').map(Number);
for (const name of (process.argv[2] || 'pLAD,LCx,pRCA').split(',')) {
  console.log(`== ${name}`);
  console.log('h     ' + LH.LEADS.map((l) => l.padStart(13)).join(''));
  for (const h of hours) {
    const S = new LH.Sim(M, { seed: 1 }); S.setRate(72);
    if (name === 'subendo') S.addSubendocardial(A.nearest(A.landmarks.LVapex ? A.landmarks.LVapex.c : [0, 0, 0], (c) => A.label[c] === 1 && A.endo[c]), 30);
    else S.addOcclusion(OCC[name]());
    S.setIschemiaTime(h);
    const rec = []; S.onSample((t, L) => rec.push(Array.from(L))); S.run(3600);
    const vb = S.log.vent[S.log.vent.length - 2], q0 = Math.floor(vb.on), j = Math.ceil(vb.last) + 6;
    const base = rec[q0 - 12];
    if (process.env.DUMP) { (global.dump = global.dump || {})[name + '@' + h] = rec.slice(q0 - 200, q0 + 600).map((r) => r.map((v, k) => +(v - base[k]).toFixed(3))); }
    const cells = LH.LEADS.map((n, k) => {
      const st = rec[j + 60][k] - base[k];
      let q = 0; for (let t = q0; t < q0 + 40; t++) q = Math.min(q, rec[t][k] - base[k]);
      let r = 0; for (let t = q0; t < j; t++) r = Math.max(r, rec[t][k] - base[k]);
      let tv = 0; for (let t = j + 80; t < j + 420; t++) { const v = rec[t][k] - base[k]; if (Math.abs(v) > Math.abs(tv)) tv = v; }
      return `${st >= 0 ? '+' : ''}${st.toFixed(2)}/${tv >= 0 ? '+' : ''}${tv.toFixed(1)}${q < -0.1 && r < 0.15 ? 'Q' : ' '}`.padStart(13);
    });
    console.log(String(h).padEnd(6) + cells.join('') + `  QRS${Math.round(vb.last - vb.on)} HR${Math.round(60000 / (S.log.vent[S.log.vent.length - 1].on - vb.on))}`);
  }
}
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(global.dump));
