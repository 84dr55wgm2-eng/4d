// Bistro prep stage 2 (generic): glTF -> web-ready GLB.
// Usage: node tools/prepare/optimize.mjs <in.gltf> <out.glb> [maxTex=1024]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, weld, prune, flatten, join, textureCompress, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [inp, out, maxTex = '1024'] = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
await doc.transform(dedup(), flatten(), instance({ min: 3 }), weld());
// Spatial clustering: join() merges primitives that share a parent, so parent meshes into
// CELL-sized grid cells first. Fewer draw calls *and* frustum/shadow culling still works.
const CELL = 20;
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const cells = new Map();
for (const node of scene.listChildren()) {
  const mesh = node.getMesh();
  if (!mesh || node.getExtension('EXT_mesh_gpu_instancing')) continue;
  const bb = getBounds(node);
  const cx = Math.floor((bb.min[0] + bb.max[0]) / 2 / CELL), cz = Math.floor((bb.min[2] + bb.max[2]) / 2 / CELL);
  // very large meshes (ground, facades spanning cells) get their own cell
  const big = Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) > CELL * 1.5;
  const key = big ? `big_${node.getName()}_${cells.size}` : `${cx}_${cz}`;
  let cell = cells.get(key);
  if (!cell) { cell = doc.createNode(`cell_${key}`); scene.addChild(cell); cells.set(key, cell); }
  scene.removeChild(node);
  cell.addChild(node);
}
await doc.transform(join({ keepNamed: false }), prune());
console.log('cells', cells.size);
log('geometry done');
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+maxTex, +maxTex], quality: 82, slots: /^(?!normal).*/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+maxTex, +maxTex], lossless: false, quality: 92, slots: /^normal/ }),
);
log('textures done');
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
const r = doc.getRoot();
log(`meshes ${r.listMeshes().length} nodes ${r.listNodes().length} textures ${r.listTextures().length}`);
