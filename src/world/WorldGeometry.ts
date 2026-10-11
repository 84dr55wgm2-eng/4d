import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetRecord, WorldDocument } from '../core/types';

/** Invisible exterior envelopes. The ground contains footprint holes so Recast cannot
 * mistakenly retain walkable floor underneath closed buildings. Rendered geometry stays authored. */
export function worldGeometry(doc: WorldDocument, assets: AssetRecord[], navigationOnly = false) {
  const solids = doc.entities.filter((e) => e.type === 'BUILDING').map((e) => {
    const size = assets.find((a) => a.id === e.assetId)?.bounds;
    if (!size) throw new Error(`Missing bounds for ${e.name}`);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(...e.transform.scale));
    const box = new THREE.Box3(new THREE.Vector3(-size[0] / 2, 0, -size[2] / 2), new THREE.Vector3(size[0] / 2, size[1], size[2] / 2)).applyMatrix4(matrix);
    return { size, matrix, box };
  });
  for (let i=0; i<solids.length; i++) for (let j=i+1; j<solids.length; j++) {
    const a=solids[i].box, b=solids[j].box;
    if (a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z) throw new Error('Les bâtiments se chevauchent');
  }
  const parts: THREE.BufferGeometry[] = [];
  for (const e of doc.entities) {
    const surface = e.metadata?.surface as { width: number; depth: number } | undefined;
    if (!surface) continue;
    const w = surface.width / 2, d = surface.depth / 2;
    const shape = new THREE.Shape([new THREE.Vector2(-w, -d), new THREE.Vector2(w, -d), new THREE.Vector2(w, d), new THREE.Vector2(-w, d)]);
    for (const { box } of solids) {
      if (box.min.x <= -w || box.max.x >= w || box.min.z <= -d || box.max.z >= d) throw new Error('Un bâtiment dépasse du terrain; corrige sa position');
      shape.holes.push(new THREE.Path([new THREE.Vector2(box.min.x, -box.min.z), new THREE.Vector2(box.min.x, -box.max.z), new THREE.Vector2(box.max.x, -box.max.z), new THREE.Vector2(box.max.x, -box.min.z)]));
    }
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    g.translate(...e.transform.position); g.deleteAttribute('normal'); g.deleteAttribute('uv');
    parts.push(g);
  }
  if (!navigationOnly) for (const { size, matrix } of solids) {
    const g = new THREE.BoxGeometry(...size); g.translate(0, size[1] / 2, 0); g.applyMatrix4(matrix);
    g.deleteAttribute('normal'); g.deleteAttribute('uv'); parts.push(g);
  }
  const out = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (!out) throw new Error('No walkable world surfaces');
  return out;
}
