// Regional decomposition of the early QRS: each lead is a sum over voxel pairs, so the pairs are
// tagged by region and each region's share of every lead and of the heart vector is summed
// separately (normal heart and an old infarct, same activation code path as the app).
//   node tools/regiondecomp.js '{params}' [site=dLAD] [hours=720]
// Regions: LV septum / anterior / lateral / inferior (AHA sectors, zuvc >= 0.25), apex (LV zuvc < 0.25),
// RV, other (conduction system, LV base outside UVC); "window" = the old-scar window term.
// Prints per region: mean contribution over 0-20 and 20-40 ms after QRS onset (mV) to the heart
// vector (X left, Y superior, Z anterior) and to II, III, aVF, V1-V6, plus the infarct minus normal.
const fs = require('fs'); if (process.env.TV2) require('../src/engine.js').setDefaultTorso2(JSON.parse(fs.readFileSync(process.env.TV2))); const LH = require('../src/engine.js');
const LV0 = LH.hypertrophyOptions({}).anatomy.lvWallLayers;
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const P = JSON.parse(process.argv[2] || '{}'), SITE = process.argv[3] || 'dLAD', HOURS = +(process.argv[4] || 720);
const { lv = LV0, rv = 0, ...mp } = P;
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), br = M.coronary.branches;
const SITES = { pLAD: br.LAD[0], mLAD: br.LAD[Math.round(br.LAD.length * +(process.env.MLAD_F || 0.22))], dLAD: br.LAD[Math.round(br.LAD.length * 0.45)],
  pLCx: br.LCx[0], dLCx: br.LCx[Math.round(br.LCx.length * 0.6)], pRCA: br.RCA[0], PDA: br.PDA[0] };
