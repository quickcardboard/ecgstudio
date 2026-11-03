// Blind 12-lead ECG reader and scenario scorer: "would a cardiologist's reading match the pathology?"
//
// The reader sees only the 12 recorded leads (1 kHz) and reads them with published criteria;
// the scorer runs each condition on an engine, reads the ECG and compares the reading with the
// simulated pathology (required / allowed / unexpected findings).
//   node tools/reader.js [engine.js path] ['{params}'] [scenario,...]
// Criteria: ACC/AHA/HRS 2009 intraventricular conduction (LAFB, LPFB, LBBB, RBBB, IVCD); Sokolow-Lyon
// and Cornell (men) LVH; RVH (RAD with R/S V1 > 1 or R V1 ≥ 0.7 mV); Fourth Universal Definition of
// MI (STEMI: J point ≥ 0.1 mV, V2–V3 ≥ 0.2 mV, two contiguous leads; pathological Q: V2–V3 ≥ 20 ms
// or QS, I/II/aVL/aVF/V4–V6 ≥ 30 ms and ≥ 0.1 mV deep or QS, two contiguous leads; III, aVR and V1
// are not used for Q); QTc (Bazett) > 460 ms long; PR > 200 ms first-degree AV block.
const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'], K = (n) => LEADS.indexOf(n);

