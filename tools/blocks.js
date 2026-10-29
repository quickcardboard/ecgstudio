// Beat-by-beat check of every block / ectopy scenario: node tools/blocks.js [scenario]
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A);

const SCEN = {
  'sinus': (S) => {},
  'av1': (S) => S.setBlock('AVN', 'first'),
  'wenckebach': (S) => S.setBlock('AVN', 'wenckebach'),
  'av-2to1': (S) => S.setBlock('AVN', 'two-to-one'),
  'mobitz2': (S) => S.setBlock('HIS', 'mobitz2', { n: 4 }),
  'avn-complete': (S) => S.setBlock('AVN', 'complete'),
  'his-complete': (S) => S.setBlock('HIS', 'complete'),
  'sa-exit': (S) => S.setBlock('SAN', 'sa-exit', { n: 3 }),
  'sinus-pause': (S) => { S.run(2600); S.setBlock('SAN', 'pause', { ms: 2800 }); },
  'sinus-arrest': (S) => S.setBlock('SAN', 'arrest'),
  'LBBB': (S) => S.setBlock('LBB', 'complete'),
  'RBBB': (S) => S.setBlock('RBB', 'complete'),
  'LAFB': (S) => S.setBlock('LAF', 'complete'),
  'LPFB': (S) => S.setBlock('LPF', 'complete'),
  'PAC': (S) => { S.run(2400); const c = A.nearest(A.landmarks.LAA.c, (x) => A.label[x] === 3); S.stimulate(c); },
  'PVC': (S) => { S.run(2400); let best = -1, bz = 9; for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.epi[c] && A.zuvc[c] > 0.3 && A.zuvc[c] < bz && A.phi[c] > 2) { bz = A.zuvc[c]; best = c; } S.stimulate(best); },
};

function run(name) {
  const S = new LH.Sim(M, { seed: 1 }); S.setRate(72);
  SCEN[name](S);
  S.run(Math.max(0, 8000 - S.t));
  const At = S.log.atrial.filter((b) => b.on > 1000), V = S.log.vent.filter((b) => b.on > 1000);
  const rows = V.map((vb) => {
    const p = S.log.atrial.filter((a) => a.on < vb.on - 30 && a.on > vb.on - 450).pop();
    const src = S.fireLog.filter((f) => f.t > vb.on - 160 && f.t <= vb.on + 1).pop();
    const stim = S.stimLog.find((x) => x.captured && x.t > vb.on - 40 && x.t <= vb.on + 2);
    return `${Math.round(vb.on)}${p ? ' PR' + Math.round(vb.on - p.on) : ' noP'} QRS${Math.round(vb.last - vb.on)}${src && src.name !== 'sinus' ? ' [' + src.name + ']' : ''}${stim ? ' [stim ' + stim.kind + ']' : ''}`;
  });
  const vr = V.length > 1 ? 60000 * (V.length - 1) / (V[V.length - 1].on - V[0].on) : 0;
  const ar = At.length > 1 ? 60000 * (At.length - 1) / (At[At.length - 1].on - At[0].on) : 0;
  const nonConducted = At.filter((a) => !V.some((v) => v.on > a.on + 30 && v.on < a.on + 450)).length;
  console.log(`== ${name}: atrial ${ar.toFixed(0)}/min, ventricular ${vr.toFixed(0)}/min, P without QRS ${nonConducted}`);
  console.log('   ' + rows.join(' | '));
}
const only = process.argv[2];
for (const k of Object.keys(SCEN)) if (!only || only.split(',').includes(k)) run(k);
