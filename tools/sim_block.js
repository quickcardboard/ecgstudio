// Headless 12-lead for a block: node tools/sim_block.js <SEG|none> <ms> <out.json>
const fs = require('fs'); const LH = require('../src/engine.js');
const [seg, ms, out] = [process.argv[2], +process.argv[3], process.argv[4]];
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));
const M = new LH.Model(A); const S = new LH.Sim(M, { seed: 1 });
if (seg !== 'none') for (const c of M.csSegments[seg]) S.blocked[c] = 1;
const rec = LH.LEADS.map(() => []);
S.onSample((t, L) => { for (let i = 0; i < 12; i++) rec[i].push(+L[i].toFixed(4)); });
S.run(ms);
fs.writeFileSync(out, JSON.stringify({ leads: LH.LEADS, data: rec }));