// ---------------------------------------------------------------- reader
// rec: array of 12-lead samples (mV, 1 ms); hint: approximate QRS onset index of the beat to read; rr: RR (ms)
function read(rec, hint, rr) {
  const NL = 12, at = (t, k) => rec[Math.max(0, Math.min(rec.length - 1, t))][k];
  // baseline: the flattest 40 ms before the P wave (TP segment)
  let base = null, bestVar = Infinity;
  for (let t0 = hint - 480; t0 <= hint - 160; t0 += 10) {
    let v = 0; const m = new Array(NL).fill(0);
    for (let t = t0; t < t0 + 40; t++) for (let k = 0; k < NL; k++) m[k] += at(t, k) / 40;
    for (let t = t0; t < t0 + 40; t++) for (let k = 0; k < NL; k++) v += (at(t, k) - m[k]) ** 2;
    if (v < bestVar) { bestVar = v; base = m; }
  }
  const x = (t, k) => at(t, k) - base[k];
  const sv = (t) => { let s = 0; for (let k = 0; k < NL; k++) s += Math.abs(at(t + 1, k) - at(t, k)); return s; };   // spatial velocity
  let vmax = 0, tmaxV = hint; for (let t = hint - 40; t < hint + 160; t++) { const v = sv(t); if (v > vmax) { vmax = v; tmaxV = t; } }
  const quiet = (t, n, f) => { for (let i = 0; i < n; i++) if (sv(t + i) >= f * vmax) return false; return true; };
  let on = hint - 40; while (on < tmaxV && quiet(on, 3, 0.05)) on++;
  // QRS end: the first point after the main activity where the signal stays quiet for 8 ms
  let off = tmaxV; while (off < on + 220 && !quiet(off, 8, 0.05)) off++;
  // P wave: spatial magnitude above 0.02 mV before the QRS
  const mag = (t) => { let s = 0; for (let k = 0; k < NL; k++) s += x(t, k) ** 2; return Math.sqrt(s); };
  // (threshold relative to the P wave's own size: 25% of its peak, at least 0.01 mV)
  // P wave: the deflection around the largest atrial peak before the QRS, extended while above
  // 8% of that peak (at least 0.006 mV)
  let pmx = 0, ppk = null; for (let t = on - 360; t < on - 30; t++) { const v = mag(t); if (v > pmx) { pmx = v; ppk = t; } }
  const pth = Math.max(0.006, 0.08 * pmx);
  let pOn = null, pOff = null;
  if (ppk !== null && pmx > 0.02) { pOn = ppk; while (pOn > on - 400 && mag(pOn - 1) > pth) pOn--; pOff = ppk; while (pOff < on - 5 && mag(pOff + 1) > pth) pOff++; }
  const pr = pOn !== null ? on - pOn : null, pdur = pOn !== null ? pOff - pOn : null;
  // T wave end: after the T peak, where the magnitude falls under 10% of the peak
  let tpk = off + 60, tmx = 0; for (let t = off + 40; t < off + 420; t++) if (mag(t) > tmx) { tmx = mag(t); tpk = t; }
  let tend = tpk; while (tend < tpk + 250 && mag(tend) > 0.1 * tmx) tend++;
  const qt = tend - on, qtc = qt / Math.sqrt((rr || 833) / 1000);
  // per-lead QRS measurements
  const L = {};
  for (const n of LEADS) {
    const k = K(n), s = []; for (let t = on; t <= off; t++) s.push(x(t, k));
    const thr = 0.025; let i0 = 0; while (i0 < s.length && Math.abs(s[i0]) < thr) i0++;
    let qDur = 0, qAmp = 0;
    if (i0 < s.length && s[i0] < 0) { let i = i0; while (i < s.length && s[i] < 0) { qAmp = Math.min(qAmp, s[i]); i++; } qDur = i; }
    const maxP = Math.max(0, ...s), minN = Math.min(0, ...s), rpt = s.indexOf(Math.max(...s));
    // R and S: the largest positive peak and the most negative point after it; R′: a second positive peak after an S
    let S = 0; for (let i = rpt; i < s.length; i++) S = Math.min(S, s[i]);
    const peaks = []; for (let i = 1; i < s.length - 1; i++) if (s[i] > 0.08 && s[i] >= s[i - 1] && s[i] > s[i + 1]) peaks.push(i);
    let rPrime = 0, rFirst = maxP;
    if (peaks.length >= 2) {
      const a = peaks[0], b = peaks[peaks.length - 1]; let dip = Infinity; for (let i = a; i <= b; i++) dip = Math.min(dip, s[i]);
      if (dip < Math.min(s[a], s[b]) - 0.08) { rFirst = s[a]; rPrime = s[b]; }
    }
    const qs = maxP < 0.1 && minN <= -0.3;   // QS (a tiny r is allowed)
    // slurred/notched broad R: positive for ≥ 60% of the QRS and R peak late
    const posShare = s.filter((v) => v > 0.05).length / s.length;
    const sWide = (() => { let n2 = 0; for (let i = rpt; i < s.length; i++) if (s[i] < -0.05) n2++; return n2; })();
    L[n] = { q: { dur: qDur, amp: +qAmp.toFixed(2) }, R: +maxP.toFixed(2), S: +(-S).toFixed(2), neg: +(-minN).toFixed(2), net: +(maxP + minN).toFixed(2), rpt, qs, rFirst: +rFirst.toFixed(2), rPrime: +rPrime.toFixed(2), posShare: +posShare.toFixed(2), sWide,
      stJ: +x(off, k).toFixed(2), st40: +x(off + 40, k).toFixed(2), T: +(() => { let b2 = 0; for (let t = off + 40; t < tend; t++) if (Math.abs(x(t, k)) > Math.abs(b2)) b2 = x(t, k); return b2; })().toFixed(2) };
  }
  const qrs = off - on, axis = Math.round(Math.atan2((2 / Math.sqrt(3)) * L.aVF.net, L.I.net) * 180 / Math.PI);
  return { m: { qrs, pr, pdur, qt, qtc: Math.round(qtc), axis, rate: Math.round(60000 / (rr || 833)) }, L, interpret };
  function interpret() { return diagnose({ qrs, pr, qtc, axis }, L); }
}

