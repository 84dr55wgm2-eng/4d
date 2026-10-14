// Assemble an authored environment and Blender-prepared content. Baking sees the
// same transforms as the product; stalls cannot silently disappear from navigation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, mergeDocuments, getBounds, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
const prepared = process.argv[2] ?? '/tmp/kova-prepared';
const raw = process.argv[3] ?? '/tmp/kova-scenario-input';
const dir = 'public/content/worlds/lagos-market';
await fs.mkdir(dir,{recursive:true});
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const measured = {};
for (const name of ['civilian','civilian-olive','civilian-rust','market-stall','market-sign','table']) {
  const doc = await io.read(name==='table' ? path.join(raw,'table.gltf') : path.join(prepared,name+'.glb'));
  const scene=doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if(name.startsWith('civilian')){
    // getBounds() does not evaluate skinning. Mixamo's mesh positions and rig
    // use different bind-space scales; a static AABB would inflate the actor.
    measured[name]={min:[-0.4,0,-0.3],max:[0.4,1.7,0.3],height:1.7};
    await doc.transform(textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:88}),meshopt({encoder:MeshoptEncoder,level:'medium'}));
    await io.write(path.join(dir,name+'.glb'),doc);
    continue;
  }
  const b=getBounds(scene), c=[(b.min[0]+b.max[0])/2,b.min[1],(b.min[2]+b.max[2])/2];
  const origin=doc.createNode('NormalizedOrigin').setTranslation(c.map(x=>-x));
  for(const n of scene.listChildren()){scene.removeChild(n);origin.addChild(n);}
  scene.addChild(origin);
  const height=b.max[1]-b.min[1];
  const scale=name==='civilian'?1.7/height:1;
  const wrapper=doc.createNode('Metres').setScale([scale,scale,scale]);scene.removeChild(origin);wrapper.addChild(origin);scene.addChild(wrapper);
  measured[name]={min:b.min.map((x,i)=>(x-c[i])*scale),max:b.max.map((x,i)=>(x-c[i])*scale),height:height*scale};
  await doc.transform(dedup(),prune(),textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:88}),meshopt({encoder:MeshoptEncoder,level:'medium'}));
  await io.write(path.join(dir,name+'.glb'),doc);
}
const manifest=JSON.parse(await fs.readFile('public/content/manifest.json','utf8'));
const base=JSON.parse(await fs.readFile('public/content/worlds/hidden-alley/world.json','utf8'));
const entities=[];
const e=(id,type,name,assetId,p,yaw=0,scale=[1,1,1],caps=['selectable'])=>({id,type,name,assetId,transform:{position:p,rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],scale},tags:['market','authored'],capabilities:caps});
const placements=[[-3.1,0,-3,Math.PI/2],[3.1,0,-7,-Math.PI/2],[-3.1,0,-11,Math.PI/2]];
placements.forEach(([x,y,z,yaw],i)=>{
 const stall=e(`stall.${i}`,'FURNITURE',`Étal ${i+1}`,'market.stall',[x,y,z],yaw);stall.locked=true;entities.push(stall);
 const sign=e(`sign.${i}`,'PROP','Enseigne du marché','market.sign',[x,y+2.5,z],yaw);sign.locked=true;entities.push(sign);
 for(let j=0;j<3;j++){
  const p=[x-Math.sin(yaw)*0.35,y+1.05,z+(j-1)*0.55];
  const crate=e(`goods.${i}.${j}`,'PROP','Caisse de légumes','lagos.crate3',p,0,[0.8,0.8,0.8]);entities.push(crate);
  for(let k=0;k<4;k++)entities.push(e(`food.${i}.${j}.${k}`,'PROP','Produits frais',k%2?'lagos.sweet_potato':'lagos.onion',[p[0]+(k%2)*0.09-0.05,p[1]+0.20,p[2]+Math.floor(k/2)*0.09],0,[1.4,1.4,1.4]));
 }
});
entities.push(e('table.0','FURNITURE','Table de vente','market.table',[2.8,0,-3],0,[1,1,1]));
const actor=e('performer','ACTOR','Interprète civil','market.civilian',[0,0,1],Math.PI,[1,1,1],['selectable','directable']);entities.push(actor);
const people=[[-0.9,0,-2],[1,0,-4],[-0.5,0,-6],[1.2,0,-9],[-1.2,0,-10],[0.8,0,-1]];
people.forEach((p,i)=>{
 const person=e(`person.${i}`,'ACTOR',`Passante ${i+1}`,['market.civilian','market.civilian-olive','market.civilian-rust'][i%3],p,0,[1,1+(i%3-1)*0.035,1],['selectable','directable']);
 person.metadata={procedural:{kind:'sim'},sim:{kind:'person',behavior:'wander',home:''}};entities.push(person);
});
entities.push(e('radio.0','PROP','Radio du marché','lagos.transceiver',[2.8,0.82,-3],0,[1,1,1],['selectable','interactable','pickable']));
const assets=[
 ['civilian','market.civilian','Interprète civil animé','CHARACTERS','ACTOR','Adobe Mixamo, via three.js examples','https://github.com/mrdoob/three.js/tree/5d8e8a89347650ee210e120cdd70f9e9288f0abc/examples/models/gltf','LicenseRef-Mixamo'],
 ['market-stall','market.stall','Étal adapté dans Blender','FURNITURE','FURNITURE','BlenderKit, Japanese/Korean Food Stall','https://www.blendkit.com/asset-gallery-detail/cff796e6-57fb-4260-b241-be5d1f8fa13d/','LicenseRef-BlenderKit-RoyaltyFree'],
 ['market-sign','market.sign','Enseigne du marché','PROPS','PROP','KOVA, prepared with Scenario MIT toolkit','https://github.com/scenario-labs/skills','CC0-1.0'],
 ['table','market.table','Table en bois','FURNITURE','FURNITURE','Poly Haven','https://polyhaven.com/a/wooden_table_02','CC0-1.0']
];
for(const variant of ['olive','rust'])assets.push([`civilian-${variant}`,`market.civilian-${variant}`,`Interprète — tenue ${variant}`,'CHARACTERS','ACTOR',assets[0][5],assets[0][6],assets[0][7]]);
for(const [file,id,name,category,entityType,source,sourceUrl,license] of assets){
 const record={id,name,category,entityType,source,sourceUrl,url:`content/worlds/lagos-market/${file}.glb`,format:'glb',bytes:(await fs.stat(`${dir}/${file}.glb`)).size,license:{id:license,verified:true,notes:'Used in the interactive scene; not a standalone asset distribution service.'},tags:['market','blender','scenario'],footprint:{min:measured[file].min,max:measured[file].max}};
 if(file.startsWith('civilian')){record.runtime={embeddedClips:true};record.scale={unitsToMetres:1,targetHeight:1.7};}
 manifest.assets=manifest.assets.filter(a=>a.id!==id);manifest.assets.push(record);
}
const world={...base,id:'lagos-market',name:'Lagos — marché / essai Scenario',revision:'scenario-market-1',
 environment:{...base.environment,collision:'content/worlds/lagos-market/collision.json',navmesh:'content/worlds/lagos-market/navmesh.bin',sun:{azimuth:145,elevation:48,intensity:2.5},exposure:0.95},
 entities,spawn:{position:[0,0,1],heading:Math.PI},shots:[
 {id:'market.overview',name:'Le marché',position:[0,2.2,6],target:[0,1.3,-7],focalLength:24},
 {id:'market.stall',name:'Les étals',position:[0.3,1.8,-1],target:[-3.1,1.3,-5],focalLength:28},
 {id:'market.deep',name:'La traversée',position:[1,2,-12],target:[0,1.3,0],focalLength:28}],
 sequences:[],worldState:{timeOfDay:'day',openingShot:true,brief:'Marché de quartier à Lagos, piétons et étals',preparation:'Scenario Blender offline toolkit + 3D Asset Server'}};
