// Ischemia audit: ECG-read findings (same rules as the app) for every occlusion site and slider stop.
// node tools/ischaudit.js [sites] [hours]
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, JSON.parse(process.env.MP || '{}')); const C = M.coronary, br = C.branches;
const SITES = { LM: br.LM[0], pLAD: br.LAD[0], mLAD: br.LAD[Math.round(br.LAD.length * 0.4)], dLAD: br.LAD[Math.round(br.LAD.length * 0.7)],
  pLCx: br.LCx[0], dLCx: br.LCx[Math.round(br.LCx.length * 0.6)], pRCA: br.RCA[0], mRCA: br.RCA[Math.round(br.RCA.length * 0.45)], dRCA: br.RCA[Math.round(br.RCA.length * 0.8)], PDA: br.PDA[0] };
const L = LH.LEADS;
function beat(S) {
  const rec = []; S.onSample((t, v) => rec.push(Array.from(v))); S.run(3600);
  const vb = S.log.vent[S.log.vent.length - 2], q0 = Math.floor(vb.on), J = Math.ceil(vb.last) + 6, b0 = rec[q0 - 15];
  const m = {};
  L.forEach((n, k) => {
    const at = (t) => rec[t][k] - b0[k];
    let qDur = 0, qAmp = 0, rMax = 0, tv = 0, r40 = 0, sMin = 0;
    for (let t = q0; t < q0 + 60; t++) { const v = at(t); if (v > 0.05) break; if (v < -0.04) qDur = t - q0 + 1; qAmp = Math.min(qAmp, v); }
    for (let t = q0; t <= J; t++) { rMax = Math.max(rMax, at(t)); sMin = Math.min(sMin, at(t)); if (t < q0 + 40) r40 = Math.max(r40, at(t)); }
    for (let t = J + 60; t < vb.repEnd + 40; t++) { const v = at(t); if (Math.abs(v) > Math.abs(tv)) tv = v; }
    const s20 = at(J + 20), s40 = at(J + 40);
    m[n] = { st: s20 * s40 > 0 ? Math.sign(s40) * Math.min(Math.abs(s20), Math.abs(s40)) : 0, qDur, qAmp, rMax, r40, s: -sMin, t: tv };
  });
  return m;
}
const ref = beat(new LH.Sim(M, { seed: 1 }));
const sites = (process.argv[2] || Object.keys(SITES).join(',')).split(','), hours = (process.argv[3] || '1,12,48,720').split(',').map(Number);
for (const site of sites) for (const h of hours) {
  const S = new LH.Sim(M, { seed: 1 }); S.addOcclusion(SITES[site]); S.setIschemiaTime(h);
  const m = beat(S);
  const ste = L.filter((n) => m[n].st >= (n === 'V2' || n === 'V3' ? 0.15 : 0.1)), std = L.filter((n) => m[n].st <= -0.08);
  const isQ = (v) => (v.qDur >= 30 && v.qAmp <= -0.1) || (v.qDur >= 40 && v.qAmp <= -0.05);
  const isQS = (n) => ref[n].r40 >= 0.2 && m[n].r40 < 0.1 && m[n].s >= 0.3 && m[n].s > 2 * m[n].rMax;
  const Q = L.filter((n) => n !== 'aVR' && m[n].st > -0.08 && ((isQ(m[n]) && (!isQ(ref[n]) || m[n].qAmp < ref[n].qAmp - 0.2)) || isQS(n)));
  const rl = L.filter((n) => ref[n].rMax > 0.2 && m[n].rMax < 0.65 * ref[n].rMax && ref[n].rMax - m[n].rMax > 0.1);
  const twi = L.filter((n) => !['aVR', 'V1', 'III'].includes(n) && m[n].t < -0.1 && !(ref[n].t < -0.05));
  console.log(`${site.padEnd(5)} ${String(h).padStart(4)}h  STE[${ste.join(' ')}]  STD[${std.join(' ')}]  Q[${Q.join(' ')}]  Rloss[${rl.join(' ')}]  TWI[${twi.join(' ')}]  dead ${S.nDead}`);
}
