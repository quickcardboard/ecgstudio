// Score for re-fitting the live model (forward model 1) around physiological activation:
//   3 × ischaemia lead-group misses (tools/fullcheck.js; +10 each beyond the live baseline of 5)
// + axis penalties (normal +30–75° per 3°; LAFB −45 to −90°, LPFB +100 to +180°, LBBB −30 to +90°, RVH +110 to +210° per 10°)
// + 0.5 × the cstune ECG checklist (QRS shape, progression, amplitudes, P, hypertrophy)
// + 0.5 × the activation score against mapping data (tools/acttune.js; live baseline 12.8)
//   node tools/refit.js '[{...}]'      require('./refit.js').evaluate(p)
process.env.CS_LITE = process.env.CS_LITE || '1';   // ischaemia is checked by fullcheck, not twice
const { check } = require('./fullcheck.js'); const act = require('./acttune.js');
const BASE_IERR = +(process.env.BASE_IERR || 5);
function evaluate(p) {
  const r = check(p, true), a = act.evaluate(p), ax = r.axes;
  const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const axis = pen(ax.N, 30, 75) / 3 + (pen(ax.LAF, -90, -45) + pen(ax.LPF, 100, 180) + pen(ax.LBB, -30, 90) + pen(ax.RVH, 110, 210)) / 10;   // normal axis weighted most
  const score = 3 * r.iErr + 10 * Math.max(0, r.iErr - BASE_IERR) + axis + 0.5 * r.cs + 0.5 * a.score;
  const miss = Object.entries(r.isch).flatMap(([s, v]) => [...v.steMiss.map((n) => `${s} ste-${n}`), ...v.steBad.map((n) => `${s} STE+${n}`), ...v.qMiss.map((n) => `${s} q-${n}`), ...v.qBad.map((n) => `${s} Q+${n}`)]);
  return { score: +score.toFixed(2), m: { iErr: r.iErr, miss, axes: ax, cs: r.cs, act: a.score, apex: a.m.apexMed, HV: a.m.HV, total: a.m.total, qrs: r.qrs } };
}
module.exports = { evaluate };
if (require.main === module) for (const p of JSON.parse(process.argv[2] || '[{}]')) console.log(JSON.stringify({ p, ...evaluate(p) }));
