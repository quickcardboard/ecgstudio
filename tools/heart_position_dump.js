// heart voxels (torso frame), electrodes, torso size for one model version
const fs=require('fs'),path=require('path');const [dir,pj,out]=process.argv.slice(2);
const LH=require(path.resolve(dir,'src/engine.js'));if(process.env.RA!==undefined&&LH.setRaLayersDefault)LH.setRaLayersDefault(+process.env.RA);
const A=new LH.Anatomy(JSON.parse(fs.readFileSync(path.resolve(dir,'src/anatomy.json'))),{lvWallLayers:2,rvWallLayers:0});
const P=JSON.parse(pj);delete P.lv;delete P.rv;const M=new LH.Model(A,P);const pts=[];
for(let c=0;c<A.n;c+=2){const L=A.label[c];if(L<1||L>4)continue;const p=(L>=3&&M.toTorsoAtrial?M.toTorsoAtrial:M.toTorso)(A.p(c));pts.push([L,...p.map(v=>+v.toFixed(1))]);}
fs.writeFileSync(out,JSON.stringify({pts,el:M.electrodes,torso:M.torso||{a:P.torsoHalfWidth||160,b:P.torsoHalfDepth||110},apex:M.apex.map((v,i)=>+(v+M.offset[i]).toFixed(1)),P:{rot:M.P.heartRotation,pitch:M.P.heartPitch,yaw:M.P.heartYaw,apexX:M.P.apexX,apexY:M.P.apexY,gap:M.P.chestGap}}));
console.log(out,pts.length,JSON.stringify(M.electrodes));
