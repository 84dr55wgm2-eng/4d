// Bake runtime acceleration data for a prepared world GLB:
//   <out>/collision.bin + collision.json  (serialized three-mesh-bvh, pattern from claude-of-duty .tools/bake_collision_bvh.mjs)
//   <out>/navmesh.bin                      (Recast solo navmesh, pattern from claude-of-duty .tools/bake_navmesh.mjs)
// Usage: node tools/prepare/bake_world.mjs <world.glb> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { init, exportNavMesh } from '@recast-navigation/core';
import { generateTiledNavMesh } from '@recast-navigation/generators';

const [inp, outDir] = process.argv.slice(2);
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);

const positions = [];
const indices = [];
let skipped = 0, tinyProps = 0;
const m4 = new THREE.Matrix4(), inst = new THREE.Matrix4(), v = new THREE.Vector3();
const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
const el = [];

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  m4.fromArray(node.getWorldMatrix());
  const gi = node.getExtension('EXT_mesh_gpu_instancing');
  const matrices = [];
  if (gi) {
    const T = gi.getAttribute('TRANSLATION'), R = gi.getAttribute('ROTATION'), S = gi.getAttribute('SCALE');
    const n = (T || R || S).getCount();
    for (let i = 0; i < n; i++) {
      T ? t.fromArray(T.getElement(i, el)) : t.set(0, 0, 0);
      R ? q.fromArray(R.getElement(i, el)) : q.identity();
      S ? s.fromArray(S.getElement(i, el)) : s.set(1, 1, 1);
      matrices.push(new THREE.Matrix4().multiplyMatrices(m4, inst.compose(t, q, s)));
    }
  } else matrices.push(m4.clone());

  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    // Only solid surfaces block movement: skip alpha-tested/blended foliage cards and decals.
    if (prim.getMode() !== 4 || (mat && mat.getAlphaMode() !== 'OPAQUE')) { skipped++; continue; }
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    // Local-space source, simplified once per primitive (collision does not need visual detail).
    const lp = new Float32Array(pos.getCount() * 3);
    for (let i = 0; i < pos.getCount(); i++) { const e = pos.getElement(i, el); lp[i * 3] = e[0]; lp[i * 3 + 1] = e[1]; lp[i * 3 + 2] = e[2]; }
    let li = new Uint32Array(idx ? idx.getCount() : pos.getCount());
    for (let i = 0; i < li.length; i++) li[i] = idx ? idx.getScalar(i) : i;
    const pb = new THREE.Box3().setFromArray(lp);
    for (const M of matrices) {
      const wb = pb.clone().applyMatrix4(M);
      // small loose props (glasses, bottles, cutlery) never block a walking human
      if (wb.getSize(v).length() < 0.35) { tinyProps++; continue; }
      if (wb.min.y > 3.2 || wb.max.y < -2) continue;
      if (!li.simplified) {
        const target = Math.max(3, Math.floor(li.length * 0.3 / 3) * 3);
        const [out] = MeshoptSimplifier.simplify(li, lp, 3, target, 0.01, ['LockBorder']);
        li = out; li.simplified = true;
      }
      const base = positions.length / 3;
      for (let i = 0; i < lp.length; i += 3) {
        v.set(lp[i], lp[i + 1], lp[i + 2]).applyMatrix4(M);
        positions.push(v.x, v.y, v.z);
      }
      for (let i = 0; i < li.length; i++) indices.push(base + li[i]);
    }
  }
}

// Keep only triangles that can touch a walking human (band between ground and head height) and compact vertices.
const MIN_Y = -2.0, MAX_Y = 3.2;
const remap = new Int32Array(positions.length / 3).fill(-1);
const outP = [], outI = [];
for (let i = 0; i < indices.length; i += 3) {
  const a = indices[i], b = indices[i + 1], c = indices[i + 2];
  const ya = positions[a * 3 + 1], yb = positions[b * 3 + 1], yc = positions[c * 3 + 1];
  if (Math.min(ya, yb, yc) > MAX_Y || Math.max(ya, yb, yc) < MIN_Y) continue;
  for (const k of [a, b, c]) {
    if (remap[k] < 0) { remap[k] = outP.length / 3; outP.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]); }
    outI.push(remap[k]);
  }
}
const P = new Float32Array(outP), I = new Uint32Array(outI);
console.log(`collision source: ${P.length / 3} verts, ${I.length / 3} tris (skipped ${skipped} non-opaque primitives, ${tinyProps} tiny props)`);
fs.mkdirSync(outDir, { recursive: true });

// --- collision BVH
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
geometry.setIndex(new THREE.BufferAttribute(I, 1));
let t0 = performance.now();
const bvh = new MeshBVH(geometry, { strategy: SAH, maxDepth: 40, targetLeafSize: 12, setBoundingBox: true });
const ser = MeshBVH.serialize(bvh, { cloneBuffers: false });
const parts = [], layout = { roots: [] };
let off = 0;
const push = (arr) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); parts.push(b); const d = { byteOffset: off, byteLength: b.byteLength }; off += b.byteLength; return d; };
layout.position = { ...push(P), type: 'Float32Array' };
layout.index = { ...push(ser.index), type: ser.index.constructor.name };
for (const r of ser.roots) layout.roots.push(push(new Uint8Array(r)));
geometry.computeBoundingBox();
fs.writeFileSync(path.join(outDir, 'collision.bin'), Buffer.concat(parts));
fs.writeFileSync(path.join(outDir, 'collision.json'), JSON.stringify({
  format: 'collision-bvh-v1', binary: 'collision.bin', triangles: I.length / 3, byteLength: off,
  bounds: { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() }, layout,
}, null, 1));
console.log(`bvh ${(performance.now() - t0).toFixed(0)}ms, ${(off / 1e6).toFixed(1)}MB`);

// --- navmesh (metres; human: 1.8 m tall, 0.35 m radius, 0.35 m step)
await init();
t0 = performance.now();
const cs = 0.2, ch = 0.1;
const { success, navMesh } = generateTiledNavMesh(P, I, { tileSize: 96,
  cs, ch, walkableSlopeAngle: 40, walkableHeight: Math.ceil(1.8 / ch), walkableClimb: Math.floor(0.35 / ch),
  walkableRadius: Math.ceil(0.35 / cs), maxEdgeLen: 12 / cs, maxSimplificationError: 1.3, minRegionArea: 8, mergeRegionArea: 20,
  maxVertsPerPoly: 6, detailSampleDist: 6 * cs, detailSampleMaxError: 1 * ch,
});
if (!success) throw new Error('navmesh generation failed');
const nav = exportNavMesh(navMesh);
fs.writeFileSync(path.join(outDir, 'navmesh.bin'), nav);
console.log(`navmesh ${(performance.now() - t0).toFixed(0)}ms, ${(nav.byteLength / 1e3).toFixed(0)}KB`);
