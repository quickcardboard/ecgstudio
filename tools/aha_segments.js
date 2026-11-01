// Coronary territories vs the AHA 17-segment typical assignment: node tools/aha_segments.js ['{params}']
// share of each AHA wall supplied by each main artery
const fs=require('fs'),LH=require(__dirname + '/../src/engine.js');const A=new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')));const M=new LH.Model(A,JSON.parse(process.argv[2]||'{}'));const C=M.coronary;
const names=['anteroseptal','anterior','anterolateral','inferolateral','inferior','inferoseptal'],AHA={anteroseptal:'LAD',anterior:'LAD',anterolateral:'LCx',inferolateral:'LCx',inferior:'RCA',inferoseptal:'RCA'};
const sec=(ph)=>{const d=((ph%(2*Math.PI))+2*Math.PI)%(2*Math.PI)*180/Math.PI;return names[Math.min(5,Math.floor(d/60))];};
const tab={};for(let c=0;c<A.n;c++){if(A.label[c]!==1||A.zuvc[c]<0)continue;const n=C.voxNode[c];if(n<0)continue;let br=C.nodes[n].branch;if(br==='PDA')br='RCA';const z=A.zuvc[c];
 const lev=z>0.67?'basal':z>0.33?'mid':z>0.1?'apical':'apex';let w=lev==='apex'?'apex':sec(A.phi[c]);if(lev==='apical')w={anteroseptal:'septal',inferoseptal:'septal',anterior:'anterior',anterolateral:'lateral',inferolateral:'lateral',inferior:'inferior'}[w];
 const k=lev+' '+w;tab[k]=tab[k]||{};tab[k][br]=(tab[k][br]||0)+1;}
const exp={...AHA,septal:'LAD',lateral:'LCx',apex:'LAD'};let agree=0,tot=0;
for(const k of Object.keys(tab)){const t=tab[k],n=Object.values(t).reduce((a,b)=>a+b,0),e=exp[k.split(' ')[1]];agree+=(t[e]||0);tot+=n;console.log(k.padEnd(22),'AHA',e.padEnd(4),'| '+Object.entries(t).sort((a,b)=>b[1]-a[1]).map(([b,v])=>b+' '+Math.round(100*v/n)+'%').join(', '));}
console.log('agreement with AHA typical (by volume):',Math.round(100*agree/tot)+'%');
