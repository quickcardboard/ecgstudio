// Random search over left-bundle anatomy: node tools/fascrandom.js <seed> <count> [baseJSON]
const evaluate = require('./fascsearch.js');
const LH = require('../src/engine.js');
const rnd = LH.rng(+process.argv[2]), N = +process.argv[3];
const base = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const U = (a, b) => +(a + (b - a) * rnd()).toFixed(2);
for (let i = 0; i < N; i++) {
  const sep = rnd() < 0.6;
  const p = Object.assign({}, base, {
    heartRotation: Math.round(U(-20, 20)),
    lafPhi: U(1.5, 2.6), lafZ: U(0.4, 0.75), lpfPhi: U(-1.8, -0.8), lpfZ: U(0.25, 0.5),
    lbbSplitZ: U(0.6, 0.82), lpfTerrLo: U(-2.8, -2.0), lpfTerrHi: U(0.2, 0.9), lpfApexZ: U(0, 0.5),
    septalTerrHalf: sep ? U(0.3, 0.6) : 0, lbbSeptalFrac: sep ? U(0.1, 0.4) : 0,
    purkCrossSlow: U(2, 12), cvBundle: U(2, 3.5), cvPurkinje: U(2, 4.5), purkZmaxLV: U(0.85, 1.0), fascConnectFrac: U(0.3, 0.8), rbbSeptalDelay: Math.round(U(8, 20)),
  });
  try { const r = evaluate(p); console.log(JSON.stringify({ score: r.score, p, normal: r.normal, LAFB: r.LAFB, LPFB: r.LPFB })); }
  catch (e) { console.log(JSON.stringify({ score: 999, p, err: e.message })); }
}
