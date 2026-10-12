// CodeWalker XML (YMAP / YTYP / YND) + per-drawable glTF → cws-package (directory + .cwspkg zip).
//
//   npx tsx tools/gta/pack/build-package.ts --in <work dir with xml/ and gltf/> --out <package dir> --id <id> --name <name>
//        [--source gta5|fixture] [--annotations annotations.json] [--vehicles fx_car,…] [--characters <dir>]
//
// Placement rules follow CodeWalker (YmapFile.cs, YmapEntityDef): a regular entity's stored rotation is the inverse
// of its orientation; a CMloInstanceDef's is not; MLO children are composed with their parent. GTA Z-up becomes
// glTF Y-up with (x, y, z) → (x, z, −y). LOD parents (from the parent YMAP) are kept as members linked to their HD
// children so the runtime shows one level at a time. Nothing is written into the input directory.
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { zipSync } from 'fflate';
import * as THREE from 'three';
import type { CwsPackage, PackageResource, SetConnector, SetDef, SetMember, V3, Q4 } from '../../../src/content/package';
import { gtaQuatToYup, gtaToYup } from '../../../src/content/package';

const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : acc), []));
const IN = path.resolve(args.in ?? 'tools/gta/work/fixture');
const OUT = path.resolve(args.out ?? 'tools/gta/work/package');
const ID = args.id ?? path.basename(OUT);
const report = { missingDrawables: new Set<string>(), unknownArchetypes: new Set<string>(), warnings: [] as string[] };

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => name === 'Item', parseAttributeValue: true, trimValues: true });
const read = (f: string) => xml.parse(fs.readFileSync(f, 'utf8'));
const files = (dir: string, ext: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f)) : []);

// ------------------------------------------------------------------ XML readers
type Obj = Record<string, any>;
const num = (o: Obj | undefined, k: string, d = 0) => (o?.[k]?.value ?? d) as number;
const vec = (o: Obj | undefined, k: string): V3 => [o?.[k]?.x ?? 0, o?.[k]?.y ?? 0, o?.[k]?.z ?? 0];
const quat = (o: Obj | undefined, k: string): Q4 => [o?.[k]?.x ?? 0, o?.[k]?.y ?? 0, o?.[k]?.z ?? 0, o?.[k]?.w ?? 1];
const txt = (o: Obj | undefined, k: string) => (typeof o?.[k] === 'string' || typeof o?.[k] === 'number' ? String(o[k]) : '');
const items = (o: Obj | undefined) => (o && typeof o === 'object' ? (o.Item ?? []) as Obj[] : []);
/** "x, y, z[, w]" items (portal corners) or one vector per line */
const vectorList = (o: Obj | undefined): V3[] => {
  if (!o) return [];
  const raw: string[] = o.Item ? o.Item.map(String) : String(o['#text'] ?? '').split('\n');
  return raw.map((s) => s.split(',').map(Number)).filter((v) => v.length >= 3 && v.every(Number.isFinite)).map((v) => [v[0], v[1], v[2]] as V3);
};

interface Archetype { name: string; assetName: string; bbMin: V3; bbMax: V3; ytyp: string; mlo?: { entities: Obj[]; rooms: Obj[]; portals: Obj[] } }
const archetypes = new Map<string, Archetype>();
for (const f of files(path.join(IN, 'xml/ytyp'), '.ytyp.xml')) {
  const doc = read(f).CMapTypes;
  for (const a of items(doc.archetypes)) {
    const name = txt(a, 'name').toLowerCase();
    archetypes.set(name, {
      name, assetName: (txt(a, 'assetName') || name).toLowerCase(), bbMin: vec(a, 'bbMin'), bbMax: vec(a, 'bbMax'), ytyp: path.basename(f),
      mlo: a.type === 'CMloArchetypeDef' ? { entities: items(a.entities), rooms: items(a.rooms), portals: items(a.portals) } : undefined,
    });
  }
}

interface Ent { arch: string; pos: V3; q: Q4; scale: V3; lod: string; parentIndex: number; mlo: boolean; ymap: string; index: number }
interface Ymap { name: string; parent: string; entities: Ent[]; file: string }
const ymaps = new Map<string, Ymap>();
for (const f of files(path.join(IN, 'xml/ymap'), '.ymap.xml')) {
  const d = read(f).CMapData;
  const name = txt(d, 'name').toLowerCase();
  const ents = items(d.entities).map((e, index): Ent => {
    const mlo = e.type === 'CMloInstanceDef';
    const s = quat(e, 'rotation');
    // CodeWalker: regular entities store the inverse rotation; MLO instances store it as is
    const q: Q4 = mlo ? s : [-s[0], -s[1], -s[2], s[3]];
    return { arch: txt(e, 'archetypeName').toLowerCase(), pos: vec(e, 'position'), q, scale: [num(e, 'scaleXY', 1), num(e, 'scaleXY', 1), num(e, 'scaleZ', 1)], lod: txt(e, 'lodLevel') || 'LODTYPES_DEPTH_HD', parentIndex: num(e, 'parentIndex', -1), mlo, ymap: name, index };
  });
  ymaps.set(name, { name, parent: txt(d, 'parent').toLowerCase(), entities: ents, file: path.basename(f) });
}

