// Headless LiveHeart run: node tools/sim.js [ms] [bpm] [out.json]
const fs = require('fs');
const LH = require('../src/engine.js');
const ms = +(process.argv[2] || 3000), bpm = +(process.argv[3] || 72), out = process.argv[4];
const t0 = Date.now();
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
console.log('anatomy', A.n, 'voxels; cavities', A.cavityLabel.map((l, i) => l ? `${i}:${l}(${A.cavitySizes[i]})` : null).filter(Boolean).join(' '));
let endoCount = [0, 0, 0, 0, 0]; for (let c = 0; c < A.n; c++) for (let L = 1; L <= 4; L++) if (A.endo[c] & (1 << L)) endoCount[L]++;
console.log('endo voxels LV,RV,LA,RA', endoCount.slice(1));
const M = new LH.Model(A);
console.log('model cells', M.nCells, 'edges', M.nEdges, 'build ms', Date.now() - t0);
for (const [k, v] of Object.entries(M.csSegments)) console.log('  seg', k, v.length);
console.log('  purkinje LV/RV', M.purkLV.length, M.purkRV.length, 'bachmann', M.bachmann.length);
console.log('  offset', M.offset.map(v => v.toFixed(1)), 'apex', M.apex.map(v => v.toFixed(1)));
const S = new LH.Sim(M, { seed: 7 });
S.setRate(bpm);
const rec = LH.LEADS.map(() => []);
const vcg = [[], [], []];
S.onSample((t, L) => { for (let i = 0; i < 12; i++) rec[i].push(+L[i].toFixed(4)); for (let a = 0; a < 3; a++) vcg[a].push(+S.dipole[a].toFixed(4)); });
const t1 = Date.now(); S.run(ms); console.log('sim', ms, 'ms in', Date.now() - t1, 'ms wall');
const a = S.log.atrial, v = S.log.vent;
console.log('atrial beats', a.map(b => `${b.on.toFixed(0)}+${(b.last - b.on).toFixed(0)}`).join(' '));
console.log('vent beats  ', v.map(b => `${b.on.toFixed(0)}+${(b.last - b.on).toFixed(0)} rep${(b.repEnd - b.on).toFixed(0)}`).join(' '));
// unactivated ventricular voxels in the last beat
let never = 0, vent = 0; for (let c = 0; c < M.nVox; c++) if (M.kind[c] === LH.KIND.VENT) { vent++; if (S.tAct[c] < 0) never++; }
console.log('vent voxels never activated', never, '/', vent);
if (out) fs.writeFileSync(out, JSON.stringify({ leads: LH.LEADS, data: rec, vcg }));
