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
    sinusTachy: { w: 2, rate: [106, 125], pRhythm: true, open: true, rating: 20, read: (r) => /^sinus (rhythm|tachycardia)$/.test(r) },
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
    wpw: { group: 'wpw', skill: 'conduction', needP: true, rating: 40, dx: 'WPW pattern', ap: true, struct: 'ap', excl: ['av', 'fasc', 'bbb', 'hyp', 'isch', 'peri', 'brugada'], leads: ['I', 'II', 'V4', 'V5'], caliper: 'pr', line: 'Short PR, slurred delta wave and broad QRS: WPW pattern.' },
    lvh: { group: 'hyp', skill: 'conditions', rating: 0, dx: 'LVH', hyp: 'lvh', struct: 'lvh', leads: ['V1', 'V5', 'V6', 'aVL'], line: 'S in V1 plus R in V5/V6 ≥ 35 mm: left ventricular hypertrophy.' },
    rvh: { group: 'hyp', skill: 'conditions', rating: 60, dx: 'RVH', hyp: 'rvh', struct: 'rvh', leads: ['V1', 'I'], line: 'Right axis with a dominant R in V1: right ventricular hypertrophy.' },
    stemi: { group: 'isch', skill: 'ischemia', rating: 0, isch: 1, excl: ['peri', 'brugada'], id: 'ste' },
    oldmi: { group: 'isch', skill: 'ischemia', rating: 20, isch: 720, excl: ['peri', 'brugada'], id: 'qwaves' },
    peri: { group: 'peri', skill: 'conditions', rating: 80, dx: 'pericarditis', peri: true, struct: 'peri', excl: ['isch', 'brugada'], leads: ['I', 'II', 'aVF', 'V5', 'V6', 'aVR'], line: 'Diffuse concave ST elevation with PR depression and ST depression in aVR: pericarditis.' },
    brugada: { group: 'brugada', skill: 'conditions', rating: 80, dx: 'Brugada type 1', brugada: true, struct: 'brugada', excl: ['isch', 'peri'], leads: ['V1', 'V2'], line: 'Coved ST elevation ≥ 2 mm in V1–V2 into a negative T: Brugada pattern.' },
  };
  const ABN_W = { avb1: 2, rae: 1, lae: 1, bae: 0.6, lafb: 2, lpfb: 1, lbbb: 2, rbbb: 2, wpw: 1, lvh: 2, rvh: 1, stemi: 3, oldmi: 3, peri: 1, brugada: 0.7 };
  const ITEM_BASE = 1200, PER_ABN = 180;

  function compatible(rh, list, k) {
    const a = ABN[k], R = RHYTHMS[rh];
    if (!R.open) return false;
    if (a.needP && !R.pRhythm) return false;
    if (a.group === 'av' && R.block) return false;
    for (const j of list) {
      const b = ABN[j];
      if (b.group === a.group) return false;
      if ((a.excl || []).includes(b.group) || (b.excl || []).includes(a.group)) return false;
    }
    return true;
  }
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
        if (ABN[k].isch) { const sites = Object.keys(MI_SITES); a.site = sites[Math.floor(rand() * sites.length)]; }
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
    function simulate(rec) {
      const hypA = rec.abn.find((a) => ABN[a.k].hyp), M = model(hypA ? ABN[hypA.k].hyp : null), R = RHYTHMS[rec.rhythm];
      let S;
      if (R.induce) S = induce(M, rec);
      else { S = base(M, rec); if (R.start) R.start(S); if (R.vt) { S.run(2000); S.startArrhythmia('vt', { cell: vtCell(M.A) }); } }
      if (!S) return null;
      S.run(SETTLE);
      const rec12 = []; let t0 = null;
      S.onSample((t, v) => { if (t0 === null) t0 = t; rec12.push(Array.from(v)); });
      S.run(STRIP);
      return { S, M, rec12, t0 };
    }
    // a 3.6 s sinus beat of the same heart (measurements for the fast tachycardias, whose T runs into the next QRS)
    function sinusRead(M) {
      const S = new LH.Sim(M, { seed: 1 }); const r = []; S.onSample((t, v) => r.push(Array.from(v))); S.run(3600);
      const v = S.log.vent, vb = v[v.length - 2]; return read(r, Math.round(vb.on), v[v.length - 2].on - v[v.length - 3].on);
    }

    // ---------------------------------------------------------------- gate and answer key
    // reader word → finding; extras that are a true consequence of the scenario are optional, anything
    // else unexpected (or a scenario finding not read) rejects the ECG
    function gate(rec, rr, b) {
      const R = RHYTHMS[rec.rhythm], fail = (why) => ({ ok: false, why });
      if (!R.read(rr.rhythm)) return fail(`rhythm read "${rr.rhythm}"`);
      let rhythm = rec.rhythm;
      if (SINUS.includes(rhythm)) rhythm = rr.rate < 60 ? 'sinusBrady' : rr.rate > 100 ? 'sinusTachy' : 'sinus';
      const dx = b.dx.slice(), f = b.f, used = new Set(), findings = [], optional = new Set(), hl = new Set(), lines = {};
      const has = (w) => dx.findIndex((d) => d === w || d.startsWith(w + ' '));
      const take = (w) => { const i = has(w); if (i < 0) return null; used.add(i); return dx[i]; };
      const ks = rec.abn.map((a) => a.k);
      for (const a of rec.abn) {
        const d = ABN[a.k];
        if (d.isch) {
          const site = MI_SITES[a.site], acute = d.isch < 24, word = acute ? 'STEMI' : 'old MI', got = take(word);
          if (!got) return fail(`${a.k} ${a.site} not read`);
          const terr = got.slice(word.length + 1).split('+').map(territory).filter(Boolean), ex = acute ? site.ste : site.q;
          if (!ex.req.some((t) => terr.includes(t))) return fail(`${a.k} ${a.site} read in ${terr.join('+')}`);
          const ok = [...new Set([...ex.ok, ...terr])].filter((t) => !ex.req.includes(t));
          const leads = acute ? f.ste : f.Q;
          findings.push({ id: d.id, regions: ex.req, okRegions: ok });
          leads.forEach((l) => hl.add(l)); ex.req.forEach((t) => RL[t].forEach((l) => hl.add(l)));
          lines[d.id] = acute ? `ST elevation in ${leads.join(', ')}: acute ${ex.req.join('/')} STEMI (${site.name} occlusion).` : `Q waves in ${leads.join(', ')}: old ${ex.req.join('/')} infarct.`;
          if (acute) { optional.add('std'); optional.add('reciprocal'); optional.add('hyperacute'); optional.add('posteriorMI'); }
          continue;
        }
        if (!take(d.dx)) return fail(`${a.k} not read`);
        findings.push({ id: a.k });
        d.leads.forEach((l) => hl.add(l)); lines[a.k] = d.line;
      }
      // extras the reader made
      const lad = ks.some((k) => k === 'stemi' || k === 'oldmi') && rec.abn.some((a) => /LAD/.test(a.site || ''));
      const rca = rec.abn.some((a) => /RCA/.test(a.site || ''));
      for (let i = 0; i < dx.length; i++) {
        if (used.has(i)) continue;
        const d = dx[i];
        if (d === 'T inversion' && ks.length) { optional.add('twi'); continue; }
        if (d === 'long QT' && ks.length) { optional.add('longqt'); continue; }
        if (d === 'poor R progression' && (ks.includes('lafb') || ks.includes('lvh') || ks.includes('rvh') || lad)) { optional.add('poorR'); continue; }
        if (d.startsWith('old MI') && ks.includes('lafb') && !ks.includes('oldmi')) { optional.add('qwaves'); continue; }   // (LAFB pseudo-infarct)
        if (d === '1st-degree AVB' && rca) { optional.add('avb1'); continue; }
        if (d.startsWith('STEMI posterior') && ks.includes('stemi')) { optional.add('posteriorMI'); continue; }
        if (d === 'IVCD' && (ks.includes('lvh') || ks.includes('rvh') || ks.includes('lpfb') || ks.includes('lafb'))) { optional.add('ivcd'); continue; }
        return fail(`unexpected "${d}"`);
      }
      if (f.axis === 'LAD') optional.add('lad');
      if (f.axis === 'RAD') optional.add('rad');
      if (ks.includes('lvh')) optional.add('lvhStrain');
      if (ks.includes('rbbb') && ks.includes('lafb')) optional.add('bifascicular');
      for (const x of findings) optional.delete(x.id);
      return { ok: true, rhythm, findings, optional: [...optional], hl: LEADS.filter((l) => hl.has(l)), lines };
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
    function build(rec) {
      const sim = simulate(rec);
      if (!sim) return { ok: false, why: 'not induced' };
      const { M, rec12, t0, S } = sim, R = RHYTHMS[rec.rhythm];
      const rr = readRhythm(rec12);
      const V = S.log.vent.filter((v) => v.on - t0 > 500 && v.on - t0 < STRIP - 800);
      if (V.length < 2) return { ok: false, why: 'too few beats' };
      const vb = V[V.length - 1], vp = V[V.length - 2];
      const r = read(rec12, Math.round(vb.on - t0), vb.on - vp.on), b = r.interpret();
      const g = gate(rec, rr, b);
      if (!g.ok) return g;
      const noPR = !R.pRhythm, sm = R.tachy ? sinusRead(M).m : r.m;
      const m = { rate: rr.rate, pr: noPR ? null : r.m.pr, qrs: R.vt ? r.m.qrs : sm.qrs, qtc: R.tachy ? null : r.m.qtc, axis: R.vt ? null : sm.axis };
      if (R.tachy && !R.vt) { /* (axis and QRS from the same heart in sinus rhythm) */ }
      // caliper on the interval that decides it
      const within = (lo, hi) => V.filter((v) => v.on - t0 > lo && v.on - t0 < hi);
      let caliper = null;
      const calK = rec.abn.map((a) => ABN[a.k].caliper).find(Boolean);
      if (R.tachy) { const [a, c] = within(1500, 4600); if (a && c) caliper = { lead: 'rhythm', t0: Math.round(a.on - t0), t1: Math.round(c.on - t0), label: `RR ${Math.round(c.on - a.on)} ms = ${Math.round(60000 / (c.on - a.on))}/min` }; }
      else if (calK === 'qrs') { const [a] = within(5200, 7200); if (a) caliper = { lead: 'V1', t0: Math.round(a.on - t0), t1: Math.round(a.on - t0 + r.m.qrs), label: `QRS ${r.m.qrs} ms` }; }
      else if ((calK === 'pr' || rec.abn.some((a) => a.k === 'avb1')) && r.m.pr) { const [a] = within(1200, 4600); if (a) caliper = { lead: 'rhythm', t0: Math.round(a.on - t0 - r.m.pr), t1: Math.round(a.on - t0), label: `PR ${r.m.pr} ms` }; }
      const leads = LEADS.map((_, k) => { const a = new Int16Array(STRIP / (1000 / HZ)); for (let i = 0; i < a.length; i++) a[i] = Math.round(rec12[i * (1000 / HZ)][k] * 1000); return b64(a); });
      const key = { rhythm: g.rhythm, alt: R.alt || (SINUS.includes(g.rhythm) && g.rhythm !== 'sinus' ? ['sinus'] : []), findings: g.findings, optional: g.optional };
      const skills = { rhythm: true }; for (const a of rec.abn) skills[ABN[a.k].skill] = true;
      const title = [g.rhythm, ...rec.abn.map((a) => (ABN[a.k].isch ? `${a.k} (${a.site})` : a.k))].join(' + ');
      return {
        ok: true,
        item: { id: `${rec.rhythm}-${rec.seed}`, title, recipe: rec, hz: HZ, ms: STRIP, leads, m, read: { rhythm: rr.rhythm, dx: b.dx }, key, highlight: g.hl.length ? g.hl : ['II'], caliper,
          lines: { rhythm: RHYTHM_LINE[g.rhythm], ...g.lines }, link: linkOf(rec), rating: itemRating(rec), skills: Object.keys(skills), n: rec.abn.length },
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