interface RoadNode { id: string; pos: V3; links: string[] }
const roadNodes = new Map<string, RoadNode>();
for (const f of files(path.join(IN, 'xml/ynd'), '.ynd.xml')) {
  const d = read(f).NodeDictionary;
  for (const n of items(d.Nodes)) {
    const id = `${num(n, 'AreaID')}:${num(n, 'NodeID')}`;
    roadNodes.set(id, { id, pos: vec(n, 'Position'), links: items(n.Links).map((l) => `${num(l, 'ToAreaID')}:${num(l, 'ToNodeID')}`) });
  }
}

// ------------------------------------------------------------------ math (GTA Z-up world)
const Q = (q: Q4) => new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
const V = (v: V3) => new THREE.Vector3(...v);
const yawOf = (q: Q4) => { const e = new THREE.Euler().setFromQuaternion(Q(q), 'ZYX'); return THREE.MathUtils.radToDeg(e.z); };
/** world AABB (GTA) of an archetype placed at pos/q/scale */
function worldBox(a: Archetype, pos: V3, q: Q4, scale: V3) {
  const b = new THREE.Box3(), m = new THREE.Matrix4().compose(V(pos), Q(q), V(scale));
  for (const x of [a.bbMin[0], a.bbMax[0]]) for (const y of [a.bbMin[1], a.bbMax[1]]) for (const z of [a.bbMin[2], a.bbMax[2]]) b.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(m));
  return b;
}
const LOD: Record<string, SetMember['lod']> = { LODTYPES_DEPTH_HD: 'HD', LODTYPES_DEPTH_ORPHANHD: 'ORPHANHD', LODTYPES_DEPTH_LOD: 'LOD', LODTYPES_DEPTH_SLOD1: 'SLOD', LODTYPES_DEPTH_SLOD2: 'SLOD', LODTYPES_DEPTH_SLOD3: 'SLOD', LODTYPES_DEPTH_SLOD4: 'SLOD' };

// ------------------------------------------------------------------ placed entities (world, with MLO children expanded)
interface Placed { key: string; arch: Archetype; pos: V3; q: Q4; scale: V3; lod: SetMember['lod']; parentKey?: string; ymap: string; mloOf?: string; room?: string; box: THREE.Box3 }
const placed: Placed[] = [];
const keyOf = (y: string, i: number) => `${y}#${i}`;
for (const y of ymaps.values()) {
  const parent = ymaps.get(y.parent);
  for (const e of y.entities) {
    const a = archetypes.get(e.arch);
    if (!a) { report.unknownArchetypes.add(e.arch); continue; }
    const key = keyOf(y.name, e.index);
    const parentKey = e.parentIndex >= 0 && parent ? keyOf(parent.name, e.parentIndex) : undefined;
    placed.push({ key, arch: a, pos: e.pos, q: e.q, scale: e.scale, lod: LOD[e.lod] ?? 'HD', parentKey, ymap: y.name, box: worldBox(a, e.pos, e.q, e.scale) });
    if (e.mlo && a.mlo) {
      const P = V(e.pos), R = Q(e.q);
      const roomOfEntity = new Map<number, string>();
      a.mlo.rooms.forEach((r, ri) => String(r.attachedObjects ?? '').split(/\s+/).filter(Boolean).forEach((i) => roomOfEntity.set(+i, txt(r, 'name') || `room${ri}`)));
      a.mlo.entities.forEach((c, ci) => {
        const ca = archetypes.get(txt(c, 'archetypeName').toLowerCase());
        if (!ca) { report.unknownArchetypes.add(txt(c, 'archetypeName')); return; }
        const s = quat(c, 'rotation');
        const local = Q([-s[0], -s[1], -s[2], s[3]]); // children store inverse rotations too
        const wp = V(vec(c, 'position')).applyQuaternion(R).add(P);
        const wq = R.clone().multiply(local);
        const pos: V3 = [wp.x, wp.y, wp.z], q: Q4 = [wq.x, wq.y, wq.z, wq.w];
        placed.push({ key: `${key}/${ci}`, arch: ca, pos, q, scale: [1, 1, 1], lod: 'ORPHANHD', ymap: y.name, mloOf: key, room: roomOfEntity.get(ci), box: worldBox(ca, pos, q, [1, 1, 1]) });
      });
    }
  }
}
const byKey = new Map(placed.map((p) => [p.key, p]));

