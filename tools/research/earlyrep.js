// Where does ventricular repolarisation start? (earliest repolarisation times)
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}');
const M = new LH.Model(A, P); const S = new LH.Sim(M, { seed: 1 }); S.run(2150);
const on = S.log.vent[S.log.vent.length - 1].on, rows = [];
for (let c = 0; c < M.nVox; c++) if (M.kind[c] === 2) rows.push({ c, at: S.tAct[c] - on, rt: S.tAct[c] - on + S.apd[c] - 0.5 * S.repW[c] });
rows.sort((a, b) => a.rt - b.rt);
const desc = (sel) => { const n = sel.length, m = (f) => (sel.reduce((s, r) => s + f(r.c), 0) / n);
  return `n ${n}  phase-3 onset ${sel[0].rt.toFixed(0)}–${sel[n - 1].rt.toFixed(0)} ms  act ${(sel.reduce((s, r) => s + r.at, 0) / n).toFixed(0)} ms  LV ${(100 * sel.filter((r) => A.label[r.c] === 1).length / n).toFixed(0)}%  z ${m((c) => A.zuvc[c]).toFixed(2)}  tm ${m((c) => A.tm[c]).toFixed(2)}  |phi| ${m((c) => Math.abs(A.phi[c])).toFixed(2)}`; };
console.log('earliest 5% :', desc(rows.slice(0, Math.floor(rows.length * 0.05))));
console.log('5–15%       :', desc(rows.slice(Math.floor(rows.length * 0.05), Math.floor(rows.length * 0.15))));
console.log('median band :', desc(rows.slice(Math.floor(rows.length * 0.45), Math.floor(rows.length * 0.55))));
console.log('latest 5%   :', desc(rows.slice(Math.floor(rows.length * 0.95))));
