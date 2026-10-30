// Local refinement around a parameter set: node tools/fasclocal.js <seed> <count> '<base JSON>'
const evaluate = require('./fascsearch.js');
const LH = require('../src/engine.js');
const rnd = LH.rng(+process.argv[2]), N = +process.argv[3], base = JSON.parse(process.argv[4]);
const jitter = { heartRotation: 6, heartPitch: 8, sigmaRatio: 1.5, lafPhi: 0.25, lafZ: 0.08, lpfPhi: 0.25, lpfZ: 0.06, lbbSplitZ: 0.05,
  lpfTerrLo: 0.2, lpfTerrHi: 0.2, lpfApexZ: 0.08, purkCrossSlow: 3, cvBundle: 0.4, cvPurkinje: 0.4, purkZmaxLV: 0.03, fascConnectFrac: 0.1, rbbSeptalDelay: 3,
  brody: 0.4, apexY: 10, heartYaw: 8, dipoleGain: 0.4 };
const SCALE = +(process.env.SCALE || 1);
for (let i = 0; i < N; i++) {
  const p = Object.assign({}, base);
  for (const [k, d] of Object.entries(jitter)) if (k in p && rnd() < 0.5) p[k] = +(p[k] + (rnd() * 2 - 1) * d * SCALE).toFixed(2);
  p.sigmaRatio = Math.max(1, Math.min(10, p.sigmaRatio)); p.purkZmaxLV = Math.min(1.01, p.purkZmaxLV);
  if ('brody' in p) p.brody = Math.max(0, p.brody);
  // optional orientation bounds (anatomical constraint)
  const RMIN = process.env.ROTMIN, RMAX = process.env.ROTMAX, PMIN = process.env.PITCHMIN, PMAX = process.env.PITCHMAX;
  if (RMIN !== undefined) p.heartRotation = +(+RMIN + rnd() * (+RMAX - +RMIN)).toFixed(1);
  if (PMIN !== undefined) p.heartPitch = +(+PMIN + rnd() * (+PMAX - +PMIN)).toFixed(1);
  try { const r = evaluate(p); console.log(JSON.stringify({ score: r.score, p, normal: r.normal, LAFB: r.LAFB, LPFB: r.LPFB, LBBB: r.LBBB })); } catch (e) { console.log(JSON.stringify({ score: 999, err: e.message })); }
}