// ------------------------------------------------------------------ drawables → resources (measured)
const gltfDir = path.join(IN, 'gltf');
const resources = new Map<string, PackageResource>();
const triangles = new Map<string, Float32Array>(); // resource-local (Y-up) triangle soup for ray tests
const vehicles = new Set((args.vehicles ?? '').split(',').filter(Boolean).map((s) => s.toLowerCase()));
async function resourceFor(a: Archetype): Promise<PackageResource | null> {
  const id = a.assetName;
  if (resources.has(id)) return resources.get(id)!;
  if (a.mlo) return null; // MLOs are containers; their drawables are their children
  const file = path.join(gltfDir, `${id}.glb`);
  if (!fs.existsSync(file)) { report.missingDrawables.add(id); return null; }
  const doc = await io.read(file);
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  // triangle soup in drawable space (node transforms applied)
  const tris: number[] = [];
  let tcount = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh(); if (!mesh) return;
    const m = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); if (!pos) continue;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const v = new THREE.Vector3(), e: number[] = [];
      for (let i = 0; i < n; i++) {
        const k = idx ? idx.getScalar(i) : i;
        const p = pos.getElement(k, e as unknown as number[]) as unknown as number[];
        v.set(p[0], p[1], p[2]).applyMatrix4(m); tris.push(v.x, v.y, v.z);
      }
      tcount += n / 3;
    }
  });
  triangles.set(id, new Float32Array(tris));
  const size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const area = size[0] * size[2];
  const r: PackageResource = {
    id, kind: vehicles.has(id) ? 'vehicle' : 'model', file: `res/${id}.glb`, bytes: fs.statSync(file).size,
    bounds: { min: b.min as V3, max: b.max as V3 }, tags: [],
    measured: { triangles: Math.round(tcount), size, flatGround: size[1] < 0.6 && area > 40, building: size[1] > 3 && area > 20 },
    inferred: {}, source: { ytyp: a.ytyp, archetype: a.name, assetName: a.assetName }, collision: 'render',
  };
  resources.set(id, r);
  return r;
}
for (const p of placed) await resourceFor(p.arch);

// road resources: a YND node lies on their footprint (measured)
const nodeList = [...roadNodes.values()];
for (const p of placed) {
  const r = resources.get(p.arch.assetName); if (!r) continue;
  if (nodeList.some((n) => n.pos[0] >= p.box.min.x && n.pos[0] <= p.box.max.x && n.pos[1] >= p.box.min.y && n.pos[1] <= p.box.max.y && Math.abs(n.pos[2] - p.box.max.z) < 1.5)) r.measured.road = true;
}

// characters: rigged glTF with their own clips
const charDir = args.characters ? path.resolve(args.characters) : path.join(IN, 'characters');
for (const f of files(charDir, '.glb')) {
  const id = path.basename(f, '.glb').toLowerCase();
  const doc = await io.read(f);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  resources.set(id, {
    id, kind: 'character', file: `res/${id}.glb`, bytes: fs.statSync(f).size, bounds: { min: b.min as V3, max: b.max as V3 }, tags: ['character'],
    measured: { triangles: 0, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }, inferred: {}, source: { file: path.basename(f) },
    collision: 'none', clips: doc.getRoot().listAnimations().map((a) => a.getName() || 'clip'),
  });
}

// ------------------------------------------------------------------ sets
const sets: SetDef[] = [];
const isLodOnly = (y: Ymap) => y.entities.length > 0 && y.entities.every((e) => /LOD/.test(e.lod) && !/ORPHAN/.test(e.lod));
const memberOf = (p: Placed): SetMember | null => {
  const r = resources.get(p.arch.assetName); if (!r) return null;
  return { id: p.key, resource: r.id, position: gtaToYup(p.pos), quaternion: gtaQuatToYup(p.q), scale: [p.scale[0], p.scale[2], p.scale[1]], lod: p.lod, parent: p.parentKey, room: p.room };
};
/** members plus the LOD parents they reference */
function withLods(ps: Placed[]) {
  const out = new Map(ps.map((p) => [p.key, p]));
  for (const p of ps) { let k = p.parentKey; while (k && !out.has(k)) { const lp = byKey.get(k); if (!lp) break; out.set(k, lp); k = lp.parentKey; } }
  return [...out.values()];
}
function makeSet(id: string, name: string, kind: SetDef['kind'], ps: Placed[], source: SetDef['source'], extra: Partial<SetDef> = {}): SetDef {
  const all = withLods(ps);
  const box = new THREE.Box3();
  for (const p of all) if (p.lod !== 'LOD' && p.lod !== 'SLOD') box.union(p.box);
  // origin: footprint centre at ground, in Y-up world
  const cGta: V3 = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z];
  const o = gtaToYup(cGta);
  const members = all.map(memberOf).filter((m): m is SetMember => !!m).map((m) => ({ ...m, position: [m.position[0] - o[0], m.position[1] - o[1], m.position[2] - o[2]] as V3 }));
  const lo = gtaToYup([box.min.x, box.max.y, box.min.z]), hi = gtaToYup([box.max.x, box.min.y, box.max.z]);
  const set: SetDef = {
    id, name, kind, source: { ...source, originGta: cGta },
    bounds: { min: [lo[0] - o[0], lo[1] - o[1], lo[2] - o[2]], max: [hi[0] - o[0], hi[1] - o[1], hi[2] - o[2]] },
    members, connectors: [], roads: [], rooms: [], capabilities: [], annotations: { measured: {}, inferred: { tags: [], uses: [] } }, related: [], ...extra,
  };
  (set as SetDef & { _origin: V3; _box: THREE.Box3; _placed: Placed[] })._origin = o;
  (set as SetDef & { _box: THREE.Box3 })._box = box;
  (set as SetDef & { _placed: Placed[] })._placed = all;
  return set;
}
const internal = (s: SetDef) => s as SetDef & { _origin: V3; _box: THREE.Box3; _placed: Placed[] };
const toLocal = (s: SetDef, gta: V3): V3 => { const o = internal(s)._origin, w = gtaToYup(gta); return [w[0] - o[0], w[1] - o[1], w[2] - o[2]]; };
const dirLocal = (d: V3): V3 => { const w = gtaToYup(d); const l = Math.hypot(w[0], w[2]) || 1; return [w[0] / l, 0, w[2] / l]; };

