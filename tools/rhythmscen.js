// Rhythm and condition scenarios for the reader (tools/reader.js): each sets up a Sim, lets the rhythm
// settle and records a 10 s 12-lead strip (1 kHz) for the blind rhythm reader.
//   setup(S, ctx) → optional promise-free setup; ctx: { M, A, LH }
// Inductions follow the app: AVNRT by a premature atrial beat from the high right atrium after a sinus
// beat (coupling shortened until it re-enters), AVRT by one from the left atrial appendage.
const SETTLE = 4000, STRIP = 10000;
function vtCell(A) { for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.epi[c] && A.zuvc[c] > 0.35 && A.zuvc[c] < 0.45 && A.phi[c] < -2.2) return c; return -1; }
function induce(LH, M, A, base, cell, coupling) {
  // returns a Sim in which a premature atrial beat at `coupling` ms after a sinus discharge started re-entry, or null
  for (const ci of coupling) {
    const S = new LH.Sim(M, { seed: 1 }); base(S); S.run(2600);
    S.stimulateAt(cell, S.nextSinus() + ci); S.run(3000);
    const V = S.log.vent.filter((v) => v.on > S.t - 1200), rr = V.slice(1).map((v, i) => v.on - V[i].on);
    if (rr.length >= 2 && rr.every((x) => x < 450)) return S;
  }
  return null;
}
const RHY = {
  // name: { make(LH, M, A) → Sim (already run to the start of settling), expect: { rhythm, all, none } }
  sinusBrady: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setRate(45); return S; }, expect: { rhythm: 'sinus bradycardia' } },
  sinusTachy: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setRate(130); return S; }, expect: { rhythm: 'sinus tachycardia' } },
  AF: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('af'); return S; }, expect: { rhythm: 'atrial fibrillation' } },
  // flutter at 2:1 (145 bpm, the waves hidden in the QRS and T: often missed by readers) and at 4:1
  flutter: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('flutter'); return S; }, expect: { rhythm: 'atrial flutter', hard: true } },
  flutter4: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('flutter'); S.run(3000); S.setVentricularResponse(75); return S; }, expect: { rhythm: 'atrial flutter' } },
  ectopicAtrial: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('ectopic'); return S; }, expect: { rhythm: 'ectopic atrial rhythm' } },
  MAT: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 3 }); S.setRate(120); S.run(2000); S.startArrhythmia('mat'); return S; }, expect: { rhythm: 'multifocal atrial tachycardia' } },
  // AVNRT and AVRT, told apart by rate (AVNRT 140–180 bpm, orthodromic AVRT above 200)
  AVNRT: { make: (LH, M, A) => induce(LH, M, A, (S) => S.setDualAVN(true), A.nearest(A.landmarks.SVC.c, (c) => A.label[c] === LH.LAB.RA), [280, 260, 240, 220, 200, 180, 160]), expect: { rhythm: 'AVNRT' } },
  AVRT: { make: (LH, M, A) => induce(LH, M, A, (S) => S.setAccessoryPathway('left-lateral'), A.nearest(A.landmarks.LAA.c, (c) => A.label[c] === LH.LAB.LA), [270, 250, 290, 230, 310]), expect: { rhythm: 'AVRT' } },
  VT: { make: (LH, M, A) => { const S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('vt', { cell: vtCell(A) }); return S; }, expect: { rhythm: 'ventricular tachycardia' } },
  VF: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 3 }); S.run(2000); S.startArrhythmia('vf'); return S; }, expect: { rhythm: 'ventricular fibrillation' } },
  mobitz1: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('AVN', 'wenckebach'); return S; }, expect: { rhythm: 'Mobitz I' } },
  mobitz2: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('HIS', 'mobitz2', { n: 4 }); return S; }, expect: { rhythm: 'Mobitz II' } },
  av2to1: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('AVN', 'two-to-one'); return S; }, expect: { rhythm: '2:1 AV block' } },
  chbAVN: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('AVN', 'complete'); return S; }, expect: { rhythm: 'complete AV block (junctional' } },
  chbHis: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('HIS', 'complete'); return S; }, expect: { rhythm: 'complete AV block (ventricular' } },
  saExit: { make: (LH, M) => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('SAN', 'sa-exit', { n: 3 }); return S; }, expect: { rhythm: 'SA block' } },
};
module.exports = { RHY, SETTLE, STRIP, vtCell };
if (require.main === module) {
  // dump recordings: node tools/rhythmscen.js out.json [names]
  const fs = require('fs'), LH = require('../src/engine.js');
  const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'))), M = new LH.Model(A);
  const names = process.argv[3] ? process.argv[3].split(',') : Object.keys(RHY), out = {};
  for (const n of names) {
    const S = RHY[n].make(LH, M, A); if (!S) { console.log(n, 'not induced'); continue; }
    S.run(SETTLE); const rec = []; S.onSample((t, v) => rec.push(Array.from(v, (x) => Math.round(x * 1000) / 1000))); S.run(STRIP);
    out[n] = rec; console.log(n, 'ok', rec.length);
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
}
