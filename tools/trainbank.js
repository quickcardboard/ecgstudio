// Training question bank (prototype): runs each scenario on the engine, records 10 s of 12-lead ECG,
// reads it blind (tools/reader.js for the beat, tools/rhythmread.js for the rhythm) and keeps the item
// only when the reading matches its answer key (the validation gate of the training design).
//   node tools/trainbank.js            → src/training_bank.json (inlined into training/index.html by tools/build.py)
// Traces are stored at 250 Hz in µV (Int16, base64), with the measurements the reader made and the
// simulator link ("Show me why") that rebuilds the same scenario.
const fs = require('fs'), path = require('path');
const LH = require('../src/engine.js');
const { read } = require('./reader.js'), { readRhythm } = require('./rhythmread.js'), { RHY, vtCell } = require('./rhythmscen.js');
const JA = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/anatomy.json')));
const A = new LH.Anatomy(JA), M = new LH.Model(A);
const B = M.coronary.branches;
const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const SETTLE = 4000, STRIP = 10000, HZ = 250;
void vtCell;

// key: rhythm (vocabulary id) and its accepted alternatives; findings: required ({ id, regions, okRegions }),
// optional ids (credit, no penalty) and alternative ids (count as the finding they stand for).
// gate(rhythm read, beat read): does the blind reading match the key?
const ITEMS = [
  { id: 'normal', title: 'Normal sinus rhythm', make: () => { const S = new LH.Sim(M, { seed: 1 }); return S; },
    link: 'r=72', key: { rhythm: 'sinus', findings: [] },
    gate: (rr, b) => /^sinus rhythm$/.test(rr.rhythm) && !b.dx.length, line: 'Regular, a P before every QRS, normal intervals and axis.' },
  { id: 'af', title: 'Atrial fibrillation', make: () => RHY.AF.make(LH, M, A), link: 'r=72&a=af',
    key: { rhythm: 'af', findings: [] }, gate: (rr) => rr.rhythm === 'atrial fibrillation', noPR: true,
    line: 'Irregularly irregular, no P waves: atrial fibrillation.' },
  { id: 'flutter', title: 'Atrial flutter, 4:1', make: () => RHY.flutter4.make(LH, M, A), link: 'r=72&a=flutter&v=75',
    key: { rhythm: 'flutter', findings: [] }, gate: (rr) => rr.rhythm === 'atrial flutter', noPR: true,
    line: 'Sawtooth flutter waves at about 300/min, every fourth one conducted.' },
  { id: 'avnrt', title: 'AVNRT', make: () => RHY.AVNRT.make(LH, M, A), link: 'r=72&a=avnrt',
    key: { rhythm: 'avnrt', alt: ['svt'], findings: [] }, gate: (rr) => rr.rhythm.startsWith('AVNRT'), noPR: true, tachy: true, caliper: 'rr',
    line: 'Regular narrow tachycardia under 200 with no visible P: AVNRT.' },
  { id: 'avrt', title: 'Orthodromic AVRT', make: () => RHY.AVRT.make(LH, M, A), link: 'r=72&s=ap&a=avrt',
    key: { rhythm: 'avrt', alt: ['svt'], findings: [] }, gate: (rr) => rr.rhythm.startsWith('AVRT'), noPR: true, tachy: true, caliper: 'rr',
    line: 'Regular narrow tachycardia above 200 with no visible P: AVRT, not AVNRT.' },
  { id: 'mobitz1', title: 'Mobitz I (Wenckebach)', make: () => RHY.mobitz1.make(LH, M, A), link: 'r=72&b=AVN.wenckebach',
    key: { rhythm: 'mobitz1', findings: [] }, gate: (rr) => rr.rhythm.includes('Mobitz I ') || rr.rhythm.includes('Mobitz I ('), noPR: true,
    line: 'PR lengthens beat by beat until a P is not conducted: Mobitz I.' },
  { id: 'chb', title: 'Complete AV block', make: () => RHY.chbAVN.make(LH, M, A), link: 'r=72&b=AVN.complete',
    key: { rhythm: 'chb', findings: [] }, gate: (rr) => rr.rhythm.includes('complete AV block'), noPR: true,
    line: 'P waves march through at their own rate, unrelated to a slow regular escape: complete block.' },
  { id: 'lbbb', title: 'Left bundle branch block', make: () => { const S = new LH.Sim(M, { seed: 1 }); S.setBlock('LBB', 'complete'); return S; },
    link: 'r=72&b=LBB.complete', key: { rhythm: 'sinus', findings: [{ id: 'lbbb' }], optional: ['lad', 'twi', 'std'] }, caliper: 'qrs',
    gate: (rr, b) => /^sinus/.test(rr.rhythm) && b.dx.includes('LBBB'), line: 'QRS ≥ 120 ms, broad notched R in I and V6, deep QS in V1: LBBB.' },
  { id: 'oldInf', title: 'Old inferior infarct', make: () => { const S = new LH.Sim(M, { seed: 1 }); S.addOcclusion(B.RCA[0]); S.setIschemiaTime(720); return S; },
    link: `r=72&o=${B.RCA[0]}&c=2&h=720`, isch: 'Q',
    key: { rhythm: 'sinus', findings: [{ id: 'qwaves', regions: ['inferior'], okRegions: ['septal'] }], optional: ['twi', 'longqt'] },
    gate: (rr, b) => /^sinus/.test(rr.rhythm) && b.dx.some((d) => d.startsWith('old MI') && d.includes('inferior')) && !b.dx.some((d) => d.startsWith('STEMI')),
    line: 'Pathological Q waves in II, III and aVF: old inferior infarct.' },
  { id: 'antSTEMI', title: 'Acute anterior STEMI', make: () => { const S = new LH.Sim(M, { seed: 1 }); S.addOcclusion(B.LAD[0]); S.setIschemiaTime(1); return S; },
    link: `r=72&o=${B.LAD[0]}&c=2&h=1`, isch: 'ST',
    key: { rhythm: 'sinus', findings: [{ id: 'ste', regions: ['anterior'], okRegions: ['septal', 'lateral'] }], optional: ['std', 'twi', 'lad'] },
    gate: (rr, b) => /^sinus/.test(rr.rhythm) && b.dx.some((d) => d.startsWith('STEMI') && d.includes('anterior')),
    line: 'ST elevation in V2–V4: acute anterior STEMI. Activate the cath lab.' },
];