// road polylines from the YND graph (chains of degree ≤ 2 nodes)
function roadChains(inBox: THREE.Box3) {
  const ids = nodeList.filter((n) => inBox.containsPoint(V([n.pos[0], n.pos[1], inBox.min.z + 0.01]).setZ((inBox.min.z + inBox.max.z) / 2))).map((n) => n.id);
  const inside = new Set(ids), seen = new Set<string>(), chains: RoadNode[][] = [];
  const nbrs = (id: string) => roadNodes.get(id)!.links.filter((l) => inside.has(l));
  for (const start of ids) {
    if (seen.has(start) || nbrs(start).length > 1) continue;
    const chain = [roadNodes.get(start)!]; seen.add(start);
    let cur = start;
    for (;;) { const next = nbrs(cur).find((x) => !seen.has(x)); if (!next) break; seen.add(next); chain.push(roadNodes.get(next)!); cur = next; }
    if (chain.length > 1) chains.push(chain);
  }
  return chains;
}

// 1. map sets (one per YMAP that is not a pure LOD container) — a whole source portion
for (const y of ymaps.values()) {
  if (isLodOnly(y)) continue;
  const ps = placed.filter((p) => p.ymap === y.name);
  if (!ps.length) continue;
  sets.push(makeSet(`map:${y.name}`, `Portion ${y.name}`, 'map', ps, { ymap: y.file, region: y.name }));
}
// 2. interiors (MLO instances): rooms + door connectors from portals to the outside (room 0)
for (const p of placed.filter((x) => x.arch.mlo)) {
  const kids = placed.filter((x) => x.mloOf === p.key);
  const s = makeSet(`int:${p.key}`, `Intérieur ${p.arch.name}`, 'interior', kids, { mlo: p.arch.name, ymap: p.ymap, originGta: p.pos, yawGta: yawOf(p.q) });
  const R = Q(p.q), P = V(p.pos);
  s.rooms = p.arch.mlo!.rooms.slice(1).map((r, i) => {
    const a = V(vec(r, 'bbMin')).applyQuaternion(R).add(P), b = V(vec(r, 'bbMax')).applyQuaternion(R).add(P);
    const la = toLocal(s, [a.x, a.y, a.z]), lb = toLocal(s, [b.x, b.y, b.z]);
    return { id: `${s.id}/room${i + 1}`, name: txt(r, 'name') || `room${i + 1}`, bounds: { min: la.map((v, k) => Math.min(v, lb[k])) as V3, max: la.map((v, k) => Math.max(v, lb[k])) as V3 } };
  });
  const center = new THREE.Vector3(); internal(s)._box.getCenter(center);
  p.arch.mlo!.portals.forEach((pt, i) => {
    if (num(pt, 'roomTo') !== 0 && num(pt, 'roomFrom') !== 0) return; // only portals to the outside are accesses
    const cs = vectorList(pt.corners).map((c) => V(c).applyQuaternion(R).add(P));
    if (cs.length < 3) { report.warnings.push(`${s.id}: portal ${i} without corners`); return; }
    const mid = cs.reduce((acc, c) => acc.add(c), new THREE.Vector3()).multiplyScalar(1 / cs.length);
    const bottom = Math.min(...cs.map((c) => c.z));
    // outward = the portal plane's horizontal normal, oriented away from the room centre
    const edge = cs[1].clone().sub(cs[0]).setZ(0);
    let out = new THREE.Vector3(-edge.y, edge.x, 0).normalize();
    if (out.dot(mid.clone().sub(center).setZ(0)) < 0) out.negate();
    const width = Math.max(...cs.map((c) => c.distanceTo(cs[0])).filter((d) => d > 0.05).map((d) => d)) || 1;
    s.connectors.push({ id: `${s.id}/door${i}`, kind: 'door', position: toLocal(s, [mid.x, mid.y, bottom]), normal: dirLocal([out.x, out.y, 0]), width: +Math.min(width, Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y)).toFixed(2), origin: 'portal' });
  });
  s.capabilities = ['interior', 'enterable', 'walkable'];
  sets.push(s);
}

