import * as THREE from 'three';
import type { AssetRecord, DistrictPlan, Entity, Relation, Vec3, WorldDocument } from '../../core/types';
import { addWorkstations, buildingMatrix, quatArr, roomOf } from './DistrictOps';
import { CAFE } from './YabaPlan';

/**
 * Compose a playable Yaba document from a district plan: architecture comes from the plan, furniture and
 * street objects are authored assets (Poly Haven CC0, Objaverse CC-BY) placed with semantic relations.
 */
export function composeYabaWorld(plan: DistrictPlan, actor: Entity, assets: AssetRecord[], opts: { id?: string; name?: string; workstations?: number } = {}): WorldDocument {
  const missing = new Set<string>();
  const have = (id: string) => { if (!assets.some((a) => a.id === id)) { missing.add(id); return false; } return true; };
  const doc: WorldDocument = {
    format: 'cws-world', version: 3, id: opts.id ?? 'yaba', name: opts.name ?? 'Yaba, Lagos — 2003',
    environment: { hdri: 'hdri.pedestrian-overpass', sun: { azimuth: 150, elevation: 58, intensity: 3.5 }, exposure: 0.92 },
    district: structuredClone(plan),
    relations: [],
    sequences: [],
    spawn: { position: [-22, 0.31, -5.4], heading: Math.PI / 2 },
    zones: [
      { id: 'zone.street', name: 'Rue commerçante', kind: 'street', bounds: [-38, -7.4, 38, 7.4], tags: ['walkable', 'street'] },
      { id: CAFE.room, name: 'Cybercafé', kind: 'interior', bounds: [-12.4, -18.4, -0.8, -7.4], tags: ['interior', 'cybercafe'] },
    ],
    entities: [], shots: [], worldState: { timeOfDay: 'day' },
  };
  const E = doc.entities, R = doc.relations!;
  const hero = structuredClone(actor);
  hero.transform.position = [...doc.spawn.position];
  hero.transform.rotation = quatArr(THREE.MathUtils.radToDeg(doc.spawn.heading));
  E.push(hero);

  const put = (id: string, assetId: string, name: string, p: Vec3, yaw: number, caps: Entity['capabilities'] = ['selectable', 'movable', 'rotatable', 'collidable'], extra: Partial<Entity> = {}) => {
    if (!have(assetId)) return null;
    const a = assets.find((x) => x.id === assetId)!;
    const e: Entity = { id, name, type: a.entityType ?? 'PROP', assetId, transform: { position: p, rotation: quatArr(yaw), scale: [1, 1, 1] }, tags: [...a.tags], capabilities: caps, metadata: {}, ...extra };
    E.push(e);
    return e;
  };

  // ---------------------------------------------------------------- cybercafé
  const { b, r } = roomOf(doc, CAFE.room);
  const M = buildingMatrix(b);
  const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M).toArray() as Vec3;
  const floorY = 0.21;
  const door = b.openings.find((o) => o.kind === 'door')!;
  // door leaf: hinge at the left jamb, inside the wall reveal; opens inward (toward −z local)
  E.push({
    id: 'door.cafe', name: 'Porte du cybercafé', type: 'DOOR',
    transform: { position: L(door.offset - door.width / 2 + 0.02, 0.15, -0.14), rotation: quatArr(b.yaw), scale: [1, 1, 1] },
    tags: ['door', 'cybercafe', 'entrance'], capabilities: ['selectable', 'interactable', 'openable'],
    metadata: { procedural: { kind: 'door', width: door.width - 0.04, height: door.height - 0.04 },
      // hinge at the entity origin; approach from the street side
      interaction: { hinge: [0, 0, 0], approach: [door.width / 2, 0, 1.0], state: 'closed', closedYaw: b.yaw, openYaw: b.yaw + 92 } },
  });
  R.push({ kind: 'connects', from: 'door.cafe', to: CAFE.room, data: { other: 'zone.street' } });

  // light bank (switchable) on the ceiling
  const [x0, z0, x1, z1] = r.rect;
  const fixtures: Vec3[] = [];
  for (let x = x0 + 1.9; x < x1 - 1; x += 3.2) for (let z = z0 + 1.8; z < z1 - 1; z += 3) fixtures.push([x - (x0 + x1) / 2, 0, z - (z0 + z1) / 2]);
  E.push({
    id: 'light.cafe', name: 'Néons du cybercafé', type: 'LIGHT',
    transform: { position: L((x0 + x1) / 2, b.floorHeight - 0.27, (z0 + z1) / 2), rotation: quatArr(b.yaw), scale: [1, 1, 1] },
    tags: ['light', 'fluorescent', 'cybercafe'], capabilities: ['selectable', 'interactable', 'toggleable'],
    metadata: { procedural: { kind: 'light_bank', fixtures, yaw: 90 },
      // the switch is by the door, inside: approach anchor in the bank's local frame
      interaction: { enabled: true, color: '#eef6ff', intensity: 26, distance: 16, approach: [door.offset - (x0 + x1) / 2 + 1.1, -(b.floorHeight - 0.27) + floorY, -0.9 - (z0 + z1) / 2] } },
  });
  R.push({ kind: 'in', from: 'light.cafe', to: CAFE.room });

  // attendant counter near the entrance, TV on it, wall clock, ceiling fans, price board outside
  const counter = put('cafe.counter', 'lagos.counter', 'Comptoir', L(x1 - 1.6, floorY, z1 - 2.4), b.yaw - 90);
  if (counter) R.push({ kind: 'in', from: counter.id, to: CAFE.room });
  put('cafe.tv', 'lagos.tv', 'Télévision', L(x1 - 1.4, floorY + 0.79, z1 - 2.9), b.yaw - 120, ['selectable', 'movable', 'rotatable']);
  put('cafe.attendant_chair', 'lagos.chair', 'Chaise du gérant', L(x1 - 0.6, floorY, z1 - 2.4), b.yaw - 90, ['selectable', 'movable', 'rotatable', 'interactable', 'sittable'],
    { metadata: { interaction: { seat: [0, 0.43, -0.02], approach: [0.62, 0, -0.25], facing: 0, occupiedBy: null } } });
  put('cafe.radio', 'lagos.radio', 'Radio-cassette', L(x1 - 1.9, floorY + 0.79, z1 - 2.2), b.yaw - 70, ['selectable', 'movable', 'rotatable', 'interactable', 'pickable'],
    { metadata: { interaction: { pickable: true, heldBy: null } } });
  put('cafe.clock', 'lagos.clock', 'Horloge', L(0, 2.4, z0 + 0.06), b.yaw, ['selectable', 'movable', 'rotatable']);
  put('cafe.fan1', 'lagos.fan', 'Ventilateur 1', L(-2.2, b.floorHeight - 0.82, (z0 + z1) / 2 - 1.5), b.yaw, ['selectable', 'movable', 'rotatable']);
  put('cafe.fan2', 'lagos.fan', 'Ventilateur 2', L(2.2, b.floorHeight - 0.82, (z0 + z1) / 2 + 1.5), b.yaw, ['selectable', 'movable', 'rotatable']);
  put('cafe.board', 'lagos.chalkboard', 'Ardoise « Browsing ₦150/hr »', L(door.offset + 1.7, -0.07, 1.25), b.yaw + 160);

  // workstations: three along each side wall (relations: in room, onSurface desk, seatFor desk)
  const want = opts.workstations ?? 6;
  if (have('lagos.desk') && have('lagos.crt') && have('lagos.chair')) {
    addWorkstations(doc, CAFE.room, Math.ceil(want / 2), 'left', assets);
    addWorkstations(doc, CAFE.room, Math.floor(want / 2), 'right', assets);
  }

  // ---------------------------------------------------------------- street life (authored props)
  const S = -1; // south walkway z ≈ −5.8
  const walk = (x: number, side: number, inset = 1.6): Vec3 => [x, 0.08, side * (7.4 - inset)];
  put('st.gen1', 'lagos.generator', 'Groupe électrogène', walk(14.3, S, 0.9), 15);
  put('st.can1', 'lagos.jerrycan', 'Jerrican', walk(15.4, S, 0.6), -20, ['selectable', 'movable', 'rotatable', 'interactable', 'pickable'], { metadata: { interaction: { pickable: true, heldBy: null } } });
  put('st.crates', 'lagos.crate', 'Casiers de bouteilles', walk(-31.2, S, 0.6), 4);
  put('st.crates2', 'lagos.crate', 'Casiers de bouteilles', walk(-30.4, S, 0.6), -8);
  put('st.bench1', 'lagos.bench', 'Banc', walk(5.6, 1, 0.75), 180);
  put('st.stool1', 'lagos.stool', 'Tabouret', walk(7.4, 1, 1.3), 30);
  put('st.chair_out', 'lagos.chair', 'Chaise monobloc', walk(-15.6, 1, 1.4), 200, ['selectable', 'movable', 'rotatable', 'interactable', 'sittable'],
    { metadata: { interaction: { seat: [0, 0.43, -0.02], approach: [0.62, 0, -0.25], facing: 0, occupiedBy: null } } });
  put('st.barrel', 'lagos.barrel', 'Fût', walk(27.8, S, 0.7), 0);
  put('st.tyres', 'lagos.tyre', 'Pneus', walk(29.0, S, 0.9), 0);
  put('st.trash', 'lagos.trashcan', 'Poubelle', walk(-3.5, 1, 0.6), 90);
  put('st.trashbag', 'lagos.trashbag', 'Sac poubelle', walk(-2.4, 1, 0.5), 10);
  put('st.box', 'lagos.box', 'Carton', walk(-17.6, S, 0.6), 25, ['selectable', 'movable', 'rotatable', 'interactable', 'pickable'], { metadata: { interaction: { pickable: true, heldBy: null } } });
  put('st.planter', 'lagos.planter', 'Bac à plantes', walk(4.8, S, 0.55), 0);
  put('st.powerbox', 'lagos.powerbox', 'Coffret électrique', walk(-12.9, S, 0.3), 0);
  // vehicles parked on the carriageway edge (period-compatible: 504 estate, Corolla E70, a covered car)
  put('veh.504', 'lagos.peugeot504', 'Peugeot 504 break', [9.5, 0.0, -2.3], 180);
  put('veh.corolla', 'lagos.corolla', 'Toyota Corolla', [-26, 0.0, 2.4], 0);
  put('veh.covered', 'lagos.covered_car', 'Voiture bâchée', [24, 0.0, 2.5], 90);
  // utility poles on the north walkway, wires drawn by the builder from plan.street poles
  const poles: Vec3[] = [];
  for (let x = -33; x <= 33; x += 16.5) poles.push([x, 0.08, 6.6]);
  poles.forEach((p, i) => put(`pole.${i}`, i === 2 ? 'lagos.pole_transformer' : 'lagos.pole', i === 2 ? 'Poteau avec transformateur' : 'Poteau électrique', p, 0, ['selectable', 'collidable']));
  (doc.district as DistrictPlan & { poles?: Vec3[] }).poles = poles;
  // facade air-conditioners (upper floors)
  for (const bb of doc.district!.buildings) {
    if (bb.floors < 2 || bb.id === 'b.e' || bb.id === 'b.w') continue;
    const m = buildingMatrix(bb);
    const p = new THREE.Vector3(bb.width / 2 - 1.0, bb.floorHeight + 0.6, 0.22).applyMatrix4(m).toArray() as Vec3;
    put(`ac.${bb.id}`, 'lagos.aircon', 'Climatiseur', p, bb.yaw, ['selectable']);
  }

  for (const e of E) if (e.type !== 'ACTOR' && !R.some((x) => x.from === e.id && x.kind === 'in')) {
    const z = doc.zones.find((zz) => e.transform.position[0] >= zz.bounds[0] && e.transform.position[0] <= zz.bounds[2] && e.transform.position[2] >= zz.bounds[1] && e.transform.position[2] <= zz.bounds[3]);
    if (z) R.push({ kind: 'in', from: e.id, to: z.id });
  }
  doc.district!.requires = [...new Set(E.flatMap((e) => (e.assetId ? [e.assetId] : [])))];
  doc.district!.missing = [...missing];
  return doc;
}

export const YABA_RELATION_KINDS: Relation['kind'][] = ['in', 'seatFor', 'onSurface', 'connects', 'faces', 'partOf'];
