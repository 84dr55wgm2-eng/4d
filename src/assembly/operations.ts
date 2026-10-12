import * as THREE from 'three';
import type { Assembly, Entity, Vec3 } from '../core/types';
import type { Catalog } from '../content/Catalog';
import type { SetConnector, SetDef } from '../content/package';
import { applySceneChanges, mergeSceneChanges } from '../vendor/pascal/apply-changes';
import { refuse } from '../vendor/pascal/refusal';
import { aabbsOverlap, findValidPlacement, itemPlanAabb, type PlanAabb } from '../vendor/pascal/layout-clearance';
import type { AgentOperation, AnyNode, SceneChanges, SceneNodes } from '../vendor/pascal/types';
import { resourceAssetId } from './AssemblyRuntime';

/**
 * Assembly operations, written to Pascal's AgentOperation contract (vendor/pascal/types.ts): each one reads the
 * scene's nodes (the studio's entities) and returns its result and the changes it asks for, or refuses with a
 * reason. The host previews the changes (applySceneChanges), verifies the scene, then commits them as one undo
 * step; a plan of several operations is merged first (mergeSceneChanges). Junctions travel as Pascal collections.
 */
export interface AssemblyContext { activeLevelId: null; catalog: Catalog; junctions: Assembly['junctions'] }
type Op<I> = (nodes: SceneNodes, input: I, ctx: AssemblyContext) => { result: Record<string, unknown>; changes?: SceneChanges };

const ent = (n: AnyNode | undefined) => n as unknown as Entity | undefined;
const yawQuat = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
const yawOfQ = (q: number[]) => THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]), 'YXZ').y);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const placements = (nodes: SceneNodes) => Object.values(nodes).map(ent).filter((e): e is Entity => e?.type === 'SET');
const setOf = (ctx: AssemblyContext, e: Entity): SetDef => {
  const ref = (e.metadata?.set as { ref: string }).ref;
  const hit = ctx.catalog.set(ref);
  if (!hit) refuse('set_unavailable', `L’ensemble ${ref} n’est pas dans le catalogue (paquet non importé dans ce navigateur).`, { ref });
  return hit!.set;
};
const placement = (nodes: SceneNodes, id: string) => {
  const e = ent(nodes[id]);
  if (!e || e.type !== 'SET') refuse('unknown_placement', `Aucun ensemble placé avec l’id ${id}.`, { id, placements: placements(nodes).map((p) => p.id) });
  return e!;
};
const findConnector = (s: SetDef, id: string) => {
  const c = s.connectors.find((x) => x.id === id || x.id.endsWith(`/${id}`));
  if (!c) refuse('unknown_connector', `Le raccord « ${id} » n’existe pas sur ${s.name}.`, { available: s.connectors.map((x) => ({ id: x.id, kind: x.kind })) });
  return c!;
};
/** connector in world space for a placement transform */
export function worldConnector(e: Pick<Entity, 'transform'>, c: SetConnector) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(1, 1, 1));
  return { p: new THREE.Vector3(...c.position).applyMatrix4(m), n: new THREE.Vector3(...c.normal).transformDirection(m).setY(0).normalize() };
}
/** rotated footprint → plan AABB (Pascal's itemPlanAabb on the set's centre and size) */
function planBox(e: Entity, s: SetDef): PlanAabb {
  const b = s.bounds, c = new THREE.Vector3((b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2).applyQuaternion(new THREE.Quaternion(...e.transform.rotation)).add(new THREE.Vector3(...e.transform.position));
  return itemPlanAabb([c.x, 0, c.z], [b.max[0] - b.min[0], 0, b.max[2] - b.min[2]], THREE.MathUtils.degToRad(yawOfQ(e.transform.rotation)));
}
/** rotated rectangle corners in XZ, for exact overlap tests (separating axis) */
function corners(e: Entity, s: SetDef, shrink = 0) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(1, 1, 1));
  const b = s.bounds;
  return [[b.min[0] + shrink, b.min[2] + shrink], [b.max[0] - shrink, b.min[2] + shrink], [b.max[0] - shrink, b.max[2] - shrink], [b.min[0] + shrink, b.max[2] - shrink]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(m));
}
function polysOverlap(a: THREE.Vector3[], b: THREE.Vector3[]) {
  for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
    const p = poly[i], q = poly[(i + 1) % 4], ax = -(q.z - p.z), az = q.x - p.x;
    const proj = (pts: THREE.Vector3[]) => pts.map((v) => v.x * ax + v.z * az);
    const pa = proj(a), pb = proj(b);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}
