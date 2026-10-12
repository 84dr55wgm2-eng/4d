// Test content for the GTA pipeline — NOT GTA content. It reproduces what the real chain hands to the package
// builder (CodeWalker XML for YMAP / YTYP / YND + one glTF per drawable, as Blender+Sollumz would export it),
// so the builder, the catalogue, composition and navigation can be verified without any game file.
//
//   node tools/gta/fixtures/build-fixtures.mjs [outDir=tools/gta/work/fixture]
//
// Output: <out>/xml/{ymap,ytyp,ynd}/*.xml, <out>/gltf/<archetype>.glb, <out>/characters/*.glb, <out>/fixture.json
// Drawables are authored in glTF Y-up; GTA-side data (XML) is Z-up, exactly like the real export.
// Materials: Poly Haven CC0 scans already in public/content/lagos/materials; props: Poly Haven CC0 models.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'tools/gta/work/fixture'));
const MATS = path.join(ROOT, 'public/content/lagos/materials');
const MODELS = path.join(ROOT, 'public/content/lagos/models');
for (const d of ['xml/ymap', 'xml/ytyp', 'xml/ynd', 'gltf', 'characters']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ------------------------------------------------------------------ geometry helpers (glTF Y-up, front = +Z)
function metricBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv'), dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}
/** wall in the XY plane from x=0..len, y=0..h, thickness t toward −Z, with rectangular holes {x0,x1,y0,y1} */
function wallPanel(len, h, t, holes) {
  const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, h), new THREE.Vector2(0, h)]);
  const bottom = holes.filter((o) => o.y0 <= 0.001).sort((a, b) => a.x0 - b.x0);
  if (bottom.length) {
    // openings reaching the floor become notches of the outline
    const pts = [new THREE.Vector2(0, 0)];
    for (const o of bottom) pts.push(new THREE.Vector2(o.x0, 0), new THREE.Vector2(o.x0, o.y1), new THREE.Vector2(o.x1, o.y1), new THREE.Vector2(o.x1, 0));
    pts.push(new THREE.Vector2(len, 0), new THREE.Vector2(len, h), new THREE.Vector2(0, h));
    s.curves = []; s.setFromPoints(pts);
  }
  for (const o of holes.filter((o) => o.y0 > 0.001)) s.holes.push(new THREE.Path([new THREE.Vector2(o.x0, o.y0), new THREE.Vector2(o.x0, o.y1), new THREE.Vector2(o.x1, o.y1), new THREE.Vector2(o.x1, o.y0)]));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -t);
  return g;
}

/** a drawable under construction: material name → geometries */
class Drawable {
  constructor(name) { this.name = name; this.parts = new Map(); }
  add(mat, g, m) { if (m) g.applyMatrix4(m); (this.parts.get(mat) ?? this.parts.set(mat, []).get(mat)).push(g.index ? g.toNonIndexed() : g); return this; }
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RY = (deg) => new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(deg));

// ------------------------------------------------------------------ materials (CC0 scans) → glTF
const MATERIALS = {
  plaster: { tex: 'white_plaster_02', tile: 2.4 }, plaster_cream: { tex: 'white_plaster_02', tile: 2.4, color: [1.3, 1.22, 1.0] },
  plaster_blue: { tex: 'white_plaster_02', tile: 2.4, color: [0.9, 1.08, 1.25] }, plaster_ochre: { tex: 'white_plaster_02', tile: 2.4, color: [1.3, 1.0, 0.62] },
  concrete: { tex: 'concrete_wall_004', tile: 2 }, asphalt: { tex: 'road_damaged', tile: 6 }, pavers: { tex: 'interlocking_concrete_pavers', tile: 1.6 },
  kerb: { tex: 'dirty_concrete', tile: 1.2 }, shutter: { tex: 'rusty_metal_shutter', tile: 1.6 }, roof: { tex: 'rusty_corrugated_iron', tile: 1.5 },
  floor_tile: { tex: 'terrazzo_tiles', tile: 1.4 }, court: { tex: 'concrete_floor_worn_001', tile: 1.6 }, wood: { tex: 'wood_peeling_paint_weathered', tile: 1.2 },
  glass: { color: [0.5, 0.58, 0.6], alpha: 0.4, rough: 0.1 }, dark: { color: [0.05, 0.05, 0.05], rough: 1 },
};
const clamp01 = (v) => Math.min(1, v);

