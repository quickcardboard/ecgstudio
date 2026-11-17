// Joint refit against a solved torso field (torso-v3 round 1). Score = tools/refit.js (gain recalibrated) + a limb/chest
// balance penalty (lead II R against the larger of V5/V6 R: 0.45–1.0).
//   TV2=field.json [FIX='{...}'] node tools/fullfit.js candidates.json out.jsonl
const fs = require('fs');
process.env.CAL = process.env.CAL || '1';
const FIX = process.env.FIX ? JSON.parse(process.env.FIX) : { fullTorso: true, chestTorso: true, fullTorsoCavity: true, chestGap: 25 };   // (FIX='{}': the live mixed model)
const { evaluate } = require('./refit.js');
const [inp, out] = process.argv.slice(2);
for (const c of JSON.parse(fs.readFileSync(inp))) {
  const t0 = Date.now(); let r;
  try { r = evaluate({ ...FIX, ...c }); } catch (e) { fs.appendFileSync(out, JSON.stringify({ p: c, err: String(e) }) + '\n'); continue; }
  const ratio = r.m.qrs.ratio, bal = ratio < 0.45 ? (0.45 - ratio) * 40 : ratio > 1.0 ? (ratio - 1.0) * 40 : 0;
  fs.appendFileSync(out, JSON.stringify({ p: c, score: +(r.score + bal).toFixed(2), bal: +bal.toFixed(2), ...r.m, sec: Math.round((Date.now() - t0) / 1000) }) + '\n');
}
