// Record one beat of each teaching scenario for side-by-side comparison of two model versions.
//   node tools/compare.js <engine dir> '<params JSON>' <torso2 field or -> <out.json>
// (RA env: RA wall layers default, as for the other tools)
const fs = require('fs'), path = require('path');
const [dir, pj, tv2, out] = process.argv.slice(2);
const LH = require(path.resolve(dir, 'src/engine.js'));
if (process.env.RA !== undefined && LH.setRaLayersDefault) LH.setRaLayersDefault(+process.env.RA);
if (tv2 && tv2 !== '-') LH.setDefaultTorso2(require(path.resolve(tv2)));
const JA = JSON.parse(fs.readFileSync(path.resolve(dir, 'src/anatomy.json')));
const P = JSON.parse(pj || '{}'); delete P.lv; delete P.rv;
const fwd = P.forward !== undefined ? P.forward : LH.DEFAULTS.forward;
const L = LH.LEADS;
const cache = new Map();
const model = (struct = {}) => {
  const k = JSON.stringify(struct); if (cache.has(k)) return cache.get(k);
  const H = LH.hypertrophyOptions.length > 1 ? LH.hypertrophyOptions(struct, fwd) : LH.hypertrophyOptions(struct);
  const A = new LH.Anatomy(JA, H.anatomy); const M = new LH.Model(A, { ...P, ...H.params });
  cache.set(k, M); return M;
};
const scen = [
  ['Normal sinus', {}, () => {}],
  ['LAFB', {}, (S) => S.setBlock('LAF', 'complete')],
  ['LPFB', {}, (S) => S.setBlock('LPF', 'complete')],
  ['LBBB', {}, (S) => S.setBlock('LBB', 'complete')],
  ['RBBB', {}, (S) => S.setBlock('RBB', 'complete')],
  ['LVH', { lvh: true }, () => {}],
  ['RVH', { rvh: true }, () => {}],
  ['RAE + LAE', {}, (S) => S.setAtrialEnlargement({ ra: true, la: true })],
  ['WPW left lateral', {}, (S) => S.setAccessoryPathway('left-lateral')],
  ['WPW posteroseptal', {}, (S) => S.setAccessoryPathway('posteroseptal')],
  ['Proximal LAD 1 h', {}, (S, M) => { S.addOcclusion(M.coronary.branches.LAD[0]); S.setIschemiaTime(1); }],
  ['Proximal RCA 1 h', {}, (S, M) => { S.addOcclusion(M.coronary.branches.RCA[0]); S.setIschemiaTime(1); }],
  ['Proximal LCx 1 h', {}, (S, M) => { S.addOcclusion(M.coronary.branches.LCx[0]); S.setIschemiaTime(1); }],
  ['Old anterior MI (mid LAD, 30 d)', {}, (S, M) => { const b = M.coronary.branches.LAD; S.addOcclusion(b[Math.round(b.length * 0.3)]); S.setIschemiaTime(720); }],
  ['Old inferior MI (prox RCA, 30 d)', {}, (S, M) => { S.addOcclusion(M.coronary.branches.RCA[0]); S.setIschemiaTime(720); }],
];
const only = process.env.ONLY ? process.env.ONLY.split('|') : null;
const res = [];
for (const [name, struct, setup] of scen) {
  if (only && !only.includes(name)) continue;
  const M = model(struct); const S = new LH.Sim(M, { seed: 1 }); const rec = [];
  S.onSample((t, v) => rec.push(Array.from(v))); setup(S, M); S.run(2700);
  const vb = S.log.vent[S.log.vent.length - 2]; const q0 = Math.floor(vb.on), q1 = Math.ceil(vb.last) + 2;
  const t0 = q0 - 250, t1 = Math.min(rec.length, q0 + 550), base = rec[q0 - 15];
  const tr = L.map((n, k) => rec.slice(t0, t1).map((r) => +(r[k] - base[k]).toFixed(3)));
  const y = (n) => rec.slice(q0, q1).map((r) => r[L.indexOf(n)] - base[L.indexOf(n)]);
  const ar = (n) => y(n).reduce((a, v) => a + v, 0);
  const rs = Object.fromEntries(L.map((n) => { const v = y(n); return [n, [+Math.max(...v).toFixed(2), +(-Math.min(...v)).toFixed(2)]]; }));
  const st = Object.fromEntries(L.map((n, k) => [n, +(rec[q1 + 40][k] - base[k]).toFixed(2)]));
  res.push({ name, onset: q0 - t0, qrs: q1 - q0, axis: Math.round(Math.atan2(ar('aVF'), ar('I')) * 180 / Math.PI), rs, st, tr });
  console.error(name, 'QRS', q1 - q0, 'axis', res[res.length - 1].axis);
}
fs.writeFileSync(out, JSON.stringify(res));
