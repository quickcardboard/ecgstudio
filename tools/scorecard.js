// Textbook scorecard: the model's measurements against fixed textbook targets, scenario by scenario, independent of
// the blind reader's verdicts (tools/reader.js). Amplitudes in mm at 10 mm/mV, times in ms.
//   node tools/scorecard.js ['{params}'] [scenario,...]      (TV2=<torso field> for a variant's solved torso)
//   JSON=1: one JSON line per scenario
// Sources for the ranges: ACC/AHA/HRS 2009 recommendations (intraventricular conduction, hypertrophy), Fourth Universal
// Definition of MI (Q waves), Goldberger's Clinical Electrocardiography and Chou's Electrocardiography in Clinical
// Practice (normal amplitudes, block morphology). Ranges are deliberately generous: a miss means clearly not textbook.
const fs = require('fs'), path = require('path');
const LH = require('../src/engine.js');
LH.setDefaultTorso(null); LH.setDefaultTorso2(JSON.parse(fs.readFileSync(process.env.TV2 || path.join(__dirname, '../src/torso_limb.json'))));
const { read, MI } = require('./reader.js');
const P = JSON.parse(process.argv[2] || '{}'), ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const JA = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/anatomy.json')));
const models = {};
const model = (hyp) => { const k = JSON.stringify(hyp || {}); if (!models[k]) { const H = LH.hypertrophyOptions(hyp || {}); models[k] = new LH.Model(new LH.Anatomy(JSON.parse(JSON.stringify(JA)), H.anatomy), { ...H.params, ...P }); } return models[k]; };

// measurement helpers on a reader result r
const mm = (x) => +(x * 10).toFixed(1);
const R = (r, n) => mm(r.L[n].R), S = (r, n) => mm(r.L[n].S), T = (r, n) => mm(r.L[n].T);
const qd = (r, n) => r.L[n].q.dur, qa = (r, n) => mm(r.L[n].q.amp);
const smallQ = (r, n) => r.L[n].qs ? false : qd(r, n) < 30 || qa(r, n) > -1;          // below the infarct criteria (4th UDMI)
const smallQ23 = (r, n) => !r.L[n].qs && qd(r, n) < 20;                                 // V2–V3: any Q ≥ 20 ms is pathological
const T_ = (lo, hi) => (v) => v >= lo && v <= hi;

