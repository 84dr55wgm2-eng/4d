// Dependencies of the extracted region: from the YMAP XML entities (and MLO children) to the archetypes' YTYP,
// their drawables (.ydr / .ydd / .yft by asset type), texture dictionaries (.ytd) and the road-graph tiles (.ynd).
//   node tools/gta/service/deps.mjs <work>  → <work>/deps.txt (+ deps-report.json)
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const work = path.resolve(process.argv[2]);
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => n === 'Item' });
const archetypes = new Map();
for (const line of fs.readFileSync(path.join(work, 'index/archetypes.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const a = JSON.parse(line);
  const k = a.name.toLowerCase();
  // the highest content priority wins (update > dlc patch > dlc > base), as for files
  if (!archetypes.has(k) || archetypes.get(k).priority < a.priority) archetypes.set(k, a);
}
const want = new Set(), missing = new Set(), used = new Set();
const ydir = path.join(work, 'xml/ymap');
const bbox = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
const visit = (name) => {
  const k = name.toLowerCase();
  if (used.has(k)) return; used.add(k);
  const a = archetypes.get(k);
  if (!a) { missing.add(k); return; }
  want.add(a.ytyp);
  const asset = (a.assetName || a.name).toLowerCase();
  if (a.assetType === 'ASSET_TYPE_DRAWABLE') want.add(`${asset}.ydr`);
  else if (a.assetType === 'ASSET_TYPE_DRAWABLEDICTIONARY') want.add(`${(a.drawableDict && a.drawableDict !== '0' ? a.drawableDict : asset).toLowerCase()}.ydd`);
  else if (a.assetType === 'ASSET_TYPE_FRAGMENT') want.add(`${asset}.yft`);
  if (a.textureDict && a.textureDict !== '0') want.add(`${a.textureDict.toLowerCase()}.ytd`);
};
for (const f of fs.existsSync(ydir) ? fs.readdirSync(ydir).filter((x) => x.endsWith('.ymap.xml')) : []) {
  const d = xml.parse(fs.readFileSync(path.join(ydir, f), 'utf8')).CMapData;
  for (const e of d.entities?.Item ?? []) {
    visit(String(e.archetypeName));
    const p = e.position; if (p) { bbox.min[0] = Math.min(bbox.min[0], p.x); bbox.min[1] = Math.min(bbox.min[1], p.y); bbox.max[0] = Math.max(bbox.max[0], p.x); bbox.max[1] = Math.max(bbox.max[1], p.y); }
  }
}
// MLO children need the interior's YTYP XML: extracted in the same pass, visited when present
const tdir = path.join(work, 'xml/ytyp');
for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir).filter((x) => x.endsWith('.ytyp.xml')) : [])
  for (const a of xml.parse(fs.readFileSync(path.join(tdir, f), 'utf8')).CMapTypes?.archetypes?.Item ?? [])
    if (a.type === 'CMloArchetypeDef' && used.has(String(a.name).toLowerCase())) for (const c of a.entities?.Item ?? []) visit(String(c.archetypeName));
// road graph tiles: nodes<area>.ynd, area = 32 × 32 grid of 512-unit cells from (−8192, −8192)
if (Number.isFinite(bbox.min[0])) {
  const cell = (v) => Math.max(0, Math.min(31, Math.floor((v + 8192) / 512)));
  for (let x = cell(bbox.min[0]); x <= cell(bbox.max[0]); x++) for (let y = cell(bbox.min[1]); y <= cell(bbox.max[1]); y++) want.add(`nodes${y * 32 + x}.ynd`);
}
fs.writeFileSync(path.join(work, 'deps.txt'), [...want].join('\n') + '\n');
fs.writeFileSync(path.join(work, 'deps-report.json'), JSON.stringify({ files: want.size, archetypes: used.size, missingArchetypes: [...missing] }, null, 1));
console.log(JSON.stringify({ step: 'deps', files: want.size, archetypes: used.size, missingArchetypes: missing.size }));
