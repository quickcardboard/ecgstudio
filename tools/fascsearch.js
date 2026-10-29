// Score sinus, LAFB and LPFB together for parameter sets.
//   node tools/fascsearch.js '[{...},{...}]'     evaluate a list
// Prints axis/QRS/morphology for each and a combined score (lower is better).
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const BLOCKALL = !!process.env.BLOCKALL;
const LEAD = (n) => LH.LEADS.indexOf(n);

function beat(M, blk) {
  const S = new LH.Sim(M, { seed: 1 }); const rec = [];
  S.onSample((t, L) => rec.push(Array.from(L)));
  for (const c of blk) S.blocked[c] = 1;
  S.run(2700);
  const vb = S.log.vent[S.log.vent.length - 2];
  const q0 = Math.floor(vb.on), q1 = Math.ceil(vb.last) + 2, base = rec[q0 - 15];
  const y = (k) => rec.slice(q0, q1).map((r) => r[k] - base[k]);
  const area = (k) => y(k).reduce((a, b) => a + b, 0);
  const axis = Math.round(Math.atan2(area(LEAD('aVF')), area(LEAD('I'))) * 180 / Math.PI);
  const rs = (n) => { const v = y(LEAD(n)); return [Math.max(...v), -Math.min(...v)]; };
  const init = (n) => { const v = y(LEAD(n)).slice(0, 20); return v.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0); };
  // clinical (net-deflection) axis: R − S in I and aVF
  const net = (n) => { const v = rs(n); return v[0] - v[1]; };
  const ampAxis = Math.round(Math.atan2(net('aVF'), net('I')) * 180 / Math.PI);
  return { axis, ampAxis, qrs: q1 - q0, rs, init };
}

function evaluate(p) {
  const M = new LH.Model(A, p);
  const n = beat(M, []), lafb = beat(M, BLOCKALL ? M.csSegments.LAF : M.csSegments.LAF.slice(0, 3)), lpfb = beat(M, BLOCKALL ? M.csSegments.LPF : M.csSegments.LPF.slice(0, 3));
  const prog = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map((k) => n.rs(k));
  // score: distance from teaching targets
  const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  let score = 0;
  score += pen(n.axis, 20, 75) / 10 + pen(n.ampAxis, 20, 75) / 10;
  score += pen(lafb.ampAxis, -90, -45) / 10 + pen(lafb.axis, -90, -30) / 20;
  score += pen(lpfb.ampAxis, 100, 150) / 10 + pen(lpfb.axis, 90, 150) / 20;
  // LAFB: rS in II/III/aVF and qR in aVL; LPFB: rS in I and qR in III
  for (const k of ['II', 'III', 'aVF']) score += Math.max(0, lafb.rs(k)[0] - lafb.rs(k)[1]) * 2;
  score += Math.max(0, lpfb.rs('I')[0] - lpfb.rs('I')[1]) * 2 + Math.max(0, lpfb.rs('III')[1] - lpfb.rs('III')[0]) * 2;
  score += pen(n.qrs, 75, 100) / 10 + pen(lafb.qrs, 80, 115) / 10 + pen(lpfb.qrs, 80, 115) / 10;
  score += pen(n.init('I'), -0.25, -0.04) * 10 + pen(n.init('V1'), 0.04, 0.3) * 10 + pen(n.init('V6'), -0.25, -0.03) * 10;
  // R progression: R should rise V1→V4, transition (R≥S) by V4
  for (let i = 0; i < 3; i++) score += Math.max(0, prog[i][0] - prog[i + 1][0]) * 3;
  score += Math.max(0, prog[3][1] - prog[3][0] - 0.3) * 2 + Math.max(0, prog[0][0] - prog[0][1]) * 3;
  const f = (r) => r.map((v) => v.toFixed(1)).join('/');
  return {
    score: +score.toFixed(2),
    normal: `axis ${n.axis}/${n.ampAxis} QRS ${n.qrs} q(I) ${n.init('I').toFixed(2)} r(V1) ${n.init('V1').toFixed(2)} prog ${prog.map(f).join(' ')}`,
    LAFB: `axis ${lafb.axis}/${lafb.ampAxis} QRS ${lafb.qrs} II ${f(lafb.rs('II'))} aVF ${f(lafb.rs('aVF'))} aVL ${f(lafb.rs('aVL'))} init aVF ${lafb.init('aVF').toFixed(2)}`,
    LPFB: `axis ${lpfb.axis}/${lpfb.ampAxis} QRS ${lpfb.qrs} I ${f(lpfb.rs('I'))} III ${f(lpfb.rs('III'))} init I ${lpfb.init('I').toFixed(2)}`,
  };
}
module.exports = evaluate;
if (require.main === module) for (const p of JSON.parse(process.argv[2])) { const r = evaluate(p); console.log(JSON.stringify(p)); console.log('   score', r.score, '\n   normal', r.normal, '\n   LAFB  ', r.LAFB, '\n   LPFB  ', r.LPFB); }
