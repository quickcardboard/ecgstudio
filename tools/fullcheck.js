// Full check for a parameter set (either forward model): gain recalibrated on the heart vector,
// axes and QRS shape (tools/cstune.js), and ischaemia localisation for every occlusion site:
// ST elevation at 1 h and Q waves at 30 days against the textbook lead groups (app reading rules,
// as tools/ischaudit.js). Prints one JSON line.
//   [TV2=field.json] [RA=0] node tools/fullcheck.js '{params}'
const fs = require('fs'); const path = require('path'); const LH = require('../src/engine.js');
if (process.env.RA !== undefined) LH.setRaLayersDefault(+process.env.RA);
if (process.env.TV2) LH.setDefaultTorso2(require(path.resolve(process.env.TV2)));
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const p = JSON.parse(process.argv[2] || '{}'); const { lv = 2, rv = 0, ...mp } = p;
const L = LH.LEADS;
// ---- gain: peak spatial QRS vector (Kors regression) = 1.6 mV
function calibrate(M) {
  const S = new LH.Sim(M, { seed: 1 }); const rec = []; S.onSample((t, v) => rec.push(Array.from(v))); S.run(2700);
  const vb = S.log.vent[S.log.vent.length - 2], q0 = Math.floor(vb.on), q1 = Math.ceil(vb.last) + 2, b = rec[q0 - 15], k = (n) => L.indexOf(n);
  const KX = [0.38, -0.07, -0.13, 0.05, -0.01, 0.14, 0.06, 0.54], KY = [-0.07, 0.93, 0.06, -0.02, -0.05, 0.06, -0.17, 0.13], KZ = [0.11, -0.23, -0.43, -0.06, -0.14, -0.20, -0.11, 0.31];
  let pk = 0; for (let t = q0; t < q1; t++) { const v = ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((n) => rec[t][k(n)] - b[k(n)]);
    const x = KX.reduce((a, c, i) => a + c * v[i], 0), y = KY.reduce((a, c, i) => a + c * v[i], 0), z = KZ.reduce((a, c, i) => a + c * v[i], 0); pk = Math.max(pk, Math.hypot(x, y, z)); }
  return 1.6 / pk;
}
const fwd = mp.forward !== undefined ? mp.forward : LH.DEFAULTS.forward;
const gainKey = fwd === 2 ? 'forwardGain' : 'ecgGain';
if (!process.env.NOCAL) { const A0 = new LH.Anatomy(JSON.parse(JSON.stringify(JA)), { lvWallLayers: lv, rvWallLayers: rv }); const M0 = new LH.Model(A0, mp); mp[gainKey] = +((mp[gainKey] || M0.P[gainKey]) * calibrate(M0)).toFixed(4); }
const cs = require('./cstune.js').evaluate({ lv, rv, ...mp });
// ---- ischaemia localisation
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), br = M.coronary.branches;
const SITES = { pLAD: br.LAD[0], mLAD: br.LAD[Math.round(br.LAD.length * 0.3)], dLAD: br.LAD[Math.round(br.LAD.length * 0.7)],
  pLCx: br.LCx[0], dLCx: br.LCx[Math.round(br.LCx.length * 0.6)], pRCA: br.RCA[0], PDA: br.PDA[0] };
