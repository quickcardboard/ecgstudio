// quick read of a model copy: normal, LAFB, LPFB, LBBB, RBBB (axis, QRS, R/S in I, II, III, aVF, V1), as rvsweep.js
const V = process.argv[2], fs = require('fs');
const LH = require(V + '/src/engine.js'); LH.setDefaultTorso(null); LH.setDefaultTorso2(require(V + '/src/torso_limb.json'));
const { read } = require(V + '/tools/reader.js');
const H = LH.hypertrophyOptions({}), A = new LH.Anatomy(JSON.parse(fs.readFileSync(V + '/src/anatomy.json')), H.anatomy), M = new LH.Model(A, { ...H.params, ...JSON.parse(process.argv[3] || '{}') });
const out = [];
for (const cs of ['none', 'LAF', 'LPF', 'LBB', 'RBB']) {
  const S = new LH.Sim(M, { seed: 1 }); if (cs !== 'none') S.setBlock(cs, 'complete');
  const r = []; S.onSample((t, v) => r.push(Array.from(v))); S.run(3600);
  const v = S.log.vent, vb = v[v.length - 2], rd = read(r, Math.round(vb.on), vb.on - v[v.length - 3].on), b = rd.interpret(), L = rd.L, mm = (n) => `${(L[n].R * 10).toFixed(0)}/${(L[n].S * 10).toFixed(0)}`;
  out.push(`${cs.padEnd(4)} axis ${String(rd.m.axis).padStart(4)}° QRS ${rd.m.qrs} R/S I ${mm('I')} II ${mm('II')} III ${mm('III')} aVF ${mm('aVF')} V1 ${mm('V1')} V5 ${mm('V5')} [${b.dx.join(', ') || 'normal'}]`);
}
console.log(out.join('\n'));
