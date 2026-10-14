// Acquire real provider files and all glTF dependencies, preserving relative paths.
import fs from 'node:fs/promises';
import path from 'node:path';
const out = process.argv[2] ?? '/tmp/kova-scenario-input';
await fs.mkdir(out, { recursive: true });
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
  return r.json();
}
async function file(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Download ${r.status}: ${dest}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, new Uint8Array(await r.arrayBuffer()));
}
const sha = '5d8e8a89347650ee210e120cdd70f9e9288f0abc';
for (const name of ['Michelle', 'Soldier']) await file(`https://raw.githubusercontent.com/mrdoob/three.js/${sha}/examples/models/gltf/${name}.glb`, path.join(out, `${name}.glb`));
const requests = [
  { id: 'blenderkit:cff796e6-57fb-4260-b241-be5d1f8fa13d', format: 'glb', filename: 'stall.glb', query: 'market stall' },
  { id: 'polyhaven:wooden_table_02', format: 'gltf', filename: 'table.gltf', query: 'wooden table' },
];
const acquired = [];
for (const req of requests) {
  const search = await json(`https://3d.shep.bot/v1/search?q=${encodeURIComponent(req.query)}&type=model&providers=${req.id.split(':')[0]}&free=true&downloadable=true&limit=12`);
  const entry = search.results?.find(r => r.id === req.id);
  const manifest = await json(`https://3d.shep.bot/v1/assets/${encodeURIComponent(req.id)}/files?format=${req.format}&resolution=1k`);
  const main = manifest.files.find(f => f.format === req.format);
  if (!main) throw new Error(`No ${req.format} for ${req.id}`);
  await file(main.url, path.join(out, req.filename));
  for (const child of main.includes ?? []) {
    if (child.path.includes('..') || child.path.startsWith('/')) throw new Error('Unsafe companion path');
    await file(child.url, path.join(out, child.path));
  }
  acquired.push({ id:req.id, title:entry?.title, source:entry?.url, license:manifest.license, format:main.format, bytes:main.sizeBytes, companions:main.includes?.map(f=>f.path) ?? [] });
  console.log('Acquired', req.id, main.sizeBytes);
}
await fs.writeFile(path.join(out, 'acquisition.json'), JSON.stringify({date:new Date().toISOString(), service:'https://3d.shep.bot', assets:acquired, motionSource:`https://github.com/mrdoob/three.js/tree/${sha}/examples/models/gltf`, motionTerms:'https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html'},null,2));
