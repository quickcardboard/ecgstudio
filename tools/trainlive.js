// Gate audit for the live training generator (src/training_gen.js): builds N random scenarios across
// the rating range and reports how often each rhythm and abnormality passes the blind read, and why
// the others were rejected.   node tools/trainlive.js [N=40] [seed=1]
const fs = require('fs'), path = require('path');
const LH = require('../src/engine.js');
if (!process.env.NODE_TORSO) { LH.setDefaultTorso(null); LH.setDefaultTorso2(require('../src/torso_limb.json')); }   // as in the app
const TrainGen = require('../src/training_gen.js'), { read } = require('./reader.js'), { readRhythm } = require('./rhythmread.js');
const JA = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/anatomy.json')));
const G = TrainGen(LH, { read, readRhythm }, JA);
const N = +(process.argv[2] || 40), rand = LH.rng(+(process.argv[3] || 1));
const stat = {}, add = (k, ok) => { const s = stat[k] || (stat[k] = { n: 0, ok: 0 }); s.n++; if (ok) s.ok++; };
const stages = {}, pairs = {};
let pass = 0, agree = 0; const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const rec = TrainGen.sample(rand, 1200 + rand() * 900), t = Date.now(), res = G.build(rec);
  const name = [rec.rhythm, ...rec.abn.map((a) => a.k + (a.site ? `(${a.site})` : ''))].join(' + ');
  console.log(`${res.ok ? 'pass' : 'FAIL'} ${String(Date.now() - t).padStart(5)} ms  ${name}${res.ok ? `  [key ${res.item.key.rhythm}; ${res.item.key.findings.map((f) => f.id + (f.regions ? ':' + f.regions : '')).join(', ')}; opt ${res.item.key.optional.join(',')}; rhythm reader: ${res.item.read.rhythm}]` : `  — ${res.stage}: ${res.why}`}`);
  if (res.ok) { pass++; if (TrainGen.RHYTHMS[rec.rhythm].read(res.item.read.rhythm)) agree++; } else stages[res.stage] = (stages[res.stage] || 0) + 1;
  add('rhythm ' + rec.rhythm, res.ok); for (const a of rec.abn) add(a.k, res.ok); add(`${rec.abn.length} abnormalities`, res.ok);
  const ks = rec.abn.map((a) => a.k).sort();
  for (let x = 0; x < ks.length; x++) for (let y = x + 1; y < ks.length; y++) { const k = `${ks[x]} + ${ks[y]}`, s = pairs[k] || (pairs[k] = { n: 0, ok: 0 }); s.n++; if (res.ok) s.ok++; }
}
console.log(`\n${pass}/${N} passed, ${Math.round((Date.now() - t0) / N)} ms per scenario; blind rhythm reader agreed on ${agree}/${pass} passed ECGs`);
console.log('rejected at:', JSON.stringify(stages));
for (const [k, s] of Object.entries(stat).sort()) console.log(`  ${k.padEnd(22)} ${s.ok}/${s.n}`);
console.log('\npairs of abnormalities (passed/tried):');
for (const [k, s] of Object.entries(pairs).sort()) console.log(`  ${k.padEnd(22)} ${s.ok}/${s.n}`);