const newId = (nodes: SceneNodes, base: string) => { const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24); let i = 1; while (nodes[`set_${slug}_${i}`]) i++; return `set_${slug}_${i}`; };
const setEntity = (id: string, name: string, ref: string, pos: Vec3, yaw: number): Entity => ({
  id, type: 'SET', name, transform: { position: pos.map(r3) as Vec3, rotation: yawQuat(yaw).toArray().map(r3) as Entity['transform']['rotation'], scale: [1, 1, 1] },
  tags: ['set'], capabilities: ['selectable', 'movable', 'rotatable'], metadata: { set: { ref }, procedural: { kind: 'set' } },
});

// ------------------------------------------------------------------ operations
/** Place an imported set. Without a position, the nearest free spot east of the current assembly (Pascal placement search). */
export const placeSet: Op<{ ref: string; position?: Vec3; yaw?: number; name?: string }> = (nodes, input, ctx) => {
  const hit = ctx.catalog.set(input.ref);
  if (!hit) refuse('set_unavailable', `Ensemble introuvable : ${input.ref}. Utilise search_sets pour obtenir une référence existante.`, { ref: input.ref });
  const s = hit!.set, yaw = input.yaw ?? 0;
  let pos = input.position;
  if (!pos) {
    const occupied = placements(nodes).map((p) => planBox(p, setOf(ctx, p)));
    const east = occupied.length ? Math.max(...occupied.map((o) => o.maxX)) + (s.bounds.max[0] - s.bounds.min[0]) / 2 + 4 : 0;
    const found = findValidPlacement({ primary: { x: east, z: 0, rotationDeg: yaw }, dimensions: [s.bounds.max[0] - s.bounds.min[0], 0, s.bounds.max[2] - s.bounds.min[2]], doorKeepouts: [], occupied, lateralsM: [0, 10, -10, 20, -20, 40, -40], insetsM: [0, 15, 30] });
    if (!found.candidate) refuse('no_free_space', 'Aucun emplacement libre trouvé autour de l’assemblage ; donne une position.', { reason: found.reason });
    pos = [found.candidate!.x, 0, found.candidate!.z];
  }
  const id = newId(nodes, s.kind + '_' + (s.source.region ?? s.source.mlo ?? ''));
  const e = setEntity(id, input.name ?? s.name, input.ref, pos, yaw);
  return { result: { placement: id, ref: input.ref, kind: s.kind, position: e.transform.position, yaw, connectors: s.connectors.map((c) => ({ id: c.id, kind: c.kind })) }, changes: { create: [{ node: e as unknown as AnyNode }] } };
};

/**
 * Join two placements by connectors: B moves so that its connector meets A's — same point, normals facing each
 * other (street end to street end, passage to sidewalk); an interior's door goes onto a facade door with the same
 * outward direction. A keeps its place.
 */
