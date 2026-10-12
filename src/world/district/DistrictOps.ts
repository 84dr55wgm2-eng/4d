import * as THREE from 'three';
import type { AssetRecord, BuildingSpec, Entity, Relation, Vec3, WorldDocument } from '../../core/types';

/**
 * Targeted, validated edits on a district document. Every function mutates a draft document passed by
 * WorldStore.commit (so it is one undoable step) and throws a precise error instead of half-applying.
 * Spatial semantics live in the relation graph: in(room), seatFor(desk), onSurface(desk), connects(door).
 */
export const WORKSTATION = {
  desk: 'lagos.desk', monitor: 'lagos.crt', keyboard: 'lagos.keyboard', tower: 'lagos.pc', chair: 'lagos.chair',
  /** desk footprint used for spacing; refined from asset bounds when available */
  deskWidth: 1.25, deskDepth: 0.65, aisle: 1.2,
};

const yawQ = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
export const quatArr = (deg: number) => yawQ(deg).toArray() as Entity['transform']['rotation'];

export function buildingMatrix(b: BuildingSpec) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...b.front), yawQ(b.yaw), new THREE.Vector3(1, 1, 1));
}

export function roomOf(doc: WorldDocument, roomId: string) {
  for (const b of doc.district?.buildings ?? []) {
    const r = b.rooms.find((x) => x.id === roomId);
    if (r) return { b, r };
  }
  throw new Error(`Pièce inconnue : ${roomId}`);
}

/** local (building) → world */
function toWorld(b: BuildingSpec, x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z).applyMatrix4(buildingMatrix(b));
}

function ent(id: string, name: string, type: Entity['type'], assetId: string, p: THREE.Vector3, yaw: number, caps: Entity['capabilities'], tags: string[], metadata: Record<string, unknown> = {}): Entity {
  return { id, name, type, assetId, transform: { position: p.toArray() as Vec3, rotation: quatArr(yaw), scale: [1, 1, 1] }, tags, capabilities: caps, metadata };
}

/**
 * One workstation = desk + CRT + keyboard + tower + chair, with relations.
 * Local frame: (x, z) in building coordinates is the desk centre against a wall; `face` is the yaw the
 * seated user looks at (toward the wall / screen).
 */
export function workstation(doc: WorldDocument, roomId: string, idx: string, x: number, z: number, face: number, assets: AssetRecord[]) {
  const { b, r } = roomOf(doc, roomId);
  const y = r.level * b.floorHeight + 0.21; // floor slab top (front at kerb level 0.15 + tile)
  const yaw = b.yaw + face;
  const fwd = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(face)), 0, Math.cos(THREE.MathUtils.degToRad(face)));
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const deskH = (assets.find((a) => a.id === WORKSTATION.desk)?.bounds?.[1] ?? 0.75);
  const at = (dx: number, dy: number, dz: number) => toWorld(b, x + right.x * dx + fwd.x * dz, y + dy, z + right.z * dx + fwd.z * dz);
  const id = (k: string) => `ws.${idx}.${k}`;
  const seat = -0.75; // chair centre behind the desk edge
  const list: Entity[] = [
    { ...ent(id('desk'), `Table du poste ${idx}`, 'FURNITURE', WORKSTATION.desk, at(0, 0, 0.1), yaw, ['selectable', 'movable', 'rotatable', 'collidable'], ['cybercafe', 'desk', 'surface'], { workstation: idx, worksurface: { height: deskH } }),
      transform: { position: at(0, 0, 0.1).toArray() as Vec3, rotation: quatArr(yaw), scale: [1, 1, 1.4] } },
    // one authored mesh: beige CRT monitor, tower, keyboard and mouse (screen faces the seated user)
    ent(id('crt'), `Ordinateur ${idx}`, 'PROP', WORKSTATION.monitor, at(0, deskH, 0.12), yaw + 180, ['selectable', 'movable', 'rotatable'], ['cybercafe', 'computer', 'crt'], { workstation: idx }),
    ent(id('chair'), `Chaise ${idx}`, 'CHAIR', WORKSTATION.chair, at(0, 0, seat), yaw, ['selectable', 'movable', 'rotatable', 'interactable', 'sittable'], ['cybercafe', 'chair'], {
      workstation: idx,
      // anchors in the chair's own frame (+z = where a seated person looks)
      interaction: { seat: [0, 0.43, -0.02], approach: [0.62, 0, -0.25], facing: 0, occupiedBy: null },
    }),
  ];
  const rel: Relation[] = [
    { kind: 'in', from: id('desk'), to: roomId },
    { kind: 'onSurface', from: id('crt'), to: id('desk') },
    { kind: 'seatFor', from: id('chair'), to: id('desk'), data: { useYaw: yaw } },
    { kind: 'faces', from: id('chair'), to: id('crt') },
  ];
  return { entities: list, relations: rel, footprint: rectAround(x, z, fwd, right, r.rect) };
}