// ---------------------------------------------------------------- criteria
// high lateral (I, aVL) marks an LAD occlusion before D1 or a circumflex/diagonal territory; low lateral (V5, V6)
// extends an anterior STEMI ('anterolateral') or belongs to the circumflex
const GROUPS = { septal: ['V1', 'V2'], anterior: ['V3', 'V4'], lowLateral: ['V5', 'V6'], highLateral: ['I', 'aVL'], inferior: ['II', 'III', 'aVF'] };
const NEXT = { II: ['III', 'aVF'], III: ['II', 'aVF'], aVF: ['II', 'III'], I: ['aVL'], aVL: ['I'], V1: ['V2'], V2: ['V1', 'V3'], V3: ['V2', 'V4'], V4: ['V3', 'V5'], V5: ['V4', 'V6'], V6: ['V5'] };
const contiguous = (set) => set.filter((n) => (NEXT[n] || []).some((m) => set.includes(m)));
const territories = (leads) => Object.entries(GROUPS).filter(([, g]) => g.some((n) => leads.includes(n))).map(([t]) => t);
function diagnose(m, L) {
  const dx = [], f = {};
  // axis
  f.axis = m.axis < -30 ? 'LAD' : m.axis > 90 ? 'RAD' : 'normal';
  // conduction
  const lbbb = m.qrs >= 120 && ['I', 'aVL', 'V5', 'V6'].filter((n) => L[n].posShare >= 0.6 && L[n].q.dur === 0).length >= 3 && L.V6.rpt > 60 && (L.V1.qs || L.V1.R < L.V1.neg);
  const rbbb = m.qrs >= 120 && ((L.V1.rPrime > 0 && L.V1.rPrime > L.V1.rFirst) || (L.V2.rPrime > 0 && L.V2.rPrime > L.V2.rFirst) || (L.V1.R > L.V1.S && L.V1.rpt > 50)) && (L.I.sWide >= 40 || L.V6.sWide >= 40 || L.I.S > L.I.R || L.V6.S > L.V6.R);
  if (lbbb) dx.push('LBBB'); else if (rbbb) dx.push('RBBB'); else if (m.qrs >= 110) dx.push('IVCD');
  const narrow = m.qrs < 120;
  if (narrow && m.axis <= -45 && m.axis >= -90 && L.aVL.q.dur > 0 && L.aVL.R > L.aVL.S && ['II', 'III', 'aVF'].every((n) => L[n].S > L[n].R) && L.aVL.rpt >= 45) dx.push('LAFB');
  else if (narrow && m.axis <= -45 && m.axis >= -90) f.lafbIncomplete = true;
  const rvh = m.axis > 90 && (L.V1.R > L.V1.S || L.V1.R >= 0.7);
  if (narrow && m.axis > 90 && m.axis <= 180 && L.I.S > L.I.R && L.aVL.S > L.aVL.R && L.III.q.dur > 0 && L.III.R > L.III.S && L.aVF.R > L.aVF.S && !rvh) dx.push('LPFB');
  // hypertrophy
  const sok = L.V1.S + Math.max(L.V5.R, L.V6.R), corn = L.aVL.R + L.V3.S;
  // (LVH criteria are not used in bundle-branch block; with RVH only Sokolow-Lyon counts)
  if (!lbbb && !rbbb && (sok >= 3.5 || (!rvh && (corn > 2.8 || L.aVL.R >= 1.1)))) dx.push('LVH');
  if (rvh) dx.push('RVH');
  f.sokolow = +sok.toFixed(2); f.cornell = +corn.toFixed(2);
  // intervals
  if (m.pr !== null && m.pr > 200) dx.push('1st-degree AVB');
  if (m.qtc > 460 && m.qrs < 120) dx.push('long QT');   // (QTc is not judged in a wide QRS)
  // ischaemia (not read in LBBB, whose secondary ST/Q changes mask them)
  if (!lbbb) {
    const ste = contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].stJ >= (n === 'V2' || n === 'V3' ? 0.2 : 0.1)));
    const std = contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].stJ <= -0.05));
    const qLead = (n) => (n === 'V2' || n === 'V3' ? L[n].q.dur >= 20 || L[n].qs : ['I', 'II', 'aVL', 'aVF', 'V4', 'V5', 'V6'].includes(n) && ((L[n].q.dur >= 30 && L[n].q.amp <= -0.1) || L[n].qs));
    const Q = contiguous(LEADS.filter(qLead));
    const twi = contiguous(LEADS.filter((n) => !['aVR', 'III', 'V1'].includes(n) && L[n].T <= -0.1));
    f.ste = ste; f.std = std; f.Q = Q; f.twi = twi; f.steT = territories(ste); f.qT = territories(Q);
    if (ste.length) dx.push('STEMI ' + f.steT.join('+'));
    if (Q.length) dx.push('old MI ' + f.qT.join('+'));
    if (twi.length) dx.push('T inversion');
  }
  return { dx, f };
}

