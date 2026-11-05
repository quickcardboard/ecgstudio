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
  const SETTLE = 4000, STRIP = 10000, HZ = 250;
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
    sinusTachy: { w: 2, rate: [106, 125], pRhythm: true, open: true, rating: 20, notWith: ['avb1', 'wpw', 'lbbb', 'rbbb', 'peri', 'bae'], read: (r) => /^sinus (rhythm|tachycardia)$/.test(r) },
    af: { w: 3, open: true, rating: 60, link: 'a=af', start: (S) => { S.run(2000); S.startArrhythmia('af'); }, read: (r) => r === 'atrial fibrillation' },
    flutter: { w: 2, open: true, rating: 150, link: 'a=flutter&v=75', start: (S) => { S.run(2000); S.startArrhythmia('flutter'); S.run(3000); S.setVentricularResponse(75); }, read: (r) => r === 'atrial flutter' },
    avnrt: { w: 2, tachy: true, rating: 180, link: 'a=avnrt', alt: ['svt'], induce: 'avnrt', read: (r) => r.startsWith('AVNRT') },
    avrt: { w: 2, tachy: true, rating: 220, link: 'a=avrt', alt: ['svt'], induce: 'avrt', read: (r) => r.startsWith('AVRT') },
    mobitz1: { w: 2, open: true, rating: 150, block: ['AVN', 'wenckebach'], read: (r) => /Mobitz I \(/.test(r) },
    mobitz2: { w: 2, open: true, rating: 180, block: ['HIS', 'mobitz2', { n: 4 }], read: (r) => /Mobitz II /.test(r) },
    avb2to1: { w: 1, open: true, rating: 200, block: ['AVN', 'two-to-one'], read: (r) => /2:1 AV block/.test(r) },
    chb: { w: 2, open: true, rating: 120, block: ['AVN', 'complete'], read: (r) => /complete AV block/.test(r) },
    vt: { w: 1, tachy: true, rating: 120, link: 'a=vt', vt: true, read: (r) => r === 'ventricular tachycardia' },
  };
  const RHYTHM_LINE = {
    sinus: 'Regular, a P before every QRS at a normal rate: sinus rhythm.',
    sinusBrady: 'A P before every QRS, rate under 60: sinus bradycardia.',
    sinusTachy: 'A P before every QRS, rate over 100: sinus tachycardia.',
    af: 'Irregularly irregular, no P waves: atrial fibrillation.',
    flutter: 'Sawtooth flutter waves at about 300/min, every fourth one conducted: atrial flutter.',
    avnrt: 'Regular narrow tachycardia under 200 with no visible P: AVNRT.',
    avrt: 'Regular narrow tachycardia above 200 with no visible P: AVRT, not AVNRT.',
    mobitz1: 'PR lengthens beat by beat until a P is not conducted: Mobitz I.',
    mobitz2: 'Constant PR, then a P suddenly not conducted: Mobitz II.',
    avb2to1: 'Every second P is not conducted: 2:1 AV block (Mobitz I or II cannot be told apart).',
    chb: 'P waves march through at their own rate, unrelated to a slow regular escape: complete AV block.',
    vt: 'Regular broad-complex tachycardia without related P waves: ventricular tachycardia.',
  };

  // ---------------------------------------------------------------- abnormalities
  // group: one per group; excl: groups it cannot be combined with (they hide each other);
  // needP: needs a 1:1 P-wave rhythm; dx: the reader's word for it
  const MI_SITES = {
    pLAD: { f: (b) => b.LAD[0], name: 'proximal LAD', ste: { req: ['anterior'], ok: ['septal', 'lateral'] }, q: { req: ['anterior'], ok: ['septal', 'lateral'] } },
    mLAD: { f: (b) => b.LAD[Math.round(b.LAD.length * 0.22)], name: 'mid LAD', ste: { req: ['anterior'], ok: ['septal', 'lateral'] }, q: { req: ['anterior'], ok: ['septal', 'lateral'] } },
    pRCA: { f: (b) => b.RCA[0], name: 'proximal RCA', ste: { req: ['inferior'], ok: ['septal'] }, q: { req: ['inferior'], ok: ['septal'] } },
    mRCA: { f: (b) => b.RCA[Math.round(b.RCA.length * 0.45)], name: 'mid RCA', ste: { req: ['inferior'], ok: ['lateral'] }, q: { req: ['inferior'], ok: ['lateral'] } },
    pLCx: { f: (b) => b.LCx[0], name: 'proximal circumflex', ste: { req: ['lateral'], ok: [] }, q: { req: ['lateral'], ok: [] } },
  };
  const ABN = {
    avb1: { group: 'av', skill: 'conduction', needP: true, rating: 0, dx: '1st-degree AVB', block: ['AVN', 'first'], leads: [], line: 'PR over 200 ms with every P conducted: first-degree AV block.' },
    rae: { group: 'atria', skill: 'conditions', needP: true, rating: 40, dx: 'RAE', atria: { ra: true }, struct: 'rae', leads: ['II', 'V1'], line: 'P taller than 2.5 mm in II: right atrial enlargement.' },
    lae: { group: 'atria', skill: 'conditions', needP: true, rating: 40, dx: 'LAE', atria: { la: true }, struct: 'lae', leads: ['II', 'V1'], line: 'Broad notched P (≥ 120 ms) in II: left atrial enlargement.' },
    bae: { group: 'atria', skill: 'conditions', needP: true, rating: 80, dx: 'biatrial enlargement', atria: { ra: true, la: true }, struct: 'rae,lae', leads: ['II', 'V1'], line: 'Tall and broad notched P: biatrial enlargement.' },
    lafb: { group: 'fasc', skill: 'conduction', rating: 40, dx: 'LAFB', block: ['LAF', 'complete'], leads: ['I', 'aVL', 'II', 'III', 'aVF'], line: 'Axis beyond −45° with qR in aVL and rS in II, III, aVF: left anterior fascicular block.' },
    lpfb: { group: 'fasc', skill: 'conduction', rating: 100, dx: 'LPFB', block: ['LPF', 'complete'], leads: ['I', 'aVL', 'III', 'aVF'], line: 'Right axis with rS in I and qR in III, no RVH: left posterior fascicular block.' },
    lbbb: { group: 'bbb', skill: 'conduction', rating: 0, dx: 'LBBB', block: ['LBB', 'complete'], excl: ['fasc', 'hyp', 'isch', 'wpw', 'brugada'], leads: ['I', 'V1', 'V6'], caliper: 'qrs', line: 'QRS ≥ 120 ms, broad notched R in I and V6, deep QS in V1: LBBB.' },
    rbbb: { group: 'bbb', skill: 'conduction', rating: 0, dx: 'RBBB', block: ['RBB', 'complete'], excl: ['hyp', 'wpw', 'brugada'], leads: ['V1', 'V2', 'I', 'V6'], caliper: 'qrs', line: 'QRS ≥ 120 ms, rsR′ in V1 and a broad S in I and V6: RBBB.' },
    wpw: { group: 'wpw', skill: 'conduction', needP: true, rating: 40, dx: 'WPW pattern', ap: true, struct: 'ap', excl: ['av', 'fasc', 'bbb', 'hyp', 'peri', 'brugada', 'atria'], leads: ['I', 'II', 'V4', 'V5'], caliper: 'pr', line: 'Short PR, slurred delta wave and broad QRS: WPW pattern.' },
    lvh: { group: 'hyp', skill: 'conditions', rating: 0, dx: 'LVH', hyp: 'lvh', struct: 'lvh', leads: ['V1', 'V5', 'V6', 'aVL'], line: 'S in V1 plus R in V5/V6 ≥ 35 mm: left ventricular hypertrophy.' },
    rvh: { group: 'hyp', skill: 'conditions', rating: 60, dx: 'RVH', hyp: 'rvh', struct: 'rvh', leads: ['V1', 'I'], line: 'Right axis with a dominant R in V1: right ventricular hypertrophy.' },
    stemi: { group: 'isch', skill: 'ischemia', rating: 0, isch: 1, excl: ['peri', 'brugada'], id: 'ste' },
    oldmi: { group: 'isch', skill: 'ischemia', rating: 20, isch: 720, excl: ['peri', 'brugada'], id: 'qwaves' },
    peri: { group: 'peri', skill: 'conditions', rating: 80, id: 'pericarditis', dx: 'pericarditis', peri: true, struct: 'peri', excl: ['isch', 'brugada'], leads: ['I', 'II', 'aVF', 'V5', 'V6', 'aVR'], line: 'Diffuse concave ST elevation with PR depression and ST depression in aVR: pericarditis.' },
    brugada: { group: 'brugada', skill: 'conditions', rating: 80, dx: 'Brugada type 1', brugada: true, struct: 'brugada', excl: ['isch', 'peri'], leads: ['V1', 'V2'], line: 'Coved ST elevation ≥ 2 mm in V1–V2 into a negative T: Brugada pattern.' },
  };
  const ABN_W = { avb1: 2, rae: 1, lae: 1, bae: 0.6, lafb: 2, lpfb: 1, lbbb: 2, rbbb: 2, wpw: 1, lvh: 2, rvh: 1, stemi: 3, oldmi: 3, peri: 1, brugada: 0.7 };
  const ITEM_BASE = 1200, PER_ABN = 180;

  // Combination rules (the author's clinical calls; see docs/DEVELOPMENT.md training-1):
  // - at most one QRS-changing condition, except RBBB with LAFB or LPFB (bifascicular block)
  // - LBBB: no ischemia, no pericarditis; RBBB: acute STEMI yes, old infarct and pericarditis no
  // - pericarditis only with the rhythm, atrial enlargement or first-degree block
  // - WPW: with ischemia, not with atrial enlargement (the P runs into the delta wave) or 1st-degree block
  // - fascicular block and infarct: LAFB not with an inferior infarct, LPFB not with an LAD or circumflex one
  //   (the infarct moves the axis: see siteOk)
  const QRS = ['lbbb', 'rbbb', 'lafb', 'lpfb', 'lvh', 'rvh', 'brugada', 'wpw'];
  const BIFASC = [['rbbb', 'lafb'], ['rbbb', 'lpfb']];
  function compatible(rh, list, k) {
    const a = ABN[k], R = RHYTHMS[rh], all = [...list, k], has = (x) => all.includes(x);
    if (!R.open) return false;
    if (a.needP && !R.pRhythm) return false;
    if (a.group === 'av' && R.block) return false;
    if ((R.notWith || []).includes(k)) return false;   // (at 106–125/min the P sits on the previous T: hidden or not read)
    for (const j of list) {
      const b = ABN[j];
      if (b.group === a.group) return false;
      if ((a.excl || []).includes(b.group) || (b.excl || []).includes(a.group)) return false;
    }
    const q = all.filter((x) => QRS.includes(x));
    if (q.length > 2 || (q.length === 2 && !BIFASC.some(([x, y]) => q.includes(x) && q.includes(y)))) return false;
    const isch = has('stemi') || has('oldmi');
    if (has('lbbb') && (isch || has('peri'))) return false;
    if (has('rbbb') && (has('oldmi') || has('peri'))) return false;
    if (has('peri') && all.some((x) => x !== 'peri' && !['rae', 'lae', 'bae', 'avb1'].includes(x))) return false;
    if (has('wpw') && all.some((x) => ['rae', 'lae', 'bae', 'avb1', 'peri'].includes(x))) return false;
    return true;
  }
  const siteOk = (site, list) => !(list.includes('lafb') && /RCA/.test(site)) && !(list.includes('lpfb') && /LAD|LCx/.test(site));
  function itemRating(rec) {
    return ITEM_BASE + RHYTHMS[rec.rhythm].rating + rec.abn.reduce((s, a) => s + PER_ABN + ABN[a.k].rating, 0);
  }
  function pickW(rand, entries) {
    const tot = entries.reduce((s, [, w]) => s + w, 0); let x = rand() * tot;
    for (const [k, w] of entries) { if ((x -= w) <= 0) return k; }
    return entries[entries.length - 1][0];
  }
  // a random scenario near the target rating, preferring one that exercises the focus skill
  function sample(rand, target = 1400, focus = null, nMax = 4) {
    let best = null, bestD = Infinity;
    for (let tries = 0; tries < 60; tries++) {
      const rhythm = pickW(rand, Object.entries(RHYTHMS).map(([k, r]) => [k, r.w]));
      const n = Math.floor(rand() * (nMax + 1)), list = [];
      for (let i = 0; i < n; i++) {
        const opts = Object.keys(ABN).filter((k) => !list.includes(k) && compatible(rhythm, list, k));
        if (!opts.length) break;
        list.push(pickW(rand, opts.map((k) => [k, ABN_W[k]])));
      }
      const abn = list.map((k) => {
        const a = { k };
        if (ABN[k].isch) { const sites = Object.keys(MI_SITES).filter((x) => siteOk(x, list)); a.site = sites[Math.floor(rand() * sites.length)]; }
        return a;
      });
      const r = RHYTHMS[rhythm];
      const rec = { rhythm, abn, seed: 1 + Math.floor(rand() * 1e6), rate: r.rate ? Math.round(r.rate[0] + rand() * (r.rate[1] - r.rate[0])) : 72 };
      const skills = new Set(['rhythm', ...abn.map((a) => ABN[a.k].skill)]);
      const d = Math.abs(itemRating(rec) - target) + (focus && focus !== 'rhythm' && !skills.has(focus) ? 150 : 0) + rand() * 60;
      if (d < bestD) { bestD = d; best = rec; }
    }
    return best;
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
      }
      if (atria.ra || atria.la) S.setAtrialEnlargement(atria);
      if (R.block) S.setBlock(R.block[0], R.block[1], R.block[2] || {});
      const isch = rec.abn.find((a) => ABN[a.k].isch);
      if (isch) { S.addOcclusion(MI_SITES[isch.site].f(M.coronary.branches)); S.setIschemiaTime(ABN[isch.k].isch); }
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
    function vtCell(A) { for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.epi[c] && A.zuvc[c] > 0.35 && A.zuvc[c] < 0.45 && A.phi[c] < -2.2) return c; return -1; }
    // the scenario run: 10 s of 12 leads, and the engine's own timing of every atrial and ventricular
    // activation in the strip (start and end; for the ventricles also the end of repolarisation)
    function simulate(rec) {
      const hypA = rec.abn.find((a) => ABN[a.k].hyp), M = model(hypA ? ABN[hypA.k].hyp : null), R = RHYTHMS[rec.rhythm];
      let S;
      if (R.induce) S = induce(M, rec);
      else { S = base(M, rec); if (R.start) R.start(S); if (R.vt) { S.run(2000); S.startArrhythmia('vt', { cell: vtCell(M.A) }); } }
      if (!S) return null;
      S.run(SETTLE);
      const rec12 = []; let t0 = null; const atr = new Set(), ven = new Set();
      S.onSample((t, v) => { if (t0 === null) t0 = t; rec12.push(Array.from(v)); });
      for (let t = 0; t < STRIP; t += 500) { S.run(500); S.log.atrial.forEach((x) => atr.add(x)); S.log.vent.forEach((x) => ven.add(x)); }   // (the logs keep 50 entries)
      const inStrip = (x) => x.on - t0 >= 0 && x.on - t0 < STRIP;
      const rel = (x) => ({ on: x.on - t0, last: x.last - t0, end: x.repEnd ? x.repEnd - t0 : null });
      return { S, M, rec12, t0, A: [...atr].filter(inStrip).sort((a, b) => a.on - b.on).map(rel), V: [...ven].filter(inStrip).sort((a, b) => a.on - b.on).map(rel) };
    }
    // a 3.6 s sinus beat of the same heart (measurements for the fast tachycardias, whose T runs into the next QRS)
    function sinusRead(M) {
      const S = new LH.Sim(M, { seed: 1 }); const r = []; S.onSample((t, v) => r.push(Array.from(v))); S.run(3600);
      const v = S.log.vent, vb = v[v.length - 2]; return read(r, Math.round(vb.on), v[v.length - 2].on - v[v.length - 3].on);
    }
    // the median beat (as clinical programs measure): every complete beat of the strip aligned at its
    // ventricular onset (engine timing), sample by sample the median of each lead
    function medianBeat(sim) {
      const { rec12, V } = sim, rrs = V.slice(1).map((v, i) => v.on - V[i].on), rr = rrs.length ? rrs.slice().sort((a, b) => a - b)[rrs.length >> 1] : 833;
      const pre = Math.round(Math.min(520, Math.max(250, rr - 250))), post = Math.round(Math.min(650, rr - 20));
      const ons = V.map((v) => Math.round(v.on)).filter((o) => o - pre >= 0 && o + post < rec12.length);
      if (ons.length < 3) return null;
      const out = [], col = new Float64Array(ons.length);
      for (let i = 0; i < pre + post; i++) {
        const row = new Array(12);
        for (let k = 0; k < 12; k++) { for (let j = 0; j < ons.length; j++) col[j] = rec12[ons[j] - pre + i][k]; const sorted = Array.from(col).sort((a, b) => a - b); row[k] = sorted[sorted.length >> 1]; }
        out.push(row);
      }
      return { rec: out, hint: pre, rr, n: ons.length };
    }

    // ---------------------------------------------------------------- what a student would see
    // 1. Rhythm (engine timing): the rate, and whether the P waves can be seen (not inside a QRS or T wave).
    function pVisibility(sim) {
      const { A, V } = sim, overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
      let hidden = 0, n = 0;
      for (const a of A) {
        if (a.on < 200 || a.on > STRIP - 300) continue;
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
    const terrOf = (leads) => [...new Set(Object.entries(GROUPS).filter(([, g]) => g.some((n) => leads.includes(n))).map(([t]) => territory(t)))];
    const steLeads = (L) => contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].stJ >= (n === 'V2' || n === 'V3' ? 0.2 : 0.1)));
    const qLeads = (L) => contiguous(LEADS.filter((n) => (n === 'V2' || n === 'V3' ? L[n].q.dur >= 20 || L[n].qs : ['I', 'II', 'aVL', 'aVF', 'V4', 'V5', 'V6'].includes(n) && ((L[n].q.dur >= 30 && L[n].q.amp <= -0.1) || L[n].qs))));
    // criteria (ACC/AHA 2009 conduction, Sokolow-Lyon/Cornell, 4th UDMI, the reader's P-wave and Brugada
    // rules; tools/reader.js has the sources) → { ok, why, leads }
    function criteria(k, a, m, L) {
      const yes = (ok, why, leads) => ({ ok: !!ok, why, leads });
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
        case 'lvh': { const sok = L.V1.S + Math.max(L.V5.R, L.V6.R), corn = L.aVL.R + L.V3.S; return yes(sok >= 3.5 || corn > 2.8 || L.aVL.R >= 1.1, `Sokolow ${sok.toFixed(2)}, Cornell ${corn.toFixed(2)}`); }
        case 'rvh': return yes((m.axis > 90 || m.axis < -90) && (L.V1.R > L.V1.S || L.V1.R >= 0.7), `axis ${m.axis}°, R V1 ${L.V1.R}`);
        case 'stemi': case 'oldmi': {
          const leads = k === 'stemi' ? steLeads(L) : qLeads(L), terr = terrOf(leads), ex = MI_SITES[a.site][k === 'stemi' ? 'ste' : 'q'];
          return yes(ex.req.some((t) => terr.includes(t)), `${k === 'stemi' ? 'ST elevation' : 'Q waves'} in ${leads.join(' ') || 'none'}`, leads);
        }
        case 'peri': {
          const ste = steLeads(L), std = contiguous(LEADS.filter((n) => n !== 'aVR' && L[n].stJ <= -0.05)).filter((n) => n !== 'V1');
          return yes(ste.length >= 4 && terrOf(ste).length >= 2 && L.aVR.stJ <= -0.05 && !std.length && m.prSeg && (m.prSeg.II <= -0.08 || m.prSeg.aVR >= 0.08), `ST up in ${ste.join(' ')}, aVR ${L.aVR.stJ}`, ste);
        }
        case 'brugada': { const b = ['V1', 'V2'].filter((n) => L[n].stJ >= 0.2 && L[n].stJ > L[n].st40 && L[n].st40 > L[n].st80 && L[n].tTerm < -0.03); return yes(b.length, `coved ST in ${b.join(' ') || 'neither V1 nor V2'}`, b); }
      }
      return yes(false, 'no criteria');
    }
    function twinDiff(med, twin, k) {
      const n = Math.min(med.rec.length - med.hint, twin.rec.length - twin.hint), pre = Math.min(med.hint, twin.hint), per = {};
      for (let j = 0; j < 12; j++) { let mx = 0; for (let i = -pre; i < n; i++) mx = Math.max(mx, Math.abs(med.rec[med.hint + i][j] - twin.rec[twin.hint + i][j])); per[LEADS[j]] = mx; }
      const max = Math.max(...Object.values(per)), thr = ['rae', 'lae', 'bae'].includes(k) ? 0.05 : 0.1;
      const top = LEADS.filter((l) => per[l] >= 0.6 * max).sort((x, y) => per[y] - per[x]).slice(0, 4);
      return { ok: max >= thr, max: +max.toFixed(2), top, per };
    }

    // ---------------------------------------------------------------- one item
    const b64 = (i16) => { let s = ''; const u = new Uint8Array(i16.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); };
    function linkOf(rec) {
      const q = [], R = RHYTHMS[rec.rhythm], blocks = [], struct = [];
      q.push(`r=${R.rate ? rec.rate : 72}`);
      if (R.link) q.push(R.link);
      if (R.block) blocks.push(`${R.block[0]}.${R.block[1]}`);
      let isch = null;
      for (const a of rec.abn) { const d = ABN[a.k]; if (d.block) blocks.push(`${d.block[0]}.${d.block[1]}`); if (d.struct) struct.push(d.struct); if (d.isch) isch = a; }
      if (blocks.length) q.push(`b=${blocks.join(',')}`);
      if (struct.length) q.push(`s=${struct.join(',')}`);
      if (isch) { const M = model(rec.abn.some((a) => ABN[a.k].hyp) ? ABN[rec.abn.find((a) => ABN[a.k].hyp).k].hyp : null); q.push(`o=${MI_SITES[isch.site].f(M.coronary.branches)}&c=2&h=${ABN[isch.k].isch}`); }
      return q.join('&');
    }
    function build(rec, opts = {}) {
      const fail = (why, stage) => ({ ok: false, why, stage });
      const sim = simulate(rec);
      if (!sim) return fail('not induced', 'rhythm');
      const { M, rec12, A, V } = sim, R = RHYTHMS[rec.rhythm];
      if (V.length < 4) return fail('too few beats', 'rhythm');
      const rrs = V.slice(1).map((v, i) => v.on - V[i].on), rate = Math.round(60000 * rrs.length / rrs.reduce((x, y) => x + y, 0));
      // rhythm: from the engine; P waves must be visible where the rhythm is read from them
      let rhythm = rec.rhythm;
      if (SINUS.includes(rhythm)) rhythm = rate < 60 ? 'sinusBrady' : rate > 100 ? 'sinusTachy' : 'sinus';
      const pv = pVisibility(sim);
      if (R.pRhythm && pv.share > 0.2) return fail(`P hidden in ${pv.hidden}/${pv.n} beats`, 'rhythm');
      if (R.block && pv.share > 0.5) return fail(`P hidden in ${pv.hidden}/${pv.n} beats`, 'rhythm');
      const rr = readRhythm(rec12);   // (blind rhythm read: kept for the record and the audit, not the gate)
      // morphology on the median beat
      const med = R.tachy ? null : medianBeat(sim);
      if (!R.tachy && !med) return fail('too few beats for a median beat', 'rhythm');
      const r = med ? read(med.rec, med.hint, med.rr) : null, b = r ? r.interpret() : { dx: [], f: {} };
      const findings = [], optional = new Set(), hl = new Set(), lines = {}, checks = [];
      for (const a of rec.abn) {
        const d = ABN[a.k], c = criteria(a.k, a, r.m, r.L);
        checks.push(`${a.k}: ${c.why}`);
        if (!c.ok) return fail(`${a.k}${a.site ? ' ' + a.site : ''} criteria not met (${c.why})`, 'criteria');
        // twin: the same scenario without this abnormality
        const twinRec = { ...rec, abn: rec.abn.filter((x) => x !== a) }, tsim = simulate(twinRec), tmed = tsim && medianBeat(tsim);
        let tw = null;
        if (tmed) { tw = twinDiff(med, tmed, a.k); if (!tw.ok) return fail(`${a.k} barely changes the tracing (${tw.max} mV)`, 'twin'); }
        if (d.isch) {
          const site = MI_SITES[a.site], acute = d.isch < 24, ex = acute ? site.ste : site.q, terr = terrOf(c.leads);
          findings.push({ id: d.id, skill: d.skill, regions: ex.req, okRegions: [...new Set([...ex.ok, ...terr])].filter((t) => !ex.req.includes(t)) });
          c.leads.forEach((l) => hl.add(l));
          lines[d.id] = acute ? `ST elevation in ${c.leads.join(', ')}: acute ${ex.req.join('/')} STEMI (${site.name} occlusion).` : `Q waves in ${c.leads.join(', ')}: old ${ex.req.join('/')} infarct.`;
          if (acute) ['std', 'reciprocal', 'hyperacute', 'posteriorMI', 'twi'].forEach((x) => optional.add(x));
        } else {
          findings.push({ id: d.id || a.k, skill: d.skill });
          // (the textbook leads, where the twin shows the change; else the leads that change most)
          const tl = tw ? d.leads.filter((l) => tw.per[l] >= 0.3 * tw.max) : d.leads;
          (c.leads || (tl.length ? tl : tw ? tw.top : d.leads)).forEach((l) => hl.add(l));
          lines[d.id || a.k] = d.line;
        }
      }
      // blind read of the median beat: a finding we did not put in must not show (it would be marked
      // "not present" for a student who names it); true consequences become optional
      if (r && !R.vt) {
        const ks = rec.abn.map((a) => a.k), words = rec.abn.map((a) => (ABN[a.k].isch ? (ABN[a.k].isch < 24 ? 'STEMI' : 'old MI') : ABN[a.k].dx));
        const rca = rec.abn.some((a) => /RCA/.test(a.site || ''));
        for (const dx of b.dx) {
          if (words.some((w) => dx === w || dx.startsWith(w + ' '))) continue;
          if (!R.pRhythm && ['RAE', 'LAE', 'biatrial enlargement', '1st-degree AVB'].includes(dx)) { if (dx === '1st-degree AVB' && rec.rhythm === 'mobitz1') optional.add('avb1'); continue; }
          if (dx === 'long QT' && ['af', 'flutter'].includes(rec.rhythm)) continue;
          if (dx === 'poor R progression') { optional.add('poorR'); continue; }
          if (dx === 'LVH' && ks.includes('lafb')) { optional.add('lvh'); continue; }
          if (dx === 'T inversion' && ks.length) { optional.add('twi'); continue; }
          if (dx === 'long QT' && ks.length) { optional.add('longqt'); continue; }
          if (dx.startsWith('old MI') && ks.includes('lafb') && !ks.includes('oldmi')) { optional.add('qwaves'); continue; }   // (LAFB pseudo-infarct)
          if (dx === '1st-degree AVB' && rca) { optional.add('avb1'); continue; }
          if (dx.startsWith('STEMI posterior') && ks.includes('stemi')) { optional.add('posteriorMI'); continue; }
          if (dx === 'IVCD' && ks.some((k) => ['lvh', 'rvh', 'lpfb', 'lafb'].includes(k))) { optional.add('ivcd'); continue; }
          // (the blind read's chained rules: a block it called instead of an intended one is not "extra")
          if (['LBBB', 'RBBB', 'IVCD', 'LAFB', 'LPFB'].includes(dx) && ks.some((k) => ['lbbb', 'rbbb', 'lafb', 'lpfb', 'wpw'].includes(k))) continue;
          return fail(`unexpected "${dx}" in the blind read`, 'extra');
        }
        if (b.f.axis === 'LAD') optional.add('lad');
        if (b.f.axis === 'RAD') optional.add('rad');
        if (ks.includes('lvh')) optional.add('lvhStrain');
        if (ks.includes('rbbb') && ks.includes('lafb')) optional.add('bifascicular');
      }
      for (const x of findings) optional.delete(x.id);
      // measurements: rate from the engine; intervals and axis from the median beat
      const sm = R.tachy ? sinusRead(M).m : r.m;
      const m = { rate, pr: R.pRhythm ? r.m.pr : null, qrs: R.vt ? null : sm.qrs, qtc: R.tachy || ['af', 'flutter'].includes(rec.rhythm) || !r || r.m.qtc < 320 || r.m.qtc > 620 ? null : r.m.qtc, axis: R.vt ? null : sm.axis };
      // caliper on the interval that decides it (engine timing)
      const within = (lo, hi) => V.filter((v) => v.on > lo && v.on < hi);
      let caliper = null;
      const calK = rec.abn.map((a) => ABN[a.k].caliper).find(Boolean);
      if (R.tachy) { const [a, c] = within(1500, 4600); if (a && c) caliper = { lead: 'rhythm', t0: Math.round(a.on), t1: Math.round(c.on), label: `RR ${Math.round(c.on - a.on)} ms = ${Math.round(60000 / (c.on - a.on))}/min` }; }
      else if (calK === 'qrs') { const [a] = within(5200, 7200); if (a) caliper = { lead: 'V1', t0: Math.round(a.on), t1: Math.round(a.on + r.m.qrs), label: `QRS ${r.m.qrs} ms` }; }
      else if ((calK === 'pr' || rec.abn.some((a) => a.k === 'avb1')) && r.m.pr) { const [a] = within(1200, 4600); if (a) caliper = { lead: 'rhythm', t0: Math.round(a.on - r.m.pr), t1: Math.round(a.on), label: `PR ${r.m.pr} ms` }; }
      const leads = LEADS.map((_, k) => { const x = new Int16Array(STRIP / (1000 / HZ)); for (let i = 0; i < x.length; i++) x[i] = Math.round(rec12[i * (1000 / HZ)][k] * 1000); return b64(x); });
      const key = { rhythm, alt: R.alt || (SINUS.includes(rhythm) && rhythm !== 'sinus' ? ['sinus'] : []), findings, optional: [...optional] };
      const skills = { rhythm: true }; for (const a of rec.abn) skills[ABN[a.k].skill] = true;
      const title = [rhythm, ...rec.abn.map((a) => (ABN[a.k].isch ? `${a.k} (${a.site})` : a.k))].join(' + ');
      // difficulty: rhythm and abnormalities, harder when some P waves are hidden
      const rating = itemRating(rec) + (pv.share > 0.2 ? 60 : 0);
      return {
        ok: true,
        item: { id: `${rec.rhythm}-${rec.seed}`, title, recipe: rec, hz: HZ, ms: STRIP, leads, m, read: { rhythm: rr.rhythm, dx: b.dx, checks, hiddenP: pv }, key, highlight: hl.size ? LEADS.filter((l) => hl.has(l)) : ['II'], caliper,
          lines: { rhythm: RHYTHM_LINE[rhythm], ...lines }, link: linkOf(rec), rating, skills: Object.keys(skills), n: rec.abn.length },
      };
    }
    // make: sample scenarios near the target until one passes the gate (or give up)
    function make({ target = 1400, focus = null, seed = Date.now(), tries = 10, log = null } = {}) {
      const rand = LH.rng(seed >>> 0);
      for (let i = 0; i < tries; i++) {
        const rec = sample(rand, target, focus);
        const res = build(rec);
        if (log) log(rec, res);
        if (res.ok) return res.item;
      }
      return null;
    }
    return { make, build, sample, model, itemRating };
  }
  TrainGen.RHYTHMS = RHYTHMS; TrainGen.ABN = ABN; TrainGen.SKILLS = SKILLS; TrainGen.itemRating = itemRating; TrainGen.sample = sample;
  if (typeof module !== 'undefined' && module.exports) module.exports = TrainGen; else root.TrainGen = TrainGen;
})(typeof self !== 'undefined' ? self : this);
