// Source of the cells that die in an old infarct (normal beat), split into the component along the
// local wall normal (transmural) and the tangential rest: net vectors (torso frame, arbitrary units,
// isotropic −∇Vm per pair) over QRS windows, and the electrode geometry of that tissue.
//   node tools/srcsplit.js '{params}' [site=dLAD]
const fs = require('fs'); const LH = require('../src/engine.js');
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const P = JSON.parse(process.argv[2] || '{}'), SITE = process.argv[3] || 'dLAD'; const { lv = 3, rv = 0, ...mp } = P;
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), n = M.nVox, br = M.coronary.branches;
const SITES = { mLAD: br.LAD[Math.round(br.LAD.length * 0.3)], dLAD: br.LAD[Math.round(br.LAD.length * 0.45)] };
const RN = ['sept', 'ant', 'lat', 'lat', 'inf', 'sept'];
const region = (c) => { if (A.label[c] !== LH.LAB.LV || A.zuvc[c] < 0) return null; if (A.zuvc[c] < 0.25) return 'apex'; const d = ((A.phi[c] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return RN[Math.min(5, Math.floor(d / (Math.PI / 3)))]; };
const S2 = new LH.Sim(M, { seed: 1 }); S2.addOcclusion(SITES[SITE]); S2.setIschemiaTime(720);
const R = M.rot, tor = (g) => [0, 1, 2].map((d) => R[3 * d] * g[0] + R[3 * d + 1] * g[1] + R[3 * d + 2] * g[2]);
const nrm = new Float32Array(3 * n), grp = new Array(n).fill(null);
for (let c = 0; c < n; c++) {
  if (M.kind[c] !== LH.KIND.VENT || !S2.blocked[c]) continue; const r = region(c); if (r !== 'ant' && r !== 'apex') continue;
  const i = A.ii[c], j = A.jj[c], k = A.kk[c], g = [0, 0, 0];
  for (let a = 0; a < 3; a++) { const p = A.at(i + (a === 0), j + (a === 1), k + (a === 2)), m = A.at(i - (a === 0), j - (a === 1), k - (a === 2));
    const tp = p >= 0 && A.tm[p] >= 0 ? A.tm[p] : null, tq = m >= 0 && A.tm[m] >= 0 ? A.tm[m] : null;
    g[a] = tp !== null && tq !== null ? (tp - tq) / 2 : tp !== null ? tp - A.tm[c] : tq !== null ? A.tm[c] - tq : 0; }
  const l = Math.hypot(...g); if (l < 0.03) continue; const u = tor(g.map((v) => v / l)); nrm.set(u, 3 * c); grp[c] = r;
}
// geometry: mean outward normal, centroid, direction/distance to V2-V4
const geo = {};
for (let c = 0; c < n; c++) { if (!grp[c]) continue; const G = geo[grp[c]] || (geo[grp[c]] = { n: 0, nn: [0, 0, 0], p: [0, 0, 0] }); G.n++; const p = M.toTorso(A.p(c)); for (let d = 0; d < 3; d++) { G.nn[d] += nrm[3 * c + d]; G.p[d] += p[d]; } }
const f = (x) => (x >= 0 ? ' ' : '') + x.toFixed(2), unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
for (const [r, G] of Object.entries(geo)) {
  const c = G.p.map((v) => v / G.n), nn = unit(G.nn);
  console.log(`${r}: ${G.n} dead cells, mean outward normal ${nn.map(f).join(' ')} (|mean| ${(Math.hypot(...G.nn) / G.n).toFixed(2)}: 1 = flat patch, 0 = closed cup)`);
  for (const e of ['V2', 'V3', 'V4']) { const v = M.electrodes[e].map((x, d) => x - c[d]), dist = Math.hypot(...v); console.log(`   to ${e}: ${dist.toFixed(0)} mm, cos(normal, direction) ${(nn[0] * v[0] / dist + nn[1] * v[1] / dist + nn[2] * v[2] / dist).toFixed(2)}`); }
}
// normal beat: per pair source s = −(Vm_w − Vm_c)·ex, split along the pair-average normal
const S = new LH.Sim(M, { seed: 1 }); S.run(3000); const on = S.log.vent[S.log.vent.length - 1].on;
const S3 = new LH.Sim(M, { seed: 1 }); S3.run(on - 1 - 0.0); // replay to the beat
const acc = {}, axes = [0, 1, 2].map((j) => [R[j], R[3 + j], R[6 + j]]);
for (let t = Math.ceil(on); t < on + 70; t++) {
  S3.step(); const T = S3.t, w5 = Math.floor((T - on) / 10) * 10;
  for (let c = 0; c < n; c++) {
    if (!grp[c]) continue; const i = A.ii[c], j = A.jj[c], k = A.kk[c];
    for (let a = 0; a < 3; a++) {
      const w = A.at(i + (a === 0), j + (a === 1), k + (a === 2)); if (w < 0 || !grp[w] || grp[w] !== grp[c]) continue;
      const dv = (S3.vm(w, T) - S3.vRest[w]) - (S3.vm(c, T) - S3.vRest[c]); if (!dv) continue;
      const nn = unit([nrm[3 * c] + nrm[3 * w], nrm[3 * c + 1] + nrm[3 * w + 1], nrm[3 * c + 2] + nrm[3 * w + 2]]), ex = axes[a], s = ex.map((x) => -dv * x);
      const sn = s[0] * nn[0] + s[1] * nn[1] + s[2] * nn[2], key = grp[c] + ' ' + w5;
      const G = acc[key] || (acc[key] = { N: [0, 0, 0], T: [0, 0, 0], nOut: 0 });
      for (let d = 0; d < 3; d++) { G.N[d] += sn * nn[d]; G.T[d] += s[d] - sn * nn[d]; } G.nOut += sn;
    }
  }
}
console.log('\nwindow (ms)    transmural part: net vector, |net|, signed sum along outward      tangential part: net vector, |net|');
for (const [k, G] of Object.entries(acc)) console.log(k.padEnd(10) + '  N ' + G.N.map((v) => f(v / 1e3)).join(' ') + '  |' + (Math.hypot(...G.N) / 1e3).toFixed(2) + '|  out ' + f(G.nOut / 1e3) + '     T ' + G.T.map((v) => f(v / 1e3)).join(' ') + '  |' + (Math.hypot(...G.T) / 1e3).toFixed(2) + '|');
