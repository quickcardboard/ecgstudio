// Activation geometry per LV region (normal sinus beat): endo/mid/epi activation times, share of
// cells whose local propagation is mainly transmural, and the mean propagation direction (torso frame:
// X left, Y superior, Z anterior). With a site, the cells that die in that old infarct are reported too.
//   node tools/actgeom.js '{params}' [site]
const fs = require('fs'); const LH = require('../src/engine.js');
const LV0 = LH.hypertrophyOptions({}).anatomy.lvWallLayers;
const JA = JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json'));
const P = JSON.parse(process.argv[2] || '{}'), SITE = process.argv[3];
const { lv = LV0, rv = 0, ...mp } = P;
const A = new LH.Anatomy(JA, { lvWallLayers: lv, rvWallLayers: rv }), M = new LH.Model(A, mp), br = M.coronary.branches, n = M.nVox;
const SITES = { mLAD: br.LAD[Math.round(br.LAD.length * 0.3)], dLAD: br.LAD[Math.round(br.LAD.length * 0.45)], PDA: br.PDA[0] };
const RN = ['sept', 'ant', 'lat', 'inf', 'apex', 'rv'], SEC = ['sept', 'ant', 'lat', 'lat', 'inf', 'sept'];
const reg = new Int8Array(n).fill(-1);
for (let c = 0; c < n; c++) {
  if (M.kind[c] !== LH.KIND.VENT) continue;
  const lab = A.label[c], z = A.zuvc[c];
  if (lab === LH.LAB.RV) reg[c] = 5;
  else if (lab === LH.LAB.LV && z >= 0) { if (z < 0.25) reg[c] = 4; else { const d = ((A.phi[c] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); reg[c] = RN.indexOf(SEC[Math.min(5, Math.floor(d / (Math.PI / 3)))]); } }
}
const S = new LH.Sim(M, { seed: 1 }); S.run(3000);
const vb = S.log.vent[S.log.vent.length - 1], on = vb.on;
const ta = Float64Array.from(S.tAct, (t) => t - on);
let dead = null;
if (SITE) { const S2 = new LH.Sim(M, { seed: 1 }); S2.addOcclusion(SITES[SITE]); S2.setIschemiaTime(720); dead = S2.blocked; }
const R = M.rot, tor = (g) => [0, 1, 2].map((d) => R[3 * d] * g[0] + R[3 * d + 1] * g[1] + R[3 * d + 2] * g[2]);
const ok = (c) => c >= 0 && M.kind[c] === LH.KIND.VENT && ta[c] >= -5 && ta[c] < 200;
function grad(F, c, valid) {
  const i = A.ii[c], j = A.jj[c], k = A.kk[c], g = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const p = A.at(i + (a === 0), j + (a === 1), k + (a === 2)), m = A.at(i - (a === 0), j - (a === 1), k - (a === 2));
    const vp = valid(p), vm = valid(m);
    g[a] = vp && vm ? (F(p) - F(m)) / 2 : vp ? F(p) - F(c) : vm ? F(c) - F(m) : 0;
  }
  return g;
}
const groups = {};
const add = (key, c) => {
  const G = groups[key] || (groups[key] = { n: 0, t: [[0, 0], [0, 0], [0, 0]], trans: 0, nd: 0, dir: [0, 0, 0], tmd: [0, 0, 0] });
  G.n++; const tm = A.tm[c], L = tm < 0.34 ? 0 : tm < 0.67 ? 1 : 2; G.t[L][0] += ta[c]; G.t[L][1]++;
  const gt = grad((x) => ta[x], c, ok), gm = grad((x) => A.tm[x], c, (x) => x >= 0 && A.tm[x] >= 0);
  const lt = Math.hypot(...gt), lm = Math.hypot(...gm);
  if (lt > 1e-6 && lm > 0.02) {
    const cos = (gt[0] * gm[0] + gt[1] * gm[1] + gt[2] * gm[2]) / (lt * lm);
    G.nd++; if (cos > 0.7) G.trans++;
    const u = tor(gt.map((v) => v / lt)), w = tor(gm.map((v) => v / lm));
    for (let d = 0; d < 3; d++) { G.dir[d] += u[d]; G.tmd[d] += w[d]; }
  }
};
for (let c = 0; c < n; c++) {
  if (reg[c] < 0 || !ok(c)) continue;
  add(RN[reg[c]], c);
  if (dead && dead[c]) add('DEAD ' + RN[reg[c]], c);
}
const f = (x) => (x >= 0 ? ' ' : '') + x.toFixed(2);
console.log(`params ${JSON.stringify(P)}${SITE ? '  dead cells of ' + SITE : ''}   (times ms from QRS onset; dir = mean unit propagation direction, out = mean outward wall direction, torso X left Y sup Z ant)`);
console.log('group        cells  endo   mid   epi  transmural%   dir X  Y  Z          out X  Y  Z');
for (const [k, G] of Object.entries(groups)) {
  const t = G.t.map(([s, c]) => (c ? (s / c).toFixed(0) : '-').padStart(5)), dl = Math.hypot(...G.dir) / G.nd;
  console.log(k.padEnd(12) + String(G.n).padStart(6) + t.join(' ') + String(Math.round(100 * G.trans / Math.max(1, G.nd))).padStart(9) + '%    ' +
    G.dir.map((v) => f(v / G.nd)).join(' ') + `  |${dl.toFixed(2)}|   ` + G.tmd.map((v) => f(v / G.nd)).join(' '));
}