// ray sampling of the real geometry (horizontal rays at 1 m) for measured openings
const _ray = new THREE.Ray(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3();
function firstHit(origin: THREE.Vector3, dir: THREE.Vector3, far: number, ps: Placed[], skip: (p: Placed) => boolean) {
  let best = far;
  for (const p of ps) {
    if (skip(p) || p.lod === 'LOD' || p.lod === 'SLOD') continue;
    const t = triangles.get(p.arch.assetName); if (!t) continue;
    // ray into the drawable's frame (GTA → Y-up world, then inverse of the placement)
    const m = new THREE.Matrix4().compose(V(gtaToYup(p.pos)), Q(gtaQuatToYup(p.q)), V([p.scale[0], p.scale[2], p.scale[1]])).invert();
    const o = V(gtaToYup([origin.x, origin.y, origin.z])).applyMatrix4(m);
    const d = V(gtaToYup([dir.x, dir.y, dir.z])).transformDirection(m);
    _ray.set(o, d);
    for (let i = 0; i < t.length; i += 9) {
      _a.set(t[i], t[i + 1], t[i + 2]); _b.set(t[i + 3], t[i + 4], t[i + 5]); _c.set(t[i + 6], t[i + 7], t[i + 8]);
      if (_ray.intersectTriangle(_a, _b, _c, false, _hit)) { const dist = _hit.distanceTo(o); if (dist < best) best = dist; }
    }
  }
  return best;
}
function measuredOpenings(s: SetDef, centre: THREE.Vector3, skip: (p: Placed) => boolean) {
  const box = internal(s)._box;
  const out: SetConnector[] = [];
  const open: number[] = [];
  for (let deg = 0; deg < 360; deg += 4) {
    const r = THREE.MathUtils.degToRad(deg), dir = new THREE.Vector3(Math.cos(r), Math.sin(r), 0);
    // distance to the set boundary along this direction
    const tx = dir.x > 0 ? (box.max.x - centre.x) / dir.x : dir.x < 0 ? (box.min.x - centre.x) / dir.x : Infinity;
    const ty = dir.y > 0 ? (box.max.y - centre.y) / dir.y : dir.y < 0 ? (box.min.y - centre.y) / dir.y : Infinity;
    const edge = Math.min(tx, ty);
    open.push(firstHit(centre, dir, edge, internal(s)._placed, skip) >= edge - 0.01 ? edge : -1);
  }
  // group consecutive open directions; a connector where the middle ray leaves the set
  const n = open.length;
  const startAt = open.findIndex((v) => v < 0);
  if (startAt < 0) return out;
  let run: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (startAt + k) % n;
    if (open[i] >= 0) run.push(i);
    if ((open[i] < 0 || k === n) && run.length) {
      const mid = run[Math.floor(run.length / 2)], r = THREE.MathUtils.degToRad(mid * 4);
      const dir = new THREE.Vector3(Math.cos(r), Math.sin(r), 0), p = centre.clone().addScaledVector(dir, open[mid]);
      const width = 2 * open[mid] * Math.tan(THREE.MathUtils.degToRad(run.length * 4) / 2);
      out.push({ id: `${s.id}/open${out.length}`, kind: 'passage', position: toLocal(s, [p.x, p.y, centre.z - 1]), normal: dirLocal([dir.x, dir.y, 0]), width: +Math.min(width, 30).toFixed(2), origin: 'measured', data: { rays: run.length } });
      run = [];
    }
  }
  return out;
}

