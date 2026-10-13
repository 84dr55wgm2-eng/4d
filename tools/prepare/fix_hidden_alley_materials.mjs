// Restore metre-based projection for source world-space shaders and cutout foliage.
// The Blender material bridge cannot export Generated/Object coordinates or colour ramps.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { meshopt } from '@gltf-transform/functions';
import * as THREE from 'three';
await MeshoptDecoder.ready;await MeshoptEncoder.ready;
const file=process.argv[2]??'public/content/worlds/hidden-alley/scene.glb';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const d=await io.read(file);let projected=0;
for(const m of d.getRoot().listMaterials()) {
  if(m.getName()==='Bark') m.setBaseColorFactor([0.09,0.038,0.014,1]);
  if(m.getAlphaMode()==='BLEND'&&/tree|grass|weed|leaves|chainlink|facade_objects/i.test(m.getName())) m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
}
for(const node of d.getRoot().listNodes()) {
  const mesh=node.getMesh();if(!mesh)continue;
  const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
  for(const p of mesh.listPrimitives()) {
    const material=p.getMaterial();if(!material||!/worldspace/.test(material.getName()))continue;
    const positions=p.getAttribute('POSITION'),normals=p.getAttribute('NORMAL');
    if(!positions||!normals)continue;
    const uv=new Float32Array(positions.getCount()*2);
    const v=new THREE.Vector3(),n=new THREE.Vector3();
    for(let i=0;i<positions.getCount();i++) {
      v.fromArray(positions.getElement(i,[])).applyMatrix4(matrix);
      n.fromArray(normals.getElement(i,[])).applyMatrix3(normalMatrix).normalize();
      let u,w;
      if(Math.abs(n.y)>Math.abs(n.x)&&Math.abs(n.y)>Math.abs(n.z)){u=v.x;w=v.z;}
      else if(Math.abs(n.x)>Math.abs(n.z)){u=-v.z;w=v.y;}
      else {u=v.x;w=v.y;}
      uv[i*2]=u/2;uv[i*2+1]=w/2;
    }
    p.setAttribute('TEXCOORD_0',d.createAccessor().setType('VEC2').setArray(uv).setBuffer(positions.getBuffer()));
    for(const info of [material.getBaseColorTextureInfo(),material.getNormalTextureInfo(),material.getMetallicRoughnessTextureInfo(),material.getOcclusionTextureInfo()]) if(info){info.setTexCoord(0).setWrapS(10497).setWrapT(10497);info.setExtension('KHR_texture_transform',null);}
    projected++;
  }
}
await d.transform(meshopt({encoder:MeshoptEncoder,level:'medium'}));
await io.write(file,d);console.log('Projected world-space primitives',projected);