export const connectSets: Op<{ a: { placement: string; connector: string }; b: { placement: string; connector: string } }> = (nodes, input, ctx) => {
  const A = placement(nodes, input.a.placement), B = placement(nodes, input.b.placement);
  if (A.id === B.id) refuse('same_placement', 'Un ensemble ne se raccorde pas à lui-même.');
  const sa = setOf(ctx, A), sb = setOf(ctx, B);
  const ca = findConnector(sa, input.a.connector), cb = findConnector(sb, input.b.connector);
  const wa = worldConnector(A, ca);
  const sameDirection = (sb.kind === 'interior' && ca.kind === 'door') || (sa.kind === 'interior' && cb.kind === 'door');
  const want = sameDirection ? wa.n.clone() : wa.n.clone().negate();
  const local = new THREE.Vector3(...cb.normal);
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(want.x, want.z) - Math.atan2(local.x, local.z));
  const q = yawQuat(yaw);
  const pos = wa.p.clone().sub(new THREE.Vector3(...cb.position).applyQuaternion(q));
  const kindOk = ca.kind === cb.kind || (['sidewalk', 'passage', 'open', 'door'].includes(ca.kind) && ['sidewalk', 'passage', 'open', 'door'].includes(cb.kind));
  if (!kindOk) refuse('incompatible_connectors', `Un raccord ${ca.kind} ne se joint pas à un raccord ${cb.kind} (voie avec voie, accès piéton avec accès piéton).`, { a: ca.kind, b: cb.kind });
  const id = `junction_${A.id}_${B.id}_${ca.id.split('/').at(-1)}`;
  const junction = { id, a: { placement: A.id, connector: ca.id }, b: { placement: B.id, connector: cb.id }, kind: `${ca.kind}-${cb.kind}` };
  // junctions that B had keep it where it was: moving B breaks them, so they are dropped and reported
  const broken = ctx.junctions.filter((j) => j.a.placement === B.id || j.b.placement === B.id).map((j) => j.id);
  return {
    result: { junction: id, moved: B.id, position: pos.toArray().map(r3), yaw: r3(yaw), widthA: ca.width, widthB: cb.width, brokenJunctions: broken, widthMismatch: Math.abs(ca.width - cb.width) > 1 ? `${ca.width} m ↔ ${cb.width} m` : null },
    changes: { update: [{ id: B.id, data: { transform: { ...B.transform, position: pos.toArray().map(r3) as Vec3, rotation: q.toArray().map(r3) as Entity['transform']['rotation'] } } as Partial<AnyNode> }], collections: { [id]: junction, ...Object.fromEntries(broken.map((b) => [b, null])) } },
  };
};

export const moveSet: Op<{ placement: string; position?: Vec3; yaw?: number; by?: Vec3 }> = (nodes, input, ctx) => {
  const e = placement(nodes, input.placement);
  const pos = input.position ?? (input.by ? e.transform.position.map((v, i) => v + input.by![i]) as Vec3 : e.transform.position);
  const rot = input.yaw !== undefined ? yawQuat(input.yaw).toArray().map(r3) as Entity['transform']['rotation'] : e.transform.rotation;
  const broken = ctx.junctions.filter((j) => j.a.placement === e.id || j.b.placement === e.id).map((j) => j.id);
  return { result: { placement: e.id, position: pos.map(r3), yaw: r3(yawOfQ(rot)), brokenJunctions: broken }, changes: { update: [{ id: e.id, data: { transform: { ...e.transform, position: pos.map(r3) as Vec3, rotation: rot } } as Partial<AnyNode> }], collections: Object.fromEntries(broken.map((b) => [b, null])) } };
};

/** Swap a placement's set for another one, keeping its junctions when the new set has connectors of the same kinds. */
export const replaceSet: Op<{ placement: string; ref: string }> = (nodes, input, ctx) => {
  const e = placement(nodes, input.placement);
  const hit = ctx.catalog.set(input.ref);
  if (!hit) refuse('set_unavailable', `Ensemble introuvable : ${input.ref}.`);
  const old = setOf(ctx, e), ns = hit!.set;
  const js = ctx.junctions.filter((j) => j.a.placement === e.id || j.b.placement === e.id);
  let transform = e.transform;
  const kept: string[] = [], dropped: string[] = [];
  const collections: Record<string, unknown> = {};
  for (const j of js) {
    const mine = j.a.placement === e.id ? j.a : j.b, other = j.a.placement === e.id ? j.b : j.a;
    const oc = old.connectors.find((c) => c.id === mine.connector);
    const cand = ns.connectors.filter((c) => c.kind === oc?.kind).sort((p, q) => new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...oc!.position)) - new THREE.Vector3(...q.position).distanceTo(new THREE.Vector3(...oc!.position)))[0];
    if (!oc || !cand) { dropped.push(j.id); collections[j.id] = null; continue; }
    if (!kept.length) {
      // align the new set on the first junction it can keep
      const tmp = { ...nodes, [e.id]: { ...e, metadata: { set: { ref: input.ref } } } as unknown as AnyNode };
      const r = connectSets(tmp, { a: other, b: { placement: e.id, connector: cand.id } }, { ...ctx, junctions: [] });
      transform = (r.changes!.update![0].data as unknown as Entity).transform;
    }
    kept.push(j.id);
    collections[j.id] = { ...j, ...(j.a.placement === e.id ? { a: { placement: e.id, connector: cand.id } } : { b: { placement: e.id, connector: cand.id } }) };
  }
  return { result: { placement: e.id, from: (e.metadata?.set as { ref: string }).ref, to: input.ref, keptJunctions: kept, droppedJunctions: dropped }, changes: { update: [{ id: e.id, data: { name: ns.name, transform, metadata: { ...e.metadata, set: { ref: input.ref } } } as Partial<AnyNode> }], collections: collections as SceneChanges['collections'] } };
};