// 3. streets / intersections: connected road pieces with what fronts them
const roads = placed.filter((p) => resources.get(p.arch.assetName)?.measured.road && p.lod !== 'LOD');
const buildings = placed.filter((p) => resources.get(p.arch.assetName)?.measured.building && p.lod !== 'LOD' && p.lod !== 'SLOD' && !p.mloOf);
const near = (a: THREE.Box3, b: THREE.Box3, d: number) => a.clone().expandByScalar(d).intersectsBox(b);
const groups: Placed[][] = [];
for (const r of roads) {
  const g = groups.find((gg) => gg.some((x) => near(x.box, r.box, 0.5)));
  if (g) g.push(r); else groups.push([r]);
}
for (const g of groups) {
  for (const r of g) {
    const size = resources.get(r.arch.assetName)!.measured.size, square = Math.abs(size[0] - size[2]) < 0.15 * Math.max(size[0], size[2]);
    if (!square) continue;
    // a square road piece with lanes on all sides is an intersection set of its own
    const s = makeSet(`cross:${r.key}`, `Carrefour ${r.arch.name}`, 'intersection', [r], { ymap: r.ymap, originGta: r.pos });
    const c = r.box.getCenter(new THREE.Vector3());
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const half = dx ? (r.box.max.x - r.box.min.x) / 2 : (r.box.max.y - r.box.min.y) / 2;
      s.connectors.push({ id: `${s.id}/road${s.connectors.length}`, kind: 'road', position: toLocal(s, [c.x + dx * half, c.y + dy * half, r.box.max.z]), normal: dirLocal([dx, dy, 0]), width: +(2 * half).toFixed(2), origin: 'inferred', data: { note: 'square road piece: four approaches' } });
    }
    s.capabilities = ['walkable', 'vehicles'];
    sets.push(s);
  }
  const box = g.reduce((b, r) => b.union(r.box), new THREE.Box3());
  const front = buildings.filter((b) => near(b.box, box, 2.5));
  const props = placed.filter((p) => !g.includes(p) && !front.includes(p) && !p.mloOf && p.lod !== 'LOD' && !p.arch.mlo && !resources.get(p.arch.assetName)?.measured.building && box.clone().expandByScalar(1).containsPoint(p.box.getCenter(new THREE.Vector3())));
  const interiors = placed.filter((p) => p.arch.mlo && front.some((b) => b.box.containsPoint(V(p.pos))));
  const s = makeSet(`street:${g[0].key}`, `Rue ${g[0].ymap}`, 'street', [...g, ...front, ...props, ...interiors, ...placed.filter((p) => interiors.some((i) => p.mloOf === i.key))], { ymap: g[0].ymap, region: g[0].ymap });
  // lanes from the road graph; connectors where lanes leave the street
  const chains = roadChains(box.clone().expandByScalar(0.5));
  s.roads = chains.map((ch, i) => ({ id: `${s.id}/lane${i}`, points: ch.map((n) => toLocal(s, n.pos)), oneway: true }));
  const ends: { p: V3; dir: V3 }[] = [];
  for (const ch of chains) for (const [a, b] of [[ch[0], ch[1]], [ch.at(-1)!, ch.at(-2)!]]) ends.push({ p: a.pos, dir: [a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], 0] });
  const done: V3[] = [];
  const roadWidth = Math.min(...g.map((r) => { const sz = resources.get(r.arch.assetName)!.measured.size; return Math.min(sz[0], sz[2]); }));
  for (const e of ends) {
    const d = V(e.dir).normalize();
    // the street end: project to the road box boundary along the lane
    const onEdge = V(e.p).add(d.clone().multiplyScalar(Math.max(0, Math.min(d.x > 0 ? box.max.x - e.p[0] : d.x < 0 ? e.p[0] - box.min.x : Infinity, d.y > 0 ? box.max.y - e.p[1] : d.y < 0 ? e.p[1] - box.min.y : Infinity))));
    if (done.some((q) => Math.hypot(q[0] - onEdge.x, q[1] - onEdge.y) < 6)) continue;
    // centre of the roadway at that end (both lanes)
    const centre = onEdge.clone();
    if (Math.abs(d.x) > Math.abs(d.y)) centre.y = (box.min.y + box.max.y) / 2; else centre.x = (box.min.x + box.max.x) / 2;
    done.push([centre.x, centre.y, 0]);
    s.connectors.push({ id: `${s.id}/road${s.connectors.length}`, kind: 'road', position: toLocal(s, [centre.x, centre.y, box.max.z]), normal: dirLocal([d.x, d.y, 0]), width: +roadWidth.toFixed(2), origin: 'ynd' });
    const side = new THREE.Vector3(-d.y, d.x, 0);
    for (const sgn of [-1, 1]) {
      const sp = centre.clone().addScaledVector(side, sgn * (roadWidth / 2 - 1.4));
      s.connectors.push({ id: `${s.id}/walk${s.connectors.length}`, kind: 'sidewalk', position: toLocal(s, [sp.x, sp.y, box.max.z]), normal: dirLocal([d.x, d.y, 0]), width: 2.8, origin: 'inferred', data: { note: 'sidewalk assumed 1.4 m inside the road piece edge' } });
    }
  }
  // interiors opening onto this street: their doors are accesses of the street set too
  for (const i of interiors) {
    const iset = sets.find((x) => x.id === `int:${i.key}`);
    if (!iset) continue;
    s.related.push({ kind: 'contains', set: iset.id });
    iset.related.push({ kind: 'partOf', set: s.id });
    for (const c of iset.connectors) {
      const w = gtaToYup([0, 0, 0]); void w;
      const io = internal(iset)._origin, so = internal(s)._origin;
      s.connectors.push({ ...c, id: `${s.id}/${c.id.split('/').at(-1)}@${iset.id}`, position: [c.position[0] + io[0] - so[0], c.position[1] + io[1] - so[1], c.position[2] + io[2] - so[2]], data: { interior: iset.id } });
    }
  }
  s.capabilities = ['walkable', 'vehicles', ...(interiors.length ? ['enterable' as const] : [])];
  sets.push(s);
}

