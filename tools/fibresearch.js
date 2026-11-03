// reader-scored structural search at the measured fibre ratio
const { spawn } = require('child_process'), fs = require('fs'), out = process.argv[2], N = +(process.argv[3] || 96), stage = process.argv[4] || 'blocks';
const CWD = '/home/user/ecgstudio', SC = stage === 'all' ? null : 'normal,LAFB,LPFB,LBBB,RBBB';
const sh = (args, env = {}) => new Promise((ok) => { const ch = spawn('node', args, { cwd: CWD, env: { ...process.env, ...env } }); let s = ''; ch.stdout.on('data', (d) => (s += d)); ch.on('close', () => ok(s)); });
const pick = (a, r) => a[Math.floor(r() * a.length)];
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const space = { sigmaRatio: [3, 4], purkCrossSlow: [6.8, 10, 15], cvPurkinje: [1.82, 2.3, 2.8], lafPhi: [2.75, 2.4, 2.1], lafZ: [0.54, 0.65, 0.75], lpfPhi: [-2.23, -1.9, -1.6], lpfZ: [0.29, 0.4], lpfTerrLo: [-1.54, -1.9, -2.2], heartRotation: [14, 18, 22] };
let V = [];
if (stage === 'all') V = JSON.parse(fs.readFileSync(process.argv[5])); else for (let i = 0; i < N; i++) { const p = { brody: 0 }; for (const [k, a] of Object.entries(space)) p[k] = pick(a, rnd); V.push(p); }
const res = [];
async function one(p) {
  const g = await sh(['-e', `const fs=require('fs'),LH=require('./src/engine.js');const A=new LH.Anatomy(JSON.parse(fs.readFileSync('src/anatomy.json')),{});const M=new LH.Model(A,${JSON.stringify(p)});let ok=true;for(const b of [null,'LAF','LPF']){const S=new LH.Sim(M,{seed:1});if(b)S.setBlock(b,'complete');S.run(3000);const v=S.log.vent;if(v.length<3||v.some(x=>x.last-x.on>200))ok=false;}console.log(ok?'ok':'re')`]);
  if (g.trim() !== 'ok') { res.push({ p, reentry: true }); return; }
  const fc = JSON.parse((await sh(['tools/fullcheck.js', JSON.stringify(p)], { CS_LITE: '1', NOISCH: '1' })).trim().split('\n').pop());
  const q = { ...p, ecgGain: +(0.0143 * fc.gain / 0.0192).toFixed(5) };
  const r = JSON.parse(await sh(SC ? ['tools/reader.js', 'src/engine.js', JSON.stringify(q), SC] : ['tools/reader.js', 'src/engine.js', JSON.stringify(q)], { JSON: '1' }));
  const pass = r.filter((x) => x.grade === 'pass').length, part = r.filter((x) => x.grade === 'partial').length;
  res.push({ p: q, pass, part, n: r.length, reads: Object.fromEntries(r.map((x) => [x.scen, x.grade[0] + ':' + (x.dx.filter((d) => d !== 'T inversion').join(',') || 'normal') + ' ax' + x.axis + ' qrs' + x.qrs])) });
}
(async () => { const q = [...V]; await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) await one(q.shift()); fs.writeFileSync(out, JSON.stringify(res)); })); fs.writeFileSync(out, JSON.stringify(res)); })();