// (the single-beat reader needs a TP segment: at 170–210/min the T runs into the next QRS, so the
// tachycardias take axis and QRS from the same heart in sinus rhythm and QTc is not shown)
let sinusM = null;
const b64 = (i16) => Buffer.from(i16.buffer).toString('base64');
const out = [];
for (const it of ITEMS) {
  const S = it.make(); if (!S) { console.log('fail   ', it.id, '(not induced)'); continue; }
  S.run(SETTLE);
  const rec = []; let t0 = null;
  S.onSample((t, v) => { if (t0 === null) t0 = t; rec.push(Array.from(v)); });
  S.run(STRIP);
  const rr = readRhythm(rec);
  // beat read: the second-to-last conducted beat in the strip
  const V = S.log.vent.filter((v) => v.on - t0 > 500 && v.on - t0 < STRIP - 800), vb = V[V.length - 1], vp = V[V.length - 2];
  const r = read(rec, Math.round(vb.on - t0), vp ? vb.on - vp.on : 833), b = r.interpret();
  const ok = it.gate(rr, b);
  console.log(`${ok ? 'pass   ' : 'FAIL   '}${it.id.padEnd(10)} rhythm: ${rr.rhythm} (${rr.rate}/min)  beat: ${b.dx.join(', ') || 'normal'}  axis ${r.m.axis}, QRS ${r.m.qrs}, PR ${r.m.pr}, QTc ${r.m.qtc}${b.f.ste ? `  STE ${b.f.ste.join(' ')}` : ''}${b.f.Q && b.f.Q.length ? `  Q ${b.f.Q.join(' ')}` : ''}`);
  if (!ok) continue;
  // 250 Hz traces in µV
  const leads = LEADS.map((_, k) => { const a = new Int16Array(STRIP / (1000 / HZ)); for (let i = 0; i < a.length; i++) a[i] = Math.round(rec[i * (1000 / HZ)][k] * 1000); return b64(a); });
  if (it.id === 'normal') sinusM = r.m;
  const ms = { rate: rr.rate, pr: it.noPR ? null : r.m.pr, qrs: (it.tachy ? sinusM : r.m).qrs, qtc: it.tachy ? null : r.m.qtc, axis: (it.tachy ? sinusM : r.m).axis };
  // highlights: the leads that carry the finding; calipers on the deciding interval
  const RL = { septal: ['V1', 'V2'], anterior: ['V3', 'V4'], lateral: ['I', 'aVL', 'V5', 'V6'], inferior: ['II', 'III', 'aVF'] };
  const keyLeads = it.isch ? it.key.findings[0].regions.flatMap((g) => RL[g]) : [];
  const hl = it.isch ? LEADS.filter((n) => keyLeads.includes(n) || (it.isch === 'Q' ? b.f.Q : b.f.ste).includes(n)) : it.id === 'lbbb' ? ['I', 'V1', 'V6'] : ['II'];
  let caliper = null;
  // (rhythm strip of the limb-lead half: 0–5 s; V1: 5–7.5 s)
  const within = (lo, hi) => V.filter((v) => v.on - t0 > lo && v.on - t0 < hi);
  if (it.caliper === 'rr') { const [a, c] = within(1500, 4600); caliper = { lead: 'rhythm', t0: Math.round(a.on - t0), t1: Math.round(c.on - t0), label: `RR ${Math.round(c.on - a.on)} ms = ${Math.round(60000 / (c.on - a.on))}/min` }; }
  if (it.caliper === 'qrs') { const [a] = within(5200, 7200); caliper = { lead: 'V1', t0: Math.round(a.on - t0), t1: Math.round(a.on - t0 + r.m.qrs), label: `QRS ${r.m.qrs} ms` }; }
  out.push({ id: it.id, title: it.title, hz: HZ, ms: STRIP, leads, m: ms, read: { rhythm: rr.rhythm, dx: b.dx }, key: it.key, highlight: hl, caliper, line: it.line, link: it.link });
}
const file = path.join(__dirname, '../src/training_bank.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`\n${out.length}/${ITEMS.length} items kept → ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} kB)`);
