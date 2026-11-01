// LV activation in LBBB by AHA segment (endocardium and epicardium), for
// comparison with endocardial mapping (Vassallo 1984; Auricchio 2004: septal
// breakthrough, a U-shaped wavefront around a functional line of block between
// septum and lateral wall, latest activation lateral/posterolateral).
//   node tools/lbbbmap.js '{params}' [block=LBB]
const fs = require('fs'); const LH = require('../src/engine.js'); if (process.env.RA !== undefined) LH.setRaLayersDefault(+process.env.RA);
const p = JSON.parse(process.argv[2] || '{}'); const { lv = 2, rv = 0, ...mp } = p; const blk = process.argv[3] || 'LBB';
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')), { lvWallLayers: lv, rvWallLayers: rv });
const M = new LH.Model(A, mp);
const S = new LH.Sim(M, { seed: 1 }); if (blk !== 'N') S.setBlock(blk, 'complete'); S.run(1700);
const v = S.log.vent[S.log.vent.length - 1], t0 = v.on;
const names = ['anteroseptal', 'anterior', 'anterolateral', 'inferolateral', 'inferior', 'inferoseptal'];
const sec = (ph) => { const d = ((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 180 / Math.PI; return names[Math.min(5, Math.floor(d / 60))]; };
const seg = (c) => { const z = A.zuvc[c]; const lev = z > 0.67 ? 'basal' : z > 0.33 ? 'mid' : z > 0.1 ? 'apical' : 'apex'; if (lev === 'apex') return 'apex'; let w = sec(A.phi[c]);
  if (lev === 'apical') w = { anteroseptal: 'septal', inferoseptal: 'septal', anterior: 'anterior', anterolateral: 'lateral', inferolateral: 'lateral', inferior: 'inferior' }[w]; return lev + ' ' + w; };
const g = {}; const add = (k, t) => (g[k] = g[k] || []).push(t);
let first = null;
for (let c = 0; c < A.n; c++) {
  if (A.label[c] !== 1 || A.zuvc[c] < 0) continue;
  const t = S.tAct[c] - t0; if (!(t > -5 && t < 250)) continue;
  const lvFace = !!(A.endo[c] & 2), rvFace = !!(A.endo[c] & 4);
  const endo = (A.tm[c] >= 0 && A.tm[c] < 0.15 && !rvFace) || lvFace, epi = A.tm[c] > 0.85 && !rvFace;
  const k = seg(c);
  if (endo) { add(k + '|endo', t); if (!first || t < first.t) first = { t, k }; }
  if (epi) add(k + '|epi', t);
}
const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
const order = ['basal', 'mid', 'apical'].flatMap((l) => (l === 'apical' ? ['septal', 'anterior', 'lateral', 'inferior'] : names).map((w) => l + ' ' + w)).concat(['apex']);
console.log(`${blk}: QRS ${Math.round(v.last - t0)} ms; first LV endocardium ${first.k} at ${Math.round(first.t)} ms`);
console.log('segment'.padEnd(22), 'endo', ' epi');
const rows = [];
for (const k of order) { const e = g[k + '|endo'], p2 = g[k + '|epi']; if (!e && !p2) continue; const te = e ? Math.round(med(e)) : NaN, tp = p2 ? Math.round(med(p2)) : NaN; rows.push([k, te, tp]); console.log(k.padEnd(22), String(te).padStart(4), String(tp).padStart(5)); }
const late = rows.filter((r) => !isNaN(r[1])).sort((a, b) => b[1] - a[1]).slice(0, 3).map((r) => r[0] + ' ' + r[1]);
console.log('latest endocardial segments:', late.join(', '));