// 4. buildings (+ their interior) as movable units
for (const b of buildings) {
  const interior = placed.find((p) => p.arch.mlo && b.box.containsPoint(V(p.pos)));
  const ps = [b, ...(interior ? [interior, ...placed.filter((p) => p.mloOf === interior.key)] : [])];
  const s = makeSet(`bldg:${b.key}`, `Bâtiment ${b.arch.name}`, 'building', ps, { ymap: b.ymap, originGta: b.pos, yawGta: yawOf(b.q) });
  const iset = interior && sets.find((x) => x.id === `int:${interior.key}`);
  if (iset) {
    const io = internal(iset)._origin, so = internal(s)._origin;
    for (const c of iset.connectors) s.connectors.push({ ...c, id: `${s.id}/door@${iset.id}`, position: [c.position[0] + io[0] - so[0], c.position[1] + io[1] - so[1], c.position[2] + io[2] - so[2]], data: { interior: iset.id } });
    s.related.push({ kind: 'hasInterior', set: iset.id }); iset.related.push({ kind: 'interiorOf', set: s.id });
  } else {
    // front = the bounding face nearest to a road (inferred): where the building meets the pavement
    const c = b.box.getCenter(new THREE.Vector3());
    const road = roads.map((r) => r.box.getCenter(new THREE.Vector3())).sort((p, q) => p.distanceTo(c) - q.distanceTo(c))[0];
    if (road) {
      const d = road.clone().sub(c).setZ(0); const axis = Math.abs(d.x) > Math.abs(d.y) ? new THREE.Vector3(Math.sign(d.x), 0, 0) : new THREE.Vector3(0, Math.sign(d.y), 0);
      const half = axis.x ? (b.box.max.x - b.box.min.x) / 2 : (b.box.max.y - b.box.min.y) / 2;
      const p = c.clone().addScaledVector(axis, half);
      s.connectors.push({ id: `${s.id}/front`, kind: 'open', position: toLocal(s, [p.x, p.y, b.box.min.z]), normal: dirLocal([axis.x, axis.y, 0]), width: +(axis.x ? b.box.max.y - b.box.min.y : b.box.max.x - b.box.min.x).toFixed(2), origin: 'inferred', data: { note: 'facade facing the nearest road' } });
    }
  }
  s.capabilities = interior ? ['enterable', 'interior', 'lod'] : ['lod'];
  sets.push(s);
}

// 5. courtyards: large flat non-road ground with the buildings around it; openings measured by rays
for (const g of placed.filter((p) => { const r = resources.get(p.arch.assetName); return r?.measured.flatGround && !r.measured.road && p.lod !== 'LOD'; })) {
  const ring = buildings.filter((b) => near(b.box, g.box, 2.5));
  const interiors = placed.filter((p) => p.arch.mlo && ring.some((b) => b.box.containsPoint(V(p.pos))));
  const props = placed.filter((p) => !p.mloOf && !p.arch.mlo && p !== g && !ring.includes(p) && !resources.get(p.arch.assetName)?.measured.building && g.box.clone().expandByScalar(0.5).containsPoint(p.box.getCenter(new THREE.Vector3())));
  const s = makeSet(`court:${g.key}`, `Cour ${g.arch.name}`, 'courtyard', [g, ...ring, ...props, ...interiors, ...placed.filter((p) => interiors.some((i) => p.mloOf === i.key))], { ymap: g.ymap, originGta: g.pos });
  const centre = g.box.getCenter(new THREE.Vector3()); centre.z = g.box.max.z + 1.0;
  s.connectors.push(...measuredOpenings(s, centre, (p) => p === g || p.arch.mlo !== undefined || !!p.mloOf || props.includes(p)));
  for (const i of interiors) {
    const iset = sets.find((x) => x.id === `int:${i.key}`); if (!iset) continue;
    const io = internal(iset)._origin, so = internal(s)._origin;
    for (const c of iset.connectors) s.connectors.push({ ...c, id: `${s.id}/door@${iset.id}`, position: [c.position[0] + io[0] - so[0], c.position[1] + io[1] - so[1], c.position[2] + io[2] - so[2]], data: { interior: iset.id } });
    s.related.push({ kind: 'contains', set: iset.id });
  }
  s.capabilities = ['walkable', ...(interiors.length ? ['enterable' as const] : [])];
  sets.push(s);
}