const SMALL = new Map();
for (const def of Object.values(MATERIALS)) if (def.tex) for (const map of ['diff', 'nor', 'arm']) {
  const k = `${def.tex}/${map}`;
  if (!SMALL.has(k)) SMALL.set(k, await sharp(fs.readFileSync(path.join(MATS, def.tex, `${map}.webp`))).resize(512, 512).webp({ quality: 82 }).toBuffer());
}
async function writeDrawable(d, file) {
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buf = doc.createBuffer();
  const scene = doc.createScene(d.name), node = doc.createNode(d.name);
  scene.addChild(node);
  const texCache = new Map();
  const tex = (id, map) => {
    const k = `${id}/${map}`;
    // test content: 512 px is enough and keeps the package small (each drawable embeds its own textures)
    if (!texCache.has(k)) texCache.set(k, doc.createTexture(k).setImage(SMALL.get(k)).setMimeType('image/webp'));
    return texCache.get(k);
  };
  const mesh = doc.createMesh(d.name);
  for (const [matName, geos] of d.parts) {
    const def = MATERIALS[matName];
    const mat = doc.createMaterial(matName).setRoughnessFactor(def.rough ?? 1).setMetallicFactor(0);
    const c = def.color ?? [1, 1, 1];
    mat.setBaseColorFactor([clamp01(c[0] * (def.tex ? 0.75 : 1)), clamp01(c[1] * (def.tex ? 0.75 : 1)), clamp01(c[2] * (def.tex ? 0.75 : 1)), def.alpha ?? 1]);
    if (def.alpha) mat.setAlphaMode('BLEND').setDoubleSided(true);
    const tile = 1 / (def.tile ?? 1);
    if (def.tex) {
      mat.setBaseColorTexture(tex(def.tex, 'diff')).setNormalTexture(tex(def.tex, 'nor')).setMetallicRoughnessTexture(tex(def.tex, 'arm')).setOcclusionTexture(tex(def.tex, 'arm'));
    }
    // merge geometries of this material into one primitive (UVs pre-scaled by the tile size)
    let n = 0; for (const g of geos) n += g.getAttribute('position').count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    let o = 0;
    for (const g of geos) {
      g.computeVertexNormals();
      const p = g.getAttribute('position'), nn = g.getAttribute('normal'), uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++, o++) {
        P.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3); N.set([nn.getX(i), nn.getY(i), nn.getZ(i)], o * 3);
        U.set(uv ? [uv.getX(i) * tile, 1 - uv.getY(i) * tile] : [0, 0], o * 2);
      }
    }
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(U).setBuffer(buf));
    mesh.addPrimitive(prim);
  }
  node.setMesh(mesh);
  await io.write(file, doc);
  const b = getBounds(scene);
  return { min: b.min, max: b.max };
}