await fs.writeFile(`${dir}/world.json`,JSON.stringify(world,null,1));
manifest.worlds=manifest.worlds.filter(w=>w.id!==world.id);manifest.worlds.push({id:world.id,name:world.name,url:`content/worlds/${world.id}/world.json`});
manifest.version=manifest.version.replace(/-scenario-market-\d+$/,'')+'-scenario-market-1';
await fs.writeFile('public/content/manifest.json',JSON.stringify(manifest,null,1));
await fs.copyFile(path.join(prepared,'blender-report.json'),`${dir}/blender-report.json`);
try{await fs.copyFile(path.join(raw,'acquisition.json'),`${dir}/acquisition.json`);}catch{}
await fs.writeFile(`${dir}/provenance.json`,JSON.stringify({toolkit:'scenario-labs/skills',toolkitCommit:'907764d4490920a913b60947f9b673359b7a002e',blender:'5.2.1',environment:'Poly Haven Hidden Alley, CC0, reused authored shell',assets:assets.map(a=>({id:a[1],source:a[6],license:a[7]})),limitations:['Adapted fictional market; not a reconstruction of Lagos','Six crowd members share one civilian mesh and rig','No Scenario paid generation used','No live language model connected'],measured},null,2));
// Build collision-only combined content. The visible product keeps each prop
// selectable; static stall geometry also participates in collision and routing.
const combined=await io.read('public/content/worlds/hidden-alley/scene.glb');
const scene=combined.getRoot().getDefaultScene()??combined.getRoot().listScenes()[0];
for(const ent of entities.filter(e=>e.assetId==='market.stall'||e.assetId==='market.table')){
 const rec=manifest.assets.find(a=>a.id===ent.assetId);const d=await io.read('public/'+rec.url);
 const map=mergeDocuments(combined,d);const sourceScene=d.getRoot().getDefaultScene()??d.getRoot().listScenes()[0];
 const imported=map.get(sourceScene);const holder=combined.createNode(ent.id).setTranslation(ent.transform.position).setRotation(ent.transform.rotation).setScale(ent.transform.scale);
 for(const n of imported.listChildren()){imported.removeChild(n);holder.addChild(n);}scene.addChild(holder);imported.dispose();
}
await combined.transform(unpartition(),meshopt({encoder:MeshoptEncoder,level:'medium'}));
await io.write('/tmp/kova-market-collision.glb',combined);
console.log('Prepared',world.id,entities.length,'entities',measured);
