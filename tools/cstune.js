// Conduction-system / orientation tuning: evaluate parameter sets against
// textbook ECG targets and Durrer's activation data.
//   node tools/cstune.js '[{...}, ...]'          one JSON line per set
//   require('./tools/cstune.js').evaluate(p)     → { score, m }
// A set may carry "lv" (LV wall layers, default 3) besides model parameters.
const fs = require('fs'); const LH = require('../src/engine.js');
const JSONA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const anat = new Map();
const anatomy = (lv) => { if (!anat.has(lv)) anat.set(lv, new LH.Anatomy(JSONA, { lvWallLayers: lv })); return anat.get(lv); };
const LEAD = (n) => LH.LEADS.indexOf(n);

function record(M, setup) {
  const S = new LH.Sim(M, { seed: 1 }); const rec = [];
  S.onSample((t, L) => rec.push(Array.from(L)));
  setup(S); S.run(2700);
  const vb = S.log.vent[S.log.vent.length - 2];
  const q0 = Math.floor(vb.on), q1 = Math.ceil(vb.last) + 2, base = rec[q0 - 15];
  const y = (n) => rec.slice(q0, q1).map((r) => r[LEAD(n)] - base[LEAD(n)]);
  return { S, vb, q0, qrs: q1 - q0, y };
}
const axisOf = (b) => { const s = (n) => b.y(n).reduce((a, v) => a + v, 0); return Math.atan2(s('aVF'), s('I')) * 180 / Math.PI; };
const netAxis = (b) => { const n = (l) => { const v = b.y(l); return Math.max(...v) + Math.min(...v); }; return Math.atan2(n('aVF'), n('I')) * 180 / Math.PI; };
const rs = (b, n) => { const v = b.y(n); return [Math.max(...v), -Math.min(...v)]; };
// early r: largest positive deflection before the QRS first goes clearly negative (within 45 ms)
const earlyR = (b, n) => { const v = b.y(n); let r = 0; for (let t = 0; t < Math.min(45, v.length); t++) { if (v[t] < -0.15) break; r = Math.max(r, v[t]); } return r; };
const initQ = (b, n) => { const v = b.y(n).slice(0, 20); return v.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0); };

function evaluate(p) {
  const { lv = 3, ...mp } = p;
  const A = anatomy(lv), M = new LH.Model(A, mp);
  const cs = M.csSegments, br = M.coronary.branches;
  const n = record(M, () => {});
  const blk = (seg) => (S) => { for (const c of cs[seg].slice(0, 3)) S.blocked[c] = 1; };
  const laf = record(M, blk('LAF')), lpf = record(M, blk('LPF')), lbb = record(M, blk('LBB')), rbb = record(M, blk('RBB'));
  const occl = (node) => (S) => { S.addOcclusion(node); S.setIschemiaTime(720); };
  const dlad = record(M, occl(br.LAD[Math.round(br.LAD.length * 0.7)]));
  const mlad = record(M, occl(br.LAD[Math.round(br.LAD.length * 0.3)]));
  const prca = record(M, occl(br.RCA[0]));
  // activation: apex endocardium, total time, HV
  const S = new LH.Sim(M, { seed: 1 }); S.run(1700);   // activation times of the last complete beat
  const t0 = S.log.vent[S.log.vent.length - 1].on, vlast = S.log.vent[S.log.vent.length - 1].last, apex = [];
  for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.tm[c] >= 0 && A.tm[c] < 0.15 && A.zuvc[c] >= 0 && A.zuvc[c] < 0.3) { const t = S.tAct[c] - t0; if (t > -5 && t < 200) apex.push(t); }
  apex.sort((a, b) => a - b);
  const m = {
    N: { axis: Math.round(axisOf(n)), net: Math.round(netAxis(n)), qrs: n.qrs, I: rs(n, 'I'), II: rs(n, 'II'),
      qI: +initQ(n, 'I').toFixed(2), qV6: +initQ(n, 'V6').toFixed(2), rV1: +initQ(n, 'V1').toFixed(2),
      prog: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((l) => rs(n, l).map((x) => +x.toFixed(2))) },
    LAF: { axis: Math.round(axisOf(laf)), net: Math.round(netAxis(laf)), qrs: laf.qrs },
    LPF: { axis: Math.round(axisOf(lpf)), net: Math.round(netAxis(lpf)), qrs: lpf.qrs },
    LBB: { axis: Math.round(axisOf(lbb)), qrs: lbb.qrs, V1: rs(lbb, 'V1'), V6: rs(lbb, 'V6') },
    RBB: { qrs: rbb.qrs, V1: rs(rbb, 'V1') },
    act: { PR: Math.round(t0 - S.log.atrial.filter((a) => a.on < t0).pop().on), total: Math.round(vlast - t0), apexMed: Math.round(apex[apex.length >> 1]), HV: Math.round(t0 - S.tAct[M.his[0]]) },
    dLAD: ['V2', 'V3', 'V4', 'V5', 'V6'].map((l) => +earlyR(dlad, l).toFixed(2)),
    mLAD: ['V1', 'V2', 'V3', 'V4'].map((l) => +earlyR(mlad, l).toFixed(2)),
    pRCA: ['II', 'III', 'aVF'].map((l) => +earlyR(prca, l).toFixed(2)),
  };
  // score: distance from targets (0 = all met)
  const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const N = m.N, pr = N.prog;
  let s = 0;
  s += pen(N.axis, 35, 70) / 8 + pen(N.net, 30, 70) / 8;
  s += pen(m.LAF.net, -80, -45) / 8 + pen(m.LAF.axis, -85, -40) / 15;
  s += pen(m.LPF.net, 100, 150) / 8 + pen(m.LPF.axis, 95, 150) / 15;
  s += pen(m.LBB.axis, -30, 60) / 12 + pen(m.LBB.qrs, 130, 170) / 10 + pen(m.RBB.qrs, 115, 160) / 10;
  s += pen(N.qrs, 80, 100) / 5 + pen(m.LAF.qrs, 85, 115) / 10 + pen(m.LPF.qrs, 85, 115) / 10;
  s += pen(N.qI, -0.25, -0.04) * 10 + pen(N.qV6, -0.25, -0.04) * 10 + pen(N.rV1, 0.04, 0.3) * 10;
  s += pen(N.I[0], 0.4, 1.5) * 4 + pen(N.II[0], 0.7, 1.8) * 4;
  for (let i = 0; i < 4; i++) s += Math.max(0, pr[i][0] - pr[i + 1][0]) * 3;           // R grows V1→V4
  s += Math.max(0, pr[3][1] - pr[3][0] - 0.5) * 2 + Math.max(0, pr[0][0] - pr[0][1]) * 3; // transition by V4, rS in V1
  s += pen(m.act.PR, 130, 170) / 5 + pen(m.act.total, 60, 85) / 5 + pen(m.act.apexMed, 0, 22) / 3 + pen(m.act.HV, 30, 55) / 5;
  s += m.dLAD.slice(1, 4).reduce((a, x) => a + Math.max(0, x - 0.1), 0) * 8;              // apical infarct: QS/Q in V3–V5
  s += m.mLAD.reduce((a, x) => a + Math.max(0, x - 0.1), 0) * 8;
  s += m.pRCA.reduce((a, x) => a + Math.max(0, x - 0.4), 0) * 2;                          // inferior: Q before any R
  return { score: +s.toFixed(2), m };
}
module.exports = { evaluate };
if (require.main === module) for (const p of JSON.parse(process.argv[2] || '[{}]')) { const r = evaluate(p); console.log(JSON.stringify({ p, ...r })); }
