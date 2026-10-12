import * as THREE from 'three';
import type { AssetRecord, Vec3, WorldDocument } from '../core/types';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { Navigation } from '../runtime/Navigation';

/** Derive runtime collision/navigation from the imported scene itself. No generated plane,
 * no rectangular building proxies, no substitution by a bundled world. Instancing is retained visually. */
export async function sceneGeometry(root: THREE.Object3D): Promise<THREE.BufferGeometry> {
  await MeshoptSimplifier.ready;
  root.updateMatrixWorld(true);
  const positions: number[] = [], indices: number[] = [];
  const vector = new THREE.Vector3(), matrix = new THREE.Matrix4();
  let triangles = 0, processed = 0;
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => { const mesh = obj as THREE.Mesh; if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(mesh); });
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.every((m) => m.transparent || m.alphaTest > 0)) continue;
    const geometry = mesh.geometry, pos = geometry.getAttribute('position');
    if (!pos) continue;
    const sourceIndex = geometry.index;
    const points = new Float32Array(pos.count * 3);
    for (let i=0; i<pos.count; i++) { points[i*3]=pos.getX(i); points[i*3+1]=pos.getY(i); points[i*3+2]=pos.getZ(i); }
    let localIndices: Uint32Array<ArrayBufferLike> = new Uint32Array(sourceIndex?.count ?? pos.count);
    for (let i=0; i<localIndices.length; i++) localIndices[i]=sourceIndex ? sourceIndex.getX(i) : i;
    if (localIndices.length > 9000) {
      const target = Math.max(3, Math.floor(localIndices.length * 0.2 / 3) * 3);
      [localIndices] = MeshoptSimplifier.simplify(localIndices, points, 3, target, 0.005, ['LockBorder']);
    }
    const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    triangles += (localIndices.length / 3) * count;
    if (triangles > 2_000_000) throw new Error('Géométrie trop lourde pour la préparation navigateur même après simplification de collision : optimise ce monde avant import');
    for (let instance=0; instance<count; instance++) {
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) { (mesh as THREE.InstancedMesh).getMatrixAt(instance, matrix); matrix.premultiply(mesh.matrixWorld); }
      else matrix.copy(mesh.matrixWorld);
      const remap = new Int32Array(pos.count).fill(-1);
      for (const oldIndex of localIndices) {
        if (remap[oldIndex] < 0) {
          remap[oldIndex] = positions.length / 3;
          vector.fromArray(points, oldIndex*3).applyMatrix4(matrix); positions.push(vector.x, vector.y, vector.z);
        }
        indices.push(remap[oldIndex]);
      }
    }
    if (++processed % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!indices.length) throw new Error('Le fichier ne contient aucune géométrie solide exploitable');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  if (size.x > 500 || size.z > 500) throw new Error('Import navigateur limité à un secteur de 500 m. Prépare des secteurs séparés pour un monde plus grand.');
  return geometry;
}

export function sceneSpawn(nav: Navigation, bounds: THREE.Box3, preferred?: Vec3): Vec3 {
  if (preferred) { const p = nav.closest(new THREE.Vector3(...preferred)); if (p && p.distanceTo(new THREE.Vector3(...preferred)) < 2) return p.toArray() as Vec3; }
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  // Prefer the central ground, then sample the whole authored footprint. No origin=ground assumption.
  for (const y of [bounds.min.y + 0.2, center.y]) {
    for (const radius of [0, 0.15, 0.3, 0.45]) for (let i=0; i<(radius ? 12 : 1); i++) {
      const angle = i * Math.PI / 6;
      const p = nav.closest(new THREE.Vector3(center.x + Math.cos(angle)*size.x*radius, y, center.z + Math.sin(angle)*size.z*radius));
      if (!p) continue;
      // Verify enough connected space for a human, not only a tabletop or a tiny isolated island.
      for (const dx of [-1.2, 1.2]) {
        const q = p.clone().add(new THREE.Vector3(dx, 0, 0));
        const path = nav.path(p, q);
        if (path && path[path.length-1].distanceTo(p) > 0.8) return p.toArray() as Vec3;
      }
    }
  }
  throw new Error('Aucun espace praticable pour le personnage. Il faut un monde avec un sol accessible, pas seulement un objet ou une façade.');
}

export function importedDocument(record: AssetRecord, baseline: WorldDocument, bounds: THREE.Box3, spawn: Vec3, triangleCount: number): WorldDocument {
  const actor = structuredClone(baseline.entities.find((e) => e.type === 'ACTOR'));
  if (!actor) throw new Error('Acteur de référence absent');
  actor.transform = {position: [...spawn], rotation: [0,0,0,1], scale:[1,1,1]};
  const box = [bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z] as [number,number,number,number];
  const cells: NonNullable<WorldDocument['imported']>['cells'] = [];
  for (let x=box[0]; x<box[2]; x+=20) for(let z=box[1]; z<box[3]; z+=20) cells.push({id:`cell.${Math.floor(x/20)}.${Math.floor(z/20)}`,bounds:[x,z,Math.min(x+20,box[2]),Math.min(z+20,box[3])],dependencies:[record.id]});
  return {format:'cws-world', version:2, id:`world.${crypto.randomUUID()}`, name:record.name,
    environment:{...structuredClone(baseline.environment),assetId:record.id,collision:undefined,navmesh:undefined},
    imported:{sourceAssetId:record.id,sourceUrl:record.sourceUrl,license:record.license,triangleCount,bounds:box,cells},
    spawn:{position:spawn,heading:0}, zones:[{id:'zone.imported',name:record.name,kind:'street',bounds:box,tags:['authored','imported']}],
    entities:[actor], shots:[], worldState:{timeOfDay:baseline.worldState.timeOfDay}};
}