// ---------------------------------------------------------------- scenarios
// expect: required diagnoses (all), forbidden (none of), and for ischaemia required / allowed territories
const NOT_ISCH = ['STEMI', 'old MI'];
const SCEN = {
  normal: { expect: { none: ['LAFB', 'LPFB', 'LBBB', 'RBBB', 'IVCD', 'LVH', 'RVH', '1st-degree AVB', 'long QT', 'STEMI', 'old MI', 'T inversion'], axis: 'normal' } },
  avb1: { set: (S) => S.setBlock('AVN', 'first'), expect: { all: ['1st-degree AVB'], none: ['LBBB', 'RBBB', 'STEMI'] } },
  LAFB: { set: (S) => S.setBlock('LAF', 'complete'), expect: { all: ['LAFB'], none: ['LBBB', 'RBBB', 'IVCD', 'LPFB', ...NOT_ISCH] } },
  LPFB: { set: (S) => S.setBlock('LPF', 'complete'), expect: { all: ['LPFB'], none: ['LBBB', 'RBBB', 'IVCD', 'LAFB', 'RVH', ...NOT_ISCH] } },
  LBBB: { set: (S) => S.setBlock('LBB', 'complete'), expect: { all: ['LBBB'], none: ['RBBB'] } },
  RBBB: { set: (S) => S.setBlock('RBB', 'complete'), expect: { all: ['RBBB'], none: ['LBBB', 'LAFB', 'LPFB', ...NOT_ISCH] } },
  LVH: { hyp: { lvh: true }, expect: { all: ['LVH'], none: ['LBBB', 'RBBB', 'RVH', 'old MI'] } },
  RVH: { hyp: { rvh: true }, expect: { all: ['RVH'], none: ['LBBB', 'LVH', 'old MI'] } },
};
// infarcts: territory required / allowed (anything else is unexpected); reciprocal ST depression is not scored
// diagnoses that are a real consequence of the occlusion (anything else besides the infarct is unexpected)
const MI_OK = { all: ['T inversion', 'long QT'], LAD: ['LAFB', 'RBBB'], RCA: ['1st-degree AVB'] };
const MI = {
  pLAD: { f: (b) => b.LAD[0], ste: { req: ['anterior'], ok: ['septal', 'lowLateral', 'highLateral'] }, q: { req: ['anterior'], ok: ['septal', 'lowLateral', 'highLateral'] } },
  mLAD: { f: (b) => b.LAD[Math.round(b.LAD.length * 0.22)], ste: { req: ['anterior'], ok: ['septal', 'lowLateral'] }, q: { req: ['anterior'], ok: ['septal', 'lowLateral'] } },
  dLAD: { f: (b) => b.LAD[Math.round(b.LAD.length * 0.45)], ste: { req: ['anterior'], ok: ['septal', 'lowLateral'] }, q: { req: ['anterior'], ok: ['septal', 'lowLateral'] } },
  pLCx: { f: (b) => b.LCx[0], ste: { req: ['lateral'], ok: ['lowLateral', 'highLateral'] }, q: { req: ['lateral'], ok: ['lowLateral', 'highLateral'] } },
  dLCx: { f: (b) => b.LCx[Math.round(b.LCx.length * 0.6)], ste: { req: ['lateral'], ok: ['lowLateral', 'highLateral', 'inferior'] }, q: { req: ['lateral'], ok: ['lowLateral', 'highLateral', 'inferior'] } },
  pRCA: { f: (b) => b.RCA[0], ste: { req: ['inferior'], ok: ['septal'] }, q: { req: ['inferior'], ok: ['septal'] } },
  PDA: { f: (b) => b.PDA[0], ste: { req: ['inferior'], ok: [] }, q: { req: ['inferior'], ok: [] } },
};

