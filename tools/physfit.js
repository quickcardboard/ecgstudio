// Joint refit under the realistic forward model: limb leads from the solved torso (limbTorso2), one
// solved field per heart tilt (TV2DIR/tv<tilt>.json), parameters drawn inside published ranges.
// Score: reader passes (+0.5 per partial) minus the axis shortfall against the criteria (per 30°).
//   TV2DIR=dir node tools/physfit.js out.json [N] [seed]      (BASE / SPACE env override)
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const out = process.argv[2], N = +(process.argv[3] || 96); let seed = +(process.argv[4] || 11);
const CWD = path.resolve(__dirname, '..'), SC = process.env.SCEN === 'all' ? null : (process.env.SCEN || 'normal,LAFB,LPFB,LBBB,RBBB'), TD = process.env.TV2DIR;
const sh = (args, env = {}) => new Promise((ok) => { const ch = spawn('node', args, { cwd: CWD, env: { ...process.env, ...env } }); let s = ''; ch.stdout.on('data', (d) => (s += d)); ch.on('close', () => ok(s)); });
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff), pick = (a) => a[Math.floor(rnd() * a.length)];
const BASE = process.env.BASE ? JSON.parse(process.env.BASE) : { limbTorso2: true, septalFascicle: true };
const space = process.env.SPACE ? JSON.parse(process.env.SPACE) : {
  heartRotation: [8, 14, 20], cvPurkinje: [1.82, 2.3, 2.8], purkCrossSlow: [1.5, 3, 6.8], purkCrossApexZ: [0, 0.4],
  fascConnectFrac: [0.3, 0.45, 0.6], lafPhi: [1.5, 1.8, 2.2, 2.75], lafZ: [0.55, 0.7, 0.85], lpfPhi: [-0.8, -1.2, -1.8, -2.23], lpfZ: [0.3, 0.4],
  lpfTerrHi: [0.56, 0.2], mbPhi: [null, 65, 55] };
// axis criteria: shortfall in degrees (0 = inside)
const AX = { normal: (a) => (a < -30 ? -30 - a : a > 90 ? a - 90 : 0), LAFB: (a) => (a > -45 ? a + 45 : 0), LPFB: (a) => (a < 90 ? 90 - a : 0),
  LBBB: () => 0, RBBB: () => 0 };   // bundle branch blocks are read on QRS width and V1/V6 shape, not the axis
const res = [];
async function one(p) {
  const env = TD ? { TV2: path.join(TD, `tv${p.heartRotation ?? 14}.json`) } : {};
  const g = await sh(['-e', `const fs=require('fs'),LH=require('./src/engine.js');if(process.env.TV2)LH.setDefaultTorso2(require(process.env.TV2));const A=new LH.Anatomy(JSON.parse(fs.readFileSync('src/anatomy.json')),{lvWallLayers:LH.hypertrophyOptions({}).anatomy.lvWallLayers});const M=new LH.Model(A,${JSON.stringify(p)});let ok=true;for(const b of [null,'LAF','LPF','LBB']){const S=new LH.Sim(M,{seed:1});if(b)S.setBlock(b,'complete');S.run(3000);const v=S.log.vent;if(v.length<3||v.some(x=>x.last-x.on>200))ok=false;}console.log(ok?'ok':'re')`], env);
  if (g.trim() !== 'ok') { res.push({ p, reentry: true, score: -99 }); return; }
  const fc = JSON.parse((await sh(['tools/fullcheck.js', JSON.stringify(p)], { ...env, CS_LITE: '1', NOISCH: '1' })).trim().split('\n').pop());
  const q = { ...p, ecgGain: +(0.0143 * fc.gain / 0.0192).toFixed(5) };
  const r = JSON.parse(await sh(SC ? ['tools/reader.js', 'src/engine.js', JSON.stringify(q), SC] : ['tools/reader.js', 'src/engine.js', JSON.stringify(q)], { ...env, JSON: '1' }));
  const pass = r.filter((x) => x.grade === 'pass').length, part = r.filter((x) => x.grade === 'partial').length;
  const short = r.reduce((s, x) => s + (AX[x.scen] ? AX[x.scen](x.axis) : 0), 0);
  res.push({ p: q, pass, part, short, score: +(pass + 0.5 * part - short / 30).toFixed(2), reads: Object.fromEntries(r.map((x) => [x.scen, x.grade[0] + ':' + (x.dx.filter((d) => d !== 'T inversion').join(',') || 'normal') + ' ax' + x.axis + ' qrs' + x.qrs])) });
}
const V = process.env.CANDS ? JSON.parse(fs.readFileSync(process.env.CANDS)) : Array.from({ length: N }, () => { const p = { ...BASE }; for (const [k, a] of Object.entries(space)) { const v = pick(a); if (v !== null) p[k] = v; } return p; });
(async () => { const q = [...V]; await Promise.all(Array.from({ length: +(process.env.PAR || 8) }, async () => { while (q.length) { await one(q.shift()); res.sort((a, b) => b.score - a.score); fs.writeFileSync(out, JSON.stringify(res)); } })); })();