function rectAround(x: number, z: number, fwd: THREE.Vector3, right: THREE.Vector3, _room: [number, number, number, number]) {
  // desk + chair zone in building-local coordinates, axis aligned (faces are multiples of 90°)
  const pts = [[-0.7, 0.4], [0.7, 0.4], [-0.7, -1.1], [0.7, -1.1]].map(([dx, dz]) => [x + right.x * dx + fwd.x * dz, z + right.z * dx + fwd.z * dz]);
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] as [number, number, number, number];
}

/** Slots along a wall of a room, in building-local coordinates. */
export function wallSlots(rect: [number, number, number, number], wall: 'left' | 'right' | 'back', margin = 0.8) {
  const [x0, z0, x1, z1] = rect, step = WORKSTATION.deskWidth + 0.35;
  const slots: { x: number; z: number; face: number }[] = [];
  if (wall === 'back') for (let x = x0 + margin + 0.6; x <= x1 - margin - 0.6; x += step) slots.push({ x, z: z0 + 0.38, face: 180 });
  else {
    const x = wall === 'left' ? x0 + 0.38 : x1 - 0.38, face = wall === 'left' ? -90 : 90;
    for (let z = z0 + margin + 0.6; z <= z1 - margin - 1.6; z += step) slots.push({ x, z, face });
  }
  return slots;
}

function occupied(doc: WorldDocument, roomId: string) {
  const { b } = roomOf(doc, roomId);
  const inv = buildingMatrix(b).invert();
  return doc.entities.filter((e) => (e.metadata?.workstation && e.type === 'FURNITURE') || e.tags.includes('counter')).map((e) => {
    const p = new THREE.Vector3(...e.transform.position).applyMatrix4(inv);
    return [p.x - 0.75, p.z - 1.2, p.x + 0.75, p.z + 1.2] as [number, number, number, number];
  });
}

const overlap = (a: number[], c: number[]) => a[0] < c[2] && a[2] > c[0] && a[1] < c[3] && a[3] > c[1];

/** « Ajoute deux postes le long de ce mur. » */
export function addWorkstations(doc: WorldDocument, roomId: string, count: number, wall: 'left' | 'right' | 'back', assets: AssetRecord[]) {
  if (!(count >= 1 && count <= 8)) throw new Error('Nombre de postes : 1 à 8');
  const { r } = roomOf(doc, roomId);
  const taken = occupied(doc, roomId);
  const free = wallSlots(r.rect, wall).filter((s) => {
    const fp = [s.x - 0.75, s.z - 0.75, s.x + 0.75, s.z + 0.75];
    return !taken.some((t) => overlap(fp, t));
  });
  if (free.length < count) throw new Error(`Place insuffisante le long du mur ${wall === 'left' ? 'gauche' : wall === 'right' ? 'droit' : 'du fond'} : ${free.length} emplacement(s) libre(s) pour ${count} demandé(s). Agrandis la pièce ou choisis un autre mur.`);
  const used = new Set(doc.entities.map((e) => e.metadata?.workstation as string).filter(Boolean));
  let k = 1;
  const made: string[] = [];
  for (const s of free.slice(0, count)) {
    while (used.has(String(k))) k++;
    used.add(String(k));
    const w = workstation(doc, roomId, String(k), s.x, s.z, s.face, assets);
    doc.entities.push(...w.entities);
    (doc.relations ??= []).push(...w.relations);
    made.push(`ws.${k}.desk`);
  }
  return made;
}

/** « Agrandis le cybercafé en conservant la rue. » — extends the building backward; facade and street untouched. */
export function enlargeRoom(doc: WorldDocument, roomId: string, metres: number) {
  if (!(metres > 0 && metres <= 8)) throw new Error('Agrandissement : 0,5 à 8 m');
  const { b, r } = roomOf(doc, roomId);
  const others = doc.district!.buildings.filter((x) => x !== b);
  const back = toWorld(b, 0, 0, -(b.depth + metres));
  // the back extension must stay clear of other buildings' footprints
  for (const o of others) {
    const m = buildingMatrix(o).invert(); const p = back.clone().applyMatrix4(m);
    if (p.x > -o.width / 2 && p.x < o.width / 2 && p.z < 0 && p.z > -o.depth) throw new Error(`L’extension toucherait ${o.name}`);
  }
  const before = r.rect[1];
  b.depth += metres;
  r.rect = [r.rect[0], r.rect[1] - metres, r.rect[2], r.rect[3]];
  // back-wall workstations move with the back wall
  const inv = buildingMatrix(b).invert();
  for (const e of doc.entities) {
    if (!e.metadata?.workstation) continue;
    const p = new THREE.Vector3(...e.transform.position).applyMatrix4(inv);
    if (p.z < before + 1.6) { p.z -= metres; e.transform.position = p.applyMatrix4(buildingMatrix(b)).toArray() as Vec3; }
  }
  return { depth: b.depth, rect: r.rect };
}

