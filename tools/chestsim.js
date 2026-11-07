// V4/V5/V6 similarity per scenario (Round 47): waveform correlation over one beat, ST at J+80 and T peak (mm).
// node tools/chestsim.js   (MP='{...}' engine parameters, TORSO=<solved torso json> for the limb/chest field)
const fs=require('fs');const P=__dirname+'/../';const LH=require(P+'src/engine.js');LH.setDefaultTorso(null);LH.setDefaultTorso2(require(process.env.TORSO||(P+'src/torso_limb.json')));
const M=new LH.Model(new LH.Anatomy(JSON.parse(fs.readFileSync(P+'src/anatomy.json'))),JSON.parse(process.env.MP||'{}'));const br=M.coronary.branches,L=LH.LEADS;
const site={pLAD:br.LAD[0],mLAD:br.LAD[Math.round(br.LAD.length*0.22)],pLCx:br.LCx[0],pRCA:br.RCA[0],mRCA:br.RCA[Math.round(br.RCA.length*0.45)]};
const cases=[['normal',null,0],...Object.keys(site).flatMap(k=>[[k+' 1h',k,1],[k+' 48h',k,48],[k+' 30d',k,720]])];
let sumc=0;
for(const [name,k,h] of cases){const S=new LH.Sim(M,{seed:1});if(k){S.addOcclusion(site[k]);S.setIschemiaTime(h)}
 const rec=[];S.onSample((t,v)=>rec.push(Array.from(v)));S.run(3600);const vb=S.log.vent[S.log.vent.length-2],E=S.beatEnds(vb),q0=Math.floor(vb.on),J=Math.ceil(E.last)+6,b0=rec[q0-15];
 const tr=(n)=>{const kk=L.indexOf(n);const x=[];for(let t=q0-20;t<E.repEnd+40;t++)x.push(rec[t][kk]-b0[kk]);return x};
 const a=tr('V4'),b=tr('V5'),c=tr('V6');const corr=(x,y)=>{const mx=x.reduce((s,v)=>s+v,0)/x.length,my=y.reduce((s,v)=>s+v,0)/y.length;let sxy=0,sx=0,sy=0;for(let i=0;i<x.length;i++){sxy+=(x[i]-mx)*(y[i]-my);sx+=(x[i]-mx)**2;sy+=(y[i]-my)**2}return sxy/Math.sqrt(sx*sy)};
 const st=(x)=>(x[J-q0+20+80]*10).toFixed(1),T=(x)=>{let m=0;for(let i=J-q0+20+60;i<x.length;i++)if(Math.abs(x[i])>Math.abs(m))m=x[i];return (m*10).toFixed(1)};
 const c56=corr(b,c);sumc+=c56;
 console.log(name.padEnd(10),'corr V4-V5',corr(a,b).toFixed(2),'V5-V6',c56.toFixed(2),'| ST V4/V5/V6',st(a),st(b),st(c),'| T',T(a),T(b),T(c))}
console.log('mean V5-V6 corr',(sumc/cases.length).toFixed(3));
