// Activation-only tuning target: score a parameter set against measured human
// activation data, without looking at the ECG: normal ventricles (Durrer et al.
// 1970), LBBB and RBBB endocardial mapping (e.g. Vassallo 1984, Auricchio 2004),
// atrial mapping (e.g. Lemery 2007), clinical HV/PR. Target ranges are
// approximate literature values.
//   node tools/acttune.js '[{...}]'          require('./acttune.js').evaluate(p)
const fs = require('fs'); const LH = require('../src/engine.js');
const JSONA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const anat = new Map();
const anatomy = (lv, rv) => { const k = lv + '/' + rv; if (!anat.has(k)) anat.set(k, new LH.Anatomy(JSONA, { lvWallLayers: lv, rvWallLayers: rv })); return anat.get(k); };
const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : NaN);

// activation times by region, relative to t0
function regions(A, S, t0) {
  const g = {}; const add = (k, t) => (g[k] = g[k] || []).push(t);
  for (let c = 0; c < A.n; c++) {
    const L = A.label[c]; if (L !== 1 && L !== 2) continue;
    const t = S.tAct[c] - t0; if (!(t > -5 && t < 250)) continue;
    const z = A.zuvc[c], ph = A.phi[c], tm = A.tm[c];
    if (L === 2) { add(A.epi[c] ? 'RVepi' : 'RVendo', t); if (A.epi[c] && z > 0.75) add('RVbaseEpi', t); continue; }
    const rvFace = !!(A.endo[c] & 4), lvFace = !!(A.endo[c] & 2);        // septal faces (the septum's tm is ~0 on both sides)
    const endo = tm >= 0 && tm < 0.15 && !rvFace, epi = tm > 0.85 && !rvFace;
    if (endo) {
      add('LVendo', t);
      if (z < 0.3) add('apexEndo', t);
      if (ph > 1.0 && ph < 2.2 && z > 0.6) add('antParasept', t);          // high anterior paraseptal
      if (Math.abs(ph) < 0.5 && z > 0.35 && z < 0.7) add('midSeptL', t);    // central left septal surface
      if (ph < -1.0 && ph > -2.2 && z > 0.2 && z < 0.5) add('postParasept', t); // posterior paraseptal, ~1/3 from apex
      if (!(ph < -0.7 && ph > -2.6 && z > 0.65)) add('LVendoNotPostBase', t);
    }
    if (Math.abs(ph) < 0.8 && rvFace) add('septR', t);                        // RV face of the septum
    if (Math.abs(ph) < 0.8 && lvFace) add('septL', t);                        // LV face of the septum
    if (epi && !(Math.abs(ph) < 0.6)) add('LVepi', t);
    if (epi && ph < -0.7 && ph > -2.9 && z > 0.6) add('LVpostBaseEpi', t);
    if (epi && Math.abs(ph) > 2.2 && z > 0.55) add('LVlatBaseEpi', t);
  }
  for (const k of Object.keys(g)) g[k].sort((a, b) => a - b);
  return g;
}
// atrial activation (sinus beat): earliest site, LA entry (Bachmann), LA appendage, total, latest regions
function atrial(A, M, S) {
  const v = S.log.vent[S.log.vent.length - 1], a = S.log.atrial.filter((x) => x.on < v.on).pop(), t0 = a.on;   // last complete sinus beat
  const lm = A.landmarks, near = (c, p, r) => Math.hypot(...A.p(c).map((v, i) => v - p[i])) < r;
  let first = -1, ft = Infinity; const la = [], all = [], laa = [];
  for (let c = 0; c < A.n; c++) {
    const L = A.label[c]; if (L !== 3 && L !== 4) continue;
    const t = S.tAct[c] - t0; if (!(t > -5 && t < 250)) continue;
    if (t < ft) { ft = t; first = c; }
    all.push([t, L]); if (L === 3) la.push(t); if (L === 3 && near(c, lm.LAA.c, 15)) laa.push(t);
  }
  la.sort((x, y) => x - y); laa.sort((x, y) => x - y); all.sort((x, y) => x[0] - y[0]);
  const late = all.slice(Math.floor(all.length * 0.95));
  const r = (v) => Math.round(v);
  return { firstToSVC: r(Math.hypot(...A.p(first).map((v, i) => v - lm.SVC.c[i]))), LAfirst: r(q(la, 0.01)), LAA: r(q(laa, 0.5)),
    total: r(all[all.length - 1][0]), lateLA: +(late.filter((x) => x[1] === 3).length / late.length).toFixed(2) };
}

