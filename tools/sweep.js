// node tools/sweep.js '[{...},{...}]'  — evaluate several parameter sets
const evaluate = require('./evalecg.js');
for (const p of JSON.parse(process.argv[2])) { const r = evaluate(p, false); console.log(JSON.stringify(p).padEnd(60), JSON.stringify(r)); }