// ------------------------------------------------------------------ kit (one drawable per archetype)
const WALL_T = 0.25;
/** building: w (x) × d (z) × floors; front at +Z. Openings on the ground floor front. */
function building(name, { w, d, floors = 2, fh = 3.3, paint = 'plaster', front = [], back = [], hollow = false, passage = null }) {
  const b = new Drawable(name);
  const H = floors * fh;
  const holesFront = [], holesBack = [];
  for (const o of front) holesFront.push({ x0: w / 2 + o.x - o.w / 2, x1: w / 2 + o.x + o.w / 2, y0: o.sill ?? 0, y1: (o.sill ?? 0) + o.h });
  for (const o of back) holesBack.push({ x0: w / 2 - o.x - o.w / 2, x1: w / 2 - o.x + o.w / 2, y0: o.sill ?? 0, y1: (o.sill ?? 0) + o.h });
  for (let f = 1; f < floors; f++) for (let i = 0; i < Math.max(1, Math.floor(w / 3.2)); i++) {
    const cx = (i + 0.5) * (w / Math.max(1, Math.floor(w / 3.2)));
    holesFront.push({ x0: cx - 0.7, x1: cx + 0.7, y0: f * fh + 0.9, y1: f * fh + 2.2 });
  }
  b.add(paint, wallPanel(w, H, WALL_T, holesFront), T(-w / 2, 0, d / 2));
  b.add(paint, wallPanel(w, H, WALL_T, holesBack), new THREE.Matrix4().multiplyMatrices(T(w / 2, 0, -d / 2), RY(180)));
  b.add(paint, wallPanel(d, H, WALL_T, []), new THREE.Matrix4().multiplyMatrices(T(-w / 2, 0, -d / 2), RY(-90)));
  b.add(paint, wallPanel(d, H, WALL_T, []), new THREE.Matrix4().multiplyMatrices(T(w / 2, 0, d / 2), RY(90)));
  // slabs (ground floor slab only when the ground floor is enterable), roof parapet
  // full-footprint slab: the doorways get a floor across the wall thickness (an interior is reachable from the street)
  if (hollow || passage) b.add('floor_tile', metricBox(w, 0.06, d), T(0, 0.03, 0));
  for (let f = 1; f <= floors; f++) b.add('concrete', metricBox(w, 0.22, d), T(0, f * fh - 0.11, 0));
  b.add('concrete', metricBox(w + 0.2, 0.8, 0.2), T(0, H + 0.4, d / 2 + 0.1 - 0.2));
  // shutters / glazing / door leaves in the openings
  for (const o of front) {
    if (o.kind === 'shop') b.add('shutter', metricBox(o.w - 0.1, 0.8, 0.05), T(o.x, o.h - 0.4, d / 2 - 0.05));
    if (o.kind === 'window') b.add('glass', metricBox(o.w - 0.1, o.h - 0.1, 0.02), T(o.x, (o.sill ?? 0) + o.h / 2, d / 2 - 0.12));
  }
  if (!hollow && !passage) b.add('dark', metricBox(w - 2 * WALL_T - 0.1, H - 0.2, 0.05), T(0, H / 2, d / 2 - 1.2)); // closed interior backdrop
  if (passage) {
    // a vaulted through-passage: side walls of the passage, ground continues
    b.add(paint, metricBox(0.2, passage.h, d), T(passage.x - passage.w / 2 - 0.1, passage.h / 2, 0));
    b.add(paint, metricBox(0.2, passage.h, d), T(passage.x + passage.w / 2 + 0.1, passage.h / 2, 0));
    b.add('concrete', metricBox(passage.w, 0.2, d), T(passage.x, passage.h + 0.1, 0));
  }
  return b;
}
function road20() {
  const r = new Drawable('fx_road_20');
  r.add('asphalt', metricBox(20, 0.1, 8), T(0, -0.05, 0));
  for (const s of [-1, 1]) { r.add('kerb', metricBox(20, 0.16, 0.2), T(0, 0.03, s * 4.1)); r.add('pavers', metricBox(20, 0.15, 2.8), T(0, 0.075, s * 5.6)); }
  return r;
}
function roadCross() {
  const r = new Drawable('fx_road_cross');
  r.add('asphalt', metricBox(14, 0.1, 14), T(0, -0.05, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) r.add('pavers', metricBox(3, 0.15, 3), T(sx * 5.5, 0.075, sz * 5.5));
  return r;
}
function courtGround() { const c = new Drawable('fx_court_ground'); c.add('court', metricBox(16, 0.1, 16), T(0, 0.05, 0)); return c; }
function room(name, w, d, h, doorX, doorW) {
  // MLO interior geometry: floor, ceiling, inner lining (door gap on the front wall)
  const r = new Drawable(name);
  r.add('floor_tile', metricBox(w, 0.04, d), T(0, 0.08, 0));
  r.add('plaster_cream', metricBox(w, 0.04, d), T(0, h, 0));
  r.add('plaster_cream', wallPanel(w, h, 0.03, [{ x0: w / 2 + doorX - doorW / 2, x1: w / 2 + doorX + doorW / 2, y0: 0, y1: 2.3 }]), T(-w / 2, 0, d / 2 - 0.01));
  r.add('plaster_cream', wallPanel(w, h, 0.03, []), new THREE.Matrix4().multiplyMatrices(T(w / 2, 0, -d / 2 + 0.03), RY(180)));
  r.add('plaster_blue', wallPanel(d, h, 0.03, []), new THREE.Matrix4().multiplyMatrices(T(-w / 2 + 0.03, 0, -d / 2), RY(-90)));
  r.add('plaster_blue', wallPanel(d, h, 0.03, []), new THREE.Matrix4().multiplyMatrices(T(w / 2 - 0.03, 0, d / 2), RY(90)));
  return r;
}
function lodBox(name, w, d, h, paint) { const l = new Drawable(name); l.add(paint, metricBox(w, h, d), T(0, h / 2, 0)); return l; }

const kit = [
  road20(), roadCross(), courtGround(),
  building('fx_bldg_shop_a', { w: 10, d: 10, floors: 2, paint: 'plaster_ochre', front: [{ kind: 'shop', x: -2.4, w: 3.2, h: 2.6 }, { kind: 'shop', x: 2.4, w: 3.2, h: 2.6 }] }),
  building('fx_bldg_shop_b', { w: 8, d: 10, floors: 3, paint: 'plaster_blue', front: [{ kind: 'shop', x: 0, w: 3.6, h: 2.6 }] }),
  building('fx_bldg_res_a', { w: 12, d: 8, floors: 2, paint: 'plaster_cream', front: [{ kind: 'window', x: -3.5, w: 1.6, h: 1.4, sill: 0.9 }, { kind: 'door', x: 0, w: 1.1, h: 2.2 }, { kind: 'window', x: 3.5, w: 1.6, h: 1.4, sill: 0.9 }] }),
  building('fx_cafe_shell', { w: 12, d: 12, floors: 2, fh: 3.4, paint: 'plaster', hollow: true, front: [{ kind: 'door', x: -3.9, w: 1.3, h: 2.3 }, { kind: 'window', x: 0, w: 2.4, h: 1.5, sill: 0.95 }, { kind: 'window', x: 3.6, w: 2.4, h: 1.5, sill: 0.95 }] }),
  building('fx_passage', { w: 6, d: 8, floors: 2, paint: 'plaster_cream', passage: { x: 0, w: 3, h: 3 }, front: [{ kind: 'door', x: 0, w: 3, h: 3 }], back: [{ kind: 'door', x: 0, w: 3, h: 3 }] }),
  building('fx_shop_small_shell', { w: 7, d: 6, floors: 1, fh: 3.2, paint: 'plaster_ochre', hollow: true, front: [{ kind: 'door', x: 0, w: 2.6, h: 2.5 }] }),
  room('fx_cafe_int_room', 11.5, 11.5, 3.1, -3.9, 1.3),
  room('fx_shop_int_room', 6.5, 5.5, 3.0, 0, 2.6),
  lodBox('fx_bldg_shop_a_lod', 10, 10, 6.6, 'plaster_ochre'), lodBox('fx_bldg_shop_b_lod', 8, 10, 9.9, 'plaster_blue'),
  lodBox('fx_bldg_res_a_lod', 12, 8, 6.6, 'plaster_cream'), lodBox('fx_cafe_shell_lod', 12, 12, 6.8, 'plaster'),
];
const bounds = {};
for (const d of kit) bounds[d.name] = await writeDrawable(d, path.join(OUT, 'gltf', `${d.name}.glb`));
// props and vehicles: Poly Haven CC0 / Objaverse CC-BY models already acquired for the project (copied as drawables)
const PROPS = { fx_chair: 'plastic_monobloc_chair_01', fx_desk: 'wooden_table_02', fx_crt: 'obj_retro_pc_setup', fx_counter: 'metal_office_desk', fx_bench: 'painted_wooden_bench', fx_crate: 'plastic_crate_01', fx_lamp: 'street_lamp_02', fx_bin: 'metal_trash_can', fx_car: 'covered_car', fx_shelf: 'steel_frame_shelves_02', fx_stool: 'wooden_stool_01' };
const SCALE = { fx_crt: 0.01 };
for (const [arch, src] of Object.entries(PROPS)) {
  const doc = await io.read(path.join(MODELS, `${src}.glb`));
  const s = SCALE[arch];
  if (s) for (const n of doc.getRoot().listScenes()[0].listChildren()) n.setScale(n.getScale().map((v) => v * s));
  await io.write(path.join(OUT, 'gltf', `${arch}.glb`), doc);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  bounds[arch] = { min: b.min, max: b.max };
}

// ------------------------------------------------------------------ GTA-side data (Z-up) — CodeWalker XML
// glTF (x, y, z) ↔ GTA (x, −z, y): bounds converted for the YTYP archetypes
const gtaBounds = (b) => ({ min: [b.min[0], -b.max[2], b.min[1]], max: [b.max[0], -b.min[2], b.max[1]] });
const f = (v) => (+v.toFixed(4)).toString();
const v3 = (tag, [x, y, z]) => `<${tag} x="${f(x)}" y="${f(y)}" z="${f(z)}" />`;
/** GTA stores the inverse rotation for regular entities (CodeWalker YmapEntityDef); yaw about +Z (degrees) */
const storedRot = (yawDeg, inverse = true) => { const h = THREE.MathUtils.degToRad(yawDeg) / 2 * (inverse ? -1 : 1); return `<rotation x="0" y="0" z="${f(Math.sin(h))}" w="${f(Math.cos(h))}" />`; };

function archetypeXml(name, extra = '') {
  const b = gtaBounds(bounds[name]);
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.hypot(b.max[0] - c[0], b.max[1] - c[1], b.max[2] - c[2]);
  return ` <Item type="CBaseArchetypeDef">
   <lodDist value="${name.endsWith('_lod') ? 1500 : 250}" /><flags value="0" /><specialAttribute value="0" />
   ${v3('bbMin', b.min)} ${v3('bbMax', b.max)} ${v3('bsCentre', c)} <bsRadius value="${f(r)}" /><hdTextureDist value="60" />
   <name>${name}</name><textureDictionary>${name}</textureDictionary><clipDictionary /><drawableDictionary /><physicsDictionary />
   <assetType>ASSET_TYPE_DRAWABLE</assetType><assetName>${name}</assetName>${extra}
  </Item>\n`;
}
function entityXml(arch, pos, yaw, { lod = 'LODTYPES_DEPTH_HD', parentIndex = -1, numChildren = 0, lodDist = 200, childLodDist = 0, type = 'CEntityDef', extra = '', inverse = true } = {}) {
  return `  <Item type="${type}">
   <archetypeName>${arch}</archetypeName><flags value="1572864" /><guid value="0" />
   ${v3('position', pos)} ${storedRot(yaw, inverse)}
   <scaleXY value="1" /><scaleZ value="1" /><parentIndex value="${parentIndex}" /><lodDist value="${lodDist}" /><childLodDist value="${childLodDist}" />
   <lodLevel>${lod}</lodLevel><numChildren value="${numChildren}" /><priorityLevel>PRI_REQUIRED</priorityLevel>${extra}
  </Item>\n`;
}
function mloXml(name, { w, d, h, door, entities }) {
  // room 0 = limbo (outside), room 1 = main; one portal from the room to the outside through the door
  const ents = entities.map((e) => entityXml(e.arch, e.pos, e.yaw ?? 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 60 })).join('');
  const y = -d / 2; // front wall (GTA −Y local is the street side of the shell)
  const corners = [[door.x - door.w / 2, y, 0], [door.x + door.w / 2, y, 0], [door.x + door.w / 2, y, door.h], [door.x - door.w / 2, y, door.h]];
  return ` <Item type="CMloArchetypeDef">
   <lodDist value="120" /><flags value="0" /><specialAttribute value="0" />
   ${v3('bbMin', [-w / 2, -d / 2, 0])} ${v3('bbMax', [w / 2, d / 2, h])} ${v3('bsCentre', [0, 0, h / 2])} <bsRadius value="${f(Math.hypot(w, d) / 2)}" /><hdTextureDist value="0" />
   <name>${name}</name><textureDictionary /><clipDictionary /><drawableDictionary /><physicsDictionary />
   <assetType>ASSET_TYPE_ASSETLESS</assetType><assetName>${name}</assetName>
   <mloFlags value="0" />
   <entities>\n${ents}   </entities>
   <rooms>
    <Item><name>limbo</name>${v3('bbMin', [0, 0, 0])} ${v3('bbMax', [0, 0, 0])}<portalCount value="1" /><attachedObjects /></Item>
    <Item><name>main</name>${v3('bbMin', [-w / 2, -d / 2, 0])} ${v3('bbMax', [w / 2, d / 2, h])}<portalCount value="1" /><attachedObjects>${entities.map((_, i) => i).join(' ')}</attachedObjects></Item>
   </rooms>
   <portals>
    <Item><roomFrom value="1" /><roomTo value="0" /><flags value="0" /><corners>${corners.map((c) => `<Item>${c.map(f).join(', ')}</Item>`).join('')}</corners><attachedObjects /></Item>
   </portals>
   <entitySets /><timeCycleModifiers />
  </Item>\n`;
}
const ytyp = (name, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<CMapTypes>\n <name>${name}</name>\n <archetypes>\n${body} </archetypes>\n</CMapTypes>\n`;
const ymap = (name, parent, body, flags = 0) => `<?xml version="1.0" encoding="UTF-8"?>\n<CMapData>\n <name>${name}</name>\n <parent>${parent ?? ''}</parent>\n <flags value="${flags}" />\n <contentFlags value="1" />\n <entities>\n${body} </entities>\n</CMapData>\n`;

const kitNames = [...kit.map((d) => d.name).filter((n) => !n.endsWith('_room')), ...Object.keys(PROPS)];
const cafeEntities = [
  ...[-3, 0, 3].map((y) => ({ arch: 'fx_desk', pos: [-4.9, y, 0.1], yaw: -90 })), ...[-3, 0, 3].map((y) => ({ arch: 'fx_crt', pos: [-5.0, y, 0.9], yaw: 90 })),
  ...[-3, 0, 3].map((y) => ({ arch: 'fx_chair', pos: [-3.9, y, 0.1], yaw: -90 })),
  ...[-1.5, 1.5].map((y) => ({ arch: 'fx_desk', pos: [4.9, y, 0.1], yaw: 90 })), ...[-1.5, 1.5].map((y) => ({ arch: 'fx_crt', pos: [5.0, y, 0.9], yaw: -90 })),
  ...[-1.5, 1.5].map((y) => ({ arch: 'fx_chair', pos: [3.9, y, 0.1], yaw: 90 })),
  { arch: 'fx_counter', pos: [3.4, -4.2, 0.1], yaw: 0 }, { arch: 'fx_cafe_int_room', pos: [0, 0, 0], yaw: 0 },
];
const shopEntities = [{ arch: 'fx_shop_int_room', pos: [0, 0, 0], yaw: 0 }, { arch: 'fx_shelf', pos: [-2.4, 2.3, 0.1], yaw: 0 }, { arch: 'fx_shelf', pos: [0, 2.3, 0.1], yaw: 0 }, { arch: 'fx_counter', pos: [1.6, 0.5, 0.1], yaw: 180 }, { arch: 'fx_stool', pos: [1.6, 1.4, 0.1], yaw: 0 }];
for (const n of ['fx_cafe_int_room', 'fx_shop_int_room']) kitNames.push(n);
fs.writeFileSync(path.join(OUT, 'xml/ytyp/fx_kit.ytyp.xml'), ytyp('fx_kit', kitNames.map((n) => archetypeXml(n)).join('')
  + mloXml('fx_cafe_int', { w: 11.5, d: 11.5, h: 3.1, door: { x: -3.9, w: 1.3, h: 2.3 }, entities: cafeEntities })
  + mloXml('fx_shop_int', { w: 6.5, d: 5.5, h: 3.0, door: { x: 0, w: 2.6, h: 2.5 }, entities: shopEntities })));

// Region A — "fx_downtown": a commercial street (east-west) ending at a crossroads; the café is enterable.
// South side buildings face +Y (yaw 180: their local −Y front turns north); north side face −Y (yaw 0).
const A = { x: 0, y: 0 };
const southFront = -7, northFront = 7;
const S = (arch, x, depth) => ({ arch, pos: [A.x + x, A.y + southFront - depth / 2, 0.15], yaw: 180 });
const N = (arch, x, depth) => ({ arch, pos: [A.x + x, A.y + northFront + depth / 2, 0.15], yaw: 0 });
const downtownBuildings = [S('fx_bldg_shop_a', 6, 10), S('fx_cafe_shell', 19.5, 12), S('fx_bldg_shop_b', 31, 10), S('fx_bldg_shop_a', 42, 10),
  N('fx_bldg_shop_b', 5, 10), N('fx_bldg_res_a', 16, 8), N('fx_bldg_shop_a', 28, 10), N('fx_bldg_shop_b', 39, 10)];
const lodOf = { fx_bldg_shop_a: 'fx_bldg_shop_a_lod', fx_bldg_shop_b: 'fx_bldg_shop_b_lod', fx_bldg_res_a: 'fx_bldg_res_a_lod', fx_cafe_shell: 'fx_cafe_shell_lod' };
let lodBody = '', hdBody = '';
downtownBuildings.forEach((b) => { lodBody += entityXml(lodOf[b.arch], b.pos, b.yaw, { lod: 'LODTYPES_DEPTH_LOD', numChildren: 1, lodDist: 1500, childLodDist: 250 }); });
downtownBuildings.forEach((b, i) => { hdBody += entityXml(b.arch, b.pos, b.yaw, { parentIndex: i }); });
for (const x of [10, 30]) hdBody += entityXml('fx_road_20', [A.x + x, A.y, 0], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 500 });
hdBody += entityXml('fx_road_cross', [A.x + 47, A.y, 0], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 500 });
for (const x of [3, 18, 33]) hdBody += entityXml('fx_lamp', [A.x + x, A.y + 6.2, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 120 });
hdBody += entityXml('fx_bench', [A.x + 24, A.y - 6.0, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 80 });
hdBody += entityXml('fx_bin', [A.x + 13, A.y - 6.2, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 80 });
hdBody += entityXml('fx_car', [A.x + 36, A.y - 2.3, 0], 90, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 150 });
// the café interior instance shares the shell's transform (MLO instances store their rotation as is)
const cafe = downtownBuildings[1];
hdBody += entityXml('fx_cafe_int', cafe.pos, cafe.yaw, { type: 'CMloInstanceDef', lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 120, inverse: false, extra: '<groupId value="0" /><floorId value="0" /><defaultEntitySets /><numExitPortals value="1" /><MLOInstflags value="0" />' });
fs.writeFileSync(path.join(OUT, 'xml/ymap/fx_downtown_lod.ymap.xml'), ymap('fx_downtown_lod', null, lodBody, 2));
fs.writeFileSync(path.join(OUT, 'xml/ymap/fx_downtown.ymap.xml'), ymap('fx_downtown', 'fx_downtown_lod', hdBody));

// Region B — "fx_residential", elsewhere on the map: a street, a passage building into a courtyard ringed by
// houses, and a small shop opening onto the courtyard.
const B = { x: -400, y: 250 };
let rb = '';
for (const x of [-10, 10]) rb += entityXml('fx_road_20', [B.x + x, B.y, 0], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 500 });
rb += entityXml('fx_passage', [B.x, B.y + 7 + 4, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_bldg_res_a', [B.x - 9.5, B.y + 7 + 4, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_bldg_res_a', [B.x + 9.5, B.y + 7 + 4, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_court_ground', [B.x, B.y + 15 + 8, 0.1], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_bldg_res_a', [B.x - 12, B.y + 23, 0.15], 90, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_bldg_res_a', [B.x, B.y + 35, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_shop_small_shell', [B.x + 11.5, B.y + 23, 0.15], -90, { lod: 'LODTYPES_DEPTH_ORPHANHD' });
rb += entityXml('fx_shop_int', [B.x + 11.5, B.y + 23, 0.15], -90, { type: 'CMloInstanceDef', lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 120, inverse: false, extra: '<groupId value="0" /><floorId value="0" /><defaultEntitySets /><numExitPortals value="1" /><MLOInstflags value="0" />' });
rb += entityXml('fx_bench', [B.x - 3, B.y + 24, 0.15], 90, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 80 });
rb += entityXml('fx_crate', [B.x + 4, B.y + 28, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 80 });
rb += entityXml('fx_lamp', [B.x - 6, B.y + 6.2, 0.15], 0, { lod: 'LODTYPES_DEPTH_ORPHANHD', lodDist: 120 });
fs.writeFileSync(path.join(OUT, 'xml/ymap/fx_residential.ymap.xml'), ymap('fx_residential', null, rb));

// Road graph (YND): two lanes along each street, a crossing at the downtown crossroads
function ynd(name, area, lanes) {
  let id = 0, items = '';
  for (const lane of lanes) {
    const ids = lane.map(() => id++);
    lane.forEach((p, i) => {
      const links = [];
      if (i + 1 < lane.length) links.push(ids[i + 1]);
      if (i > 0) links.push(ids[i - 1]);
      items += `  <Item><AreaID value="${area}" /><NodeID value="${ids[i]}" /><StreetName>${name}</StreetName>${v3('Position', p)}<Flags0 value="2" /><Flags1 value="0" /><Flags2 value="0" /><Flags3 value="0" /><Flags4 value="0" /><Flags5 value="${links.length}" />
   <Links>${links.map((to) => `<Item><ToAreaID value="${area}" /><ToNodeID value="${to}" /><Flags0 value="0" /><Flags1 value="0" /><Flags2 value="${to === ids[i + 1] ? 1 : 0}" /><LinkLength value="10" /></Item>`).join('')}</Links></Item>\n`;
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<NodeDictionary>\n <VehicleNodeCount value="${id}" />\n <PedNodeCount value="0" />\n <Nodes>\n${items} </Nodes>\n <Junctions />\n</NodeDictionary>\n`;
}
const laneA = (dir) => Array.from({ length: 6 }, (_, i) => [A.x + (dir > 0 ? i * 10 : 50 - i * 10), A.y - dir * 2, 0.05]);
fs.writeFileSync(path.join(OUT, 'xml/ynd/fx_nodes_a.ynd.xml'), ynd('fx_downtown', 900, [laneA(1), laneA(-1)]));
const laneB = (dir) => Array.from({ length: 5 }, (_, i) => [B.x + (dir > 0 ? -20 + i * 10 : 20 - i * 10), B.y - dir * 2, 0.05]);
fs.writeFileSync(path.join(OUT, 'xml/ynd/fx_nodes_b.ynd.xml'), ynd('fx_residential', 901, [laneB(1), laneB(-1)]));

// test characters: Khronos glTF sample "CesiumMan" (CC BY 4.0, Cesium) — rigged, with a walk cycle
const cesium = path.join(OUT, 'characters', 'CesiumMan.glb');
if (!fs.existsSync(cesium)) {
  const res = await fetch('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb');
  if (res.ok) fs.writeFileSync(cesium, Buffer.from(await res.arrayBuffer())); else console.warn('CesiumMan not fetched', res.status);
}
fs.writeFileSync(path.join(OUT, 'fixture.json'), JSON.stringify({
  kind: 'fixture', notGta: true, description: 'Test content mimicking the GTA export chain (CodeWalker XML + per-drawable glTF). Not GTA content.',
  regions: { fx_downtown: A, fx_residential: B }, drawables: Object.keys(bounds).length,
  licenses: ['Poly Haven CC0 textures/models', 'Objaverse CC-BY (retro PC set by dr.badass2142)', 'CesiumMan CC BY 4.0 (Cesium / Khronos glTF-Sample-Assets)'],
}, null, 1));
console.log(`fixture → ${OUT}: ${Object.keys(bounds).length} drawables`);
