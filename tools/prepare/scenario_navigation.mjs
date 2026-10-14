// Use the authored foreground floor and the placed stall geometry for walking.
// Far-background floors and visual scatter must not create stacked Recast floors.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/functions';
import * as THREE from 'three';
import { init, exportNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { generateTiledNavMesh } from '@recast-navigation/generators';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc=await io.read('/tmp/kova-market-collision.glb');
const P=[],I=[];
const obstacles=doc.getRoot().listNodes().filter(n=>/^(stall\.|table\.)/.test(n.getName())).map(n=>getBounds(n));
for(const node of doc.getRoot().listNodes()){
 if(!node.getMesh() || node.getName()!=='Floor_main')continue;
 const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());
 for(const prim of node.getMesh().listPrimitives()){
  const a=prim.getAttribute('POSITION'),idx=prim.getIndices(),offset=P.length/3;
  for(let i=0;i<a.getCount();i++)P.push(...new THREE.Vector3(...a.getElement(i,[])).applyMatrix4(matrix).toArray());
  for(let i=0;i<idx.getCount();i+=3){
    const ids=[0,1,2].map(k=>offset+idx.getScalar(i+k));
    const x=ids.reduce((s,k)=>s+P[k*3],0)/3,z=ids.reduce((s,k)=>s+P[k*3+2],0)/3;
    // Carve the measured footprint of each real placed asset out of the
    // authored floor. Full geometry remains in the capsule/camera BVH.
    if(obstacles.some(b=>x>b.min[0]-.1&&x<b.max[0]+.1&&z>b.min[2]-.1&&z<b.max[2]+.1))continue;
    I.push(...ids);
  }
 }
}
await init();
const {success,navMesh}=generateTiledNavMesh(new Float32Array(P),new Uint32Array(I),{cs:0.15,ch:0.05,tileSize:96,walkableSlopeAngle:40,walkableHeight:36,walkableClimb:6,walkableRadius:3,minRegionArea:8,mergeRegionArea:20});
if(!success)throw new Error('Authored market navigation failed');
const q=new NavMeshQuery(navMesh);
const near=z=>{const r=q.findClosestPoint({x:0,y:0,z},{halfExtents:{x:.8,y:.4,z:.8}});if(!r.success)throw new Error(`No foreground ground at ${z}`);return r.point;};
const start=near(1),end=near(-10),route=q.computePath(start,end);
if(!route.success||!route.path.length||Math.hypot(route.path.at(-1).x-end.x,route.path.at(-1).z-end.z)>.6)throw new Error('Market passage disconnected');
fs.writeFileSync('public/content/worlds/lagos-market/navmesh.bin',exportNavMesh(navMesh));
console.log('Market foreground navigation:',route.path.length,'waypoints',P.length/3,'vertices');