/** « Déplace cette chaise devant cet ordinateur. » — chair goes to the workstation's seat zone, facing it. */
export function seatChairAt(doc: WorldDocument, chairId: string, targetId: string) {
  const chair = doc.entities.find((e) => e.id === chairId);
  if (!chair || !chair.capabilities.includes('sittable')) throw new Error('Choisis une chaise');
  const target = doc.entities.find((e) => e.id === targetId);
  if (!target) throw new Error('Poste introuvable');
  const ws = target.metadata?.workstation as string | undefined;
  const desk = doc.entities.find((e) => e.metadata?.workstation === ws && e.type === 'FURNITURE');
  if (!desk) throw new Error('Cet objet n’appartient à aucun poste');
  if ((chair.metadata?.interaction as { occupiedBy?: string })?.occupiedBy) throw new Error('La chaise est occupée');
  const q = new THREE.Quaternion(...desk.transform.rotation);
  const p = new THREE.Vector3(0, 0, -0.85).applyQuaternion(q).add(new THREE.Vector3(...desk.transform.position));
  // another chair already in that seat zone?
  const clash = doc.entities.find((e) => e.id !== chairId && e.type === 'CHAIR' && new THREE.Vector3(...e.transform.position).distanceTo(p) < 0.45);
  if (clash) {
    // the seat is taken by an empty chair: swap places (and seat roles) rather than stacking two chairs
    if ((clash.metadata?.interaction as { occupiedBy?: string })?.occupiedBy) throw new Error(`${clash.name} est occupée`);
    const prev = doc.relations?.find((r) => r.kind === 'seatFor' && r.from === chairId)?.to;
    clash.transform.position = [...chair.transform.position] as Vec3;
    clash.transform.rotation = [...chair.transform.rotation] as Entity['transform']['rotation'];
    doc.relations = (doc.relations ?? []).filter((r) => !(r.kind === 'seatFor' && r.from === clash.id));
    if (prev) doc.relations.push({ kind: 'seatFor', from: clash.id, to: prev });
  }
  chair.transform.position = p.toArray() as Vec3;
  chair.transform.rotation = q.clone().toArray() as Entity['transform']['rotation'];
  doc.relations = (doc.relations ?? []).filter((r) => !(r.kind === 'seatFor' && r.from === chairId));
  doc.relations.push({ kind: 'seatFor', from: chairId, to: desk.id });
  return desk.id;
}

export type TimeOfDay = 'morning' | 'midday' | 'late_afternoon' | 'dusk';
export const SUN: Record<TimeOfDay, { azimuth: number; elevation: number; intensity: number; exposure: number }> = {
  morning: { azimuth: 75, elevation: 22, intensity: 3.0, exposure: 0.95 },
  midday: { azimuth: 160, elevation: 72, intensity: 3.6, exposure: 0.9 },
  late_afternoon: { azimuth: -95, elevation: 16, intensity: 3.2, exposure: 1.0 },
  dusk: { azimuth: -100, elevation: 4, intensity: 1.2, exposure: 1.15 },
};

/** « Passe en fin d’après-midi sans changer les bâtiments. » */
export function setTimeOfDay(doc: WorldDocument, t: TimeOfDay) {
  const s = SUN[t];
  if (!s) throw new Error('Moment inconnu');
  doc.environment.sun = { azimuth: s.azimuth, elevation: s.elevation, intensity: s.intensity };
  doc.environment.exposure = s.exposure;
  doc.worldState.timeOfDay = t as never;
}

/** Closed doors as world boxes (dynamic obstacles for the actor + path validation). */
export function closedDoorBoxes(doc: WorldDocument) {
  const out: { id: string; box: THREE.Box3 }[] = [];
  for (const e of doc.entities) {
    if (e.type !== 'DOOR') continue;
    const inter = (e.metadata?.interaction ?? {}) as { state?: string };
    if (inter.state === 'open') continue;
    const w = ((e.metadata?.procedural as { width?: number })?.width) ?? 1;
    const q = new THREE.Quaternion(...e.transform.rotation), p = new THREE.Vector3(...e.transform.position);
    const a = new THREE.Vector3(0, 0, 0.06).applyQuaternion(q).add(p), c = new THREE.Vector3(w, 2.2, -0.06).applyQuaternion(q).add(p);
    out.push({ id: e.id, box: new THREE.Box3().setFromPoints([a, c]) });
  }
  return out;
}
