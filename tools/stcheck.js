// ST-segment levels per lead: node tools/stcheck.js '<params JSON>'
// Reports J-point, ST at J+40/J+60/J+80 ms relative to the PR (pre-QRS) baseline.
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}');
const M = new LH.Model(A, P); const S = new LH.Sim(M, { seed: 1 }); const rec = [];
S.onSample((t, L) => rec.push(Array.from(L))); S.run(2700);
const vb = S.log.vent[S.log.vent.length - 2], q0 = Math.floor(vb.on), j = Math.ceil(vb.last) + 6;
const base = rec[q0 - 12];   // PR segment just before the QRS
const row = (k) => [0, 40, 60, 80].map((d) => (rec[j + d][k] - base[k]).toFixed(2).padStart(6)).join('');
// pre-T dip: most negative excursion (relative to the T-wave polarity) between J+40 and the T peak
const dip = (k) => {
  let tp = j + 60, tv = 0; for (let t = j + 60; t < j + 400; t++) { const v = rec[t][k] - base[k]; if (Math.abs(v) > Math.abs(tv)) { tv = v; tp = t; } }
  const sgn = Math.sign(tv) || 1; let worst = 0; for (let t = j + 40; t < tp; t++) worst = Math.min(worst, sgn * (rec[t][k] - base[k]));
  return -worst;
};
const quiet = process.argv[3] === 'summary';
if (!quiet) { console.log('lead      J   J+40  J+60  J+80   pre-T dip (mV vs PR baseline)'); LH.LEADS.forEach((n, k) => console.log(n.padEnd(5), row(k), dip(k).toFixed(2).padStart(6))); }
else { const js = LH.LEADS.map((n, k) => Math.abs(rec[j][k] - base[k])), ds = LH.LEADS.map((n, k) => dip(k)); console.log(`max |J| ${Math.max(...js).toFixed(2)}  max pre-T dip ${Math.max(...ds).toFixed(2)} (${LH.LEADS[ds.indexOf(Math.max(...ds))]})`); }