export const removeSet: Op<{ placement: string }> = (nodes, input, ctx) => {
  const e = placement(nodes, input.placement);
  const broken = ctx.junctions.filter((j) => j.a.placement === e.id || j.b.placement === e.id).map((j) => j.id);
  // entities standing in it (population, props) go with it
  const inside = Object.values(nodes).map(ent).filter((x) => x && x.parentId === e.id).map((x) => x!.id);
  return { result: { removed: e.id, alsoRemoved: inside, brokenJunctions: broken }, changes: { delete: [e.id, ...inside], collections: Object.fromEntries(broken.map((b) => [b, null])) } };
};

/** Hide some members of a placed set (replace part of the décor with something else placed separately). */
export const hideMembers: Op<{ placement: string; members: string[] }> = (nodes, input, ctx) => {
  const e = placement(nodes, input.placement), s = setOf(ctx, e);
  const unknown = input.members.filter((m) => !s.members.some((x) => x.id === m));
  if (unknown.length) refuse('unknown_members', `Membres inconnus : ${unknown.join(', ')}`, { members: s.members.slice(0, 40).map((m) => ({ id: m.id, resource: m.resource })) });
  const prev = (e.metadata?.set as { hiddenMembers?: string[] }).hiddenMembers ?? [];
  const hiddenMembers = [...new Set([...prev, ...input.members])];
  return { result: { placement: e.id, hidden: hiddenMembers }, changes: { update: [{ id: e.id, data: { metadata: { ...e.metadata, set: { ...(e.metadata?.set as object), hiddenMembers } } } as Partial<AnyNode> }] } };
};

/**
 * People, vehicles or props from a package, placed in a placement (at a connector, a room or its centre) with a
 * behaviour the simulation runs (wander, customer, sit, drive, idle).
 */
export const addEntities: Op<{ resource: string; count?: number; placement: string; at?: string; behavior?: 'wander' | 'customer' | 'sit' | 'drive' | 'idle'; name?: string }> = (nodes, input, ctx) => {
  const hit = ctx.catalog.resource(input.resource);
  if (!hit) refuse('resource_unavailable', `Ressource introuvable : ${input.resource}. Utilise search_resources.`);
  const e = placement(nodes, input.placement), s = setOf(ctx, e);
  const count = Math.max(1, Math.min(40, input.count ?? 1));
  const base = (() => {
    if (input.at) {
      const room = s.rooms.find((r) => r.id === input.at || r.id.endsWith(`/${input.at}`) || r.name === input.at);
      if (room) return { p: new THREE.Vector3((room.bounds.min[0] + room.bounds.max[0]) / 2, room.bounds.min[1] + 0.1, (room.bounds.min[2] + room.bounds.max[2]) / 2), spread: Math.min(room.bounds.max[0] - room.bounds.min[0], room.bounds.max[2] - room.bounds.min[2]) / 3 };
      const c = findConnector(s, input.at);
      return { p: new THREE.Vector3(...c.position).addScaledVector(new THREE.Vector3(...c.normal), c.kind === 'door' ? -1.5 : -2), spread: Math.min(3, c.width / 2) };
    }
    return { p: new THREE.Vector3((s.bounds.min[0] + s.bounds.max[0]) / 2, 0.2, (s.bounds.min[2] + s.bounds.max[2]) / 2), spread: 4 };
  })();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(1, 1, 1));
  const kind = hit!.res.kind;
  const created: AnyNode[] = [];
  const behavior = input.behavior ?? (kind === 'vehicle' ? 'drive' : kind === 'character' ? 'wander' : 'idle');
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2, rr = count > 1 ? base.spread * (0.4 + 0.6 * ((i * 7919) % 13) / 13) : 0;
    const p = base.p.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)).applyMatrix4(m);
    let id = `${kind}_${hit!.res.id}_${i + 1}`.replace(/[^a-z0-9_]/gi, '_'); let k = i + 1; while (nodes[id] || created.some((c) => c.id === id)) id = `${kind}_${hit!.res.id}_${++k}`.replace(/[^a-z0-9_]/gi, '_');
    const en: Entity = {
      id, type: kind === 'vehicle' ? 'VEHICLE' : 'PROP', name: `${input.name ?? hit!.res.id} ${i + 1}`, assetId: resourceAssetId(hit!.pkg.id, hit!.res.id), parentId: e.id,
      transform: { position: p.toArray().map(r3) as Vec3, rotation: yawQuat(THREE.MathUtils.radToDeg(-a)).toArray().map(r3) as Entity['transform']['rotation'], scale: [1, 1, 1] },
      tags: [kind, ...hit!.res.tags], capabilities: ['selectable', 'movable', 'rotatable'],
      metadata: { sim: { kind: kind === 'vehicle' ? 'vehicle' : kind === 'character' ? 'person' : 'prop', behavior, home: input.placement, area: input.at ?? null }, ...(kind === 'vehicle' || kind === 'character' ? { procedural: { kind: 'sim' } } : {}) },
    };
    created.push(en as unknown as AnyNode);
  }
  return { result: { created: created.map((c) => c.id), kind, behavior, placement: e.id }, changes: { create: created.map((node) => ({ node })) } };
};

