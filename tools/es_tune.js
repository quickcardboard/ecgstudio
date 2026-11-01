// Evolution-strategy tuner for the conduction system (diagonal CMA-style):
// node tools/es_tune.js <start.json> <out-dir> [generations] [lambda] [workers]
// Each generation samples lambda parameter sets around the mean, evaluates
// them with tools/cstune.js in persistent worker processes, recombines the
// best quarter and adapts the per-parameter step sizes. Every evaluation is
// appended to out-dir/evals.jsonl, a generation summary to out-dir/log.txt.
const { fork } = require('child_process'); const fs = require('fs'); const path = require('path');
if (process.argv[2] === '--worker') {
  const { evaluate } = require('./cstune.js');
  process.on('message', ({ id, p }) => { let r; try { r = evaluate(p); } catch (e) { r = { score: 1e9, err: String(e) }; } process.send({ id, p, ...r }); });
  return;
}
const [startFile, outDir, G = 150, LAMBDA = 12, NW = 4] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const R = {
  cvPurkinje: [1.7, 3.2], apexPurkMul: [1, 3], apexPurkZ: [0.25, 0.5], lafPhi: [2.2, 3.1], lafZ: [0.3, 0.62], lpfPhi: [-2.7, -1.4], lpfZ: [0.12, 0.45],
  lpfTerrLo: [-2.4, -1.0], lpfTerrHi: [-0.2, 1.0], lpfApexZ: [0, 0.35], fascConnectFrac: [0.3, 0.9], purkCrossSlow: [1.2, 8], heartRotation: [0, 40], heartPitch: [-28, 5],
  heartYaw: [-10, 20], limbRotation: [0, 20], pmjAntero: [6, 16], torsoIIGain: [0.45, 1], torsoBlend: [0.5, 0.9],
  septalTerrHalf: [0.05, 0.45], lsfZ: [0.15, 0.6], lsfPhi: [-0.4, 0.7], lbbSplitZ: [0.76, 0.92], lbbSplitPhi: [-0.2, 0.3], purkZmaxLV: [0.86, 0.96],
  mbZ: [0.34, 0.48], rbbSeptalFrac: [0, 0.25], apexX: [58, 82], apexY: [-48, -22], chestGap: [10, 25], purkLinkR: [2.6, 4.5], sigmaRatio: [6.5, 10],
  atrialFrontalRot: [0, 70],
};
const K = Object.keys(R), D = K.length;
const start = JSON.parse(fs.readFileSync(startFile, 'utf8'));
const def = { atrialFrontalRot: 30, septalTerrHalf: 0.15, lsfZ: 0.3, lsfPhi: 0.05, lbbSplitZ: 0.84, lbbSplitPhi: 0, purkZmaxLV: 0.94, mbZ: 0.4, rbbSeptalFrac: 0, apexX: 72, apexY: -34.83, chestGap: 15, purkLinkR: 3.2, sigmaRatio: 10, torsoIIGain: 0.6, torsoBlend: 0.7 };
const toU = (k, v) => (v - R[k][0]) / (R[k][1] - R[k][0]), fromU = (k, u) => R[k][0] + Math.min(1, Math.max(0, u)) * (R[k][1] - R[k][0]);
let mean = K.map((k) => toU(k, start[k] !== undefined ? start[k] : def[k] !== undefined ? def[k] : (R[k][0] + R[k][1]) / 2));
const sd = new Array(D).fill(1); let sigma = 0.08;
const fixed = { septalFascicle: true, lv: start.lv !== undefined ? start.lv : 2, rv: 0 };
const build = (u) => { const p = { ...fixed }; K.forEach((k, i) => { p[k] = +fromU(k, u[i]).toFixed(4); }); p.avnSegDelay = +(17 - (p.pmjAntero - 2) / 5).toFixed(2); return p; };
let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const workers = Array.from({ length: +NW }, () => fork(__filename, ['--worker'])); let nextId = 0;
const pending = new Map(); for (const w of workers) w.on('message', (m) => { const r = pending.get(m.id); pending.delete(m.id); w.busy = false; r(m); pump(); });
const queue = []; const pump = () => { for (const w of workers) if (!w.busy && queue.length) { const job = queue.shift(); w.busy = true; pending.set(job.id, job.resolve); w.send({ id: job.id, p: job.p }); } };
const evalP = (p) => new Promise((resolve) => { queue.push({ id: nextId++, p, resolve }); pump(); });
const log = (s) => { fs.appendFileSync(path.join(outDir, 'log.txt'), s + '\n'); };
(async () => {
  let best = null;
  const mu = Math.floor(+LAMBDA / 4), w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1)), ws = w.reduce((a, b) => a + b, 0);
  const first = await evalP(build(mean)); fs.appendFileSync(path.join(outDir, 'evals.jsonl'), JSON.stringify({ g: 0, ...first }) + '\n'); best = first;
  log(`start ${first.score}`);
  for (let g = 1; g <= +G; g++) {
    const zs = Array.from({ length: +LAMBDA }, () => Array.from({ length: D }, gauss));
    const us = zs.map((z) => mean.map((m, i) => Math.min(1, Math.max(0, m + sigma * sd[i] * z[i]))));
    const res = await Promise.all(us.map((u) => evalP(build(u))));
    res.forEach((r) => fs.appendFileSync(path.join(outDir, 'evals.jsonl'), JSON.stringify({ g, ...r }) + '\n'));
    const order = res.map((r, i) => [r.score, i]).sort((a, b) => a[0] - b[0]);
    const sel = order.slice(0, mu).map(([, i]) => i);
    mean = mean.map((_, d) => sel.reduce((a, i, j) => a + w[j] * us[i][d], 0) / ws);
    for (let d = 0; d < D; d++) { const e = sel.reduce((a, i, j) => a + w[j] * zs[i][d] * zs[i][d], 0) / ws; sd[d] = Math.min(3, Math.max(0.2, sd[d] * Math.exp(0.15 * (e - 1)))); }
    const gb = res[order[0][1]];
    if (gb.score < best.score) { best = gb; sigma = Math.min(0.3, sigma * 1.08); fs.writeFileSync(path.join(outDir, 'best.json'), JSON.stringify(best)); } else sigma = Math.max(0.025, sigma * 0.93);
    const m = best.m;
    log(`g ${g} genBest ${order[0][0]} best ${best.score} sigma ${sigma.toFixed(3)} | N ${m.N.axis}/${m.N.net} qI ${m.N.qI} LAF ${m.LAF.net} LPF ${m.LPF.net} LBB ${m.LBB.axis} apex ${m.act.apexMed} V4 ${m.N.prog[3]} V5 ${m.N.prog[4]} dLAD ${m.dLAD.slice(0, 4)}`);
  }
  log('done'); for (const w of workers) w.kill(); process.exit(0);
})();