function evaluate(p) {
  const { lv = 2, rv = 0, ...mp } = p;
  const A = anatomy(lv, rv), M = new LH.Model(A, mp);
  const S = new LH.Sim(M, { seed: 1 }); S.run(1700);
  const vb = S.log.vent[S.log.vent.length - 1], t0 = vb.on;
  const g = regions(A, S, t0);
  // bundle branch blocks (mapping data) and the atria
  const bbb = (site) => { const B = new LH.Sim(M, { seed: 1 }); B.setBlock(site, 'complete'); B.run(1700); const v = B.log.vent[B.log.vent.length - 1]; return { g: regions(A, B, v.on), total: v.last - v.on }; };
  const lb = bbb('LBB'), rb = bbb('RBB');
  const atr = atrial(A, M, S);
  const total = vb.last - t0;
  const m = {
    early: { ant: q(g.antParasept, 0.02), sept: q(g.midSeptL, 0.02), post: q(g.postParasept, 0.02) },
    LVendo75: q(g.LVendoNotPostBase, 0.75), apexMed: q(g.apexEndo, 0.5),
    RVfirst: q(g.RVendo, 0.01), RVbreak: q(g.RVepi, 0.01), LVbreak: q(g.LVepi, 0.01),
    septL: q(g.septL, 0.5), septR: q(g.septR, 0.5),
    lateLVpostBase: q(g.LVpostBaseEpi, 0.9), lateRVbase: q(g.RVbaseEpi, 0.9), total,
    HV: t0 - S.tAct[M.his[0]], PR: t0 - S.log.atrial.filter((a) => a.on < t0).pop().on,
    LBBB: { total: lb.total, RVfirst: q(lb.g.RVendo, 0.01), transsept: q(lb.g.septL, 0.5) - q(lb.g.septR, 0.5), lateLat: q(lb.g.LVlatBaseEpi, 0.9) },
    RBBB: { total: rb.total, LVendo75: q(rb.g.LVendoNotPostBase, 0.75), sept: q(rb.g.septR, 0.5) - q(rb.g.septL, 0.5), lateRV: q(rb.g.RVbaseEpi, 0.9) },
    atria: atr,
  };
  for (const k of Object.keys(m)) if (typeof m[k] === 'number') m[k] = Math.round(m[k]); else for (const j of Object.keys(m[k])) m[k][j] = +(+m[k][j]).toFixed(2);
  const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  let s = 0;
  for (const v of Object.values(m.early)) s += pen(v, 0, 6) / 2;                       // three earliest LV sites
  s += pen(m.LVendo75, 10, 30) / 2 + pen(m.apexMed, 8, 24) / 2;
  s += pen(m.RVfirst, 4, 12) / 2 + pen(m.RVbreak, 15, 28) / 3 + Math.max(0, m.RVbreak - m.LVbreak + 3) / 2;   // RV breaks through first
  s += Math.max(0, m.septL - m.septR + 10) / 3;                                            // septum left → right
  s += pen(m.total, 65, 80) / 2;
  s += Math.max(0, Math.max(m.lateLVpostBase, m.lateRVbase) - m.total + 12) / 3;          // latest: posterobasal LV / RV base
  s += pen(m.HV, 35, 55) / 3 + pen(m.PR, 130, 170) / 5;
  // LBBB (endocardial mapping): RV first, slow transseptal conduction, lateral/posterolateral LV base last
  const L = m.LBBB, R = m.RBBB, At = m.atria;
  s += pen(L.total, 120, 180) / 4 + pen(L.RVfirst, 0, 15) / 3 + pen(L.transsept, 25, 60) / 3 + Math.max(0, L.total - 15 - L.lateLat) / 3;
  // RBBB: LV as normal, septum left → right with delay, RV free wall/outflow base last
  s += pen(R.total, 110, 160) / 4 + pen(R.LVendo75, 10, 35) / 3 + pen(R.sept, 15, 50) / 3 + Math.max(0, R.total - 15 - R.lateRV) / 3;
  // atria (electroanatomic/intraoperative mapping): high crista first, LA via Bachmann, LAA, total, LA last
  s += pen(At.firstToSVC, 0, 25) / 3 + pen(At.LAfirst, 20, 45) / 3 + pen(At.LAA, 50, 90) / 4 + pen(At.total, 80, 115) / 4 + pen(At.lateLA, 0.6, 1) * 5;
  return { score: +s.toFixed(2), m };
}
module.exports = { evaluate };
if (require.main === module) for (const p of JSON.parse(process.argv[2] || '[{}]')) console.log(JSON.stringify({ p, ...evaluate(p) }));
