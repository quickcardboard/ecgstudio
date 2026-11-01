// Activation-only tuning target: score a parameter set against measured human
// activation data (Durrer et al. 1970, isolated human hearts; clinical HV/PR),
// without looking at the ECG.
//   node tools/acttune.js '[{...}]'          require('./acttune.js').evaluate(p)
const fs = require('fs'); const LH = require('../src/engine.js');
const JSONA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const anat = new Map();
const anatomy = (lv, rv) => { const k = lv + '/' + rv; if (!anat.has(k)) anat.set(k, new LH.Anatomy(JSONA, { lvWallLayers: lv, rvWallLayers: rv })); return anat.get(k); };
const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : NaN);

function evaluate(p) {
  const { lv = 2, rv = 0, ...mp } = p;
  const A = anatomy(lv, rv), M = new LH.Model(A, mp);
  const S = new LH.Sim(M, { seed: 1 }); S.run(1700);
  const vb = S.log.vent[S.log.vent.length - 1], t0 = vb.on;
  const g = {}; const add = (k, t) => (g[k] = g[k] || []).push(t);
  for (let c = 0; c < A.n; c++) {
    const L = A.label[c]; if (L !== 1 && L !== 2) continue;
    const t = S.tAct[c] - t0; if (!(t > -5 && t < 250)) continue;
    const z = A.zuvc[c], ph = A.phi[c], tm = A.tm[c];
    if (L === 2) { add(A.epi[c] ? 'RVepi' : 'RVendo', t); if (A.epi[c] && z > 0.75) add('RVbaseEpi', t); continue; }
    const endo = tm >= 0 && tm < 0.15, epi = tm > 0.85;
    if (endo) {
      add('LVendo', t);
      if (z < 0.3) add('apexEndo', t);
      if (ph > 1.0 && ph < 2.2 && z > 0.6) add('antParasept', t);          // high anterior paraseptal
      if (Math.abs(ph) < 0.5 && z > 0.35 && z < 0.7) add('midSeptL', t);    // central left septal surface
      if (ph < -1.0 && ph > -2.2 && z > 0.2 && z < 0.5) add('postParasept', t); // posterior paraseptal, ~1/3 from apex
      if (!(ph < -0.7 && ph > -2.6 && z > 0.65)) add('LVendoNotPostBase', t);
    }
    if (Math.abs(ph) < 0.6 && epi) add('septR', t);                           // RV side of the septum
    if (Math.abs(ph) < 0.6 && endo) add('septL', t);
    if (epi && !(Math.abs(ph) < 0.6)) add('LVepi', t);
    if (epi && ph < -0.7 && ph > -2.9 && z > 0.6) add('LVpostBaseEpi', t);
  }
  for (const k of Object.keys(g)) g[k].sort((a, b) => a - b);
  const total = vb.last - t0;
  const m = {
    early: { ant: q(g.antParasept, 0.02), sept: q(g.midSeptL, 0.02), post: q(g.postParasept, 0.02) },
    LVendo75: q(g.LVendoNotPostBase, 0.75), apexMed: q(g.apexEndo, 0.5),
    RVfirst: q(g.RVendo, 0.01), RVbreak: q(g.RVepi, 0.01), LVbreak: q(g.LVepi, 0.01),
    septL: q(g.septL, 0.5), septR: q(g.septR, 0.5),
    lateLVpostBase: q(g.LVpostBaseEpi, 0.9), lateRVbase: q(g.RVbaseEpi, 0.9), total,
    HV: t0 - S.tAct[M.his[0]], PR: t0 - S.log.atrial.filter((a) => a.on < t0).pop().on,
  };
  for (const k of Object.keys(m)) if (typeof m[k] === 'number') m[k] = Math.round(m[k]); else for (const j of Object.keys(m[k])) m[k][j] = Math.round(m[k][j]);
  const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  let s = 0;
  for (const v of Object.values(m.early)) s += pen(v, 0, 6) / 2;                       // three earliest LV sites
  s += pen(m.LVendo75, 10, 30) / 2 + pen(m.apexMed, 8, 24) / 2;
  s += pen(m.RVfirst, 4, 12) / 2 + pen(m.RVbreak, 15, 28) / 3 + Math.max(0, m.RVbreak - m.LVbreak + 3) / 2;   // RV breaks through first
  s += Math.max(0, m.septL - m.septR + 10) / 3;                                            // septum left → right
  s += pen(m.total, 65, 80) / 2;
  s += Math.max(0, Math.max(m.lateLVpostBase, m.lateRVbase) - m.total + 12) / 3;          // latest: posterobasal LV / RV base
  s += pen(m.HV, 35, 55) / 3 + pen(m.PR, 130, 170) / 5;
  return { score: +s.toFixed(2), m };
}
module.exports = { evaluate };
if (require.main === module) for (const p of JSON.parse(process.argv[2] || '[{}]')) console.log(JSON.stringify({ p, ...evaluate(p) }));
