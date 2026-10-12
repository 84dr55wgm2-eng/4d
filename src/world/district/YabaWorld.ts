import * as THREE from 'three';
import type { AssetRecord, DistrictPlan, Entity, Relation, Trade, Vec3, WorldDocument } from '../../core/types';
import { addWorkstations, buildingMatrix, quatArr, roomOf, ROOM_FLOOR } from './DistrictOps';
import { CAFE } from './YabaPlan';
import { seeded } from './Materials';

/**
 * Compose a playable Yaba document from a district plan: architecture comes from the plan, furniture and
 * street objects are authored assets (Poly Haven CC0, Objaverse CC-BY) placed with semantic relations.
 */
export function composeYabaWorld(plan: DistrictPlan, actor: Entity, assets: AssetRecord[], opts: { id?: string; name?: string; workstations?: number; layout?: 'sides' | 'back' | 'sides+back' } = {}): WorldDocument {
  const missing = new Set<string>();
  const have = (id: string) => { if (!assets.some((a) => a.id === id)) { missing.add(id); return false; } return true; };
  const doc: WorldDocument = {
    format: 'cws-world', version: 3, id: opts.id ?? 'yaba', name: opts.name ?? 'Yaba, Lagos — 2003',
    environment: { hdri: 'hdri.pedestrian-overpass', sun: { azimuth: 150, elevation: 58, intensity: 3.5 }, exposure: 0.92 },
    district: structuredClone(plan),
    relations: [],
    sequences: [],
    spawn: { position: [0, 0.31, 0], heading: Math.PI / 2 },
    zones: [],
    entities: [], shots: [], worldState: { timeOfDay: 'day' },
  };
  const E = doc.entities, R = doc.relations!;
  const st = plan.street, frontZ = st.carriageway / 2 + (st.drain ? 0.7 : 0) + st.sidewalk;
  const rnd = seeded(`${plan.params?.seed ?? 'yaba'}/props`);
  // zones and spawn follow the plan: street bounds, café room footprint, a start on the café's walkway
  {
    const { b: cb, r: cr } = roomOf(doc, CAFE.room);
    const cm = buildingMatrix(cb);
    const cs = [[cr.rect[0], cr.rect[1]], [cr.rect[2], cr.rect[3]], [cr.rect[0], cr.rect[3]], [cr.rect[2], cr.rect[1]]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(cm));
    doc.zones.push(
      { id: 'zone.street', name: 'Rue commerçante', kind: 'street', bounds: [-st.length / 2, -frontZ, st.length / 2, frontZ], tags: ['walkable', 'street'] },
      { id: CAFE.room, name: 'Cybercafé', kind: 'interior', bounds: [Math.min(...cs.map((c) => c.x)), Math.min(...cs.map((c) => c.z)), Math.max(...cs.map((c) => c.x)), Math.max(...cs.map((c) => c.z))], tags: ['interior', 'cybercafe'] },
    );
    const door = cb.openings.find((o) => o.kind === 'door')!;
    const doorW = new THREE.Vector3(door.offset, 0, 0).applyMatrix4(cm);
    const side = Math.sign(cb.front[2]) || -1;
    // 14 m up the street from the door (or down, near the street start), looking toward it
    let sx = doorW.x - 14;
    if (sx < -st.length / 2 + 3) sx = doorW.x + 14;
    doc.spawn = { position: [+sx.toFixed(2), 0.31, +(side * (frontZ - 1.6)).toFixed(2)], heading: sx < doorW.x ? Math.PI / 2 : -Math.PI / 2 };
  }
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
  const floorY = ROOM_FLOOR; // building-local: L() adds the building's kerb-level origin
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
    metadata: { procedural: { kind: 'light_bank', fixtures, yaw: 90, ceilingHeight: b.floorHeight - 0.27 },
      // the switch is by the door, inside: approach anchor in the bank's local frame
      interaction: { enabled: true, color: '#eef6ff', intensity: 40, distance: 16, approach: [door.offset - (x0 + x1) / 2 + 1.1, -(b.floorHeight - 0.27) + floorY, -0.9 - (z0 + z1) / 2] } },
  });
  R.push({ kind: 'in', from: 'light.cafe', to: CAFE.room });
  // the wall switch the light bank's approach point leads to (inside, beside the door)
  const sw = put('cafe.switch', 'lagos.lightswitch', 'Interrupteur des néons', L(door.offset + door.width / 2 + 0.45, floorY + 1.1, -0.25 - 0.03), b.yaw + 180, ['selectable']);
  if (sw) R.push({ kind: 'connects', from: 'cafe.switch', to: 'light.cafe' }, { kind: 'in', from: 'cafe.switch', to: CAFE.room });

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
    const layout = opts.layout ?? plan.params?.cafe.layout ?? 'sides';
    const walls: ('left' | 'right' | 'back')[] = layout === 'back' ? ['back'] : layout === 'sides' ? ['left', 'right'] : ['left', 'right', 'back'];
    // spread over the chosen walls; a wall that is full passes the remainder to the next one
    let left = want;
    walls.forEach((w, i) => {
      const share = Math.ceil(left / (walls.length - i));
      for (let k = share; k >= 1; k--) { try { addWorkstations(doc, CAFE.room, k, w, assets); left -= k; break; } catch { /* fewer on this wall */ } }
    });
    // a shortfall is reported by the caller (count of ws.*.desk vs the request), never padded
  }

  // ---------------------------------------------------------------- street life (authored props, chosen by trade)
  const pickable = (): Partial<Entity> => ({ metadata: { interaction: { pickable: true, heldBy: null } } });
  const sittable = (): Partial<Entity> => ({ metadata: { interaction: { seat: [0, 0.43, -0.02], approach: [0.62, 0, -0.25], facing: 0, occupiedBy: null } } });
  const MOVE: Entity['capabilities'] = ['selectable', 'movable', 'rotatable', 'collidable'];
  type Prop = { asset: string; name: string; caps?: Entity['capabilities']; extra?: () => Partial<Entity>; id?: string };
  const BY_TRADE: Partial<Record<Trade, Prop[]>> = {
    provisions: [{ asset: 'lagos.crate', name: 'Casiers de bouteilles', id: 'st.crates' }, { asset: 'lagos.crate', name: 'Casiers de bouteilles' }],
    canteen: [{ asset: 'lagos.bench', name: 'Banc', id: 'st.bench1' }, { asset: 'lagos.stool', name: 'Tabouret', id: 'st.stool1' }],
    electricals: [{ asset: 'lagos.generator', name: 'Groupe électrogène', id: 'st.gen1' }, { asset: 'lagos.jerrycan', name: 'Jerrican', id: 'st.can1', caps: ['selectable', 'movable', 'rotatable', 'interactable', 'pickable'], extra: pickable }],
    barber: [{ asset: 'lagos.chair', name: 'Chaise monobloc', id: 'st.chair_out', caps: ['selectable', 'movable', 'rotatable', 'interactable', 'sittable'], extra: sittable }],
    phones: [{ asset: 'lagos.box', name: 'Carton', id: 'st.box', caps: ['selectable', 'movable', 'rotatable', 'interactable', 'pickable'], extra: pickable }],
    chemist: [{ asset: 'lagos.planter', name: 'Bac à plantes', id: 'st.planter' }],
    business: [{ asset: 'lagos.generator', name: 'Groupe électrogène' }],
    general: [{ asset: 'lagos.barrel', name: 'Fût', id: 'st.barrel' }, { asset: 'lagos.tyre', name: 'Pneus', id: 'st.tyres' }],
    books: [{ asset: 'lagos.bench', name: 'Banc' }],
    photo: [{ asset: 'lagos.stool', name: 'Tabouret' }],
    fashion: [{ asset: 'lagos.planter', name: 'Bac à plantes' }],
  };
  let propN = 0;
  const used = new Set<string>();
  for (const bb of doc.district!.buildings) {
    if (bb.id === 'b.e' || bb.id === 'b.w' || bb.id === CAFE.building) continue;
    const trade = (bb.openings.find((o) => o.kind === 'shopfront')?.trade ?? 'general') as Trade;
    const list = BY_TRADE[trade] ?? [];
    // free stretches of facade between ground-floor openings
    const taken = bb.openings.filter((o) => o.level === 0 && o.wall === 'front').map((o) => [o.offset - o.width / 2 - 0.5, o.offset + o.width / 2 + 0.5]).sort((u, v) => u[0] - v[0]);
    const free: [number, number][] = [];
    let cur = -bb.width / 2 + 0.4;
    for (const [u, v] of taken) { if (u - cur > 0.9) free.push([cur, u]); cur = Math.max(cur, v); }
    if (bb.width / 2 - 0.4 - cur > 0.9) free.push([cur, bb.width / 2 - 0.4]);
    const m = buildingMatrix(bb);
    list.forEach((prop, i) => {
      // against a free stretch of wall, or (facade all shopfronts) out on the pavement in front of the shop
      const seg = free[i];
      const lx = seg ? (seg[0] + seg[1]) / 2 : THREE.MathUtils.lerp(-bb.width / 2 + 0.8, bb.width / 2 - 0.8, (i + 0.5) / list.length);
      const lz = seg ? 0.75 + rnd() * 0.3 : Math.min(st.sidewalk - 1.3, 1.6) + rnd() * 0.2;
      const wp = new THREE.Vector3(lx, 0, lz).applyMatrix4(m);
      const id = prop.id && !used.has(prop.id) ? prop.id : `st.${prop.asset.split('.')[1]}${++propN}`;
      used.add(id);
      put(id, prop.asset, prop.name, [+wp.x.toFixed(2), 0.08, +wp.z.toFixed(2)], bb.yaw + (rnd() - 0.5) * 50, prop.caps ?? MOVE, prop.extra?.() ?? {});
    });
  }
  // shared street furniture near the café: bin and bag at the kerb, the electricity box on its facade
  {
    const { b: cb } = roomOf(doc, CAFE.room);
    const m = buildingMatrix(cb);
    const at = (x: number, z: number) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(m); return [+v.x.toFixed(2), 0.08, +v.z.toFixed(2)] as Vec3; };
    put('st.trash', 'lagos.trashcan', 'Poubelle', at(cb.width / 2 - 0.6, st.sidewalk - 0.6), cb.yaw + 90);
    put('st.trashbag', 'lagos.trashbag', 'Sac poubelle', at(cb.width / 2 - 1.3, st.sidewalk - 0.5), 10);
    put('st.powerbox', 'lagos.powerbox', 'Coffret électrique', at(cb.width / 2 - 0.35, 0.3), cb.yaw);
  }
  // vehicles parked along the kerbs, kept clear of the café entrance
  {
    const { b: cb } = roomOf(doc, CAFE.room);
    const doorX = new THREE.Vector3(cb.openings.find((o) => o.kind === 'door')!.offset, 0, 0).applyMatrix4(buildingMatrix(cb)).x;
    const cars: [string, string, string, number][] = [['veh.504', 'lagos.peugeot504', 'Peugeot 504 break', -1], ['veh.corolla', 'lagos.corolla', 'Toyota Corolla', 1], ['veh.covered', 'lagos.covered_car', 'Voiture bâchée', 1]];
    const half = st.carriageway / 2;
    cars.forEach(([id, asset, name, side], i) => {
      let x = -st.length / 2 + st.length * (0.2 + 0.3 * i + rnd() * 0.12);
      if (Math.abs(x - doorX) < 4) x += 6;
      put(id, asset, name, [+x.toFixed(2), 0, side * (half - 1.15)], side === 1 ? 0 : 180);
    });
  }
  // utility poles on the north walkway, wires drawn by the builder from the plan's pole list
  const poles: Vec3[] = [];
  for (let x = -st.length / 2 + 5; x <= st.length / 2 - 5; x += 16.5) poles.push([+x.toFixed(2), 0.08, +(frontZ - 0.8).toFixed(2)]);
  const transformer = Math.floor(poles.length / 2);
  poles.forEach((p, i) => put(`pole.${i}`, i === transformer ? 'lagos.pole_transformer' : 'lagos.pole', i === transformer ? 'Poteau avec transformateur' : 'Poteau électrique', p, 0, ['selectable', 'collidable']));
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
