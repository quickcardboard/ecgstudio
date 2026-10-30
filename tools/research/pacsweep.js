// PAC coupling sweep: blocked / conducted / aberrant?
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const P = JSON.parse(process.argv[2] || '{}'); const M = new LH.Model(A, P);
const site = A.nearest(A.landmarks.LAA.c, (c) => A.label[c] === 3);
const out = [];
for (const dt of [20, 60, 100, 140, 180, 220, 260, 320, 400, 500]) {
  const S = new LH.Sim(M, { seed: 1 }); S.run(1700); while (!S.log.vent.some((b) => b.on > 1700)) S.step();
  const on = S.log.vent[S.log.vent.length - 1].on; while (S.t < on + dt) S.step();
  const rec = S.stimulate(site); S.run(700);
  if (!rec.captured) { out.push(`${dt}: no atrial capture`); continue; }
  const v = S.log.vent.find((b) => b.on > rec.t + 40 && b.on < rec.t + 500);
  out.push(`${dt}: ${v ? `conducted, PR ${Math.round(v.on - rec.t)}, QRS ${Math.round(v.last - v.on)}` : 'blocked in AV node'}`);
}
console.log('PAC coupled to QRS onset +ms ->', out.join(' | '));
