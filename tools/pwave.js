// P-wave measurements: node tools/pwave.js '<sim setup JSON>'  e.g. '{"atria":{"ra":true}}'
// Prints P duration, peak amplitudes and notching in II, V1 positive/negative parts (mV, ms).
const fs = require('fs'); const LH = require('../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A, { ecgHighpass: 0 });
function pwave(setup) {
  const P0 = Object.assign({}, M.P); Object.assign(M.P, setup.P || {});
  const S = new LH.Sim(M, { seed: 1 }); S.setRate(72);
  if (setup.atria) S.setAtrialEnlargement(setup.atria);
  const rec = []; S.onSample((t, L) => rec.push(Array.from(L))); S.run(3000);
  const ab = S.log.atrial[S.log.atrial.length - 2], vb = S.log.vent.find((v) => v.on > ab.on);
  const t0 = Math.floor(ab.on), base = rec[t0 - 5], k = (n) => LH.LEADS.indexOf(n);
  // P ends when all leads are back within 0.01 mV of baseline after the last atrial activation + repolarisation of the front
  let t1 = Math.ceil(ab.last); while (t1 < vb.on && LH.LEADS.some((n) => Math.abs(rec[t1][k(n)] - base[k(n)]) > 0.015)) t1++;
  const seg = (n) => rec.slice(t0, t1).map((r) => r[k(n)] - base[k(n)]);
  const II = seg('II'), V1 = seg('V1');
  const peaks = []; for (let i = 2; i < II.length - 2; i++) if (II[i] > II[i - 1] && II[i] >= II[i + 1] && II[i] > 0.05) peaks.push(i);
  const notch = peaks.length > 1 ? peaks[peaks.length - 1] - peaks[0] : 0;
  const v1neg = V1.filter((v) => v < 0), v1negArea = -v1neg.reduce((a, b) => a + b, 0);
  Object.assign(M.P, P0);
  if (process.env.DUMP) (global.dump = global.dump || []).push({ name: JSON.stringify(setup.atria || {}) + JSON.stringify(setup.P || {}), II: rec.slice(t0 - 20, t0 + 300).map((r) => r[k('II')] - base[k('II')]), V1: rec.slice(t0 - 20, t0 + 300).map((r) => r[k('V1')] - base[k('V1')]) });
  return { Pdur: t1 - t0, activation: Math.round(ab.last - ab.on), PII: +Math.max(...II).toFixed(3), notchMs: notch, V1pos: +Math.max(0, ...V1).toFixed(3), V1neg: +Math.min(0, ...V1).toFixed(3), V1negArea_mVms: +v1negArea.toFixed(1), PR: Math.round(vb.on - ab.on) };
}
const arg = process.argv[2] ? JSON.parse(process.argv[2]) : [{}];
for (const s of Array.isArray(arg) ? arg : [arg]) console.log(JSON.stringify(s), JSON.stringify(pwave(s)));
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(global.dump));
