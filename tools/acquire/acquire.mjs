// Content acquisition that runs where the network is open (GitHub Actions), output committed to the repo.
// Usage: node tools/acquire/acquire.mjs tools/acquire/request.json
//   request.catalog: true          -> tools/acquire/catalog/polyhaven-{models,textures}.json
//   request.models:  [polyhavenId] -> public/content/lagos/models/<id>.glb  (glTF 1k/2k + textures -> GLB, WebP, meshopt)
//   request.textures:[polyhavenId] -> public/content/lagos/materials/<id>/{diff,nor,arm}.webp
//   request.objaverse:[{uid,name}] -> public/content/lagos/models/obj-<uid>.glb (license recorded)
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, textureCompress, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const req = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const UA = { 'User-Agent': 'cinematic-world-studio/1.0 (github.com/84dr55wgm2-eng/4d)' };
const OUT = 'public/content/lagos';
const LOG = [];
const log = (...a) => { const s = a.join(' '); console.log(s); LOG.push(s); };
const get = async (url, type = 'json') => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return type === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
};
fs.mkdirSync('tools/acquire/catalog', { recursive: true });
const provenance = fs.existsSync(`${OUT}/provenance.json`) ? JSON.parse(fs.readFileSync(`${OUT}/provenance.json`, 'utf8')) : {};

if (req.catalog) {
  for (const t of ['models', 'textures']) {
    const all = await get(`https://api.polyhaven.com/assets?t=${t}`);
    const slim = Object.fromEntries(Object.entries(all).map(([id, a]) => [id, { n: a.name, c: a.categories, t: a.tags, d: a.dimensions }]));
    fs.writeFileSync(`tools/acquire/catalog/polyhaven-${t}.json`, JSON.stringify(slim));
    log(`catalog ${t}: ${Object.keys(slim).length}`);
  }
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function packGltf(dir, rootFile, outFile, maxTex) {
  const doc = await io.read(path.join(dir, rootFile));
  await doc.transform(dedup(), weld(), resample(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await io.write(outFile, doc);
  return fs.statSync(outFile).size;
}

for (const spec of req.models ?? []) {
  const id = typeof spec === 'string' ? spec : spec.id;
  const res = (typeof spec === 'object' && spec.res) || '1k';
  const out = `${OUT}/models/${id}.glb`;
  if (fs.existsSync(out) && !req.force) { log(`skip ${id}`); continue; }
  try {
    const files = await get(`https://api.polyhaven.com/files/${id}`);
    const g = files.gltf?.[res]?.gltf ?? files.gltf?.['1k']?.gltf;
    if (!g) throw new Error('no gltf');
    const dir = `/tmp/ph/${id}`;
    fs.mkdirSync(dir, { recursive: true });
    const rootName = path.basename(new URL(g.url).pathname);
    fs.writeFileSync(path.join(dir, rootName), await get(g.url, 'bin'));
    for (const [rel, inc] of Object.entries(g.include ?? {})) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), await get(inc.url, 'bin'));
    }
    const size = await packGltf(dir, rootName, out, res === '2k' ? 2048 : 1024);
    const info = await get(`https://api.polyhaven.com/info/${id}`);
    provenance[`models/${id}.glb`] = { source: 'Poly Haven', id, name: info.name, url: `https://polyhaven.com/a/${id}`, license: 'CC0-1.0', authors: Object.keys(info.authors ?? {}), dimensions: info.dimensions, bytes: size };
    log(`model ${id} ${(size / 1e6).toFixed(2)}MB dims=${JSON.stringify(info.dimensions)}`);
  } catch (e) { log(`FAIL model ${id}: ${e.message}`); }
}

for (const spec of req.textures ?? []) {
  const id = typeof spec === 'string' ? spec : spec.id;
  const res = (typeof spec === 'object' && spec.res) || '1k';
  const dir = `${OUT}/materials/${id}`;
  if (fs.existsSync(`${dir}/diff.webp`) && !req.force) { log(`skip tex ${id}`); continue; }
  try {
    const files = await get(`https://api.polyhaven.com/files/${id}`);
    fs.mkdirSync(dir, { recursive: true });
    const pick = (k) => files[k]?.[res]?.jpg?.url ?? files[k]?.[res]?.png?.url;
    const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') };
    for (const [k, url] of Object.entries(maps)) {
      if (!url) { log(`  ${id}: missing ${k}`); continue; }
      const buf = await get(url, 'bin');
      await sharp(buf).webp({ quality: k === 'nor' ? 92 : 85 }).toFile(`${dir}/${k}.webp`);
    }
    const info = await get(`https://api.polyhaven.com/info/${id}`);
    provenance[`materials/${id}`] = { source: 'Poly Haven', id, name: info.name, url: `https://polyhaven.com/a/${id}`, license: 'CC0-1.0', authors: Object.keys(info.authors ?? {}), dimensions: info.dimensions };
    log(`texture ${id} ok dims=${JSON.stringify(info.dimensions)}`);
  } catch (e) { log(`FAIL texture ${id}: ${e.message}`); }
}

// Objaverse (Sketchfab-derived, per-object license recorded; only CC0/CC-BY accepted)
if (req.objaverseSearch || req.objaverse) {
  const { execSync } = await import('node:child_process');
  try { execSync(`python3 tools/acquire/objv_fetch.py ${process.argv[2]}`, { stdio: 'inherit' }); } catch (e) { log('FAIL objaverse lane: ' + e.message); }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/provenance.json`, JSON.stringify(provenance, null, 1));
fs.writeFileSync('tools/acquire/last-run.log', LOG.join('\n') + '\n');