// each check: [label, value(r), test(value)]
const SC = {
  normal: { checks: [
    ['QRS 70–100 ms', (r) => r.m.qrs, T_(70, 100)], ['PR 120–200 ms', (r) => r.m.pr, T_(120, 200)], ['QTc 350–450 ms', (r) => r.m.qtc, T_(350, 450)],
    ['axis 0–75° (adult mean ~+50°)', (r) => r.m.axis, T_(0, 75)], ['P II 1–2.5 mm', (r) => mm(r.m.pAmp.II), T_(1, 2.5)],
    ['R I 3–12', (r) => R(r, 'I'), T_(3, 12)], ['R II 5–17', (r) => R(r, 'II'), T_(5, 17)], ['R aVL < 11', (r) => R(r, 'aVL'), T_(0, 11)],
    ['V1 rS: R 0.5–5, S 3–15', (r) => [R(r, 'V1'), S(r, 'V1')], ([a, b]) => a >= 0.5 && a <= 5 && b >= 3 && b <= 15],
    ['R V3 2–12', (r) => R(r, 'V3'), T_(2, 12)], ['R V4 ≥ R V3 (progression)', (r) => [R(r, 'V3'), R(r, 'V4')], ([a, b]) => b >= a],
    ['R V5 7–22', (r) => R(r, 'V5'), T_(7, 22)], ['R V6 5–20', (r) => R(r, 'V6'), T_(5, 20)],
    ['septal q V6 small (< 30 ms, > −2 mm)', (r) => [qd(r, 'V6'), qa(r, 'V6')], ([d, a]) => d < 30 && a > -2],
    ['inferior q small (II, aVF < 30 ms or > −1 mm)', (r) => ['II', 'aVF'].map((n) => qd(r, n) + '/' + qa(r, n)), (v, r) => smallQ(r, 'II') && smallQ(r, 'aVF')],
    ['T upright I, II, V3–V6 (≥ 1 mm)', (r) => ['I', 'II', 'V3', 'V4', 'V5', 'V6'].map((n) => T(r, n)), (v) => v.every((x) => x >= 1)],
    ['T V5 ≥ 1.5 mm, T aVL ≥ 0', (r) => [T(r, 'V5'), T(r, 'aVL')], ([a, b]) => a >= 1.5 && b >= 0],
  ] },
  LAFB: { set: (S) => S.setBlock('LAF', 'complete'), checks: [
    ['axis −45 to −90°', (r) => r.m.axis, T_(-90, -45)], ['QRS < 120 ms', (r) => r.m.qrs, T_(0, 119)],
    ['qR in aVL (small q)', (r) => [qd(r, 'aVL'), qa(r, 'aVL'), R(r, 'aVL')], (v, r) => qd(r, 'aVL') > 0 && smallQ(r, 'aVL') && r.L.aVL.R > r.L.aVL.S],
    ['rS in II, III, aVF', (r) => ['II', 'III', 'aVF'].map((n) => R(r, n) + '/' + S(r, n)), (v, r) => ['II', 'III', 'aVF'].every((n) => r.L[n].S > r.L[n].R)],
    ['S III 10–25', (r) => S(r, 'III'), T_(10, 25)], ['R aVL 5–14', (r) => R(r, 'aVL'), T_(5, 14)],
    ['small r in V1–V3 (≥ 1 mm, no QS)', (r) => ['V1', 'V2', 'V3'].map((n) => R(r, n)), (v, r) => ['V1', 'V2', 'V3'].every((n) => R(r, n) >= 1 && !r.L[n].qs)],
    ['no pathological Q (I, aVL, V2–V6)', (r) => ['I', 'aVL', 'V2', 'V3', 'V4', 'V5', 'V6'].map((n) => qd(r, n)), (v, r) => smallQ(r, 'I') && smallQ(r, 'aVL') && smallQ23(r, 'V2') && smallQ23(r, 'V3') && ['V4', 'V5', 'V6'].every((n) => smallQ(r, n))],
  ] },
  LPFB: { set: (S) => S.setBlock('LPF', 'complete'), checks: [
    ['axis 90–180°', (r) => r.m.axis, T_(90, 180)], ['QRS < 120 ms', (r) => r.m.qrs, T_(0, 119)],
    ['rS in I and aVL', (r) => ['I', 'aVL'].map((n) => R(r, n) + '/' + S(r, n)), (v, r) => ['I', 'aVL'].every((n) => r.L[n].S > r.L[n].R)],
    ['qR in III and aVF (small q)', (r) => ['III', 'aVF'].map((n) => qd(r, n) + '/' + R(r, n)), (v, r) => ['III', 'aVF'].every((n) => qd(r, n) > 0 && r.L[n].R > r.L[n].S) && smallQ(r, 'aVF')],
    ['R III 8–20', (r) => R(r, 'III'), T_(8, 20)], ['R II, aVF ≤ 20', (r) => [R(r, 'II'), R(r, 'aVF')], ([a, b]) => a <= 20 && b <= 20],
  ] },
  LBBB: { set: (S) => S.setBlock('LBB', 'complete'), checks: [
    ['QRS ≥ 120 ms', (r) => r.m.qrs, T_(120, 200)], ['axis −30 to +90°', (r) => r.m.axis, T_(-30, 90)],
    ['QS or rS in V1', (r) => [R(r, 'V1'), S(r, 'V1')], (v, r) => r.L.V1.qs || r.L.V1.R < r.L.V1.neg],
    ['broad R, no q in I, V5, V6', (r) => ['I', 'V5', 'V6'].map((n) => qd(r, n) + '/' + R(r, n)), (v, r) => ['I', 'V6'].every((n) => qd(r, n) === 0 && r.L[n].R > 0.3)],
    ['R peak time V5/V6 > 60 ms', (r) => Math.max(r.L.V5.rpt, r.L.V6.rpt), T_(61, 200)],
  ] },
  RBBB: { set: (S) => S.setBlock('RBB', 'complete'), checks: [
    ['QRS ≥ 120 ms', (r) => r.m.qrs, T_(120, 200)], ['axis −30 to +90°', (r) => r.m.axis, T_(-30, 90)],
    ["rsR′ (or broad R) in V1", (r) => [R(r, 'V1'), mm(r.L.V1.rPrime)], (v, r) => (r.L.V1.rPrime > 0 && r.L.V1.rPrime > r.L.V1.rFirst) || (r.L.V1.R > r.L.V1.S && r.L.V1.rpt > 50)],
    ['wide S in I and V6 (≥ 40 ms)', (r) => [r.L.I.sWide, r.L.V6.sWide], ([a, b]) => a >= 40 || b >= 40],
    ['no pathological Q', (r) => ['II', 'aVF', 'I', 'aVL'].map((n) => qd(r, n)), (v, r) => ['II', 'aVF', 'I', 'aVL'].every((n) => smallQ(r, n))],
  ] },
  LVH: { hyp: { lvh: true }, checks: [
    ['Sokolow-Lyon ≥ 35', (r) => S(r, 'V1') + Math.max(R(r, 'V5'), R(r, 'V6')), T_(35, 80)], ['QRS < 120 ms', (r) => r.m.qrs, T_(0, 119)],
    ['axis −30 to +90°', (r) => r.m.axis, T_(-30, 90)], ['strain: T inverted V5–V6 (≤ −1 mm)', (r) => [T(r, 'V5'), T(r, 'V6')], ([a, b]) => a <= -1 && b <= -1],
  ] },
  RVH: { hyp: { rvh: true }, checks: [
    ['axis > 90°', (r) => r.m.axis, (v) => v > 90 || v < -150], ['R V1 ≥ 7 or R/S V1 > 1', (r) => [R(r, 'V1'), S(r, 'V1')], ([a, b]) => a >= 7 || a > b],
    ['T inverted V1–V2', (r) => [T(r, 'V1'), T(r, 'V2')], ([a, b]) => a < 0 && b < 0], ['QRS < 120 ms', (r) => r.m.qrs, T_(0, 119)],
  ] },
};
// infarcts: the lead pattern and size against textbook (ST at 1 h, Q and T at 30 days)
const occ = (site, h) => (S, M) => { S.addOcclusion(MI[site].f(M.coronary.branches)); S.setIschemiaTime(h); };
const ste = (r, n) => mm(r.L[n].stJ);
Object.assign(SC, {
  'mLAD 1 h': { set: occ('mLAD', 1), checks: [['ST ↑ ≥ 2 mm in V2–V4', (r) => ['V2', 'V3', 'V4'].map((n) => ste(r, n)), (v) => v.every((x) => x >= 2)], ['no ST ↑ in II, III, aVF', (r) => ['II', 'III', 'aVF'].map((n) => ste(r, n)), (v) => v.every((x) => x < 1)]] },
  'mLAD 30 d': { set: occ('mLAD', 720), checks: [['Q/QS in V2–V3', (r) => ['V2', 'V3'].map((n) => qd(r, n) + (r.L[n].qs ? 'QS' : '')), (v, r) => ['V2', 'V3'].every((n) => !smallQ23(r, n))], ['T inverted V2–V4', (r) => ['V2', 'V3', 'V4'].map((n) => T(r, n)), (v) => v.every((x) => x < 0)], ['axis −30 to +90° (no RAD)', (r) => r.m.axis, T_(-30, 90)]] },
  'mRCA 1 h': { set: occ('mRCA', 1), checks: [['ST ↑ ≥ 1 mm in II, III, aVF', (r) => ['II', 'III', 'aVF'].map((n) => ste(r, n)), (v) => v.every((x) => x >= 1)], ['reciprocal ST ↓ in aVL', (r) => ste(r, 'aVL'), (v) => v <= -0.5], ['ST III > ST II', (r) => [ste(r, 'III'), ste(r, 'II')], ([a, b]) => a > b]] },
  'mRCA 30 d': { set: occ('mRCA', 720), checks: [['Q ≥ 30 ms in II or aVF and III', (r) => ['II', 'III', 'aVF'].map((n) => qd(r, n)), (v, r) => (!smallQ(r, 'II') || !smallQ(r, 'aVF')) && qd(r, 'III') >= 30], ['Q III −3 to −12 mm', (r) => qa(r, 'III'), T_(-12, -3)], ['T III −0.5 to −5 mm', (r) => T(r, 'III'), T_(-5, -0.5)], ['R aVL < 11', (r) => R(r, 'aVL'), T_(0, 11)], ['T I, aVL ≤ 5 mm', (r) => [T(r, 'I'), T(r, 'aVL')], (v) => v.every((x) => x <= 5)]] },
  'pLCx 1 h': { set: occ('pLCx', 1), checks: [['ST ↑ in I, aVL or V5–V6 (≥ 1 mm, 2 leads)', (r) => ['I', 'aVL', 'V5', 'V6'].map((n) => ste(r, n)), (v) => (v[0] >= 1 && v[1] >= 1) || (v[2] >= 1 && v[3] >= 1)], ['ST ↓ in V1–V3 (posterior)', (r) => ['V1', 'V2', 'V3'].map((n) => ste(r, n)), (v) => v.filter((x) => x <= -0.5).length >= 2]] },
  'pLCx 30 d': { set: occ('pLCx', 720), checks: [['Q in I+aVL or V5+V6', (r) => ['I', 'aVL', 'V5', 'V6'].map((n) => qd(r, n)), (v, r) => (!smallQ(r, 'I') && !smallQ(r, 'aVL')) || (!smallQ(r, 'V5') && !smallQ(r, 'V6'))], ['tall R V1–V2 (R/S ≥ 1 in V2)', (r) => [R(r, 'V2'), S(r, 'V2')], ([a, b]) => a >= b]] },
});

const rows = [];
let pass = 0, tot = 0;
for (const [name, sc] of Object.entries(SC)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const M = model(sc.hyp), S = new LH.Sim(M, { seed: 1 }); if (sc.set) sc.set(S, M);
  const rec = []; S.onSample((t, v) => rec.push(Array.from(v))); S.run(3600);
  const v = S.log.vent, vb = v[v.length - 2], rr = vb.on - v[v.length - 3].on, r = read(rec, Math.round(vb.on), rr);
  const res = sc.checks.map(([label, val, test]) => { const x = val(r); let ok = false; try { ok = !!test(x, r); } catch (e) { ok = false; } return { label, value: x, ok }; });
  const n = res.filter((c) => c.ok).length; pass += n; tot += res.length;
  rows.push({ scen: name, pass: n, of: res.length, res });
  if (process.env.JSON) console.log(JSON.stringify(rows[rows.length - 1]));
  else { console.log(`${name.padEnd(10)} ${n}/${res.length}`); for (const c of res) if (!c.ok || process.env.ALL) console.log(`   ${c.ok ? 'ok  ' : 'MISS'} ${c.label}: ${JSON.stringify(c.value)}`); }
}
console.log(`scorecard ${pass}/${tot}`);
