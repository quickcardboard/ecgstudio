// Combined score: ECG checklist (cstune) + activation against Durrer (acttune, weight 2).
const cs = require('./cstune.js'), act = require('./acttune.js');
function evaluate(p) { const a = cs.evaluate(p), b = act.evaluate(p); return { score: +(a.score + 2 * b.score).toFixed(2), m: { ...a.m, durrer: b.m, durrerScore: b.score } }; }
module.exports = { evaluate };
if (require.main === module) for (const p of JSON.parse(process.argv[2] || '[{}]')) console.log(JSON.stringify({ p, ...evaluate(p) }));
