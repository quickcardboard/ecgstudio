// ECG Studio Training: live question generator.
// Builds a random scenario (a rhythm plus 0–4 abnormalities that stay visible together), runs it on the
// engine, records 10 s of 12-lead ECG, reads it blind (tools/reader.js beat read, tools/rhythmread.js
// rhythm read) and keeps it only when the reading matches the scenario: the answer key is then built
// from the scenario and the reading (true extra findings the reader makes become optional).
// Runs in the training page's worker and in Node (tools/trainlive.js).
//   const G = TrainGen(LH, { read, readRhythm }); G.make({ target, focus, seed }) → item or null
(function (root) {
  'use strict';
  const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  const ELECTRODES = ['RA', 'LA', 'LL', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  // artifact size at level 1, the most an ECG gets, on its electrode (mV): tremor RMS, wander peak, mains peak. Set by
  // the author from galleries of one ECG at rising strength: the last level still readable.
  const ART_MAX = { tremor: 0.12, wander: 1.2, mains: 0.18 };
  const SETTLE = 4000, STRIP = 10000, TWIN_STRIP = 6000, HZ = 250;   // (a twin is only read for its median beat)
  const SKILLS = ['rhythm', 'conduction', 'ischemia', 'conditions'];
  const RL = { septal: ['V1', 'V2'], anterior: ['V3', 'V4'], lateral: ['I', 'aVL', 'V5', 'V6'], inferior: ['II', 'III', 'aVF'] };
  const territory = (t) => (t === 'lowLateral' || t === 'highLateral' ? 'lateral' : RL[t] ? t : null);
  const SINUS = ['sinus', 'sinusBrady', 'sinusTachy'];

  // ---------------------------------------------------------------- rhythms
  // pRhythm: P waves conducted 1:1 (P-wave findings allowed); open: other findings allowed;
  // read: does the blind rhythm reading match; rating: difficulty added to the item rating
  const RHYTHMS = {
    sinus: { w: 8, rate: [62, 95], pRhythm: true, open: true, rating: 0, read: (r) => /^sinus (rhythm|bradycardia|tachycardia)$/.test(r) },
    sinusBrady: { w: 2, rate: [44, 55], pRhythm: true, open: true, rating: 20, read: (r) => /^sinus (rhythm|bradycardia)$/.test(r) },
    // respiratory sinus arrhythmia: a P before every QRS, the RR rising and falling with breathing (≥ 120 ms apart);
    // answered as sinus arrhythmia, with sinus rhythm partly correct
    sinusArr: { w: 1.2, open: true, pRhythm: true, rating: 60, rate: [55, 85], alt: ['sinus'], notWith: ['peri', 'bae'],
      start: (S, rec) => S.setSinusArrhythmia({ amp: rec.sa[0], period: rec.sa[1] }), read: (r) => /sinus/.test(r) },
    // (with first-degree block, WPW or a bundle branch block the P can sit on the previous T: allowed, and SVT is accepted too)
    sinusTachy: { w: 2, rate: [106, 125], pRhythm: true, open: true, rating: 20, notWith: ['peri', 'bae'], read: (r) => /^sinus (rhythm|tachycardia)$/.test(r) },
    // (AF rate bands, targets: slow 15%, controlled 50%, rapid ventricular response 35%; the engine's response runs a little
    // below the target: about 40–45, 50–85 and 110–165/min)
    af: { w: 5, open: true, rating: 60, rate: [60, 150], rateBands: [[42, 58, 0.15], [60, 105, 0.5], [130, 170, 0.35]], vLink: true, link: 'a=af', struct: 'fib', start: (S, rec) => { S.setAtrialFibrosis(true); S.run(2000); S.startArrhythmia('af'); S.setVentricularResponse(rec.rate); },   // (AF on its substrate, as in the app)
    read: (r) => r === 'atrial fibrillation' },
    // (the author, 2026-11-18: no electrolyte change with flutter (U waves, flat or peaked T waves blur the sawtooth), and the
    // blind rhythm read must see flutter (gateRead), so a strip whose sawtooth reads as sinus or AF is not shown)
    flutter: { w: 2.5, open: true, gateRead: true, notWith: ['stemi', 'evolving', 'oldmi', 'recent', 'hyper', 'narrow', 'multinarrow', 'nsstt', 'wellensA', 'wellensB', 'hyperK', 'hyperK2', 'hypoK', 'hypoCa', 'hyperCa', 'hypothermia'],   // (flutter waves sit on the ST segment)
      rating: 150, rate: [60, 150], vLink: true, link: 'a=flutter',   // (above ~115/min the response is 2:1: flutter waves hidden in the QRS/T)
      start: (S, rec) => { S.run(2000); S.startArrhythmia('flutter'); S.run(3000); S.setVentricularResponse(rec.rate); }, read: (r) => r === 'atrial flutter' },
    // irregular flutter (variable block): the conduction ratio changes beat by beat (2:1–4:1); answered as flutter, with
    // AF as partly correct (an irregular response hides the regular sawtooth less clearly)
    flutterVar: { w: 0.8, open: true, gateRead: true, notWith: ['stemi', 'evolving', 'oldmi', 'recent', 'hyper', 'narrow', 'multinarrow', 'nsstt', 'wellensA', 'wellensB', 'hyperK', 'hyperK2', 'hypoK', 'hypoCa', 'hyperCa', 'hypothermia'], rating: 190, rate: [80, 120],
      variable: [[2, 4], [2, 3, 4], [2, 3]], vLink: true, link: 'a=flutter', key: 'flutter', alt: ['af'],
      start: (S, rec) => { S.run(2000); S.startArrhythmia('flutter'); S.run(3000); S.setVentricularResponse(rec.rate, { variable: rec.fv }); }, read: (r) => r === 'atrial flutter' },
    // multifocal atrial tachycardia: four atrial foci taking turns (±25% cycle), so ≥ 3 P shapes with varying PR and RR;
    // the blind rhythm read must see it (gateRead), and the P waves must be visible
    // WAP/MAT: below 100/min a wandering atrial pacemaker, above it multifocal atrial tachycardia (key: 'wap' or 'mat', both
    // accepted at 95–105). Gated on the engine's own record (≥ 3 different foci fired in the strip, P waves visible), not on
    // the blind rhythm read, which can take MAT for AF.
    mat: { w: 1, open: true, pVisible: true, foci: true, rating: 170, rate: [70, 130], link: 'a=mat', start: (S, rec, M, h) => { S.run(2000); S.startArrhythmia('mat', { cells: h.matFoci(M) }); }, read: (r) => /multifocal|wandering/.test(r) },
    avnrt: { w: 1.5, tachy: true, rating: 180, link: 'a=avnrt', alt: ['svt', 'flutter'], induce: 'avnrt', read: (r) => r.startsWith('AVNRT') },
    avrt: { w: 0.8, tachy: true, rating: 220, link: 'a=avrt', alt: ['svt', 'flutter', 'avnrt'], induce: 'avrt', read: (r) => r.startsWith('AVRT') },
    // (Round 66: the blind read must see the Wenckebach pattern; a proximal RCA infarct slowing the node turned one into a
    // steady first-degree block)
    mobitz1: { w: 2, open: true, gateRead: true, rating: 150, block: ['AVN', 'wenckebach'], read: (r) => /Mobitz I \(/.test(r) },
    mobitz2: { w: 0.4, open: true, rating: 180, block: ['HIS', 'mobitz2', { n: 4 }], read: (r) => /Mobitz II /.test(r) },
    avb2to1: { w: 0.6, open: true, rating: 200, block: ['AVN', 'two-to-one'], read: (r) => /2:1 AV block/.test(r) },
    // (the atrial rate must not be a whole or half multiple of the 48/min junctional escape: at 72 or 96 the P waves
    // fall in the same places beat after beat instead of marching through)
    chb: { w: 0.9, open: true, rating: 120, rate: [60, 100], rateOk: (x) => ![1, 1.5, 2, 2.5].some((q) => Math.abs(x / 48 - q) < 0.04 * q), block: ['AVN', 'complete'], read: (r) => /complete AV block/.test(r) },
    vt: { w: 1.2, tachy: true, rating: 120, link: 'a=vt', vt: true, read: (r) => r === 'ventricular tachycardia' },
    // torsades de pointes (Round 53): polymorphic VT, the QRS axis twisting (a focus moving around the LV each beat)
    tdp: { w: 0.3, tachy: true, rating: 180, link: 'a=tdp', poly: true, start: (S) => { S.run(2000); S.startArrhythmia('tdp'); }, read: (r) => /ventricular/.test(r) },
    vf: { w: 0.8, tachy: true, rating: 40, link: 'a=vf', vf: true, start: (S) => { S.run(2000); S.startArrhythmia('vf'); }, read: (r) => r === 'ventricular fibrillation' },
    // sinus arrest for the whole strip with an escape rhythm: junctional (narrow, retrograde P hidden after the QRS)
    // or ventricular (block in the His bundle below it: wide); naming the sinus pause is true but not required
    // ectopic atrial rhythm and atrial tachycardia (Round 66): a low right-atrial focus (the simulator's "Ectopic atrial
    // rhythm"), P inverted in II, III and aVF before every QRS; the blind rhythm read must see it
    ectopicAtrial: { w: 0.7, open: true, pRhythm: true, gateRead: true, rating: 130, rate: [62, 95], link: 'a=ectopic', notWith: ['rae', 'lae', 'bae', 'wpw', 'peri'],
      start: (S, rec, M) => { S.run(2000); S.startArrhythmia('ectopic', { cell: lowAtrialCell(M) }); S.setRate(rec.rate); }, read: (r) => /ectopic atrial/.test(r) },
    atrialTach: { w: 0.6, open: true, pRhythm: true, gateRead: true, rating: 170, rate: [112, 150], link: 'a=ectopic', alt: ['svt'], notWith: ['rae', 'lae', 'bae', 'wpw', 'peri'],
      start: (S, rec, M) => { S.run(2000); S.startArrhythmia('ectopic', { cell: lowAtrialCell(M) }); S.setRate(rec.rate); }, read: (r) => /ectopic atrial|atrial tachycardia/.test(r) },
    junctional: { w: 0.8, open: true, noP: true, notWith: ['lbbb', 'rbbb', 'nsstt'],   // (a wide QRS would pass for a ventricular escape; the retrograde P sits on the ST-T)
      rating: 140, block: ['SAN', 'arrest'], optional: ['sinusPause'], read: () => true },
    idioventricular: { w: 0.5, noP: true, wide: true, rating: 160, block: ['SAN', 'arrest'], block2: ['HIS', 'complete'], optional: ['sinusPause'], read: () => true },
  };
  // the focus of the atrial rhythms: the right-atrial cell nearest the AV node at least ECT_MM from it (low in the right
  // atrium, so the P is inverted in II, III and aVF; far enough for a normal PR)
  let ECT_MM = 38;
  const lowAtrialCell = (M) => {
    const a0 = M.avn[0], A = M.A; let c = -1, best = Infinity;
    for (let q = 0; q < M.nVox; q++) {
      if (M.kind[q] !== 1 || A.label[q] !== 4) continue;
      const d = Math.hypot(M.x[q] - M.x[a0], M.y[q] - M.y[a0], M.z[q] - M.z[a0]);
      if (d >= ECT_MM && d < best) { best = d; c = q; }
    }
    return c;
  };
  const RHYTHM_LINE = {
    sinus: 'Regular, a P before every QRS at a normal rate: sinus rhythm.',
    sinusBrady: 'A P before every QRS, rate under 60: sinus bradycardia.',
    sinusTachy: 'A P before every QRS, rate over 100: sinus tachycardia.',
    sinusArr: 'A normal P before every QRS with a constant PR, but the RR lengthens and shortens gradually with breathing (more than 120 ms apart): sinus arrhythmia, a normal finding.',
    ectopicAtrial: 'A P before every QRS but inverted in II, III and aVF (a low atrial focus), rate under 100: ectopic atrial rhythm.',
    atrialTach: 'Regular, rate over 100, an abnormal P (inverted in II, III and aVF) before every QRS: atrial tachycardia.',
    af: 'Irregularly irregular, no P waves: atrial fibrillation.',
    mat: 'Irregular, rate over 100, at least three different P-wave shapes with varying PR: multifocal atrial tachycardia.',
    wap: 'Irregular, rate under 100, at least three different P-wave shapes with varying PR: wandering atrial pacemaker (the slow form of MAT).',
    flutter: 'Sawtooth flutter waves at about 300/min, a fixed share of them conducted: atrial flutter.',
    flutterVar: 'Sawtooth flutter waves at about 300/min with a conduction ratio that changes from beat to beat, so the rhythm is irregular: atrial flutter with variable block. The regular sawtooth tells it from AF.',
    flutter21: 'Regular narrow tachycardia near 150 with flutter waves hidden in the QRS and T: atrial flutter with 2:1 conduction. Without visible flutter waves it cannot be told from other SVTs, so SVT and AVNRT count too.',
    avnrt: 'Regular narrow tachycardia under 200 with no visible P: AVNRT.',
    avrt: 'Regular narrow tachycardia above 200 with no visible P: AVRT, not AVNRT.',
    mobitz1: 'PR lengthens beat by beat until a P is not conducted: Mobitz I.',
    mobitz2: 'Constant PR, then a P suddenly not conducted: Mobitz II.',
    avb2to1: 'Every second P is not conducted: 2:1 AV block. 2:1 conduction cannot tell Mobitz I from II, so it is named as the more dangerous one: Mobitz II.',
    chb: 'P waves march through at their own rate, unrelated to a slow regular escape: complete AV block.',
    vt: 'Regular broad-complex tachycardia without related P waves: ventricular tachycardia.',
    tdp: 'Broad-complex tachycardia whose QRS axis twists around the baseline, the complexes growing and shrinking in spindles: torsades de pointes (polymorphic VT on a long QT).',
    vf: 'Chaotic, irregular deflections with no identifiable QRS complexes: ventricular fibrillation. Defibrillate.',
    junctional: 'No P waves before the QRS (sinus arrest); regular narrow QRS at 40–60/min: junctional escape rhythm.',
    idioventricular: 'No P waves (sinus arrest); regular wide QRS at 20–40/min: ventricular escape (idioventricular) rhythm.',
  };

  // ---------------------------------------------------------------- abnormalities
  // group: one per group; excl: groups it cannot be combined with (they hide each other);
  // needP: needs a 1:1 P-wave rhythm; dx: the reader's word for it
  // advanced findings (adv: a rating): below it in the finding's skill the finding may appear but is not asked (no miss
  // for leaving it out; credited when named). Wellens, hypothermia's Osborn waves, a STEMI read through LBBB
  // (Sgarbossa), and hypo- and hypercalcemia (interval-only changes)
  const ADV = 1700;
  const MI_SITES = {
    pLAD: { f: (b) => b.LAD[0], name: 'proximal LAD', ste: { req: ['anterior'], ok: ['septal', 'lateral'] }, q: { req: ['anterior'], ok: ['septal', 'lateral'] } },
    mLAD: { f: (b) => b.LAD[Math.round(b.LAD.length * 0.22)], name: 'mid LAD', ste: { req: ['anterior'], ok: ['septal', 'lateral'] }, q: { req: ['anterior'], ok: ['septal', 'lateral'] } },
    pRCA: { f: (b) => b.RCA[0], name: 'proximal RCA', ste: { req: ['inferior'], ok: ['septal'] }, q: { req: ['inferior'], ok: ['septal'] } },
    mRCA: { f: (b) => b.RCA[Math.round(b.RCA.length * 0.45)], name: 'mid RCA', ste: { req: ['inferior'], ok: ['lateral'] }, q: { req: ['inferior'], ok: ['lateral'] } },
    pLCx: { f: (b) => b.LCx[0], name: 'proximal circumflex', ste: { req: ['lateral'], ok: [] }, q: { req: ['lateral'], ok: [] } },
    // Round 50 (re-tested after the chest-lead and ischaemia rounds): kinds limits what a site is used for. Not used: the
    // distal LAD (inferior ST elevation only, no anterior change or Q waves), the acute marginal (inferior instead of the
    // right-ventricular pattern), and a distal circumflex STEMI (only V6 rises)
    LM: { fam: 'LAD', f: (b) => b.LM[0], name: 'left main', kinds: ['stemi', 'evolving', 'oldmi', 'recent', 'narrow'], ste: { req: ['lateral'], ok: ['anterior', 'septal'] }, q: { req: ['anterior'], ok: ['lateral', 'septal'] } },
    OM1: { fam: 'LCx', f: (b) => b.OM1[0], name: 'first obtuse marginal', kinds: ['stemi', 'evolving', 'oldmi', 'recent', 'narrow'], ste: { req: ['lateral'], ok: [] }, q: { req: ['lateral'], ok: [] } },
    OM2: { fam: 'LCx', f: (b) => b.OM2[0], name: 'second obtuse marginal', kinds: ['stemi', 'evolving', 'oldmi', 'recent', 'narrow'], ste: { req: ['inferior'], ok: ['lateral'] }, q: { req: ['lateral'], ok: ['inferior'] } },
    dLCx: { fam: 'LCx', f: (b) => b.LCx[Math.round(b.LCx.length * 0.6)], name: 'distal circumflex', kinds: ['oldmi'], ste: { req: ['lateral'], ok: ['inferior'] }, q: { req: ['lateral'], ok: ['inferior'] } },
    dRCA: { fam: 'RCA', f: (b) => b.RCA[Math.round(b.RCA.length * 0.8)], name: 'distal RCA', kinds: ['stemi', 'evolving', 'oldmi', 'recent', 'narrow'], ste: { req: ['inferior'], ok: ['lateral'] }, q: { req: ['inferior'], ok: ['lateral'] } },
    PDA: { fam: 'RCA', f: (b) => b.PDA[0], name: 'posterior descending artery', kinds: ['stemi', 'evolving', 'oldmi', 'recent', 'narrow'], ste: { req: ['inferior'], ok: [] }, q: { req: ['inferior'], ok: [] } },
  };
  const famOf = (site) => MI_SITES[site].fam || site.replace(/^[pmd]/, '');
  const ABN = {
    avb1: { group: 'av', skill: 'conduction', needP: true, rating: 0, dx: '1st-degree AVB', block: ['AVN', 'first'], leads: [], line: 'PR over 200 ms with every P conducted: first-degree AV block.' },
    rae: { group: 'atria', skill: 'conditions', needP: true, rating: 40, dx: 'RAE', atria: { ra: true }, struct: 'rae', leads: ['II', 'V1'], line: 'P taller than 2.5 mm in II: right atrial enlargement.' },
    lae: { group: 'atria', skill: 'conditions', needP: true, rating: 40, dx: 'LAE', atria: { la: true }, struct: 'lae', leads: ['II', 'V1'], line: 'Broad notched P (≥ 120 ms) in II: left atrial enlargement.' },
    bae: { group: 'atria', skill: 'conditions', needP: true, rating: 80, dx: 'biatrial enlargement', atria: { ra: true, la: true }, struct: 'rae,lae', leads: ['II', 'V1'], line: 'Tall and broad notched P: biatrial enlargement.' },
    lafb: { group: 'fasc', skill: 'conduction', rating: 40, dx: 'LAFB', block: ['LAF', 'complete'], leads: ['I', 'aVL', 'II', 'III', 'aVF'], line: 'Axis beyond −45° with qR in aVL and rS in II, III, aVF: left anterior fascicular block.' },
    lpfb: { group: 'fasc', skill: 'conduction', rating: 100, dx: 'LPFB', block: ['LPF', 'complete'], leads: ['I', 'aVL', 'III', 'aVF'], line: 'Right axis with rS in I and qR in III, no RVH: left posterior fascicular block.' },
    lbbb: { group: 'bbb', skill: 'conduction', rating: 0, dx: 'LBBB', block: ['LBB', 'complete'], excl: ['fasc', 'hyp', 'wpw', 'brugada'], leads: ['I', 'V1', 'V6'], caliper: 'qrs', line: 'QRS ≥ 120 ms, broad notched R in I and V6, deep QS in V1: LBBB.' },
    rbbb: { group: 'bbb', skill: 'conduction', rating: 0, dx: 'RBBB', block: ['RBB', 'complete'], excl: ['hyp', 'wpw', 'brugada'], leads: ['V1', 'V2', 'I', 'V6'], caliper: 'qrs', line: 'QRS ≥ 120 ms, rsR′ in V1 and a broad S in I and V6: RBBB.' },
    wpw: { group: 'wpw', skill: 'conduction', needP: true, rating: 40, dx: 'WPW pattern', ap: true, struct: 'ap', excl: ['av', 'fasc', 'bbb', 'hyp', 'peri', 'brugada', 'atria'], leads: ['I', 'II', 'V4', 'V5'], caliper: 'pr', line: 'Short PR, slurred delta wave and broad QRS: WPW pattern.' },
    lvh: { group: 'hyp', skill: 'conditions', rating: 0, dx: 'LVH', hyp: 'lvh', struct: 'lvh', leads: ['V1', 'V5', 'V6', 'aVL'], line: 'S in V1 plus R in V5/V6 ≥ 35 mm: left ventricular hypertrophy.' },
    rvh: { group: 'hyp', skill: 'conditions', rating: 60, dx: 'RVH', hyp: 'rvh', struct: 'rvh', leads: ['V1', 'I'], line: 'Right axis with a dominant R in V1: right ventricular hypertrophy.' },
    stemi: { group: 'isch', skill: 'ischemia', rating: 0, isch: 1, excl: ['peri', 'brugada'], id: 'ste' },   // (Round 50: the injury current is compensated for hypertrophy's source gain, ischHypComp)
    oldmi: { group: 'isch', skill: 'ischemia', rating: 20, isch: 720, excl: ['peri', 'brugada'], id: 'qwaves' },
    // narrowing (partial flow, 1 h): subendocardial ischemia, ST depression (with ST elevation in aVR)
    narrow: { group: 'isch', skill: 'ischemia', rating: 100, isch: 1, stenosis: true, excl: ['peri', 'brugada', 'wpw'], id: 'std' },
    // multivessel narrowing (two or three arteries, 1 h): diffuse subendocardial ischemia, widespread ST depression with ST
    // elevation in aVR (the left main / three-vessel pattern); the sites are one per artery family
    multinarrow: { group: 'isch', skill: 'ischemia', rating: 160, isch: 1, stenosis: true, multi: true, excl: ['peri', 'brugada', 'wpw'], id: 'std' },
    // hyperacute phase (15 min): tall, broad T waves over the territory before the ST rises
    hyper: { group: 'isch', skill: 'ischemia', rating: 140, isch: 0.25, excl: ['peri', 'brugada', 'hyp', 'wpw'], id: 'hyperacute' },   // (Round 50: with the K-ATP plateau slope the T stays single with a fascicular block)
    // an evolving STEMI (4 h, 12 h): ST elevation past its peak with Q waves forming, T waves starting to invert at 12 h
    evolving: { group: 'isch', skill: 'ischemia', rating: 60, isch: 4, stops: [4, 12], excl: ['peri', 'brugada'], id: 'ste' },
    // a recent infarct (2 days): Q waves with T inversion over the territory, ST elevation mostly resolved
    recent: { group: 'isch', skill: 'ischemia', rating: 120, isch: 48, excl: ['peri', 'brugada'], id: 'qwaves' },
    // non-specific ST-T changes: flat T waves in leads where T is normally upright, no territory
    nsstt: { group: 'repol', skill: 'conditions', rating: 120, id: 'nsstt', nsstt: true, struct: 'nsstt', excl: ['isch', 'peri', 'brugada', 'bbb', 'hyp', 'wpw'], leads: [], line: '' },
    peri: { group: 'peri', skill: 'conditions', rating: 80, id: 'pericarditis', dx: 'pericarditis', peri: true, struct: 'peri', excl: ['isch', 'brugada'], leads: ['I', 'II', 'aVF', 'V5', 'V6', 'aVR'], line: 'Diffuse concave ST elevation with PR depression and ST depression in aVR: pericarditis.' },
    // ectopy (sinus rhythm only): two PVCs, two PACs, or one ventricular couplet in the strip, timed from the
    // engine's own beats; verified from its timing (the ectopic beat fired, premature, wide or narrow)
    pvc: { group: 'ectopy', skill: 'rhythm', rating: 20, ectopy: 'pvc', id: 'pvc', leads: ['II'], line: 'An early, wide, bizarre QRS with no P wave before it and a full compensatory pause: premature ventricular complexes.' },
    pac: { group: 'ectopy', skill: 'rhythm', rating: 80, ectopy: 'pac', id: 'pac', leads: ['II'], line: 'An early P of another shape, a normal narrow QRS, then a less-than-compensatory pause: premature atrial complexes.' },
    // SA exit block (3:2): whole P–QRS complexes drop out, each pause twice the P–P interval
    saBlock: { group: 'ectopy', skill: 'rhythm', rating: 100, id: 'saBlock', sinusNode: true, block: ['SAN', 'sa-exit', { n: 3 }], leads: ['II'], line: 'Whole P–QRS complexes drop out; each pause is twice the P–P interval: sinoatrial exit block.' },
    // atrial couplet: two PACs in a row
    acouplet: { group: 'ectopy', skill: 'rhythm', rating: 70, ectopy: 'acouplet', id: 'acouplet', leads: ['II'], line: 'Two early P waves of another shape in a row, each with a narrow QRS: an atrial couplet.' },
    // a sinus pause (2.6 s, at 3 s into the strip): a finding on sinus rhythm, like ectopy
    // (rec.pauseEscape: the junctional escape fires during the pause (true), or stays silent too: a pure pause)
    sinusPause: { group: 'ectopy', skill: 'rhythm', rating: 60, id: 'sinusPause', pause: true, linkBlock: 'SAN.pause', at: [[3000, (S, rec) => S.setBlock('SAN', 'pause', { ms: 2600, escape: !!rec.pauseEscape })]], leads: ['II'], line: 'A sudden pause with no P wave, not a multiple of the P–P interval, then sinus beats resume: sinus pause.' },
    // repeating ectopy (bigeminy: after every sinus beat; trigeminy: after every second one) and short runs, scheduled beat
    // by beat from the engine's own sinus beats (sinus rhythm only, like the single ectopics)
    vbig: { group: 'ectopy', skill: 'rhythm', rating: 100, ectopy: 'vbig', id: 'vbigeminy', optional: ['pvc'], leads: ['II'], line: 'Every sinus beat is followed by a PVC (normal, PVC, normal, PVC…): ventricular bigeminy.' },
    vtrig: { group: 'ectopy', skill: 'rhythm', rating: 110, ectopy: 'vtrig', id: 'vtrigeminy', optional: ['pvc'], leads: ['II'], line: 'Every third beat is a PVC (two sinus beats, then a PVC): ventricular trigeminy.' },
    abig: { group: 'ectopy', skill: 'rhythm', rating: 140, ectopy: 'abig', id: 'abigeminy', optional: ['pac'], leads: ['II'], line: 'Every sinus beat is followed by an early P of another shape with a narrow QRS: atrial bigeminy (it can look like an irregular rhythm until the paired P waves are seen).' },
    atrig: { group: 'ectopy', skill: 'rhythm', rating: 150, ectopy: 'atrig', id: 'atrigeminy', optional: ['pac'], leads: ['II'], line: 'Every third beat is an early P of another shape with a narrow QRS: atrial trigeminy.' },
    nsvt: { group: 'ectopy', skill: 'rhythm', rating: 120, ectopy: 'nsvt', id: 'nsvt', optional: ['pvc', 'couplet'], leads: ['II'], line: 'A run of three or more broad complexes at over 100/min that stops by itself within 30 s: non-sustained ventricular tachycardia.' },
    arun: { group: 'ectopy', skill: 'rhythm', rating: 140, ectopy: 'arun', id: 'svtrun', optional: ['pac', 'acouplet'], leads: ['II'], line: 'A run of three or more early narrow complexes at over 100/min with abnormal P waves, then sinus rhythm resumes: a short run of SVT (paroxysmal atrial tachycardia).' },
    couplet: { group: 'ectopy', skill: 'rhythm', rating: 60, ectopy: 'couplet', id: 'couplet', leads: ['II'], line: 'Two premature wide complexes in a row: a ventricular couplet (three or more would be non-sustained VT).' },
    // Wellens (Round 52; Sim.setWellens): a reperfused critical proximal LAD lesion, T changes over V2–V3, no Q waves
    wellensA: { group: 'isch', skill: 'ischemia', rating: 180, adv: ADV, id: 'wellens', wellens: 'A', link: 'wellens=A', optional: ['twi'], excl: ['peri', 'brugada', 'repol', 'bbb', 'hyp', 'wpw', 'electro', 'fasc'], leads: ['V2', 'V3'], line: 'Biphasic T waves (up, then down) in V2–V3 with no Q waves and the ST near baseline: Wellens type A, a critical proximal LAD stenosis.' },
    wellensB: { group: 'isch', skill: 'ischemia', rating: 140, adv: ADV, id: 'wellens', wellens: 'B', link: 'wellens=B', optional: ['twi'], excl: ['peri', 'brugada', 'repol', 'bbb', 'hyp', 'wpw', 'electro', 'fasc'], leads: ['V2', 'V3', 'V4'], line: 'Deep, symmetric T inversion in V2–V4 with no Q waves and the ST near baseline: Wellens type B, a critical proximal LAD stenosis.' },
    // electrolytes and hypothermia (Round 51; Sim.setElectrolyte): one per ECG, not with ST-T disease or a wide QRS
    hyperK: { group: 'electro', skill: 'conditions', rating: 80, id: 'hyperK', elec: ['hyperK', 1], link: 'hyperK=mild', excl: ['isch', 'peri', 'brugada', 'repol', 'wpw', 'bbb', 'hyp'], leads: ['V2', 'V3', 'V4', 'II'], line: 'Tall, narrow-based, peaked T waves: hyperkalemia (K about 6–7).' },
    hyperK2: { group: 'electro', skill: 'conditions', rating: 160, id: 'hyperK', elec: ['hyperK', 2], link: 'hyperK=severe', optional: ['avb1', 'ivcd'], excl: ['isch', 'peri', 'brugada', 'repol', 'wpw', 'bbb', 'hyp'], leads: ['II', 'V1', 'V3'], line: 'Peaked T waves with flattened P waves, a long PR and a wide QRS: severe hyperkalemia (K above 7). Treat now.' },
    hypoK: { group: 'electro', skill: 'conditions', rating: 120, id: 'hypoK', elec: ['hypoK', 1], struct: 'hypoK', optional: ['nsstt', 'longqt'], excl: ['isch', 'peri', 'brugada', 'repol', 'wpw', 'bbb', 'hyp'], leads: ['V2', 'V3'], line: 'Flat T waves followed by prominent U waves in V2–V3: hypokalemia.' },
    hypoCa: { group: 'electro', skill: 'conditions', rating: 120, adv: ADV, id: 'hypoCa', elec: ['hypoCa', 1], struct: 'hypoCa', optional: ['longqt'], excl: ['isch', 'peri', 'brugada', 'repol', 'wpw', 'bbb', 'hyp'], leads: ['II', 'V3'], caliper: 'qt', line: 'Long QTc from a long, flat ST segment with a normal T wave: hypocalcemia.' },
    hyperCa: { group: 'electro', skill: 'conditions', rating: 140, adv: ADV, id: 'hyperCa', elec: ['hyperCa', 1], struct: 'hyperCa', excl: ['isch', 'peri', 'brugada', 'repol', 'wpw', 'bbb', 'hyp'], leads: ['II', 'V3'], caliper: 'qt', line: 'Short QTc: the T wave starts almost at the end of the QRS (short ST segment): hypercalcemia.' },
    hypothermia: { group: 'electro', skill: 'conditions', rating: 140, adv: ADV, id: 'hypothermia', elec: ['hypothermia', 1], struct: 'hypothermia', cold: true, optional: ['longqt', 'avb1'], excl: ['isch', 'peri', 'brugada', 'repol', 'wpw', 'bbb', 'hyp'], leads: ['II', 'V4', 'V5'], line: 'J (Osborn) waves at the end of the QRS with bradycardia and a long QT: hypothermia.' },
    brugada: { group: 'brugada', skill: 'conditions', rating: 80, dx: 'Brugada type 1', brugada: true, struct: 'brugada', excl: ['isch', 'peri'], leads: ['V1', 'V2'], line: 'Coved ST elevation ≥ 2 mm in V1–V2 into a negative T: Brugada pattern.' },
  };
  // (testers' round 1: fewer hypertrophy, Brugada and atrial enlargement; more ST depression, T changes,
  // WPW and ectopy)
  const ABN_W = { avb1: 1.2, rae: 0.3, lae: 0.3, bae: 0.15, lafb: 0.9, lpfb: 0.5, lbbb: 1.5, rbbb: 1.5, wpw: 0.6, lvh: 0.7, rvh: 0.3, stemi: 2.5, oldmi: 2, recent: 2.5, evolving: 2, multinarrow: 1.2, hyper: 2, narrow: 3.5, nsstt: 2.5, peri: 0.8, brugada: 0.1, pvc: 2, pac: 1.5, couplet: 0.8, sinusPause: 1.2, acouplet: 0.6, saBlock: 0.8, vbig: 0.8, vtrig: 0.6, abig: 0.5, atrig: 0.4, nsvt: 0.7, arun: 0.6, hyperK: 0.35, hyperK2: 0.15, hypoK: 0.3, hypoCa: 0.2, hyperCa: 0.15, hypothermia: 0.4, wellensA: 0.2, wellensB: 0.25 };   // (the electrolytes, Wellens and hypothermia: rare, about as often as atrial enlargement)
  const ITEM_BASE = 1200, PER_ABN = 180;
  // (difficulty above the base is stretched ×1.32: the hardest ECGs, four findings on a hard rhythm, reach ~2700
  // instead of ~2340, leaving headroom above the top title; the generator works on the unstretched scale)
  const ITEM_SCALE = 1.1;   // (hardest clean ECG ~2450; artifacts add up to ART_BONUS × 1.25 = 250, so the hardest reach ~2700)
  // artifacts: a reading layer for users rated 1650 and above (target = rating − 168). Chance 35% at 1650 rising to 60%;
  // strength rising with the target up to level 1 (ART_MAX); one kind, a quarter of the time two (from level 0.5)
  const ART_FROM = 1650 - 168, ART_SPAN = 800, ART_BONUS = 200;
  const ART_EL = [['RA', 2], ['LA', 2], ['LL', 2], ['V1', 0.5], ['V2', 0.5], ['V3', 0.5], ['V4', 0.5], ['V5', 0.5], ['V6', 0.5]];
  const artBonus = (art) => (art ? Math.round(ART_BONUS * art.level * (1 + 0.25 * (art.kinds.length - 1))) : 0);
  function sampleArt(rand, target, rhythm) {
    if (target < ART_FROM) return null;   // (every rhythm can carry artifacts, VT, torsades and VF included)
    const x = Math.min(1, (target - ART_FROM) / ART_SPAN);
    if (rand() >= 0.35 + 0.25 * x) return null;
    const level = +Math.max(0.15, Math.min(1, 0.25 + 0.75 * x + (rand() - 0.5) * 0.3)).toFixed(2);
    const all = ['tremor', 'wander', 'mains'], kinds = [all[Math.floor(rand() * 3)]];
    if (level > 0.5 && rand() < 0.25) kinds.push(all.filter((k) => k !== kinds[0])[Math.floor(rand() * 2)]);
    const el = {}; for (const k of ['tremor', 'wander']) if (kinds.includes(k)) el[k] = pickW(rand, ART_EL);
    return { kinds, el, level };
  }

  // Combination rules (the author's clinical calls; see docs/DEVELOPMENT.md training-1):
  // - at most one QRS-changing condition, except RBBB with LAFB or LPFB (bifascicular block)
  // - LBBB: no ischemia, no pericarditis; RBBB: infarcts and narrowing yes, hyperacute T and pericarditis no
  // - pericarditis only with the rhythm, atrial enlargement or first-degree block
  // - WPW: with ischemia, not with atrial enlargement (the P runs into the delta wave) or 1st-degree block
  // - fascicular block and infarct: LAFB not with an inferior infarct, LPFB not with an LAD or circumflex one
  //   (the infarct moves the axis: see siteOk)
  const QRS = ['lbbb', 'rbbb', 'lafb', 'lpfb', 'lvh', 'rvh', 'brugada', 'wpw'];
  // (2026-11-18: RBBB + LAFB is out of Training for now: the model's RBBB alone already reads about −51° (its late RV forces
  // point up), so it cannot be told from RBBB + LAFB (about −63°); see neutral in build. RBBB + LPFB stays: it reads right axis)
  const BIFASC = [['rbbb', 'lpfb']];
  function compatible(rh, list, k) {
    const a = ABN[k], R = RHYTHMS[rh], all = [...list, k], has = (x) => all.includes(x);
    if (!R.open) return false;
    if (a.needP && !R.pRhythm) return false;
    if (a.group === 'av' && R.block) return false;
    if ((R.notWith || []).includes(k)) return false;
    if (a.cold && rh !== 'sinusBrady') return false;   // (hypothermia slows the sinus node)
    if ((a.ectopy || a.pause || a.sinusNode) && !['sinus', 'sinusBrady'].includes(rh)) return false;   // (ectopy and pauses are timed from sinus beats)
    // (pericarditis: with P waves (PR depression read), or in AF (diffuse concave ST elevation alone))
    if (k === 'peri' && !(R.pRhythm || rh === 'af' || rh === 'junctional')) return false;
    if (has('wpw') && all.some((x) => ABN[x].ectopy || ABN[x].pause || ABN[x].sinusNode)) return false;   // (at 106–125/min the P sits on the previous T: hidden or not read)
    for (const j of list) {
      const b = ABN[j];
      if (b.group === a.group) return false;
      if ((a.excl || []).includes(b.group) || (b.excl || []).includes(a.group)) return false;
    }
    const q = all.filter((x) => QRS.includes(x));
    if (q.length > 2 || (q.length === 2 && !BIFASC.some(([x, y]) => q.includes(x) && q.includes(y)))) return false;
    const isch = has('stemi') || has('evolving') || has('oldmi') || has('recent') || has('hyper') || has('narrow');
    if (has('lbbb') && ((isch && !has('stemi')) || has('peri') || all.some((x) => ['wellensA', 'wellensB'].includes(x)))) return false;   // (Round 52: LBBB with an acute STEMI, read by the Sgarbossa criteria)
    if (has('rbbb') && (has('hyper') || has('peri'))) return false;   // (RBBB's own ST-T in V1–V3 hides them; Round 50: old/recent infarcts and narrowing allowed)
    if (has('peri') && all.some((x) => x !== 'peri' && !['rae', 'lae', 'bae', 'avb1'].includes(x))) return false;
    if (has('wpw') && all.some((x) => ['rae', 'lae', 'bae', 'avb1', 'peri'].includes(x))) return false;
    return true;
  }
  // (Round 50: LAFB with an old or recent inferior/circumflex infarct stays out: the inferior Q waves replace LAFB's rS, as
  // in real ECGs; LAFB with an acute STEMI anywhere, and LPFB with any infarct, are allowed and gated on their criteria)
  const siteOk = (site, list, k) => (!MI_SITES[site].kinds || MI_SITES[site].kinds.includes(k))
    && !(list.includes('lafb') && /RCA|LCx/.test(famOf(site)) && ['oldmi', 'recent', 'evolving'].includes(k)) && !(list.includes('lpfb') && famOf(site) === 'RCA' && ['oldmi', 'recent', 'evolving'].includes(k))
    && !(list.includes('avb1') && /^[pm]RCA$/.test(site))
    && !(list.includes('wpw') && famOf(site) === 'LCx');   // (the left-lateral pathway inserts in circumflex territory: an infarct there removes the pre-excitation)   // (a proximal RCA occlusion slows the AV node too: with first-degree block the P sinks into the T)
  function itemRating(rec) {
    return Math.round(ITEM_BASE + ITEM_SCALE * (RHYTHMS[rec.rhythm].rating + rec.abn.reduce((s, a) => s + PER_ABN + ABN[a.k].rating + (a.sev && a.sev < 1 ? 60 : 0) + (a.h === 12 ? 30 : 0), 0))) + artBonus(rec.art);
  }
  // (a weight that is missing or not a number counts as 0.5: one undefined weight made the whole draw pick the
  // last entry every time)
  function pickW(rand, entries) {
    const ws = entries.map(([, w]) => (Number.isFinite(w) && w >= 0 ? w : 0.5)), tot = ws.reduce((s, w) => s + w, 0);
    let x = rand() * tot;
    for (let i = 0; i < entries.length; i++) { if ((x -= ws[i]) <= 0) return entries[i][0]; }
    return entries[entries.length - 1][0];
  }

  // a random scenario near the target rating, preferring one that exercises the focus skill
  // A scenario near the target rating: the rhythm is drawn first, by its weight (so every rhythm keeps its share
  // whatever the user's level: a tachycardia carries no other findings); then the number of abnormalities is
  // set by the target (one per ~300 rating points above the base) and they are drawn by their weights, so the weights set
  // the mix (choosing the best of many random combinations favoured the abnormalities with the largest
  // difficulty bonus: hypertrophy, Brugada, 2:1 block). With a focus skill, one abnormality is from it.
  // adjust: per rhythm/abnormality weight multipliers from the page (recently seen: rarer; often missed: more often)
  function sample(rand, target = 1400, focus = null, nMax = 4, adjust = {}) {
    const wr = (k, w) => w * (adjust[k] === undefined ? 1 : adjust[k]);
    let rhythm = pickW(rand, Object.entries(RHYTHMS).map(([k, r]) => [k, wr(k, r.w)]));
    if (focus && focus !== 'rhythm' && !RHYTHMS[rhythm].open) rhythm = pickW(rand, Object.entries(RHYTHMS).filter(([, r]) => r.open).map(([k, r]) => [k, wr(k, r.w)]));
    const R = RHYTHMS[rhythm];
    // (a plain normal ECG only now and then (~6%): it was the most repeated interpretation; a rhythm that takes
    // findings otherwise gets at least one)
    const art = sampleArt(rand, target, rhythm);
    const raw = ITEM_BASE + (target - artBonus(art) - ITEM_BASE) / ITEM_SCALE;   // (the target on the generator's own scale, less the artifacts' share)
    const n0 = R.open ? Math.min(nMax, Math.round((raw - ITEM_BASE - R.rating) / (PER_ABN + 120) + (rand() - 0.5))) : 0;
    const n = R.open ? Math.max(focus && focus !== 'rhythm' ? 1 : 0, n0 > 0 || rand() < 0.15 * (adjust.normal === undefined ? 1 : adjust.normal) ? n0 : 1) : 0;
    const list = [];
    for (let i = 0; i < n; i++) {
      let opts = Object.keys(ABN).filter((k) => !list.includes(k) && compatible(rhythm, list, k));
      if (i === 0 && focus && focus !== 'rhythm' && opts.some((k) => ABN[k].skill === focus)) opts = opts.filter((k) => ABN[k].skill === focus);
      if (!opts.length) break;
      list.push(pickW(rand, opts.map((k) => [k, wr(k, ABN_W[k])])));
    }
    // (an infarct takes an artery the other abnormalities allow; if they allow none, it is left out)
    const abn = list.map((k) => {
      const a = { k };
      // (a mid-LAD narrowing stays under 1 mm: not asked)
      if (ABN[k].isch) { const sites = Object.keys(MI_SITES).filter((x) => siteOk(x, list, k) && !(k === 'hyper' && famOf(x) === 'LCx')); if (!sites.length) return null; a.site = pickW(rand, sites.map((x) => [x, adjust[`site:${x}`] === undefined ? 1 : adjust[`site:${x}`]]));
        if (ABN[k].stops) a.h = ABN[k].stops[Math.floor(rand() * ABN[k].stops.length)];
        if (ABN[k].stenosis && !ABN[k].multi) a.sev = pickW(rand, [[0.8, 0.3], [1, 0.4], [1.35, 0.3]]);
        if (ABN[k].multi) { const fam = ['mLAD', 'pLCx', 'pRCA'].sort(() => rand() - 0.5); a.sites = fam.slice(0, rand() < 0.35 ? 3 : 2); a.site = a.sites[0]; } }   // (no hyperacute T at a circumflex site: its T barely grows; nor at the proximal RCA, whose inferior T stays under 5 mm)
      return a;
    }).filter(Boolean);
    let rate = 72;
    const band = R.rateBands ? pickW(rand, R.rateBands.map((b) => [b, b[2]])) : R.rate;
    if (R.rate) for (let i = 0; i < 50; i++) { rate = Math.round(band[0] + rand() * (band[1] - band[0])); if (!R.rateOk || R.rateOk(rate)) break; }
    const rec = { rhythm, abn, seed: 1 + Math.floor(rand() * 1e6), rate };
    if (R.variable) rec.fv = R.variable[Math.floor(rand() * R.variable.length)];
    if (rhythm === 'sinusArr') rec.sa = [+(0.15 + 0.07 * rand()).toFixed(2), Math.round(4000 + 2000 * rand())];
    if (abn.some((a) => a.k === 'sinusPause')) rec.pauseEscape = rand() < 0.5;
    if (art) rec.art = art;
    return rec;
  }

  // ---------------------------------------------------------------- simulation
  function TrainGen(LH, readers, JA) {
    const { read, readRhythm } = readers;
    const models = {};
    const model = (hyp) => {
      const key = hyp || 'none';
      if (!models[key]) {
        const H = LH.hypertrophyOptions(hyp ? { [hyp]: true } : {});
        const A = new LH.Anatomy(JSON.parse(JSON.stringify(JA)), H.anatomy);
        models[key] = new LH.Model(A, { ...H.params });
      }
      return models[key];
    };
    const LAB = LH.LAB;
    // ---------------------------------------------------------------- artifacts (a reading layer, generator only)
    // Added to the finished strip after every check (the checks read the clean ECG); the simulator never sees them.
    // Each artifact is a potential on one electrode (or, for mains interference, on all of them); the 12 leads are
    // formed from the electrodes as the machine forms them, so a right-arm artifact shows in I, II, aVR, aVL, aVF
    // and every V lead (through Wilson's central terminal) but not in III, and one on V3 only in V3.
    // art = { kinds: ['tremor' | 'wander' | 'mains'], el: { tremor, wander }, level 0–1 } (rec.art)
    function artifactLeads(art, seed, n, hz = HZ) {
      const r = LH.rng((seed ^ 0xa27f) >>> 0), E = {}, dt = 1 / hz;
      for (const e of ELECTRODES) E[e] = new Float32Array(n);
      const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
      const lv = art.level;
      if (art.kinds.includes('tremor')) {
        // muscle tremor: bursts of 0.6–2 s (2–4 of them) of a coarse 4–9 Hz shaking whose size and pace wander, with a
        // little low-passed muscle noise on top: slower than mains interference, which is a fine even 50 Hz band
        // duration varies too: a quarter of strips shake throughout (a shivering patient, the size swelling and easing
        // over seconds); the rest have 1–4 bursts of 0.4–3.5 s, each of its own strength
        const x = E[art.el.tremor], A = ART_MAX.tremor * lv;
        let w0 = 0, w1 = 0;
        const env = new Float32Array(n);
        if (r() < 0.25) {
          const f = 0.08 + 0.12 * r(), p = 2 * Math.PI * r();
          for (let i = 0; i < n; i++) env[i] = 0.7 + 0.3 * Math.sin(2 * Math.PI * f * i * dt + p);
        } else {
          const nb = 1 + Math.floor(r() * 4);
          for (let b = 0; b < nb; b++) {
            const len = Math.min(n, (0.4 + 3.1 * r() * r()) * hz), t0 = r() * (n - len), ramp = 0.15 * hz, g = 0.55 + 0.45 * r();
            for (let i = Math.max(0, Math.floor(t0)); i < Math.min(n, t0 + len); i++) { const u = Math.min(1, (i - t0) / ramp, (t0 + len - i) / ramp); env[i] = Math.max(env[i], g * (0.5 - 0.5 * Math.cos(Math.PI * u))); }
          }
        }
        const f0 = 4 + 5 * r(), v = new Float32Array(n); let ph = 2 * Math.PI * r(), am = 1, lp1 = 0, lp2 = 0, ss = 0;
        const k = 1 - Math.exp(-2 * Math.PI * 15 / hz);   // (muscle noise low-passed at ~15 Hz)
        for (let i = 0; i < n; i++) {
          ph += 2 * Math.PI * f0 * (1 + 0.25 * gauss() * 0.3) * dt; am += 0.08 * gauss() - 0.04 * (am - 1);
          lp1 += k * (gauss() - lp1); lp2 += k * (lp1 - lp2);
          v[i] = Math.max(0.2, am) * Math.sin(ph) + 2.2 * lp2; ss += v[i] * v[i];
        }
        const norm = 1 / Math.sqrt(ss / n || 1);
        for (let i = 0; i < n; i++) x[i] += A * env[i] * v[i] * norm;
        void w0; void w1;
      }
      if (art.kinds.includes('wander')) {
        // baseline wander: slow swings (breathing 0.15–0.3 Hz, and a slower drift) on one electrode
        const x = E[art.el.wander], A = ART_MAX.wander * lv, f1 = 0.15 + 0.15 * r(), f2 = 0.05 + 0.07 * r(), p1 = 2 * Math.PI * r(), p2 = 2 * Math.PI * r();
        for (let i = 0; i < n; i++) x[i] += A * (0.65 * Math.sin(2 * Math.PI * f1 * i * dt + p1) + 0.35 * Math.sin(2 * Math.PI * f2 * i * dt + p2));
      }
      if (art.kinds.includes('mains')) {
        // electrical interference: 50 Hz on every electrode, unequal (the amplifier rejects only the common part)
        const ph = 2 * Math.PI * r();
        for (const e of ELECTRODES) { const A = ART_MAX.mains * lv * (0.2 + 0.8 * r()); for (let i = 0; i < n; i++) E[e][i] += A * Math.sin(2 * Math.PI * 50 * i * dt + ph); }
      }
      const { RA, LA, LL } = E, out = LEADS.map(() => new Float32Array(n));
      for (let i = 0; i < n; i++) {
        const ra = RA[i], la = LA[i], ll = LL[i], wct = (ra + la + ll) / 3;
        out[0][i] = la - ra; out[1][i] = ll - ra; out[2][i] = ll - la;
        out[3][i] = ra - (la + ll) / 2; out[4][i] = la - (ra + ll) / 2; out[5][i] = ll - (ra + la) / 2;
        for (let k = 1; k <= 6; k++) out[5 + k][i] = E['V' + k][i] - wct;
      }
      return out;
    }
    // the scenario's structure on a fresh Sim (everything except the rhythm)
    function base(M, rec) {
      const S = new LH.Sim(M, { seed: rec.seed });
      const R = RHYTHMS[rec.rhythm];
      if (R.rate) S.setRate(rec.rate);
      const atria = {};
      for (const a of rec.abn) {
        const d = ABN[a.k];
        if (d.block) S.setBlock(d.block[0], d.block[1], d.block[2] || {});
        if (d.atria) Object.assign(atria, d.atria);
        if (d.ap) S.setAccessoryPathway('left-lateral');
        if (d.peri) S.setPericarditis(true);
        if (d.brugada) S.setBrugada(true);
        if (d.elec) S.setElectrolyte(d.elec[0], d.elec[1]);
        if (d.wellens) S.setWellens(d.wellens);
        if (d.nsstt) S.setNonspecificSTT(true);
      }
      if (atria.ra || atria.la) S.setAtrialEnlargement(atria);
      if (R.block) S.setBlock(R.block[0], R.block[1], R.block[2] || {});
      if (R.block2) S.setBlock(R.block2[0], R.block2[1], R.block2[2] || {});
      const isch = rec.abn.find((a) => ABN[a.k].isch);
      if (isch) { for (const st of isch.sites || [isch.site]) { const node = MI_SITES[st].f(M.coronary.branches); if (ABN[isch.k].stenosis) S.addStenosis(node, { sev: isch.sev || 1 }); else S.addOcclusion(node); } S.setIschemiaTime(isch.h || ABN[isch.k].isch); }
      return S;
    }
    function induce(M, rec) {
      const A = M.A, avrt = rec.rhythm === 'avrt';
      const cell = avrt ? A.nearest(A.landmarks.LAA.c, (c) => A.label[c] === LAB.LA) : A.nearest(A.landmarks.SVC.c, (c) => A.label[c] === LAB.RA);
      for (const ci of avrt ? [270, 250, 290, 230, 310] : [280, 260, 240, 220, 200, 180, 160]) {
        const S = base(M, rec);
        if (avrt) S.setAccessoryPathway('left-lateral'); else S.setDualAVN(true);
        S.run(2600); S.stimulateAt(cell, S.nextSinus() + ci); S.run(3000);
        const V = S.log.vent.filter((v) => v.on > S.t - 1200), rr = V.slice(1).map((v, i) => v.on - V[i].on);
        if (rr.length >= 2 && rr.every((x) => x < 450)) return S;
      }
      return null;
    }
    // MAT foci in four distinct parts of the atria, so the P shapes differ visibly: high RA (sinus-like P), low RA
    // (inverted in II, III, aVF), LA appendage (negative in I) and the left inferior pulmonary vein (posterior LA)
    function matFoci(M) {
      const A = M.A, at = (lm, lab) => A.nearest(A.landmarks[lm].c, (c) => A.label[c] === lab && M.kind[c] === LH.KIND.ATRIAL && !M.seg[c]);
      return [at('SVC', LAB.RA), at('IVC', LAB.RA), at('LAA', LAB.LA), at('LIPV', LAB.LA)].filter((c) => c >= 0);
    }
    function vtCell(A) { for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.epi[c] && A.zuvc[c] > 0.35 && A.zuvc[c] < 0.45 && A.phi[c] < -2.2) return c; return -1; }
    // the scenario run: 10 s of 12 leads, and the engine's own timing of every atrial and ventricular
    // activation in the strip (start and end; for the ventricles also the end of repolarisation)
    function simulate(rec, strip = STRIP) {
      const hypA = rec.abn.find((a) => ABN[a.k].hyp), M = model(hypA ? ABN[hypA.k].hyp : null), R = RHYTHMS[rec.rhythm];
      let S;
      if (R.induce) S = induce(M, rec);
      else { S = base(M, rec); if (R.start) R.start(S, rec, M, { matFoci }); if (R.vt) { S.run(2000); S.startArrhythmia('vt', { cell: vtCell(M.A) }); } }
      if (!S) return null;
      S.run(R.induce || rec.rhythm === 'flutter' || rec.rhythm === 'flutterVar' ? 1500 : SETTLE);   // (flutter and the induced tachycardias have run 3–5 s in their own start-up)
      const rec12 = []; let t0 = null; const atr = new Set(), ven = new Set(), stims = [], fired = new Set();
      S.onSample((t, v) => { if (t0 === null) t0 = t; rec12.push(Array.from(v)); });
      // timed events in the strip: the rhythm's own (a sinus pause) and ectopic beats
      const events = [...(R.at || []), ...rec.abn.flatMap((a) => ABN[a.k].at || [])].map(([t, fn]) => ({ t, fn }));
      const ect = rec.abn.find((a) => ABN[a.k].ectopy);
      let repeat = null;
      if (ect) {
        const er = LH.rng((rec.seed ^ 0xec70) >>> 0), A = M.A, kind = ABN[ect.k].ectopy, rr = 60000 / (R.rate ? rec.rate : 72);
        const pickCell = (f) => { const pool = []; for (let c = 0; c < M.nVox; c++) if (f(c)) pool.push(c); return pool[Math.floor(er() * pool.length)]; };
        const cell = ['pac', 'acouplet', 'abig', 'atrig', 'arun'].includes(kind) ? pickCell((c) => M.kind[c] === LH.KIND.ATRIAL && !M.seg[c]) : pickCell((c) => M.kind[c] === LH.KIND.VENT && A.epi[c]);
        // a PVC ~0.6 RR after the last QRS (after its T wave, before the next sinus beat conducts); a PAC ~0.65 RR
        // after the last P wave; a couplet: a second PVC 380 ms after the first
        const fire = () => {
          const lv = S.log.vent[S.log.vent.length - 1], next = S.nextSinus();
          if (kind === 'pac' || kind === 'acouplet') {
            let tp = next - 0.35 * rr; if (tp <= S.t + 5) tp += rr; S.stimulateAt(cell, tp); stims.push({ t: tp, kind: 'pac' });
            if (kind === 'acouplet') { const t2 = tp + Math.max(440, 0.62 * rr); S.stimulateAt(cell, t2); stims.push({ t: t2, kind: 'pac' }); }   // (the second PAC early after the first)
            return;
          }
          // (the PVC well before the next sinus P, so it cannot fuse with the conducted beat (the author: a couplet's first beat
          // looked like fusion); seen too late in this cycle: tried again in the next)
          const tp = Math.max(S.t + 5, lv.on + Math.max(420, 0.6 * rr));
          const la = S.log.atrial[S.log.atrial.length - 1];
          if (tp > next - 40 || (la && la.on > lv.on)) return false;   // (a sinus P already on its way to the ventricles: fusion)
          { S.stimulateAt(cell, tp); stims.push({ t: tp, kind: 'pvc' }); if (kind === 'couplet') { S.stimulateAt(cell, tp + 380); stims.push({ t: tp + 380, kind: 'pvc' }); } }
        };
        const PATTERN = { vbig: ['v', 1], vtrig: ['v', 2], abig: ['a', 1], atrig: ['a', 2] }[kind];
        if (PATTERN) {
          // after every (bigeminy) or every second (trigeminy) sinus beat: a PVC 0.6 RR after the QRS, a PAC 0.65 RR after the P
          // (a fixed coupling interval, as in real bigeminy: a PVC just after the T wave (Bazett QT + 40–80 ms), a PAC
          // 0.6 RR after the P; constant through the strip; a beat seen too late to keep it is skipped, not fired late)
          const qt = 410 * Math.sqrt(rr / 1000), vCoup = Math.round(qt + 40 + 40 * er()), aCoup = Math.round(Math.max(380, 0.6 * rr));
          const [chamber, every] = PATTERN, st = { handled: -1e9, n: 0 }, isOwn = (t0x) => stims.some((x) => Math.abs(x.t - t0x) < 80 || (x.kind === 'pac' && t0x > x.t && t0x < x.t + 120));
          repeat = () => {
            if (S.t - t0 < 800 || S.t - t0 > strip - 700) return;
            const log = chamber === 'v' ? S.log.vent : S.log.atrial, b = log[log.length - 1];
            if (!b || b.on <= st.handled || isOwn(b.on)) return;
            st.handled = b.on; st.n++;
            if (st.n % every) return;
            const tp = b.on + (chamber === 'v' ? vCoup : aCoup);
            if (tp < S.t + 2) return;
            S.stimulateAt(cell, tp); stims.push({ t: tp, kind: chamber === 'v' ? 'pvc' : 'pac' });
          };
        } else if (kind === 'nsvt' || kind === 'arun') {
          // one run of 3–6 PVCs (360–400 ms apart) or 4–7 PACs (380–420 ms apart), 3.6 s into the strip
          const n = kind === 'nsvt' ? 3 + Math.floor(er() * 4) : 4 + Math.floor(er() * 4), cyc = kind === 'nsvt' ? 360 + 40 * er() : 380 + 40 * er();
          events.push({ t: 3600, fn: () => {
            const lv = S.log.vent[S.log.vent.length - 1], next = S.nextSinus();
            const t1 = kind === 'nsvt' ? Math.max(S.t + 5, lv.on + Math.max(420, 0.6 * rr)) : Math.max(S.t + 5, next - 0.35 * rr);
            for (let i = 0; i < n; i++) { S.stimulateAt(cell, t1 + i * cyc); stims.push({ t: t1 + i * cyc, kind: kind === 'nsvt' ? 'pvc' : 'pac' }); }
          } });
        } else for (const t of kind === 'couplet' || kind === 'acouplet' ? [3800] : [2600, 6600]) events.push({ t, fn: fire });
      }
      for (let t = 0; t < strip; t += 100) {
        for (const e of events) if (!e.done && e.t >= t && e.t < t + 100) { e.done = true; if (e.fn(S, rec) === false && e.t < strip - 2500) { e.done = false; e.t = t + 100; } }
        if (repeat) { for (let u = 0; u < 5; u++) { if (t0 !== null) repeat(); S.run(20); } } else
        S.run(100);
        if (t % 500 === 400) { S.log.atrial.forEach((x) => atr.add(x)); S.log.vent.forEach((x) => ven.add(x)); S.fireLog.forEach((x) => { if (x.name === 'focus') fired.add(x); }); }   // (the logs keep 50 entries)
      }
      const inStrip = (x) => x.on - t0 >= 0 && x.on - t0 < strip;
      const rel = (x) => ({ on: x.on - t0, last: x.last - t0, end: x.repEnd ? x.repEnd - t0 : null, n: x.n });
      return { S, M, rec12, t0, A: [...atr].filter(inStrip).sort((a, b) => a.on - b.on).map(rel), V: [...ven].filter(inStrip).sort((a, b) => a.on - b.on).map(rel), stims: stims.map((x) => ({ ...x, t: x.t - t0 })), foci: [...fired].filter((x) => x.t - t0 >= 0 && x.t - t0 < strip).map((x) => ({ t: x.t - t0, cell: x.cell })) };
    }
    // a 3.6 s sinus beat of the same heart (measurements for the fast tachycardias, whose T runs into the next QRS)
    function sinusRead(M) {
      const S = new LH.Sim(M, { seed: 1 }); const r = []; S.onSample((t, v) => r.push(Array.from(v))); S.run(3600);
      const v = S.log.vent, vb = v[v.length - 2]; return read(r, Math.round(vb.on), v[v.length - 2].on - v[v.length - 3].on);
    }
    // the median beat (as clinical programs measure): every complete beat of the strip aligned at its
    // ventricular onset (engine timing), sample by sample the median of each lead
    // the beats an ectopic stimulus produced (a PVC itself; the early beat a PAC conducts)
    function ectopicBeats(sim) {
      const out = new Set();
      for (const st of sim.stims || []) {
        const v = sim.V.find((x) => (st.kind === 'pac' ? x.on > st.t + 60 && x.on < st.t + 350 : x.on >= st.t - 5 && x.on <= st.t + 60));
        if (v) out.add(v);
      }
      return out;
    }
    function medianBeat(sim) {
      // (the RR for QTc and the window: the shorter, sinus cycle, not a pause of SA block or around an ectopic beat)
      const ect = ectopicBeats(sim), { rec12 } = sim, V = sim.V.filter((v) => !ect.has(v)), rrs = V.slice(1).map((v, i) => v.on - V[i].on), rr = rrs.length ? rrs.slice().sort((a, b) => a - b)[Math.floor(rrs.length * 0.25)] : 833;
      const pre = Math.round(Math.min(520, Math.max(250, rr - 250))), post = Math.round(Math.min(650, rr - 20));
      const ons = V.map((v) => Math.round(v.on)).filter((o) => o - pre >= 0 && o + post < rec12.length);
      if (ons.length < 3) return null;
      const out = [], col = new Float64Array(ons.length);
      for (let i = 0; i < pre + post; i++) {
        const row = new Array(12);
        for (let k = 0; k < 12; k++) { for (let j = 0; j < ons.length; j++) col[j] = rec12[ons[j] - pre + i][k]; const sorted = Array.from(col).sort((a, b) => a - b); row[k] = sorted[sorted.length >> 1]; }
        out.push(row);
      }
      // (the end of ventricular activation, from the engine: the earliest QRS end the reader may take)
      const dur = V.map((v) => v.last - v.on).sort((a, b) => a - b), qrsEnd = pre + dur[dur.length >> 1] + 5;
      return { rec: out, hint: pre, rr, n: ons.length, qrsEnd };
    }

    // ---------------------------------------------------------------- what a student would see
    // 1. Rhythm (engine timing): the rate, and whether the P waves can be seen (not inside a QRS or T wave).
    function pVisibility(sim) {
      const { A, V } = sim, overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
      let hidden = 0, n = 0;
      for (const a of A) {
        if (a.on < 200 || a.on > STRIP - 300) continue;
        if ((sim.stims || []).some((x) => Math.abs(a.on - x.t) < 400)) continue;   // (a P next to an ectopic beat: hidden by it, as expected)
        // (a retrograde P from an escape beat (a QRS no P conducted) sits in that QRS, as expected)
        if (V.some((v) => a.on >= v.on - 20 && a.on <= v.on + 200 && !A.some((x) => v.on - x.on > 60 && v.on - x.on < 300))) continue;
        const d = Math.max(40, a.last - a.on + 20); let cover = 0;   // (P wave ≈ atrial activation + 20 ms)
        for (const v of V) cover += overlap(a.on, a.on + d, v.on - 5, (v.end || v.last + 300));
        n++; if (cover / d > 0.5) hidden++;
      }
      return { n, hidden, share: n ? hidden / n : 0 };
    }
    // 2. Morphology: each abnormality on its own, with its published criteria measured on the median beat
    //    (no chained rules: LBBB does not stop LAFB from being looked at), and
    // 3. visibility: the same heart without that abnormality (the "twin") must differ by at least 1 mm
    //    (0.5 mm for P waves) somewhere in the median beat; the leads that differ most are highlighted.
    const NEXT = { II: ['III', 'aVF'], III: ['II', 'aVF'], aVF: ['II', 'III'], I: ['aVL'], aVL: ['I'], V1: ['V2'], V2: ['V1', 'V3'], V3: ['V2', 'V4'], V4: ['V3', 'V5'], V5: ['V4', 'V6'], V6: ['V5'] };
    const GROUPS = { septal: ['V1', 'V2'], anterior: ['V3', 'V4'], lowLateral: ['V5', 'V6'], highLateral: ['I', 'aVL'], inferior: ['II', 'III', 'aVF'] };
    const contiguous = (set) => set.filter((n) => (NEXT[n] || []).some((m) => set.includes(m)));
    // the infarct's wall in words, from the territories its Q waves reach (those the site allows): inferolateral, …
    const wallName = (ex, terr) => {
      const t = terr.filter((x) => ex.req.includes(x) || ex.ok.includes(x)), has = (x) => t.includes(x);
      if (has('inferior') && has('lateral')) return 'inferolateral';
      if (has('anterior') && has('lateral')) return has('septal') ? 'extensive anterior' : 'anterolateral';
      if (has('anterior') && has('septal')) return 'anteroseptal';
      return ex.req.join('/');
    };
    // (the territories where a change shows in at least two of the territory's own leads: one lead at a border, V4 beside
    // V5–V6, does not make the anterior wall)
    const terrStrong = (leads) => Object.keys(RL).filter((t) => RL[t].filter((n) => leads.includes(n)).length >= 2);
    const terrOf = (leads) => [...new Set(Object.entries(GROUPS).filter(([, g]) => g.some((n) => leads.includes(n))).map(([t]) => territory(t)))];
    const steLeads = (L) => contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].stJ >= (n === 'V2' || n === 'V3' ? 0.2 : 0.1)));
    // ST depression (4th UDMI, at the stricter teaching threshold): ≥ 1 mm at J+80 ms, horizontal or
    // downsloping (the ST rises < 0.5 mm from the J point to J+80: upsloping depression is nonspecific), in
    // two contiguous leads (aVR and V1 not counted)
    // (lead groups also accepted for a region-specific finding (the author, 2026-11-18: err on the side of caution, by the
    // textbook rule): any group with a lead in a pair of contiguous leads that meets the finding's criteria, so a group whose
    // second lead falls short, or a pair spanning two groups (V4–V5), costs nothing. ST depression ≥ 0.5 mm (4th UDMI),
    // ST elevation by steLeads (1 mm; 2 mm in V2–V3), T inversion by twiLeads (≥ 1 mm with a prominent R), Q waves by qLeads)
    const groupsOf = (leads) => Object.keys(RL).filter((t) => RL[t].some((n) => leads.includes(n)));
    const dipped = (L) => groupsOf(contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].st80 <= -0.05)));
    const raised = (L) => groupsOf(steLeads(L));
    const inverted = (L) => groupsOf(twiLeads(L));
    const qGroups = (L) => groupsOf(qLeads(L));
    const stdLeads = (L) => contiguous(LEADS.filter((n) => !['aVR', 'V1'].includes(n) && L[n].st80 <= -0.1 && L[n].st80 - L[n].stJ < 0.05));
    // T inversion (4th UDMI): ≥ 1 mm in two contiguous leads with a prominent R wave (R/S > 1); aVR, III and
    // V1 not counted
    // (behind Q/QS waves the R is gone and inverted T still counts)
    // (lead III counts with aVF or II beside it, never alone: a lone inverted T in III is normal)
    const twiLeads = (L) => contiguous(LEADS.filter((n) => !['aVR', 'V1'].includes(n) && L[n].T <= -0.1 && (L[n].R > L[n].S || L[n].qs || L[n].q.dur >= 30)));
    // (4th UDMI: lead III counts with aVF or II beside it (contiguous), never alone)
    // (Round 66, the author: a 30–32 ms, 1.3 mm q in V5 is not a Q wave anyone sees at 25 mm/s. Outside V2–V3 a lead counts
    // with a QS, a Q of at least 40 ms (one small square), or a Q of at least 30 ms that is at least 2 mm deep)
    const qLeads = (L) => contiguous(LEADS.filter((n) => (n === 'V2' || n === 'V3' ? L[n].q.dur >= 20 || L[n].qs : ['I', 'II', 'III', 'aVL', 'aVF', 'V4', 'V5', 'V6'].includes(n) && ((L[n].q.dur >= 40 && L[n].q.amp <= -0.1) || (L[n].q.dur >= 30 && L[n].q.amp <= -0.2) || L[n].qs))));
    // criteria (ACC/AHA 2009 conduction, Sokolow-Lyon, 4th UDMI, the reader's P-wave and Brugada
    // rules; tools/reader.js has the sources) → { ok, why, leads }
    function criteria(k, a, m, L) {
      const yes = (ok, why, leads, leads2) => ({ ok: !!ok, why, leads, leads2 });
      const latR = (n) => L[n].posShare >= 0.6 && L[n].q.dur === 0;
      switch (k) {
        case 'avb1': return yes(m.pr !== null && m.pr > 200, `PR ${m.pr}`);
        case 'rae': return yes(m.pAmp && m.pAmp.II >= 0.25, `P in II ${m.pAmp && m.pAmp.II} mV`);
        case 'lae': return yes(m.pdur !== null && m.pdur >= 120 && m.pNotch >= 40, `P ${m.pdur} ms, notch ${m.pNotch} ms`);
        case 'bae': return yes(m.pAmp && m.pAmp.II >= 0.25 && m.pdur >= 120 && m.pNotch >= 40, `P ${m.pAmp && m.pAmp.II} mV, ${m.pdur} ms, notch ${m.pNotch}`);
        case 'lafb': return yes(m.axis <= -45 && m.axis >= -90 && L.aVL.q.dur > 0 && L.aVL.R > L.aVL.S && ['II', 'III', 'aVF'].every((n) => L[n].S > L[n].R), `axis ${m.axis}°`);
        case 'lpfb': return yes(m.axis > 90 && m.axis <= 180 && L.I.S > L.I.R && L.III.q.dur > 0 && L.III.R > L.III.S, `axis ${m.axis}°`);
        case 'lbbb': return yes(m.qrs >= 120 && (latR('V6') || latR('I')) && Math.max(L.V6.rpt, L.I.rpt) > 60 && (L.V1.qs || L.V1.R < L.V1.neg), `QRS ${m.qrs} ms`);
        case 'rbbb': return yes(m.qrs >= 120 && ((L.V1.rPrime > 0 && L.V1.rPrime > L.V1.rFirst) || (L.V2.rPrime > 0 && L.V2.rPrime > L.V2.rFirst) || (L.V1.R > L.V1.S && L.V1.rpt > 50)) && (L.I.sWide >= 40 || L.V6.sWide >= 40 || L.I.S > L.I.R || L.V6.S > L.V6.R), `QRS ${m.qrs} ms`);
        case 'wpw': return yes(m.pr !== null && m.pr < 120 && m.qrs >= 110 && m.upstroke >= 50, `PR ${m.pr}, QRS ${m.qrs}, upstroke ${m.upstroke}`);
        case 'lvh': { const sok = L.V1.S + Math.max(L.V5.R, L.V6.R); return yes(sok >= 3.5, `Sokolow ${sok.toFixed(2)}`); }   // (Sokolow-Lyon only, as the reader)
        case 'rvh': return yes((m.axis > 90 || m.axis < -90) && (L.V1.R > L.V1.S || L.V1.R >= 0.7), `axis ${m.axis}°, R V1 ${L.V1.R}`);
        case 'nsstt': {
          // flat T (within ±0.5 mm) in two contiguous leads where T is normally upright, and neither the
          // ischemic T-inversion nor the ST-depression rule met (else it is not non-specific)
          const UP = ['I', 'II', 'aVF', 'V3', 'V4', 'V5', 'V6'], nb = { I: [], II: ['aVF'], aVF: ['II'], V3: ['V4'], V4: ['V3', 'V5'], V5: ['V4', 'V6'], V6: ['V5'] };
          const flat = UP.filter((n) => Math.abs(L[n].T) <= 0.05), fc = flat.filter((n) => nb[n].some((x) => flat.includes(x)));   // (flat: within ±0.5 mm)
          const twi = twiLeads(L), std = stdLeads(L);
          return yes(fc.length >= 2 && !twi.length && !std.length, `flat T in ${fc.join(' ') || 'none'}${twi.length ? `, T inversion in ${twi.join(' ')}` : ''}${std.length ? `, ST depression in ${std.join(' ')}` : ''}`, fc);
        }
        case 'narrow': {
          // subendocardial ischemia: horizontal or downsloping ST depression ≥ 1 mm (stdLeads), no ST-elevation
          // criteria met
          const std = stdLeads(L);
          return yes(std.length >= 2 && !steLeads(L).length, `ST depression (J+80) in ${std.map((n) => `${n} ${(L[n].st80 * 10).toFixed(1)}`).join(', ') || 'none ≥ 1 mm horizontal'}${steLeads(L).length ? `, ST elevation in ${steLeads(L).join(' ')}` : ''}`, std);
        }
        case 'hyper': {
          // textbook: T ≥ 5 mm in a limb lead or ≥ 10 mm in a chest lead, in two contiguous leads of the
          // territory, with no ST elevation criteria met (the rise over the same heart's T, ≥ 1.4×, is checked on the twin)
          const ex = MI_SITES[a.site].ste, terrLeads = ex.req.flatMap((t) => RL[t]);
          const tall = contiguous(LEADS.filter((n) => terrLeads.includes(n) && L[n].T >= (n.startsWith('V') ? 1.0 : 0.5)));
          return yes(tall.length >= 2 && !steLeads(L).length, `T ${tall.map((n) => `${n} ${(L[n].T * 10).toFixed(0)} mm`).join(', ') || 'not tall'}${steLeads(L).length ? ', ST elevation already' : ''}`, tall);
        }
        case 'multinarrow': {
          // diffuse: ST depression in at least four leads over two or more territories, ST up ≥ 1 mm in aVR, no ST elevation elsewhere
          const std = stdLeads(L);
          return yes(std.length >= 4 && terrOf(std).length >= 2 && L.aVR.stJ >= 0.1 && !steLeads(L).length, `ST depression in ${std.join(' ') || 'none'}, aVR ${(L.aVR.stJ * 10).toFixed(1)} mm`, std);
        }
        case 'recent': {
          const q = qLeads(L), terr = terrOf(q), ex = MI_SITES[a.site].q, twi = twiLeads(L);
          return yes(ex.req.some((t) => terr.includes(t)) && twi.length >= 2, `Q waves in ${q.join(' ') || 'none'}, T inversion in ${twi.join(' ') || 'none'}`, q, twi);
        }
        case 'stemi': case 'evolving': case 'oldmi': {
          const leads = k !== 'oldmi' ? steLeads(L) : qLeads(L), terr = terrOf(leads), ex = MI_SITES[a.site][k !== 'oldmi' ? 'ste' : 'q'];
          return yes(ex.req.some((t) => terr.includes(t)), `${k !== 'oldmi' ? 'ST elevation' : 'Q waves'} in ${leads.join(' ') || 'none'}`, leads);
        }
        case 'peri': {
          const ste = steLeads(L), std = contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].stJ <= -0.05)).filter((n) => n !== 'V1');
          const diffuse = ste.length >= 4 && terrOf(ste).length >= 2 && L.aVR.stJ <= -0.05 && !std.length;
          if (a.noP) {
            // (AF: no PR segment; the ST must be concave upward: at J+40 below the chord from J to J+80)
            const conc = ste.filter((n) => L[n].st40 < (L[n].stJ + L[n].st80) / 2 - 0.005);
            return yes(diffuse && conc.length >= Math.ceil(ste.length / 2), `ST up in ${ste.join(' ')}, concave in ${conc.join(' ')}, aVR ${L.aVR.stJ}`, ste);
          }
          return yes(diffuse && m.prSeg && (m.prSeg.II <= -0.08 || m.prSeg.aVR >= 0.08), `ST up in ${ste.join(' ')}, aVR ${L.aVR.stJ}`, ste);
        }
        // electrolytes (Round 51): the change itself is checked on the twin (visible); here the textbook measure
        case 'hyperK': case 'hyperK2': { const tall = ['V2', 'V3', 'V4', 'II'].filter((n) => L[n].T >= (n === 'II' ? 0.7 : 0.9)); return yes(tall.length, `T ${tall.map((n) => `${n} ${(L[n].T * 10).toFixed(0)} mm`).join(', ') || 'not tall'}${k === 'hyperK2' ? `, QRS ${m.qrs} ms` : ''}`, tall); }
        case 'wellensB': { const inv = ['V2', 'V3', 'V4'].filter((n) => L[n].T <= -0.15); return yes(inv.length >= 2 && !qLeads(L).length && !steLeads(L).length, `T ${['V2', 'V3', 'V4'].map((n) => `${n} ${(L[n].T * 10).toFixed(1)}`).join(', ')} mm${qLeads(L).length ? ', Q waves' : ''}`, inv); }
        case 'wellensA': { const bi = ['V2', 'V3'].filter((n) => L[n].tTerm < -0.03); return yes(bi.length >= 1 && !qLeads(L).length && !steLeads(L).length, `terminal T ${['V2', 'V3'].map((n) => `${n} ${(L[n].tTerm * 10).toFixed(1)}`).join(', ')} mm`, ['V2', 'V3']); }
        case 'hypoK': return yes(true, 'U waves (engine: slow terminal repolarisation)', ['V2', 'V3']);
        case 'hypoCa': return yes(m.qtc !== null && m.qtc >= 460, `QTc ${m.qtc}`);
        case 'hyperCa': return yes(m.qtc !== null && m.qtc <= 370, `QTc ${m.qtc}`);
        case 'hypothermia': return yes(true, 'J (Osborn) waves (engine: epicardial notch)', ['II', 'V4', 'V5']);
        case 'brugada': { const b = ['V1', 'V2'].filter((n) => L[n].stJ >= 0.2 && L[n].stJ > L[n].st40 && L[n].st40 > L[n].st80 && L[n].tTerm < -0.03); return yes(b.length, `coved ST in ${b.join(' ') || 'neither V1 nor V2'}`, b); }
      }
      return yes(false, 'no criteria');
    }
    // Sgarbossa criteria, Smith-modified (Round 52): a STEMI in LBBB. Concordant ST elevation ≥ 1 mm (positive QRS),
    // concordant ST depression ≥ 1 mm in V1–V3 (negative QRS), or discordant ST elevation ≥ 1 mm and ≥ 25% of the S wave
    function sgarbossa(L) {
      const conc = LEADS.filter((n) => L[n].net > 0 && L[n].stJ >= 0.1), dep = ['V1', 'V2', 'V3'].filter((n) => L[n].net < 0 && L[n].stJ <= -0.1);
      const exc = LEADS.filter((n) => n !== 'aVR' && L[n].net < 0 && L[n].stJ >= 0.1 && L[n].stJ >= 0.25 * L[n].neg);
      const why = [conc.length ? `concordant ST elevation in ${conc.join(', ')}` : '', dep.length ? `concordant ST depression in ${dep.join(', ')}` : '', exc.length ? `discordant ST elevation ≥ 25% of the S in ${exc.join(', ')}` : ''].filter(Boolean).join('; ');
      return { ok: !!(conc.length || dep.length || exc.length), why: why || 'no Sgarbossa criterion', leads: [...new Set([...conc, ...dep, ...exc])] };
    }
    function twinDiff(med, twin, k) {
      const n = Math.min(med.rec.length - med.hint, twin.rec.length - twin.hint), pre = Math.min(med.hint, twin.hint), per = {};
      for (let j = 0; j < 12; j++) { let mx = 0; for (let i = -pre; i < n; i++) mx = Math.max(mx, Math.abs(med.rec[med.hint + i][j] - twin.rec[twin.hint + i][j])); per[LEADS[j]] = mx; }
      const max = Math.max(...Object.values(per)), thr = ['rae', 'lae', 'bae'].includes(k) ? 0.05 : 0.1;
      const top = LEADS.filter((l) => per[l] >= 0.6 * max).sort((x, y) => per[y] - per[x]).slice(0, 4);
      return { ok: max >= thr, max: +max.toFixed(2), top, per };
    }

    // the rhythm's teaching line (AF: the ventricular rate class; fixed flutter: the conduction ratio)
    function rhythmLine(rec, rhythm, rate, flutter21) {
      if (rec.rhythm === 'avb2to1') return RHYTHM_LINE.avb2to1;
      if (flutter21) return RHYTHM_LINE.flutter21;
      if (rec.rhythm === 'flutterVar') return RHYTHM_LINE.flutterVar;
      if (rec.rhythm === 'flutter' && rate) return `Sawtooth flutter waves at about 300/min, every ${['', '', 'second', 'third', 'fourth', 'fifth', 'sixth'][Math.max(2, Math.min(6, Math.round(290 / rate)))]} one conducted: atrial flutter with ${Math.max(2, Math.min(6, Math.round(290 / rate)))}:1 block.`;
      if (rhythm === 'af' && rate) return rate < 60 ? 'Irregularly irregular, no P waves, ventricular rate under 60: atrial fibrillation with a slow ventricular response.' : rate > 100 ? 'Irregularly irregular, no P waves, ventricular rate over 100: atrial fibrillation with a rapid ventricular response (AF with RVR).' : 'Irregularly irregular, no P waves, ventricular rate 60–100: atrial fibrillation with a controlled ventricular response.';
      return RHYTHM_LINE[rhythm];
    }

    // ---------------------------------------------------------------- one item
    const b64 = (i16) => { let s = ''; const u = new Uint8Array(i16.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); };
    function linkOf(rec) {
      const q = [], R = RHYTHMS[rec.rhythm], blocks = [], struct = [];
      q.push(`r=${R.rate ? rec.rate : 72}`);
      if (R.link) q.push(R.link);
      if (R.block) blocks.push(`${R.block[0]}.${R.block[1]}`);
      if (R.block2) blocks.push(`${R.block2[0]}.${R.block2[1]}`);
      if (R.struct) struct.push(R.struct);
      if (R.linkBlock) blocks.push(R.linkBlock);
      for (const a of rec.abn) if (ABN[a.k].linkBlock) blocks.push(ABN[a.k].linkBlock);
      if (R.vLink) q.push(`v=${rec.rate}`);
      if (rec.fv) q.push(`fv=${rec.fv.join('-')}`);
      if (rec.sa) q.push(`sar=${rec.sa[0]}-${rec.sa[1]}`);
      let isch = null;
      for (const a of rec.abn) { const d = ABN[a.k]; if (d.block) blocks.push(`${d.block[0]}.${d.block[1]}`); if (d.struct) struct.push(d.struct); if (d.link) q.push(d.link); if (d.isch) isch = a; }
      if (blocks.length) q.push(`b=${blocks.join(',')}`);
      if (struct.length) q.push(`s=${struct.join(',')}`);
      if (isch) { const M = model(rec.abn.some((a) => ABN[a.k].hyp) ? ABN[rec.abn.find((a) => ABN[a.k].hyp).k].hyp : null); q.push(`${ABN[isch.k].stenosis ? 'n' : 'o'}=${(isch.sites || [isch.site]).map((x) => MI_SITES[x].f(M.coronary.branches)).join(',')}&c=2&h=${isch.h || ABN[isch.k].isch}${isch.sev && isch.sev !== 1 ? `&ns=${isch.sev}` : ''}`); }
      return q.join('&');
    }
    function build(rec, opts = {}) {
      const fail = (why, stage) => ({ ok: false, why, stage });
      const sim = simulate(rec);
      if (!sim) return fail('not induced', 'rhythm');
      const { M, rec12, A, V } = sim, R = RHYTHMS[rec.rhythm];
      if (V.length < 4 && !R.vf) return fail('too few beats', 'rhythm');
      const rrs = V.slice(1).map((v, i) => v.on - V[i].on), rate = R.vf ? null : Math.round(60000 * rrs.length / rrs.reduce((x, y) => x + y, 0));
      // rhythm: from the engine; P waves must be visible where the rhythm is read from them
      let rhythm = rec.rhythm;
      // (with SA exit block or a pause, the rate class comes from the sinus cycle, not the average with the pauses)
      const sinusRate = rec.abn.some((x) => ABN[x.k].sinusNode || ABN[x.k].pause) ? Math.round(60000 / rrs.slice().sort((x, y) => x - y)[Math.floor(rrs.length * 0.25)]) : rate;
      if (SINUS.includes(rhythm)) rhythm = sinusRate < 60 ? 'sinusBrady' : sinusRate > 100 ? 'sinusTachy' : 'sinus';
      const pv = pVisibility(sim);
      const tachyHideP = rhythm === 'sinusTachy' && rec.abn.some((a) => ['avb1', 'wpw', 'lbbb', 'rbbb'].includes(a.k));
      if ((R.pRhythm || R.pVisible) && pv.share > (tachyHideP ? 0.5 : 0.2)) return fail(`P hidden in ${pv.hidden}/${pv.n} beats`, 'rhythm');
      if (R.noP) {
        // (sinus arrest: no atrial activation may precede a QRS by the time of a PR; retrograde P after it is expected)
        const pre = A.filter((a) => V.some((v) => v.on - a.on > 60 && v.on - a.on < 300)).length;
        if (pre) return fail(`${pre} P waves before a QRS in sinus arrest`, 'rhythm');
        const lim = rec.rhythm === 'junctional' ? [40, 60] : [20, 40];
        if (rate < lim[0] || rate > lim[1]) return fail(`escape rate ${rate}`, 'rhythm');
      }
      if (R.block && !R.noP && pv.share > (rec.rhythm === 'chb' ? 0.65 : 0.5)) return fail(`P hidden in ${pv.hidden}/${pv.n} beats`, 'rhythm');
      const rr = readRhythm(rec12);   // (blind rhythm read: kept for the record and the audit, not the gate, except where the rhythm asks)
      if (R.gateRead && !R.read(rr.rhythm)) return fail(`rhythm read as "${rr.rhythm}"`, 'rhythm');
      let rhythmAlt = tachyHideP ? ['sinus', 'svt'] : null, rhythmSame = null;
      if (rec.rhythm === 'sinusArr') {
        const span = Math.max(...rrs) - Math.min(...rrs);
        if (span < 120) return fail(`sinus arrhythmia too slight (RR span ${Math.round(span)} ms)`, 'rhythm');
        // (the author: sinus arrhythmia is a normal variant, not required; the sinus rhythm of its rate is fully right, the
        // other sinus names partly)
        const own = rate < 60 ? 'sinusBrady' : rate > 100 ? 'sinusTachy' : 'sinus';
        rhythmSame = [own]; rhythmAlt = SINUS.filter((x) => x !== own);
      }
      if (rec.rhythm === 'flutterVar') {
        const mean = rrs.reduce((x, y) => x + y, 0) / rrs.length, sd = Math.sqrt(rrs.reduce((x, y) => x + (y - mean) ** 2, 0) / rrs.length);
        if (sd / mean < 0.15) return fail(`flutter response not irregular (RR CV ${(sd / mean).toFixed(2)})`, 'rhythm');
      }
      if (R.key) rhythm = R.key;
      if (R.foci) {
        // WAP/MAT from the engine: at least three different atrial foci fired in the strip
        const n = new Set(sim.foci.map((x) => x.cell)).size;
        if (n < 3) return fail(`only ${n} atrial foci fired`, 'rhythm');
        rhythm = rate < 100 ? 'wap' : 'mat';
        // (the author: WAP for MAT and MAT for WAP earn partial credit, as sinus rhythm does for sinus bradycardia; near
        // 100/min either is right)
        if (rate >= 95 && rate <= 105) rhythmSame = [rhythm === 'wap' ? 'mat' : 'wap'];
        else rhythmAlt = [rhythm === 'wap' ? 'mat' : 'wap'];
      }
      // morphology on the median beat
      const med = R.tachy ? null : medianBeat(sim);
      if (!R.tachy && !med) return fail('too few beats for a median beat', 'rhythm');
      const r = med ? read(med.rec, med.hint, med.rr, { minOff: med.qrsEnd }) : null, b = r ? r.interpret() : { dx: [], f: {} };
      const findings = [], optional = new Set(), hl = new Set(), lines = {}, checks = [], hlBy = {}, neutral = new Set();
      let recentSte = false;   // (a recent infarct whose ST elevation still meets the STEMI criteria)
      if (rhythm === 'sinusTachy' && !rec.abn.some((a) => a.k === 'avb1')) neutral.add('avb1');   // (the author: the P on the T looked like a long PR)
      if (rec.abn.some((a) => a.k === 'rbbb') && !rec.abn.some((a) => a.k === 'lafb' || a.k === 'lpfb')) { neutral.add('lafb'); neutral.add('bifascicular'); }   // (RBBB's own left axis in this model)
      const mark = (id, leads) => { for (const l of leads) { hl.add(l); (hlBy[id] = hlBy[id] || []).includes(l) || hlBy[id].push(l); } };   // (each finding's own leads: the result chips show them)
      // (the cheap checks first, so a scenario that fails them costs no twin runs: the blind read, then every
      // abnormality's criteria; the twins run only once all of these pass)
      // blind read of the median beat: a finding we did not put in must not show (it would be marked
      // "not present" for a student who names it); true consequences become optional
      (R.optional || []).forEach((x) => optional.add(x));   // (naming the sinus arrest behind an escape rhythm is true)
      for (const a of rec.abn) (ABN[a.k].optional || []).forEach((x) => optional.add(x));   // (true consequences named by the abnormality itself)
      if (r && !R.vt && !R.wide) {   // (a ventricular escape beat is wide and abnormal by nature: its shape is not a finding)
        const ks = rec.abn.map((a) => a.k), words = rec.abn.flatMap((a) => (a.k === 'recent' ? ['old MI', 'T inversion'] : a.k === 'evolving' ? ['STEMI', 'old MI', 'T inversion'] : ABN[a.k].isch ? [ABN[a.k].isch < 24 ? 'STEMI' : 'old MI'] : [ABN[a.k].dx]));
        const rca = rec.abn.some((a) => /RCA/.test(a.site || ''));
        for (const dx of b.dx) {
          if (words.some((w) => dx === w || dx.startsWith(w + ' '))) continue;
          if (!R.pRhythm && ['RAE', 'LAE', 'biatrial enlargement', '1st-degree AVB'].includes(dx)) { if (dx === '1st-degree AVB' && rec.rhythm === 'mobitz1') optional.add('avb1'); continue; }
          if (dx === 'long QT' && ['af', 'flutter', 'flutterVar', 'mat'].includes(rec.rhythm)) continue;
          if (/^flutter/.test(rec.rhythm) && /^(STEMI|old MI|T inversion)/.test(dx)) continue;   // (flutter waves on the ST-T; at 2:1 they deform the T too)
          if (ks.includes('peri') && /^STEMI/.test(dx)) continue;   // (AF pericarditis: without a PR segment the reader cannot tell it from STEMI)   // (flutter waves on the ST segment; flutter carries no ischemia)
          if (dx === 'long QT' && (R.block || R.at || rec.abn.some((x) => ABN[x.k].ectopy || ABN[x.k].pause || ABN[x.k].sinusNode))) continue;   // (QT after a pause is longer: QTc is not read across pauses)
          if (dx === 'poor R progression') { optional.add('poorR'); continue; }
          // (electrolytes, Round 51: severe hyperkalemia widens the QRS everywhere, which the reader's block rules take for a
          // bundle branch block; hypothermia's J (Osborn) waves raise the J point in many leads, read as ST elevation)
          if (ks.includes('hyperK2') && ['LBBB', 'RBBB', 'IVCD', 'LAFB', 'LPFB'].includes(dx)) { optional.add('ivcd'); continue; }
          if (ks.includes('hypothermia') && /^STEMI/.test(dx)) continue;
          // (sinus tachycardia: the P rides on the previous T, which makes it look tall (RAE) and, with the P hidden, the PR long)
          if (rhythm === 'sinusTachy' && (dx === 'RAE' || (dx === '1st-degree AVB' && !ks.includes('avb1')))) continue;
          if (dx.startsWith('old MI') && ks.includes('wpw')) { optional.add('qwaves'); continue; }   // (WPW pseudo-infarct: negative delta waves look like Q waves)
          if (dx.startsWith('STEMI') && ks.includes('lbbb') && !rec.abn.some((x) => ABN[x.k].isch)) continue;   // (LBBB: discordant ST elevation in V1–V3 is expected)
          if (dx === 'LVH' && ks.includes('lafb')) { optional.add('lvh'); continue; }
          if (dx === 'T inversion' && ks.length) { optional.add('twi'); continue; }
          if (dx === 'long QT' && ks.length) { optional.add('longqt'); continue; }
          if (dx.startsWith('old MI') && ks.includes('lafb') && !ks.includes('oldmi') && !ks.includes('recent')) { optional.add('qwaves'); continue; }   // (LAFB pseudo-infarct)
          if (dx === '1st-degree AVB' && rca) { optional.add('avb1'); continue; }
          if (dx.startsWith('STEMI') && ks.includes('recent')) { optional.add('ste'); recentSte = true; continue; }   // (residual ST elevation at 2 days)
          if (dx.startsWith('old MI') && ks.includes('stemi')) { optional.add('qwaves'); continue; }   // (Q waves form within hours of a STEMI)
          // (an infarct moves the axis and the R waves: lateral and posterior loss gives right axis and a tall R
          // in V1, inferior loss a tall R in aVL; the reader's RVH/LVH voltage rules have no infarct exception, so
          // these reads are not findings of the ECG. Clinically: "tall R in V1: posterior MI or RVH?")
          if (dx === 'RVH' && !ks.includes('rvh') && rec.abn.some((a) => ABN[a.k].isch && ABN[a.k].isch >= 24)) { optional.add('dominantRV1'); optional.add('posteriorMI'); continue; }
          if (dx === 'LVH' && !ks.includes('lvh') && rec.abn.some((a) => ABN[a.k].isch && ABN[a.k].isch >= 24)) continue;
          if (dx.startsWith('STEMI posterior') && ks.includes('stemi')) { optional.add('posteriorMI'); continue; }
          if (dx === 'IVCD' && ks.some((k) => ['lvh', 'rvh', 'lpfb', 'lafb'].includes(k))) { optional.add('ivcd'); continue; }
          // (the blind read's chained rules: a block it called instead of an intended one is not "extra")
          if (['LBBB', 'RBBB', 'IVCD', 'LAFB', 'LPFB'].includes(dx) && ks.some((k) => ['lbbb', 'rbbb', 'lafb', 'lpfb', 'wpw'].includes(k))) continue;
          return fail(`unexpected "${dx}" in the blind read`, 'extra');
        }
        if (b.f.axis === 'LAD') optional.add('lad');
        if (b.f.axis === 'RAD') optional.add('rad');
        if (r.m.axis !== null && (r.m.axis < -90 || r.m.axis > 180)) optional.add('ead');   // (extreme axis, −90° to ±180°: Round 66)
        if (ks.includes('lvh')) optional.add('lvhStrain');
        if (ks.includes('lvh') || ks.includes('rvh')) optional.add('twi');   // (the strain pattern: lateral or right-precordial T inversion)
        if (ks.includes('rbbb') && ks.includes('lafb')) optional.add('bifascicular');
      }
      const crits = new Map();
      // (sinus tachycardia with a block or pre-excitation: the P sits on the previous T and the reader's PR is unreliable;
      // the PR is taken from the engine, for the criteria and for the PR shown with the ECG and on its caliper)
      let enginePR = null;
      if (tachyHideP) {
        const prs = V.map((v) => { const p = A.filter((x) => x.on < v.on - 30 && x.on > v.on - 400).pop(); return p ? v.on - p.on : null; }).filter((x) => x !== null).sort((x, y) => x - y);
        if (prs.length) enginePR = Math.round(prs[prs.length >> 1]);
      }
      const shownPR = enginePR !== null ? enginePR : r && r.m.pr;
      for (const a of rec.abn) {
        const d = ABN[a.k]; if (d.sinusNode || d.pause || d.ectopy) continue;
        let mm = r.m;
        if (enginePR !== null && (a.k === 'avb1' || a.k === 'wpw')) mm = { ...r.m, pr: enginePR };
        const c = a.k === 'stemi' && rec.abn.some((x) => x.k === 'lbbb') ? sgarbossa(r.L) : criteria(a.k, R.pRhythm ? a : { ...a, noP: true }, mm, r.L);
        if (!c.ok) return fail(`${a.k}${a.site ? ' ' + a.site : ''} criteria not met (${c.why})`, 'criteria');
        crits.set(a, c);
      }
      for (const a of rec.abn) {
        const d = ABN[a.k];
        if (d.sinusNode) {
          // SA exit block (3:2): pauses of twice the sinus cycle, at least two of them
          const cyc = rrs.slice().sort((x, y) => x - y)[Math.floor(rrs.length * 0.25)], longs = rrs.filter((x) => x > 1.7 * cyc && x < 2.3 * cyc);
          checks.push(`SA exit block: ${longs.length} pauses of 2× the sinus cycle (${Math.round(cyc)} ms)`);
          if (longs.length < 2) return fail('SA exit block pauses not seen', 'criteria');
          findings.push({ id: d.id, skill: d.skill }); mark(d.id, ['II']); lines[d.id] = d.line;
          continue;
        }
        if (d.pause) {
          // from the sinus P waves (atrial activations a QRS follows 60–300 ms later), not the RR: a junctional escape
          // beat may fall inside the pause (rec.pauseEscape), and then it must; without it, none may
          const conducts = (x) => V.some((v) => v.on - x.on > 60 && v.on - x.on < 300);
          const sp = A.filter(conducts), pp = sp.slice(1).map((x, i) => x.on - sp[i].on), medPP = pp.slice().sort((x, y) => x - y)[pp.length >> 1], longest = Math.max(...pp);
          const esc = V.filter((v) => v.on > 350 && !A.some((x) => v.on - x.on > 60 && v.on - x.on < 300));   // (a QRS at the strip's start may have its P before it)
          checks.push(`pause: longest P–P ${Math.round(longest)} ms (${(longest / medPP).toFixed(1)}× the usual), ${esc.length} escape beat(s)`);
          if (!(longest >= 1.6 * medPP)) return fail(`sinus pause not seen (longest P–P ${Math.round(longest)} ms)`, 'criteria');
          if (!!rec.pauseEscape !== esc.length > 0) return fail(`${esc.length} escape beats in a pause ${rec.pauseEscape ? 'with' : 'without'} escape`, 'criteria');
          findings.push({ id: d.id, skill: d.skill }); mark(d.id, ['II']);
          lines[d.id] = esc.length ? 'A sudden pause with no P wave, not a multiple of the P–P interval, ended by a narrow junctional escape beat (no P before it), then sinus beats resume: sinus pause with junctional escape.' : d.line;
          if (esc.length) optional.add('escape');
          continue;
        }
        if (d.ectopy) {
          // ectopy, from the engine's timing: every planned ectopic beat fired; PVCs wide (≥ 110 ms) and premature,
          // PACs conducted to a narrow QRS
          const ect = ectopicBeats(sim), med = rrs.slice().sort((x, y) => x - y)[rrs.length >> 1];
          const pvcs = (sim.stims || []).filter((x) => x.kind === 'pvc'), pacs = (sim.stims || []).filter((x) => x.kind === 'pac');
          const wide = [...ect].filter((v) => v.last - v.on >= 110), early = [...ect].filter((v) => { const i = V.indexOf(v); return i > 0 && v.on - V[i - 1].on < 0.85 * med; });
          const atrial = ['pac', 'acouplet', 'abig', 'atrig', 'arun'].includes(d.ectopy);
          let want = 2, ok = atrial ? pacs.length === 2 && ect.size === 2 && wide.length === 0 && early.length === 2 : pvcs.length === 2 && wide.length === 2 && early.length >= (d.ectopy === 'couplet' ? 2 : 1);
          if (['vbig', 'vtrig', 'abig', 'atrig'].includes(d.ectopy)) {
            // the pattern: every planned ectopic beat showed (wide or narrow as it should), at least three of them, and they
            // make up about a half (bigeminy) or a third (trigeminy) of the beats in the stretch they cover
            const planned = atrial ? pacs.length : pvcs.length, share = ect.size / V.filter((v) => v.on >= Math.min(...[...ect].map((x) => x.on)) - 1500).length;
            const big = d.ectopy.endsWith('big');
            want = planned;
            ok = planned >= 3 && ect.size === planned && (atrial ? wide.length === 0 : wide.length === planned) && Math.abs(share - (big ? 0.5 : 1 / 3)) < 0.12;
          } else if (d.ectopy === 'nsvt' || d.ectopy === 'arun') {
            const planned = atrial ? pacs.length : pvcs.length, ev = [...ect].sort((x, y) => x.on - y.on), fast = ev.slice(1).every((v, i) => v.on - ev[i].on < 600);
            want = planned;
            ok = planned >= 3 && ect.size === planned && fast && (atrial ? wide.length === 0 : wide.length === planned);
          }
          checks.push(`${a.k}: ${ect.size} ectopic beats (${wide.length} wide, ${early.length} premature)`);
          if (!ok) return fail(`${a.k}: ectopic beats did not show as planned (${ect.size} of ${want})`, 'criteria');
          findings.push({ id: d.id, skill: d.skill }); mark(d.id, ['II', 'V1']); lines[d.id] = d.line;
          if (d.ectopy === 'couplet') optional.add('pvc');
          if (d.ectopy === 'acouplet') optional.add('pac');
          for (const o of d.optional || []) optional.add(o);
          continue;
        }
        const c = crits.get(a);
        checks.push(`${a.k}: ${c.why}`);
        // twin: the same scenario without this abnormality
        const twinRec = { ...rec, abn: rec.abn.filter((x) => x !== a) }, tsim = simulate(twinRec, TWIN_STRIP), tmed = tsim && medianBeat(tsim);
        let tw = null;
        if (tmed) { tw = twinDiff(med, tmed, a.k); if (!tw.ok) return fail(`${a.k} barely changes the tracing (${tw.max} mV)`, 'twin'); }
        if (a.k === 'narrow') {
          // (ST depression does not localise the artery: the region asked is where the depression is deepest; any
          // other lead group that shows it is accepted too)
          const site = MI_SITES[a.site], terr = terrOf(c.leads), depth = (t) => Math.min(...RL[t].filter((n) => c.leads.includes(n)).map((n) => r.L[n].st80));
          const main = terr.slice().sort((x, y) => depth(x) - depth(y))[0];
          findings.push({ id: 'std', skill: d.skill, regions: [main], okRegions: [...new Set([...terr, ...site.ste.req, ...site.ste.ok, ...dipped(r.L)])].filter((t) => t !== main) });
          mark('std', c.leads); if (r.L.aVR.stJ >= 0.05) mark('std', ['aVR']);
          lines.std = `ST depression in ${c.leads.join(', ')}${r.L.aVR.stJ >= 0.05 ? ', ST up in aVR' : ''}: subendocardial ischemia (NSTEMI pattern). It does not localise the artery.`;
          ['reciprocal'].forEach((x) => optional.add(x)); if (twiLeads(r.L).length) optional.add('twi');
        } else if (a.k === 'multinarrow') {
          const terr = terrOf(c.leads), names = a.sites.map((x) => MI_SITES[x].name);
          findings.push({ id: 'std', skill: d.skill, regions: terr.slice(0, 1), okRegions: [...new Set([...terr.slice(1), ...dipped(r.L)])].filter((t) => t !== terr[0]) });
          optional.add('avrste');   // (the author: ST elevation in aVR is true here but not asked)
          mark('std', [...c.leads, 'aVR']);
          lines.std = `Widespread ST depression in ${c.leads.join(', ')}: diffuse subendocardial ischemia, not one territory.`;
          lines.std += ` With ST elevation in aVR (${(r.L.aVR.stJ * 10).toFixed(1)} mm): the left main or multivessel pattern (here ${names.join(', ')} narrowed). Urgent: it does not localise to one artery.`;
          ['reciprocal'].forEach((x) => optional.add(x)); if (twiLeads(r.L).length) optional.add('twi');
        } else if (a.k === 'nsstt') {
          findings.push({ id: 'nsstt', skill: d.skill });
          mark('nsstt', c.leads);
          lines.nsstt = `Flat T waves in ${c.leads.join(', ')}, no territory, no ST depression or Q waves: non-specific ST-T changes.`;
        } else if (a.k === 'hyper') {
          // (the T waves must be taller than this heart's own: at least 1.5× the twin's in those leads)
          let taller = [];   // (lead groups with a lead in a contiguous pair whose T grew ≥ 0.5 mm over this heart's own)
          if (tmed) { const tr = read(tmed.rec, tmed.hint, tmed.rr, { minOff: tmed.qrsEnd }).L, risen = c.leads.filter((n) => r.L[n].T >= 1.4 * Math.max(0.05, tr[n].T)); if (risen.length < 2) return fail(`hyper ${a.site}: T not taller than this heart's own (${c.leads.map((n) => `${n} ${r.L[n].T}/${tr[n].T}`).join(', ')})`, 'criteria'); c.leads = risen; taller = groupsOf(contiguous(LEADS.filter((n) => n !== 'aVR' && r.L[n].T - tr[n].T >= 0.05))); }
          const site = MI_SITES[a.site], ex = site.ste, terr = terrOf(c.leads), req = ex.req.filter((t) => terr.includes(t)).length ? ex.req.filter((t) => terr.includes(t)) : terr.slice(0, 1);
          findings.push({ id: 'hyperacute', skill: d.skill, regions: req, okRegions: [...new Set([...terr, ...ex.req, ...ex.ok, ...taller])].filter((t) => !req.includes(t)) });
          mark('hyperacute', c.leads);
          lines.hyperacute = `Tall, broad T waves in ${c.leads.join(', ')}, no ST elevation yet: hyperacute ${req.join('/')} ischemia. Repeat the ECG.`;
          ['twi', 'reciprocal'].forEach((x) => optional.add(x));
        } else if (a.k === 'recent') {
          const site = MI_SITES[a.site], ex = site.q, terr = terrOf(c.leads), tt = terrOf(c.leads2), ts = terrStrong(c.leads2);
          findings.push({ id: 'qwaves', skill: d.skill, regions: ex.req, okRegions: [...new Set([...ex.ok, ...terr, ...qGroups(r.L)])].filter((t) => !ex.req.includes(t)) });
          // (T inversion asked where it is: a territory of the site's that shows it in two of its leads, else the territory with the most)
          const most = (ts.length ? ts : tt).slice().sort((x, y) => RL[y].filter((n) => c.leads2.includes(n)).length - RL[x].filter((n) => c.leads2.includes(n)).length);
          const tReq = ts.filter((t) => ex.req.includes(t)).length ? ts.filter((t) => ex.req.includes(t)) : most.slice(0, 1);
          // (the author: where the ST is still up by the STEMI criteria, ST elevation is the more important reading: named
          // with the Q waves it counts for the T inversion)
          findings.push({ id: 'twi', skill: d.skill, regions: tReq, okRegions: [...new Set([...tt, ...ex.req, ...ex.ok, ...inverted(r.L), ...(recentSte ? raised(r.L) : [])])].filter((t) => !tReq.includes(t)), ...(recentSte ? { alts: ['ste'] } : {}) });
          mark('qwaves', c.leads); mark('twi', c.leads2);
          lines.qwaves = lines.twi = `Q waves in ${c.leads.join(', ')}, T inversion in ${c.leads2.join(', ')}: recent ${wallName(ex, terr)} infarct (days old).`;
          if (recentSte) { lines.qwaves += ' The ST is still raised, so ST elevation counts in place of the T inversion: treat it as a STEMI until shown otherwise.'; lines.twi = lines.qwaves; }
          ['ste', 'poorR', 'longqt'].forEach((x) => optional.add(x));
        } else if (a.k === 'stemi' && rec.abn.some((x) => x.k === 'lbbb')) {
          // (STEMI in LBBB: answered as ST elevation, a finding of its own beside the LBBB; seen through the Sgarbossa
          // criteria, so the region asked is the artery's and every territory the criteria flag is accepted)
          const site = MI_SITES[a.site], ex = site.ste, terr = terrOf(c.leads);
          findings.push({ id: 'ste', skill: d.skill, adv: ADV, regions: ex.req, okRegions: [...new Set([...ex.ok, ...terr, ...raised(r.L)])].filter((t) => !ex.req.includes(t)) });
          mark('ste', c.leads);
          lines.ste = `${c.why}: Sgarbossa criteria (modified) positive, an acute ${ex.req.join('/')} STEMI despite the LBBB.`;
          ['std', 'reciprocal', 'hyperacute', 'posteriorMI'].forEach((x) => optional.add(x));
        } else if (d.isch) {
          const site = MI_SITES[a.site], acute = d.isch < 24, ex = acute ? site.ste : site.q, terr = terrOf(c.leads);
          findings.push({ id: d.id, skill: d.skill, regions: ex.req, okRegions: [...new Set([...ex.ok, ...terr, ...(acute ? raised(r.L) : qGroups(r.L))])].filter((t) => !ex.req.includes(t)) });
          mark(d.id, c.leads);
          lines[d.id] = a.k === 'evolving' ? `ST elevation in ${c.leads.join(', ')}, past its peak, with Q waves forming${a.h >= 12 ? ' and T waves starting to invert' : ''}: an evolving ${ex.req.join('/')} STEMI, about ${a.h} hours old.`
            : acute ? `ST elevation in ${c.leads.join(', ')}: acute ${ex.req.join('/')} STEMI.` : `Q waves in ${c.leads.join(', ')}: old ${wallName(ex, terr)} infarct.`;
          // (Q waves can form within hours of a STEMI: named with the STEMI, they are true)
          if (acute) ['std', 'reciprocal', 'hyperacute', 'posteriorMI', 'twi', 'qwaves'].forEach((x) => optional.add(x));
        } else {
          findings.push(d.adv ? { id: d.id || a.k, skill: d.skill, adv: d.adv } : { id: d.id || a.k, skill: d.skill });
          // (the textbook leads, where the twin shows the change; else the leads that change most)
          const tl = tw ? d.leads.filter((l) => tw.per[l] >= 0.3 * tw.max) : d.leads;
          mark(d.id || a.k, c.leads || (tl.length ? tl : tw ? tw.top : d.leads));
          lines[d.id || a.k] = d.line;
        }
      }
      for (const x of findings) optional.delete(x.id);
      // what the median beat measurably shows beyond the key (ST depression, Q waves, T inversion by the same criteria)
      // is accepted as also true, with a line saying where (Round 61: testers named them and lost points). Not in LBBB,
      // where Q waves and ST-T cannot be read for themselves, nor in ventricular rhythms.
      if (r && !R.vt && !R.wide && !R.poly && !rec.abn.some((a) => a.k === 'lbbb')) {
        const have = new Set(findings.map((f) => f.id)), ks = rec.abn.map((a) => a.k), rightAxis = ks.includes('rvh') || ks.includes('lpfb') || (b.f && b.f.axis === 'RAD');
        const said = { std: (ls) => `ST depression in ${ls.join(', ')}${ks.includes('lvh') ? ', the strain pattern of LVH' : ''}: also true on this ECG.`,
          qwaves: (ls) => (rightAxis && ls.every((n) => ['II', 'III', 'aVF'].includes(n)) ? `Q waves in ${ls.join(', ')}: a qR pattern from the right axis, not an infarct; also true on this ECG.` : `Q waves in ${ls.join(', ')}: also true on this ECG.`),
          twi: (ls) => `T wave inversion in ${ls.join(', ')}: also true on this ECG.` };
        for (const [id, ls] of [['std', stdLeads(r.L)], ['qwaves', qLeads(r.L)], ['twi', twiLeads(r.L)]]) {
          if (ls.length < 2 || have.has(id)) continue;
          optional.add(id); if (!lines[id]) lines[id] = said[id](ls);
        }
      }
      if (!R.pRhythm && lines.pericarditis) lines.pericarditis = 'Diffuse concave ST elevation with ST depression in aVR (no PR segment to read): pericarditis.';
      // measurements: rate from the engine; intervals and axis from the median beat
      const sm = R.vf ? null : R.tachy ? sinusRead(M).m : r.m;
      const m = R.vf ? { rate: null, pr: null, qrs: null, qtc: null, axis: null } : { rate, pr: R.pRhythm ? shownPR : null, qrs: R.vt || R.poly ? null : sm.qrs, qtc: R.noP ? null : R.tachy || R.block || R.at || rec.abn.some((x) => ABN[x.k].pause || ABN[x.k].ectopy || ABN[x.k].sinusNode) || ['af', 'flutter', 'mat'].includes(rec.rhythm) || !r || r.m.qtc < 320 || r.m.qtc > 620 ? null : r.m.qtc, axis: R.vt || R.wide || R.poly ? null : sm.axis };
      // caliper on the interval that decides it (engine timing)
      const within = (lo, hi) => V.filter((v) => v.on > lo && v.on < hi);
      let caliper = null;
      const calK = rec.abn.map((a) => ABN[a.k].caliper).find(Boolean);
      if (R.tachy) { const [a, c] = within(1500, 4600); if (a && c) caliper = { lead: 'rhythm', t0: Math.round(a.on), t1: Math.round(c.on), label: `RR ${Math.round(c.on - a.on)} ms = ${Math.round(60000 / (c.on - a.on))}/min` }; }
      else if (calK === 'qrs') { const [a] = within(5200, 7200); if (a) caliper = { lead: 'V1', t0: Math.round(a.on), t1: Math.round(a.on + r.m.qrs), label: `QRS ${r.m.qrs} ms` }; }
      else if ((calK === 'pr' || rec.abn.some((a) => a.k === 'avb1')) && shownPR) { const [a] = within(1200, 4600); if (a) caliper = { lead: 'rhythm', t0: Math.round(a.on - shownPR), t1: Math.round(a.on), label: `PR ${shownPR} ms` }; }
      const nS = STRIP / (1000 / HZ), art = rec.art ? artifactLeads(rec.art, rec.seed, nS) : null;
      const leads = LEADS.map((_, k) => { const x = new Int16Array(nS); for (let i = 0; i < x.length; i++) x[i] = Math.max(-32000, Math.min(32000, Math.round((rec12[i * (1000 / HZ)][k] + (art ? art[k][i] : 0)) * 1000))); return b64(x); });
      // (2:1 AV block is answered as Mobitz II: no chip of its own (Round 66, the author))
      if (rhythm === 'avb2to1') rhythm = 'mobitz2';
      // (2:1 flutter, the author: SVT, atrial flutter and AVNRT are all correct; the narrow regular tachycardias accept each other)
      const flutter21 = rec.rhythm === 'flutter' && rate > 120;
      if (flutter21) rhythmAlt = ['svt', 'avnrt'];
      const key = { rhythm, alt: rhythmAlt || R.alt || (SINUS.includes(rhythm) && rhythm !== 'sinus' ? ['sinus'] : []), findings, optional: [...optional] };
      if (rhythmSame) key.same = rhythmSame;   // (named instead of the key's rhythm: full credit)
      if (neutral.size) key.neutral = [...neutral];   // (named: no credit, no penalty: it cannot be judged on this ECG)
      const skills = { rhythm: true }; for (const a of rec.abn) skills[ABN[a.k].skill] = true;
      const title = [rhythm, ...rec.abn.map((a) => (ABN[a.k].isch ? `${a.k} (${(a.sites || [a.site]).join(', ')})` : a.k))].join(' + ');
      // difficulty: rhythm and abnormalities, harder when some P waves are hidden
      const rating = itemRating(rec) + (pv.share > 0.2 ? 60 : 0);
      return {
        ok: true,
        item: { id: `${rec.rhythm}-${rec.seed}`, title, recipe: rec, hz: HZ, ms: STRIP, leads, m, read: { rhythm: rr.rhythm, dx: b.dx, checks, hiddenP: pv }, key, highlight: hl.size ? LEADS.filter((l) => hl.has(l)) : ['II'], hlBy, caliper,
          lines: { rhythm: rhythmLine(rec, rhythm, rate, flutter21), ...lines }, link: linkOf(rec), rating, skills: Object.keys(skills), n: rec.abn.length },
      };
    }
    // make: sample scenarios near the target until one passes the gate (or give up)
    function make({ target = 1400, focus = null, seed = Date.now(), tries = 10, log = null, adjust = {} } = {}) {
      const rand = LH.rng(seed >>> 0);
      for (let i = 0; i < tries; i++) {
        const rec = sample(rand, target, focus, 4, adjust);
        const res = build(rec);
        if (log) log(rec, res);
        if (res.ok) return res.item;
      }
      return null;
    }
    return { make, build, sample, simulate, model, itemRating, artifactLeads, ART_MAX, setEctMm: (x) => { ECT_MM = x; } };
  }
  TrainGen.RHYTHMS = RHYTHMS; TrainGen.ABN = ABN; TrainGen.SKILLS = SKILLS; TrainGen.itemRating = itemRating; TrainGen.sample = sample;
  if (typeof module !== 'undefined' && module.exports) module.exports = TrainGen; else root.TrainGen = TrainGen;
})(typeof self !== 'undefined' ? self : this);
