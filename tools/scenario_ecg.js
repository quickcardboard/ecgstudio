// Record a scenario's ECG: node tools/scenario_ecg.js <name> <out.json>
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A);
const stimAt = (S, kind, afterOn) => {
  const on = S.log.vent[S.log.vent.length - 1].on; while (S.t < on + afterOn) S.step();
  let c = -1; for (let i = 0; i < A.n; i++) if (M.kind[i] === (kind === 'atrial' ? 1 : 2) && A.epi[i]) { c = i; if (kind === 'atrial' ? A.label[i] === 3 : A.zuvc[i] < 0.3) break; }
  S.stimulate(c);
};
const SC = {
  'wenckebach': (S) => S.setBlock('AVN', 'wenckebach'), 'av-2to1': (S) => S.setBlock('AVN', 'two-to-one'),
  'mobitz2': (S) => S.setBlock('HIS', 'mobitz2', { n: 4 }), 'av1': (S) => S.setBlock('AVN', 'first'),
  'chb-his': (S) => S.setBlock('HIS', 'complete'), 'chb-avn': (S) => S.setBlock('AVN', 'complete'),
  'sa-exit': (S) => S.setBlock('SAN', 'sa-exit', { n: 3 }), 'sinus-pause': (S) => { S.run(3300); S.setBlock('SAN', 'pause', { ms: 2800 }); },
  'pvc': (S) => { S.run(4000); stimAt(S, 'ventricular', 480); }, 'pac': (S) => { S.run(4000); stimAt(S, 'atrial', 450); },
  'rbbb': (S) => S.setBlock('RBB', 'complete'), 'lbbb': (S) => S.setBlock('LBB', 'complete'),
};
const [name, out] = process.argv.slice(2);
const S = new LH.Sim(M, { seed: 1 }); const rec = LH.LEADS.map(() => []);
S.onSample((t, L) => { for (let i = 0; i < 12; i++) rec[i].push(+L[i].toFixed(4)); });
SC[name](S); S.run(Math.max(0, 11500 - S.t));
fs.writeFileSync(out, JSON.stringify({ leads: LH.LEADS, data: rec }));