// ------------------------------------------------------------------ measured + inferred annotations
const annotations: Record<string, { tags?: string[]; uses?: string[]; name?: string; note?: string }> = args.annotations && fs.existsSync(args.annotations) ? JSON.parse(fs.readFileSync(args.annotations, 'utf8')) : {};
for (const s of sets) {
  const b = s.bounds;
  const seats = s.members.filter((m) => /chair|stool|bench|seat/.test(m.resource)).length;
  s.annotations.measured = {
    width: +(b.max[0] - b.min[0]).toFixed(2), depth: +(b.max[2] - b.min[2]).toFixed(2), height: +(b.max[1] - b.min[1]).toFixed(2),
    members: s.members.length, rooms: s.rooms.length, doors: s.connectors.filter((c) => c.kind === 'door').length,
    roadConnectors: s.connectors.filter((c) => c.kind === 'road').length, openings: s.connectors.filter((c) => c.kind === 'passage').length, lanes: s.roads.length,
  };
  const tags = new Set<string>(), uses = new Set<string>();
  if (s.kind === 'street') { tags.add('rue'); const w = Math.min(...s.connectors.filter((c) => c.kind === 'road').map((c) => c.width)); if (w < 12) tags.add('rue étroite'); }
  if (s.kind === 'intersection') tags.add('carrefour');
  if (s.kind === 'courtyard') { tags.add('cour'); if (s.connectors.some((c) => c.kind === 'passage')) tags.add('accès depuis la rue'); }
  if (s.kind === 'interior') { tags.add('intérieur accessible'); if (seats >= 3) { uses.add('places assises'); s.capabilities.push('seating'); } }
  if (s.related.some((r) => r.kind === 'hasInterior' || r.kind === 'contains')) tags.add('avec intérieur');
  const extra = annotations[s.id];
  if (extra) { extra.tags?.forEach((t) => tags.add(t)); extra.uses?.forEach((u) => uses.add(u)); if (extra.name) s.name = extra.name; }
  s.annotations.inferred = { tags: [...tags], uses: [...uses] };
  if (s.members.some((m) => m.lod === 'LOD' || m.lod === 'SLOD')) s.capabilities.push('lod');
  s.capabilities = [...new Set(s.capabilities)];
}
for (const r of resources.values()) {
  const extra = annotations[r.id];
  if (r.measured.road) r.tags.push('route'); if (r.measured.building) r.tags.push('bâtiment'); if (r.measured.flatGround) r.tags.push('sol');
  if (r.kind === 'vehicle') r.tags.push('véhicule');
  if (extra) { r.tags.push(...(extra.tags ?? [])); r.inferred = { ...r.inferred, ...extra }; }
}
// LOD stand-ins at resource level, from the placements' hierarchy
for (const p of placed) if (p.parentKey) { const lp = byKey.get(p.parentKey); const r = resources.get(p.arch.assetName); if (lp && r && lp.arch.assetName !== r.id) r.lod = lp.arch.assetName; }

// ------------------------------------------------------------------ write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'res'), { recursive: true });
const zipFiles: Record<string, Uint8Array> = {};
for (const r of resources.values()) {
  const src = r.kind === 'character' ? path.join(charDir, `${r.source.file}`) : path.join(gltfDir, `${r.id}.glb`);
  const bytes = fs.readFileSync(src);
  fs.writeFileSync(path.join(OUT, r.file), bytes);
  zipFiles[r.file] = new Uint8Array(bytes);
}
const fixture = fs.existsSync(path.join(IN, 'fixture.json')) ? JSON.parse(fs.readFileSync(path.join(IN, 'fixture.json'), 'utf8')) : null;
const pkg: CwsPackage = {
  format: 'cws-package', version: 1, id: ID, name: args.name ?? ID, createdAt: new Date().toISOString(),
  source: {
    kind: (args.source as 'gta5' | 'fixture') ?? (fixture ? 'fixture' : 'gta5'), notGta: !!fixture,
    tools: { codewalker: '485d56bec00262ed7fa472261cce7bbc6202b96e', builder: 'tools/gta/pack/build-package.ts@1' },
    inputs: [...ymaps.values()].map((y) => ({ file: y.file })).concat(files(path.join(IN, 'xml/ytyp'), '.xml').map((f) => ({ file: path.basename(f) })), files(path.join(IN, 'xml/ynd'), '.xml').map((f) => ({ file: path.basename(f) }))),
    license: fixture ? fixture.licenses.join('; ') : 'Game content: for private use by its owner; not for redistribution.',
  },
  coordinate: { from: 'gta-zup', to: 'gltf-yup', mapping: '(x, y, z) -> (x, z, -y)' },
  resources: [...resources.values()],
  sets: sets.map((s) => { const { _origin, _box, _placed, ...rest } = internal(s); void _box; void _placed; return { ...rest, source: { ...rest.source, originYup: _origin } } as SetDef; }),
};
const json = JSON.stringify(pkg, null, 1);
fs.writeFileSync(path.join(OUT, 'package.json'), json);
zipFiles['package.json'] = new TextEncoder().encode(json);
fs.writeFileSync(`${OUT}.cwspkg`, zipSync(zipFiles, { level: 0 }));
const rep = { sets: sets.length, byKind: Object.fromEntries([...new Set(sets.map((s) => s.kind))].map((k) => [k, sets.filter((s) => s.kind === k).length])), resources: resources.size, missingDrawables: [...report.missingDrawables], unknownArchetypes: [...report.unknownArchetypes], warnings: report.warnings };
fs.writeFileSync(path.join(OUT, 'build-report.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep));
