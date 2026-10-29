// Anatomical long axis (mitral centre -> LV apex) in the torso frame for given heart rotation/pitch
const fs = require('fs'); const LH = require(__dirname + '/../../src/engine.js');
const A = new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../../src/anatomy.json')));
const pairs = JSON.parse(process.argv[2] || '[[0,0],[29,12]]');
for (const [rot, pitch] of pairs) {
  const M = new LH.Model(A, { heartRotation: rot, heartPitch: pitch });
  let apex = [0, 0, 0], n = 0;
  for (let c = 0; c < A.n; c++) if (A.label[c] === 1 && A.zuvc[c] >= 0 && A.zuvc[c] < 0.04 && A.epi[c]) { const p = A.p(c); apex = apex.map((v, i) => v + p[i]); n++; }
  apex = M.toTorso(apex.map((v) => v / n)); const mv = M.toTorso(A.landmarks.MV.c);
  const d = apex.map((v, i) => v - mv[i]), L = Math.hypot(...d);
  const frontal = Math.atan2(-d[1], d[0]) * 180 / Math.PI;               // degrees below horizontal, toward patient's left
  const anterior = Math.asin(d[2] / L) * 180 / Math.PI;                 // tilt toward the chest wall
  console.log(`rotation ${String(rot).padStart(3)}  pitch ${String(pitch).padStart(3)}  ->  long axis ${frontal.toFixed(0)}° below horizontal (frontal), ${anterior.toFixed(0)}° anterior tilt`);
}
