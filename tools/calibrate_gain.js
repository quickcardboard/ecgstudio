// usage: TV2=field.json [RA=0] node tools/calibrate_gain.js '{params}'  -> forwardGain
// forwardGain so the peak spatial QRS vector (Kors regression 12-lead -> X,Y,Z) is 1.6 mV.
// Kors et al. 1990 coefficients (written from memory: verify against the paper).
const fs=require('fs'),LH=require(__dirname + '/../src/engine.js'); LH.setDefaultTorso2(require(require('path').resolve(process.env.TV2))); if (process.env.RA !== undefined) LH.setRaLayersDefault(+process.env.RA);
const A=new LH.Anatomy(JSON.parse(fs.readFileSync(__dirname + '/../src/anatomy.json')),{lvWallLayers:2});const p=JSON.parse(process.argv[2]);delete p.lv;delete p.rv;
const M=new LH.Model(A,p);const S=new LH.Sim(M,{seed:1});const rec=[];S.onSample((t,v)=>rec.push(Array.from(v)));S.run(2700);
const vb=S.log.vent[S.log.vent.length-2],q0=Math.floor(vb.on),q1=Math.ceil(vb.last)+2,b=rec[q0-15],L=LH.LEADS,k=(n)=>L.indexOf(n);
const KX=[0.38,-0.07,-0.13,0.05,-0.01,0.14,0.06,0.54],KY=[-0.07,0.93,0.06,-0.02,-0.05,0.06,-0.17,0.13],KZ=[0.11,-0.23,-0.43,-0.06,-0.14,-0.20,-0.11,0.31];
const leads=['I','II','V1','V2','V3','V4','V5','V6'];let pk=0;
for(let t=q0;t<q1;t++){const v=leads.map(n=>rec[t][k(n)]-b[k(n)]);const x=KX.reduce((a,c,i)=>a+c*v[i],0),y=KY.reduce((a,c,i)=>a+c*v[i],0),z=KZ.reduce((a,c,i)=>a+c*v[i],0);pk=Math.max(pk,Math.hypot(x,y,z));}
console.log((1.6/pk*(p.forwardGain||1)).toFixed(4));