// ------------------------------------------------------------------ verification (pure)
export type Issue = { code: string; severity: 'blocking' | 'warning' | 'info'; message: string; ids: string[] };
/**
 * Scene checks on the assembly: overlapping placements, broken junctions (connectors apart), floor steps at
 * junctions, doors blocked by another placement, isolated placements. Navigation continuity needs the navmesh and
 * is checked by the host on top of this.
 */
export function verifyAssembly(nodes: SceneNodes, ctx: AssemblyContext): Issue[] {
  const issues: Issue[] = [];
  const ps = placements(nodes);
  const sets = new Map(ps.map((p) => [p.id, ctx.catalog.set((p.metadata?.set as { ref: string }).ref)?.set]));
  for (const p of ps) if (!sets.get(p.id)) issues.push({ code: 'set_unavailable', severity: 'blocking', message: `${p.name} : ensemble absent (paquet non importé).`, ids: [p.id] });
  const valid = ps.filter((p) => sets.get(p.id));
  const linked = (a: string, b: string) => ctx.junctions.some((j) => (j.a.placement === a && j.b.placement === b) || (j.a.placement === b && j.b.placement === a));
  for (let i = 0; i < valid.length; i++) for (let k = i + 1; k < valid.length; k++) {
    const a = valid[i], b = valid[k];
    // a joined pair may touch along the joint; 0.4 m of tolerance on every side
    if (polysOverlap(corners(a, sets.get(a.id)!, 0.4), corners(b, sets.get(b.id)!, linked(a.id, b.id) ? 0.8 : 0.4)))
      issues.push({ code: 'overlap', severity: 'blocking', message: `${a.name} et ${b.name} se chevauchent.`, ids: [a.id, b.id] });
  }
  for (const j of ctx.junctions) {
    const A = ent(nodes[j.a.placement]), B = ent(nodes[j.b.placement]);
    if (!A || !B) { issues.push({ code: 'junction_dangling', severity: 'warning', message: `Raccord ${j.id} sans ensemble.`, ids: [j.id] }); continue; }
    const ca = sets.get(A.id)?.connectors.find((c) => c.id === j.a.connector), cb = sets.get(B.id)?.connectors.find((c) => c.id === j.b.connector);
    if (!ca || !cb) continue;
    const wa = worldConnector(A, ca), wb = worldConnector(B, cb);
    const gap = Math.hypot(wa.p.x - wb.p.x, wa.p.z - wb.p.z);
    if (gap > 0.3) issues.push({ code: 'junction_open', severity: 'blocking', message: `Le raccord entre ${A.name} et ${B.name} est ouvert de ${gap.toFixed(1)} m.`, ids: [A.id, B.id, j.id] });
    if (Math.abs(wa.p.y - wb.p.y) > 0.15) issues.push({ code: 'floor_step', severity: 'warning', message: `Marche de ${Math.abs(wa.p.y - wb.p.y).toFixed(2)} m au raccord ${A.name} / ${B.name}.`, ids: [A.id, B.id] });
  }
  // doors: 1.2 m in front must not fall inside another placement (Pascal door keep-out, applied to accesses)
  for (const p of valid) for (const c of sets.get(p.id)!.connectors.filter((x) => x.kind === 'door' && !(x.data as { interior?: string } | undefined)?.interior)) {
    const w = worldConnector(p, c), front = w.p.clone().addScaledVector(w.n, 1.2);
    const keep: PlanAabb = { minX: front.x - 0.6, maxX: front.x + 0.6, minZ: front.z - 0.6, maxZ: front.z + 0.6 };
    for (const q of valid) if (q.id !== p.id && !linked(p.id, q.id) && aabbsOverlap(keep, planBox(q, sets.get(q.id)!)) && polysOverlap(corners(q, sets.get(q.id)!, 0.3), [new THREE.Vector3(keep.minX, 0, keep.minZ), new THREE.Vector3(keep.maxX, 0, keep.minZ), new THREE.Vector3(keep.maxX, 0, keep.maxZ), new THREE.Vector3(keep.minX, 0, keep.maxZ)]))
      issues.push({ code: 'door_blocked', severity: 'blocking', message: `L’accès ${c.id.split('/').at(-1)} de ${p.name} donne sur ${q.name}.`, ids: [p.id, q.id] });
  }
  if (valid.length > 1) for (const p of valid) if (!ctx.junctions.some((j) => j.a.placement === p.id || j.b.placement === p.id))
    issues.push({ code: 'isolated', severity: 'warning', message: `${p.name} n’est raccordé à rien : on ne peut y aller qu’en traversant le vide.`, ids: [p.id] });
  return issues;
}