function run(LH, JA, params, names) {
  const out = [];
  const make = (hyp) => {
    const H = LH.hypertrophyOptions(hyp || {}), A = new LH.Anatomy(JSON.parse(JSON.stringify(JA)), H.anatomy);
    return new LH.Model(A, { ...H.params, ...params });
  };
  const M0 = make(null);
  const record = (M, setup, ms = 3600) => {
    const S = new LH.Sim(M, { seed: 1 }); if (setup) setup(S);
    const rec = []; S.onSample((t, v) => rec.push(Array.from(v))); S.run(ms);
    const v = S.log.vent, vb = v[v.length - 2], rr = v.length > 2 ? v[v.length - 2].on - v[v.length - 3].on : 833;
    const r = read(rec, Math.round(vb.on), rr); r.simQRS = Math.round(vb.last - vb.on); return r;
  };
  const want = (n) => !names || names.includes(n) || names.includes(n.split(' ')[0]);
  for (const [name, sc] of Object.entries(SCEN)) {
    if (!want(name)) continue;
    const r = record(sc.hyp ? make(sc.hyp) : M0, sc.set), { dx, f } = r.interpret(), e = sc.expect, has = (d) => dx.some((x) => x.startsWith(d));
    const miss = (e.all || []).filter((d) => !has(d)), extra = (e.none || []).filter(has), axisBad = e.axis && f.axis !== e.axis;
    out.push({ scen: name, pass: !miss.length && !extra.length && !axisBad, grade: !miss.length && !extra.length && !axisBad ? 'pass' : miss.length ? 'fail' : 'partial', dx, axis: r.m.axis, qrs: r.m.qrs, simQRS: r.simQRS, pr: r.m.pr, qtc: r.m.qtc, miss, extra: axisBad ? [...extra, 'axis ' + f.axis] : extra, f });
  }
  for (const [site, mi] of Object.entries(MI)) for (const [h, key, label] of [[1, 'ste', '1 h'], [720, 'q', '30 d']]) {
    if (!want(site + ' ' + label)) continue;
    const r = record(M0, (S) => { S.addOcclusion(mi.f(M0.coronary.branches)); S.setIschemiaTime(h); }), { dx, f } = r.interpret();
    const got0 = key === 'ste' ? (f.steT || []) : (f.qT || []), ex = mi[key];
    const got = got0.some((t) => t.endsWith('ateral')) ? [...got0, 'lateral'] : got0;   // 'lateral' = either lateral group
    const miss = ex.req.filter((t) => !got.includes(t)), extra = got0.filter((t) => !ex.req.includes(t) && !ex.ok.includes(t));
    const okDx = [...MI_OK.all, ...(site.includes('LAD') && site !== 'dLAD' ? MI_OK.LAD : []), ...(site === 'pRCA' || site === 'PDA' ? MI_OK.RCA : [])];
    for (const d of dx) if (!d.startsWith('STEMI') && !d.startsWith('old MI') && !okDx.includes(d)) extra.push(d);
    out.push({ scen: `${site} ${label}`, pass: !miss.length && !extra.length, grade: miss.length ? 'fail' : extra.length ? 'partial' : 'pass', dx, axis: r.m.axis, qrs: r.m.qrs, simQRS: r.simQRS, miss, extra, leads: key === 'ste' ? f.ste : f.Q });
  }
  return out;
}

module.exports = { read, diagnose, run, SCEN, MI };
if (require.main === module) {
  const path = require('path'), fs = require('fs');
  const ENG = path.resolve(process.argv[2] || path.join(__dirname, '../src/engine.js')), LH = require(ENG);
  if (process.env.TV2) LH.setDefaultTorso2(require(path.resolve(process.env.TV2)));   // solved torso (fullTorso / chestTorso)
  const JA = JSON.parse(fs.readFileSync(path.join(path.dirname(ENG), 'anatomy.json')));
  const params = JSON.parse(process.argv[3] || '{}'), names = process.argv[4] ? process.argv[4].split(',') : null;
  const res = run(LH, JA, params, names);
  if (process.env.JSON) { console.log(JSON.stringify(res)); process.exit(0); }
  for (const r of res) console.log(`${r.grade.padEnd(8)}${r.scen.padEnd(10)} reads: ${r.dx.join(', ') || 'normal'}  [axis ${r.axis}°, QRS ${r.qrs} ms (sim ${r.simQRS || '-'})${r.pr ? ', PR ' + r.pr : ''}${r.leads ? ', leads ' + r.leads.join(' ') : ''}]${r.miss.length ? '  missing: ' + r.miss.join(', ') : ''}${r.extra.length ? '  unexpected: ' + r.extra.join(', ') : ''}`);
  const n = res.length, p = res.filter((r) => r.grade === 'pass').length, pa = res.filter((r) => r.grade === 'partial').length;
  console.log(`\n${p}/${n} read as the simulated pathology, ${pa} partial, ${n - p - pa} wrong`);
}