function beat(S) {
  const rec = []; S.onSample((t, v) => rec.push(Array.from(v))); S.run(3600);
  const vb = S.log.vent[S.log.vent.length - 2], E = S.beatEnds(vb), q0 = Math.floor(vb.on), J = Math.ceil(E.last) + 6, b0 = rec[q0 - 15], m = {};
  L.forEach((n, k) => {
    const at = (t) => rec[t][k] - b0[k]; let qDur = 0, qAmp = 0, rMax = 0, r40 = 0, sMin = 0;
    for (let t = q0; t < q0 + 60; t++) { const v = at(t); if (v > 0.05) break; if (v < -0.04) qDur = t - q0 + 1; qAmp = Math.min(qAmp, v); }
    for (let t = q0; t <= J; t++) { rMax = Math.max(rMax, at(t)); sMin = Math.min(sMin, at(t)); if (t < q0 + 40) r40 = Math.max(r40, at(t)); }
    const s20 = at(J + 20), s40 = at(J + 40);
    m[n] = { st: s20 * s40 > 0 ? Math.sign(s40) * Math.min(Math.abs(s20), Math.abs(s40)) : 0, qDur, qAmp, rMax, r40, s: -sMin };
  });
  return m;
}
const ref = beat(new LH.Sim(M, { seed: 1 }));
const isQ = (v) => (v.qDur >= 30 && v.qAmp <= -0.1) || (v.qDur >= 40 && v.qAmp <= -0.05);
// textbook lead groups: core = must show; bad = must not (allowed = anything else)
const EXP = {
  pLAD: { ste: { core: ['V1', 'V2', 'V3', 'V4', 'I', 'aVL'], bad: ['II', 'III', 'aVF'] }, q: { core: ['V1', 'V2', 'V3', 'V4'], bad: ['II', 'III', 'aVF'] } },
  mLAD: { ste: { core: ['V2', 'V3', 'V4'], bad: ['I', 'aVL'] }, q: { core: ['V2', 'V3', 'V4'], bad: ['I', 'aVL'] } },
  dLAD: { ste: { core: ['V3', 'V4', 'V5'], bad: ['I', 'aVL'] }, q: { core: ['V4', 'V5'], bad: ['I', 'aVL', 'V1'] } },
  pLCx: { ste: { core: ['I', 'aVL', 'V5', 'V6'], bad: ['V1', 'V2', 'V3', 'II', 'III', 'aVF'] }, q: { core: ['I', 'aVL', 'V6'], bad: ['V1', 'V2', 'V3', 'II', 'III', 'aVF'] } },
  dLCx: { ste: { core: ['V6'], bad: ['V1', 'V2', 'V3'] }, q: { core: ['V6'], bad: ['V1', 'V2', 'V3'] } },
  pRCA: { ste: { core: ['II', 'III', 'aVF'], bad: ['I', 'aVL', 'V4', 'V5', 'V6'] }, q: { core: ['II', 'III', 'aVF'], bad: ['I', 'aVL', 'V2', 'V3', 'V4', 'V5', 'V6'] } },
  PDA: { ste: { core: ['II', 'III', 'aVF'], bad: ['I', 'aVL', 'V1', 'V2', 'V3', 'V4'] }, q: { core: ['II', 'III', 'aVF'], bad: ['I', 'aVL', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] } },
};
const isch = {}; let iErr = 0;
for (const [site, node] of Object.entries(SITES)) {
  const S1 = new LH.Sim(M, { seed: 1 }); S1.addOcclusion(node); S1.setIschemiaTime(1); const a = beat(S1);
  const ste = L.filter((n) => a[n].st >= (n === 'V2' || n === 'V3' ? 0.15 : 0.1));
  const S2 = new LH.Sim(M, { seed: 1 }); S2.addOcclusion(node); S2.setIschemiaTime(720); const b = beat(S2);
  const isQS = (n) => ref[n].r40 >= 0.2 && b[n].r40 < 0.1 && b[n].s >= 0.3 && b[n].s > 2 * b[n].rMax;
  const Q = L.filter((n) => n !== 'aVR' && b[n].st > -0.08 && ((isQ(b[n]) && (!isQ(ref[n]) || b[n].qAmp < ref[n].qAmp - 0.2)) || isQS(n)));
  const e = EXP[site], miss = (have, g) => g.core.filter((n) => !have.includes(n)), bad = (have, g) => g.bad.filter((n) => have.includes(n));
  const r = { ste, Q, steMiss: miss(ste, e.ste), steBad: bad(ste, e.ste), qMiss: miss(Q, e.q), qBad: bad(Q, e.q) };
  iErr += r.steMiss.length + r.steBad.length + r.qMiss.length + r.qBad.length; isch[site] = r;
}
const m = cs.m, pr = m.N.prog;
const axes = { N: m.N.axis, LAF: m.LAF.net, LPF: m.LPF.net, LBB: m.LBB.axis, RVH: m.RVH.axis };
const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
const axErr = pen(axes.N, 30, 75) / 15 + pen(axes.LAF, -90, -45) / 15 + pen(axes.LPF, 100, 180) / 15 + pen(axes.LBB, -30, 60) / 15 + pen(axes.RVH, 110, 210) / 15;
console.log(JSON.stringify({ p: process.env.TAG || '', gain: mp[gainKey], cs: cs.score, iErr, axErr: +axErr.toFixed(2), axes,
  qrs: { V1: pr[0], V2: pr[1], R: pr.map((x) => x[0]), qI: m.N.qI, ratio: +(m.N.II[0] / Math.max(pr[4][0], pr[5][0])).toFixed(2) }, isch }));
