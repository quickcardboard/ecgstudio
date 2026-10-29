// Evaluate sinus ECG/VCG metrics for a parameter set: node tools/evalecg.js '{"param":value}'
const fs = require('fs'); const LH = require('../src/engine.js');
const params = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const A = global.__A || new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
function evaluate(params, verbose) {
  const M = new LH.Model(A, params); const S = new LH.Sim(M, { seed: 1 });
  const rec = [], vcg = [];
  S.onSample((t, L) => { rec.push(Array.from(L)); vcg.push(Array.from(S.dipole)); });
  S.run(Math.max(2600, Math.round(4.2 * 60000 / (params.sinusRate || 72))));
  const vb = S.log.vent[S.log.vent.length - 2], ab = S.log.atrial.filter(a => a.on < vb.on).pop();
  const q0 = Math.floor(vb.on), q1 = Math.ceil(vb.last) + 2, t1 = Math.ceil(vb.repEnd + 40), a0 = Math.floor(ab.on);
  const base = rec[a0 - 5];
  const lead = (k, a, b) => rec.slice(a, b).map(r => r[k] - base[k]);
  const area = (k) => lead(k, q0, q1).reduce((s, v) => s + v, 0);
  const frontal = Math.atan2(area(5), area(0)) * 180 / Math.PI;
  const tarea = (k) => lead(k, q1 + 20, t1).reduce((s, v) => s + v, 0);
  const taxis = Math.atan2(tarea(5), tarea(0)) * 180 / Math.PI;
  // VCG
  let best = 0, bi = 0; for (let t = q0; t < q1; t++) { const v = vcg[t], m = Math.hypot(...v); if (m > best) { best = m; bi = t; } }
  const vm = vcg[bi], init = vcg[q0 + 15], im = Math.hypot(...init);
  const ampl = LH.LEADS.map((n, k) => { const y = lead(k, q0, q1); return [n, Math.max(...y), Math.min(...y)]; });
  const tw = LH.LEADS.map((n, k) => { const y = lead(k, q1 + 40, t1); return y.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0); });
  const pw = LH.LEADS.map((n, k) => { const y = lead(k, a0, a0 + 120); return y.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0); });
  const r = {
    PR: q0 - a0, QRS: q1 - q0, QT: t1 - q0, Pdur: Math.round(ab.last - ab.on),
    paxis: Math.round(Math.atan2(lead(5, a0, q0).reduce((s, v) => s + v, 0), lead(0, a0, q0).reduce((s, v) => s + v, 0)) * 180 / Math.PI),
    PII: +Math.max(...lead(1, a0, a0 + 130)).toFixed(2),
    init: Object.fromEntries(['I', 'V1', 'V6'].map(n => { const k = LH.LEADS.indexOf(n); const y = lead(k, q0, q0 + 18); return [n, +y.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0).toFixed(2)]; })),
    axis: Math.round(frontal), taxis: Math.round(taxis),
    T: Object.fromEntries(['I', 'II', 'aVR', 'V1', 'V2', 'V4', 'V6'].map(n => [n, +tw[LH.LEADS.indexOf(n)].toFixed(2)])),
    vmaxFrontal: Math.round(Math.atan2(-vm[1], vm[0]) * 180 / Math.PI), vmaxHoriz: Math.round(Math.atan2(-vm[2], vm[0]) * 180 / Math.PI),
    vmaxT: bi - q0, initRatio: +(im / best).toFixed(2),
  };
  if (verbose) {
    console.log(JSON.stringify(r));
    console.log('lead  R/S/T/P: ' + ampl.map(([n, mx, mn], k) => `${n} ${mx.toFixed(2)}/${mn.toFixed(2)}/${tw[k].toFixed(2)}/${pw[k].toFixed(2)}`).join('  '));
  }
  return r;
}
module.exports = evaluate;
if (require.main === module) evaluate(params, true);