// ------------------------------------------------------------------ transactions
export const OPERATIONS = { place_set: placeSet, connect_sets: connectSets, move_set: moveSet, replace_set: replaceSet, remove_set: removeSet, hide_members: hideMembers, add_entities: addEntities } as const satisfies Record<string, AgentOperation<never> | Op<never>>;
export type OperationName = keyof typeof OPERATIONS;

/** "$0" (or "$0.placement") in a step input = the placement created/handled by step 0 of the same transaction */
function resolveRefs(v: unknown, results: Record<string, unknown>[]): unknown {
  if (typeof v === 'string') {
    const m = v.match(/^\$(\d+)(?:\.(\w+))?$/);
    if (!m) return v;
    const r = results[+m[1]];
    if (!r) refuse('bad_step_reference', `Référence ${v} : l’étape ${m[1]} n’existe pas encore dans cette transaction.`);
    return r![m[2] ?? 'placement'];
  }
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, results));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, results)]));
  return v;
}

/**
 * Run several operations as one transaction: each sees the scene as the previous ones left it (preview), the
 * changes are merged (Pascal mergeSceneChanges) and verified before anything is committed.
 */
export function planTransaction(nodes: SceneNodes, steps: { op: OperationName; input: Record<string, unknown> }[], ctx: AssemblyContext) {
  let view = nodes;
  let junctions = [...ctx.junctions];
  const results: Record<string, unknown>[] = [];
  const all: SceneChanges[] = [];
  steps.forEach((s, i) => {
    const op = OPERATIONS[s.op] as Op<Record<string, unknown>>;
    if (!op) refuse('unknown_operation', `Opération inconnue : ${s.op}`, { available: Object.keys(OPERATIONS) });
    let out;
    try { out = op(view, resolveRefs(s.input, results) as Record<string, unknown>, { ...ctx, junctions }); }
    catch (e) { (e as { details?: Record<string, unknown> }).details = { ...(e as { details?: Record<string, unknown> }).details, step: i, op: s.op }; throw e; }
    results.push({ op: s.op, ...out.result });
    if (out.changes) {
      all.push(out.changes);
      view = applySceneChanges(view, out.changes);
      for (const [k, v] of Object.entries(out.changes.collections ?? {})) junctions = v === null ? junctions.filter((j) => j.id !== k) : [...junctions.filter((j) => j.id !== k), v as unknown as Assembly['junctions'][number]];
    }
  });
  const merged = mergeSceneChanges(all);
  const issues = verifyAssembly(view, { ...ctx, junctions });
  return { results, changes: merged, preview: view, junctions, issues };
}
