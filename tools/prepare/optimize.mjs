// Bistro prep stage 2 (generic): glTF -> web-ready GLB.
// Usage: node tools/prepare/optimize.mjs <in.gltf> <out.glb> [maxTex=1024]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, weld, prune, flatten, join, textureCompress, meshopt, resample, inspect } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [inp, out, maxTex = '1024'] = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inp);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
await doc.transform(dedup(), flatten(), instance({ min: 3 }), weld(), join({ keepNamed: false }), prune());
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