const RN = ['sept', 'ant', 'lat', 'inf', 'apex', 'rv', 'oth'], NR = RN.length, NE = M.NE, n = M.nVox;
const SEC = ['sept', 'ant', 'lat', 'lat', 'inf', 'sept'];   // anteroseptal, anterior, anterolateral, inferolateral, inferior, inferoseptal
const reg = new Int8Array(n);
for (let c = 0; c < n; c++) {
  const lab = A.label[c], z = A.zuvc[c];
  if (lab === LH.LAB.RV) reg[c] = 5;
  else if (lab === LH.LAB.LV && z >= 0) {
    if (z < 0.25) reg[c] = 4;
    else { const d = ((A.phi[c] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); reg[c] = RN.indexOf(SEC[Math.min(5, Math.floor(d / (Math.PI / 3)))]); }
  } else reg[c] = 6;
}
if (process.env.REG === 'time' && process.env.ZSPLIT) {   // anterior wall and septum split at zuvc ZSPLIT
  const zs = +process.env.ZSPLIT;
  RN.splice(0, NR, 'sept_lo', 'ant_lo', 'sept_hi', 'ant_hi', 'apex', 'inf+lat', 'rv+oth');
  for (let c = 0; c < n; c++) { const lab = A.label[c], z = A.zuvc[c];
    if (lab !== LH.LAB.LV || z < 0) { reg[c] = 6; continue; } if (z < 0.25) { reg[c] = 4; continue; }
    const d = ((A.phi[c] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), sec = SEC[Math.min(5, Math.floor(d / (Math.PI / 3)))];
    reg[c] = sec === 'sept' ? (z < zs ? 0 : 2) : sec === 'ant' ? (z < zs ? 1 : 3) : 5; }
}
if (process.env.REG === 'rv') {   // RV split by height (apicobasal UVC thirds) and side; LV lumped
  RN.splice(0, NR, 'rv_apex', 'rv_mid_a', 'rv_mid_p', 'rv_base_a', 'rv_base_p', 'LV', 'oth');
  const pz = +(process.env.RVPHI || 0.6);   // rotational UVC splitting anterior (phi > RVPHI) from posterior RV
  for (let c = 0; c < n; c++) { const lab = A.label[c], z = A.zuvc[c];
    if (lab === LH.LAB.LV && z >= 0) { reg[c] = 5; continue; } if (lab !== LH.LAB.RV) { reg[c] = 6; continue; }
    const ph = Math.atan2(Math.sin(A.phi[c]), Math.cos(A.phi[c])), ant = ph > pz;
    reg[c] = z < 0.33 ? 0 : z < 0.66 ? (ant ? 1 : 2) : (ant ? 3 : 4); }
}
if (process.env.SUPPLY) {   // regions by supplying artery and position along the LAD
  const C = M.coronary, LADi = new Map(br.LAD.map((id, i) => [id, i / (br.LAD.length - 1)])), cut = process.env.SUPPLY.split(',').map(Number);   // e.g. 0.18,0.3,0.45
  RN.splice(0, NR, `LAD<${cut[0]}`, `LAD${cut[0]}-${cut[1]}`, `LAD${cut[1]}-${cut[2]}`, `LAD>${cut[2]}`, 'LCx', 'RCA/PDA', 'RV/oth');
  for (let c = 0; c < n; c++) { if (A.label[c] !== LH.LAB.LV) { reg[c] = 6; continue; } const nd = C.voxNode[c]; if (nd < 0) { reg[c] = 6; continue; }
    const b = C.nodes[nd].branch; if (b === 'LAD') { const f = LADi.get(nd); reg[c] = f < cut[0] ? 0 : f < cut[1] ? 1 : f < cut[2] ? 2 : 3; } else if (b === 'LCx' || b === 'LM') reg[c] = 4; else reg[c] = 5; }
  if (process.env.SEPT) {   // split the most proximal bin into septum (rotational UVC 0.1-1.7) and free wall, merge the rest of the LAD
    RN.splice(0, NR, `sept<${cut[0]}`, `free<${cut[0]}`, `LAD>${cut[0]}`, 'zz>0.5 of it', 'LCx', 'RCA/PDA', 'RV/oth');
    for (let c = 0; c < n; c++) { if (reg[c] === 0) reg[c] = A.phi[c] > 0.1 && A.phi[c] < 1.7 ? 0 : 1; else if (reg[c] === 1 || reg[c] === 2 || reg[c] === 3) reg[c] = 2; }
    for (let c = 0; c < n; c++) if (reg[c] === 1 && A.zuvc[c] >= 0.5) reg[c] = 3;   // proximal free wall split: upper half separately
    RN[1] = `free<${cut[0]} z<.5`; RN[3] = `free<${cut[0]} z>=.5`;
  }
  const cnt = new Array(NR).fill(0); for (let c = 0; c < n; c++) if (M.kind[c] === LH.KIND.VENT) cnt[reg[c]]++; console.log('cells: ' + RN.map((r, i) => r + ' ' + cnt[i]).join(', '));
}
// regional pair weights (a pair belongs to its low cell's region; pair coefficients exactly as the model's W)
function regionalW(dead) {
  const WR = Array.from({ length: NR }, () => new Float32Array(n * NE)), cc = new Float64Array(NE);
  for (let c = 0; c < n; c++) {
    const kc = M.kind[c]; if (!kc) continue;
    const i = A.ii[c], j = A.jj[c], k = A.kk[c];
    for (let a = 0; a < 3; a++) {
      const w = A.at(i + (a === 0), j + (a === 1), k + (a === 2));
      if (w < 0 || M.kind[w] !== kc) continue;
      if (dead && kc === LH.KIND.VENT && dead[c] !== dead[w]) continue;   // necrotic/living coupling removed (old scar)
      M.pairCoef(c, w, a, cc);
      const R = WR[reg[c]];
      for (let e = 0; e < NE; e++) { R[w * NE + e] += cc[e]; R[c * NE + e] -= cc[e]; }
    }
  }
  return WR;
}
// leads from a phi vector (no baseline, no filter): same formulas as Sim._ecg
function leads(S, phi) {
  const Pp = S.P, g = -Pp.ecgGain, v = (e) => g * phi[e], D = [0, 1, 2].map((a) => v(9 + a) * Pp.dipoleGain);
  const L = new Array(12).fill(0), c60 = 0.5, s60 = 0.8660254;
  if (M.torsoLimb) {
    const b = Pp.torsoBlend, gd = Pp.dipoleGain, al = Pp.limbRotation * Math.PI / 180, lr = [Math.cos(al), Math.sin(al)];
    const dx = lr[0] * D[0] + lr[1] * D[1], dy = -lr[1] * D[0] + lr[0] * D[1];
    L[0] = b * v(12) * gd + (1 - b) * dx; L[1] = b * Pp.torsoIIGain * v(13) * gd + (1 - b) * (c60 * dx - s60 * dy); L[2] = L[1] - L[0];
  } else { L[0] = D[0]; L[1] = c60 * D[0] - s60 * D[1]; L[2] = -c60 * D[0] - s60 * D[1]; }
  L[3] = -(L[0] + L[1]) / 2; L[4] = (L[0] - L[2]) / 2; L[5] = (L[1] + L[2]) / 2;
  const wct = (v(0) + v(1) + v(2)) / 3;
  for (let k = 0; k < 6; k++) { const u = M.leadDir[k], proj = D[0] * u[0] + D[1] * u[1] + D[2] * u[2];
    L[6 + k] = Pp.precordialGain * (Pp.precordialDipoleW * Pp.precordialDipoleGain * proj + (1 - Pp.precordialDipoleW) * (v(3 + k) - wct)); }
  if (process.env.SPLIT) {   // chest leads split: heart-vector part and local-field part (each as it enters the lead)
    const parts = [];
    for (let k = 0; k < 6; k++) { const u = M.leadDir[k], proj = D[0] * u[0] + D[1] * u[1] + D[2] * u[2];
      parts.push(Pp.precordialGain * Pp.precordialDipoleW * Pp.precordialDipoleGain * proj, Pp.precordialGain * (1 - Pp.precordialDipoleW) * (v(3 + k) - wct)); }
    return { D, L, parts };
  }
  return { D, L };
}
const RUN = +(process.env.ISCH_MS || 3000);
function decompose(occl) {
  const mk = () => { const S = new LH.Sim(M, { seed: 1 }); if (typeof occl === 'string') S.setBlock(occl, 'complete'); else if (occl) { S.addOcclusion(occl); S.setIschemiaTime(HOURS); } return S; };   // a string = conduction block site (LAF, LPF, LBB, RBB)
  const S0 = mk(); S0.run(RUN); const vb = S0.log.vent[S0.log.vent.length - 2], on = Math.floor(vb.on);
  const S = mk();
  const dead = occl ? Uint8Array.from({ length: n }, (_, c) => (S.blocked[c] && M.kind[c] === LH.KIND.VENT ? 1 : 0)) : null;
  const WR = regionalW(dead), T = +(process.env.TMAX || 60);
  const out = Array.from({ length: NR + 1 }, () => Array.from({ length: T }, () => new Float64Array(NE)));
  const full = Array.from({ length: T }, () => new Float64Array(NE)), model = Array.from({ length: T }, () => new Float64Array(NE));
  const cells = [], creg = new Array(n);
  for (let c = 0; c < n; c++) { if (!M.kind[c]) continue; const rs = []; for (let r = 0; r < NR; r++) { const R = WR[r]; for (let e = 0; e < NE; e++) if (R[c * NE + e]) { rs.push(r); break; } } if (rs.length) { cells.push(c); creg[c] = rs; } }
  const orig = S._ecg;
  S._ecg = function (t) {
    orig.call(this, t);
    const dt = t - on; if (dt < 0 || dt >= T) return;
    const Wf = this.W;
    for (const c of cells) {
      const dv = this.vm(c, t) - this.vRest[c]; if (!dv) continue;
      const o = c * NE;
      for (let e = 0; e < NE; e++) full[dt][e] += Wf[o + e] * dv;
      for (const r of creg[c]) { const R = WR[r], X = out[r][dt]; for (let e = 0; e < NE; e++) X[e] += R[o + e] * dv; }
    }
    { const b = this._baseline; for (let e = 0; e < NE; e++) model[dt][e] = this._phi[e] + (b ? b[e] : 0); }
    if (this._pOn && this._pFirst !== null && t <= this._pFirst + 160) { const k = this.P.scarWindow * this.P.vAmp; for (let e = 0; e < NE; e++) out[NR][dt][e] = -k * this._pSum[e]; }
  };
  S.run(RUN);
  // check: regional sum reproduces the model's dynamic sum
  let err = 0, mag = 0;
  for (let t = 0; t < T; t++) for (let e = 0; e < NE; e++) { let s = 0; for (let r = 0; r < NR; r++) s += out[r][t][e]; err = Math.max(err, Math.abs(s - full[t][e])); mag = Math.max(mag, Math.abs(full[t][e])); }
  // and the model's own phi (with baseline) = dynamic sum + window term + pre-QRS offset
  let e2 = 0; for (let t = 0; t < T; t++) for (let e = 0; e < NE; e++) e2 = Math.max(e2, Math.abs((model[t][e] - model[0][e]) - (full[t][e] - full[0][e] + out[NR][t][e] - out[NR][0][e])));
  return { S, out, relErr: err / mag, modelErr: e2 / mag, on };
}
const SHOW = process.env.LIMB ? ['I', 'II', 'III', 'aVL', 'aVF', 'V1', 'V2', 'V4', 'V6'] : ['II', 'III', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'], LI = SHOW.map((s) => LH.LEADS.indexOf(s));
function summary(S, out, w0, w1) {
  return out.map((series) => {
    const acc = { D: [0, 0, 0], L: new Array(12).fill(0) };
    for (let t = w0; t < w1; t++) { const { D, L } = leads(S, series[t]); for (let a = 0; a < 3; a++) acc.D[a] += D[a] / (w1 - w0); for (let k = 0; k < 12; k++) acc.L[k] += L[k] / (w1 - w0); }
    return acc;
  });
}
const f = (x) => (x >= 0 ? ' ' : '') + x.toFixed(2);
function table(title, sm) {
  console.log('\n' + title); console.log('region   X     Y     Z   | ' + SHOW.map((s) => s.padStart(5)).join(' '));
  const names = [...RN, 'window', 'TOTAL'], tot = { D: [0, 0, 0], L: new Array(12).fill(0) };
  sm.forEach((s) => { for (let a = 0; a < 3; a++) tot.D[a] += s.D[a]; for (let k = 0; k < 12; k++) tot.L[k] += s.L[k]; });
  [...sm, tot].forEach((s, i) => console.log(names[i].padEnd(7) + s.D.map(f).join(' ') + ' | ' + LI.map((k) => f(s.L[k]).padStart(5)).join(' ')));
}
if (process.env.REG === 'dead') {
  const S2 = new LH.Sim(M, { seed: 1 }); S2.addOcclusion(SITES[SITE]); S2.setIschemiaTime(HOURS);
  for (let c = 0; c < n; c++) if (!(S2.blocked[c] && M.kind[c] === LH.KIND.VENT)) reg[c] = 6; else if (reg[c] === 6) reg[c] = 6;
  RN.splice(0, NR, 'Dsept', 'Dant', 'Dlat', 'Dinf', 'Dapex', 'Drv', 'living');
  const Nn = decompose(null), BIN = 5;
  console.log(`normal heart: contribution of the cells that die in ${SITE} (pairs inside the dead set and its border), mean per ${BIN} ms`);
  console.log('ms     region   X     Y     Z   | ' + SHOW.map((s) => s.padStart(5)).join(' '));
  for (let w0 = 0; w0 < 60; w0 += BIN) { const sm = summary(Nn.S, Nn.out, w0, w0 + BIN);
    if (process.env.SPLIT) { [1, 4].forEach((i) => { const pp = new Array(12).fill(0); for (let t = w0; t < w0 + BIN; t++) { const r = leads(Nn.S, Nn.out[i][t]); r.parts.forEach((x, j) => (pp[j] += x / BIN)); }
      console.log(String(w0).padEnd(6) + RN[i].padEnd(7) + ' V1-V6 heart-vector part: ' + [0, 2, 4, 6, 8, 10].map((j) => f(pp[j])).join(' ') + '   local part: ' + [1, 3, 5, 7, 9, 11].map((j) => f(pp[j])).join(' ')); }); continue; }
    [1, 4, 0, 6].forEach((i) => console.log(String(w0).padEnd(6) + RN[i].padEnd(7) + sm[i].D.map(f).join(' ') + ' | ' + LI.map((k) => f(sm[i].L[k]).padStart(5)).join(' '))); }
  process.exit(0);
}
if (process.env.REG === 'time' || process.env.REG === 'rv') {   // normal heart (or BLOCKT=site: with that conduction block): every region per 5 ms
  const Nn = decompose(process.env.BLOCKT || null);
  console.log('normal heart by region, mean per 5 ms (heart vector X left Y sup Z ant; leads mV)');
  console.log('ms   region   X     Y     Z   | ' + SHOW.map((s) => s.padStart(5)).join(' '));
  if (process.env.AREA && process.env.BLOCK) {   // QRS area per region: normal, block, and block − normal
    const T = +(process.env.TMAX || 130), iI = LH.LEADS.indexOf('I'), iF = LH.LEADS.indexOf('aVF'), Bk = decompose(process.env.BLOCK);
    const ar = (D) => { const sm = summary(D.S, D.out, 0, T); return sm.map((x) => [x.L[iI] * T, x.L[iF] * T]); };
    const a = ar(Nn), b = ar(Bk), ax = (v) => (Math.atan2(v[1] * 2 / Math.sqrt(3), v[0]) * 180 / Math.PI).toFixed(0);
    const tot = (z) => z.slice(0, NR).reduce((s, v) => [s[0] + v[0], s[1] + v[1]], [0, 0]);
    console.log('region      normal I/aVF     ' + process.env.BLOCK + 'B I/aVF       change I/aVF  (mV·ms, 0-' + T + ' ms)');
    RN.forEach((r, i) => console.log(r.padEnd(9) + (a[i][0].toFixed(1) + '/' + a[i][1].toFixed(1)).padStart(14) + (b[i][0].toFixed(1) + '/' + b[i][1].toFixed(1)).padStart(16) + ((b[i][0] - a[i][0]).toFixed(1) + '/' + (b[i][1] - a[i][1]).toFixed(1)).padStart(16)));
    const ta = tot(a), tb = tot(b); console.log('total    ' + (ta[0].toFixed(1) + '/' + ta[1].toFixed(1)).padStart(14) + (tb[0].toFixed(1) + '/' + tb[1].toFixed(1)).padStart(16) + '   area axis ' + ax(ta) + ' -> ' + ax(tb));
    process.exit(0);
  }
  if (process.env.AREA) {   // QRS area (mV·ms) per region and per window, and each region's share of the frontal axis
    const T = +(process.env.TMAX || 60), B = +(process.env.BIN || 10), iI = LH.LEADS.indexOf('I'), iF = LH.LEADS.indexOf('aVF');
    const tot = new Array(NR + 1).fill(0).map(() => [0, 0]);
    console.log('window  ' + RN.map((r) => (r + ' I/aVF').padStart(14)).join(''));
    for (let w0 = 0; w0 < T; w0 += B) { const sm = summary(Nn.S, Nn.out, w0, Math.min(T, w0 + B)); let row = String(w0).padEnd(8);
      sm.forEach((x, i) => { if (i >= NR) return; const a = x.L[iI] * B, b = x.L[iF] * B; tot[i][0] += a; tot[i][1] += b; row += (a.toFixed(1) + '/' + b.toFixed(1)).padStart(14); }); console.log(row); }
    let sI = 0, sF = 0; tot.forEach(([a, b]) => { sI += a; sF += b; });
    console.log('total   ' + tot.slice(0, NR).map(([a, b]) => (a.toFixed(1) + '/' + b.toFixed(1)).padStart(14)).join('') + `   sum I ${sI.toFixed(1)} aVF ${sF.toFixed(1)} -> area axis ${(Math.atan2(sF * 2 / Math.sqrt(3), sI) * 180 / Math.PI).toFixed(0)} deg`);
    process.exit(0);
  }
  for (let w0 = 0; w0 < 45; w0 += 5) { const sm = summary(Nn.S, Nn.out, w0, w0 + 5); sm.forEach((x, i) => { if (i < NR) console.log(String(w0).padEnd(5) + RN[i].padEnd(7) + x.D.map(f).join(' ') + ' | ' + LI.map((k) => f(x.L[k]).padStart(5)).join(' ')); }); }
  process.exit(0);
}
const N = decompose(null), I = decompose(SITES[SITE]);
console.log(`params ${JSON.stringify(P)}  site ${SITE} ${HOURS} h  check err ${N.relErr.toExponential(1)} / ${I.relErr.toExponential(1)}, vs model ${N.modelErr.toExponential(1)} / ${I.modelErr.toExponential(1)}  dead cells ${I.S.nDead}`);
const cnt = new Array(NR).fill(0), dcnt = new Array(NR).fill(0);
for (let c = 0; c < n; c++) if (M.kind[c] === LH.KIND.VENT) { cnt[reg[c]]++; if (I.S.blocked[c]) dcnt[reg[c]]++; }
console.log('dead share by region: ' + RN.map((r, i) => `${r} ${Math.round(100 * dcnt[i] / Math.max(1, cnt[i]))}%`).join(', '));
const res = {};
for (const [w0, w1] of (process.env.WIN ? process.env.WIN.split(',').map((w) => w.split('-').map(Number)) : [[0, 20], [20, 40]])) {
  const sn = summary(N.S, N.out, w0, w1), si = summary(I.S, I.out, w0, w1);
  const diff = si.map((s, i) => ({ D: s.D.map((v, a) => v - sn[i].D[a]), L: s.L.map((v, k) => v - sn[i].L[k]) }));
  table(`NORMAL ${w0}-${w1} ms`, sn); table(`INFARCT ${w0}-${w1} ms`, si); table(`INFARCT - NORMAL ${w0}-${w1} ms`, diff);
  res[`${w0}-${w1}`] = { normal: sn, infarct: si };
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ P, SITE, HOURS, RN, res }));
