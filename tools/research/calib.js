// Feasibility of regional lead-sensitivity calibration.
//   node tools/research/calib.js '<model params JSON>' [samples]
// 1. Simulate normal, LAFB, LPFB, LBBB, RBBB; record each region's frontal
//    heart-vector contribution through the QRS.
// 2. Search region weights in [0.5, 2] so all five conditions meet textbook
//    axis and morphology targets. Leads are linear in the weights.
const fs = require('fs'); const LH = require('../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}'), NS = +(process.argv[3] || 200000);
const M = new LH.Model(A, P), NE = M.NE, W = M.W;
const LO = +(process.env.WLO || 0.5), HI = +(process.env.WHI || 2);

const REG = ['RV', 'LVsept', 'LVant', 'LVlat', 'LVinf', 'LVapex', 'LVbase'];
const region = (c) => {
  if (A.label[c] === 2) return 0;
  const ph = A.phi[c], z = A.zuvc[c];
  if (Math.abs(ph) < 0.6) return 1;
  if (z >= 0 && z < 0.25) return 5;
  if (z > 0.8) return 6;
  if (ph > 0.6 && ph < 2.3) return 2;
  if (ph > -2.3 && ph < -0.6) return 4;
  return 3;
};
const reg = new Int8Array(M.nVox).fill(-1);
for (let c = 0; c < M.nVox; c++) if (M.kind[c] === LH.KIND.VENT) reg[c] = region(c);

function record(blk) {
  const S = new LH.Sim(M, { seed: 1 });
  for (const c of blk) S.blocked[c] = 1;
  S.run(1700);                                   // before the 3rd sinus beat reaches the ventricles
  const t0 = S.t, g = -S.P.ecgGain * S.P.dipoleGain, all = [];
  for (let k = 0; k < 450; k++) {
    S.step();
    const d = REG.map(() => [0, 0]);
    for (let c = 0; c < M.nVox; c++) {
      const r = reg[c]; if (r < 0) continue;
      const dv = S.vm(c, S.t) - S.vRest[c]; if (!dv) continue;
      d[r][0] += W[c * NE + 9] * dv * g; d[r][1] += W[c * NE + 10] * dv * g;
    }
    all.push(d);
  }
  const vb = S.log.vent.filter((b) => b.on > t0).shift();
  const i0 = Math.max(0, Math.floor(vb.on) - t0 - 2);
  const series = all.slice(i0, i0 + 170);
  return { series, n: Math.min(170, Math.ceil(vb.last - vb.on) + 6) };
}

const cs = M.csSegments;
const conds = {
  normal: record([]), LAFB: record(cs.LAF), LPFB: record(cs.LPF),
  LBBB: record(cs.LBB.slice(0, 2)), RBBB: record(cs.RBB.slice(0, 4)),
};
// (I, aVF) waveforms for a weight vector
function leads(cond, w) {
  const I = [], F = [];
  for (let k = 0; k < cond.n; k++) { let x = 0, y = 0; cond.series[k].forEach((d, r) => { x += w[r] * d[0]; y += w[r] * d[1]; }); I.push(x); F.push(-y); }
  return { I, F };
}
const stats = (v) => { let mx = 0, mn = 0, ar = 0; for (const x of v) { if (x > mx) mx = x; if (x < mn) mn = x; ar += x; } return { R: mx, S: -mn, net: mx + mn, area: ar }; };
const ang = (y, x) => Math.atan2(y, x) * 180 / Math.PI;
function measure(w) {
  const out = {};
  for (const [k, c] of Object.entries(conds)) {
    const { I, F } = leads(c, w), a = stats(I), b = stats(F);
    // II and III from I and aVF (Einthoven): II = I/2 + (√3/2)·aVF·(2/√3)… use hexaxial projection
    const II = I.map((v, i) => 0.5 * v + 0.866 * F[i] * 1.1547 * 0.866), III = I.map((v, i) => -0.5 * v + 0.866 * F[i] * 1.1547 * 0.866);
    out[k] = { amp: ang(b.net, a.net), area: ang(b.area, a.area), I: a, aVF: b, II: stats(II), III: stats(III) };
  }
  return out;
}
const pen = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
function score(m) {
  let s = 0;
  s += pen(m.normal.amp, 30, 75) + pen(m.normal.area, 30, 75);
  s += pen(m.LAFB.amp, -90, -45) + pen(m.LAFB.area, -90, -40);
  s += pen(m.LPFB.amp, 100, 150) + pen(m.LPFB.area, 95, 150);
  s += pen(m.LBBB.amp, -30, 60) + pen(m.RBBB.amp, -10, 90);
  // morphology: LAFB rS in inferior leads; LPFB rS in I; normal R-dominant aVF
  s += 40 * Math.max(0, m.LAFB.aVF.R - m.LAFB.aVF.S) + 40 * Math.max(0, m.LPFB.I.R - m.LPFB.I.S);
  s += 40 * Math.max(0, m.normal.aVF.S - m.normal.aVF.R);
  return s;
}
const fmt = (m) => Object.entries(m).map(([k, v]) => `${k} ${Math.round(v.amp)}/${Math.round(v.area)}`).join('  ');
const ones = REG.map(() => 1);
console.log('uncalibrated   ', fmt(measure(ones)), ' score', score(measure(ones)).toFixed(1));

const rnd = LH.rng(7);
let best = ones, bs = score(measure(ones));
for (let i = 0; i < NS; i++) {
  const w = i < NS / 2 ? REG.map(() => Math.exp(Math.log(LO) + rnd() * Math.log(HI / LO)))
    : best.map((v) => Math.min(HI, Math.max(LO, v * Math.exp((rnd() - 0.5) * 0.3))));
  const s = score(measure(w));
  if (s < bs) { bs = s; best = w; }
}
const m = measure(best);
console.log('best weights   ', REG.map((r, i) => `${r} ${best[i].toFixed(2)}`).join('  '));
console.log('calibrated     ', fmt(m), ' score', bs.toFixed(1));
for (const k of Object.keys(m)) console.log(`   ${k.padEnd(6)} I ${m[k].I.R.toFixed(2)}/${m[k].I.S.toFixed(2)}  aVF ${m[k].aVF.R.toFixed(2)}/${m[k].aVF.S.toFixed(2)}`);
