import * as THREE from 'three';
import type { AssetRecord, Entity, WorldDocument } from '../core/types';
import { compileWorldIntent } from './WorldIntent';

export interface WorldPlan {
  brief: string;
  name: string;
  layout: 'street' | 'courtyard';
  size: number;
  count: number;
  lighting: 'day' | 'golden' | 'overcast';
  buildingAssets: string[];
  vegetation: boolean;
  missing: string[];
}

/** A transparent deterministic planner. It composes a supplied authored kit; it never claims
 * that searching the web fulfils an unsupported place, era or building requirement. */
export function planWorld(brief: string, assets: AssetRecord[]): WorldPlan {
  const intent = compileWorldIntent(brief);
  const tokens = brief.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const courtyard = /\b(cour|place|square|jardin|garden|park)\b/.test(tokens);
  const lower = brief.toLowerCase();
  const missing: string[] = [];
  if (/lagos|afri|tropi|cyber|2003|japon|tokyo|new york|futur|desert|désert|rural|village/.test(lower))
    missing.push('Le kit actuel couvre une architecture urbaine européenne. Ce lieu, cette époque ou ce type de bâtiment demande des assets supplémentaires.');
  if (/intérieur|interior|entrer|room|pièce/.test(lower))
    missing.push('Les bâtiments de ce kit sont des enveloppes extérieures. Les intérieurs ne sont pas encore composés.');
  return {
    brief: intent.brief, name: intent.title,
    layout: courtyard ? 'courtyard' : 'street',
    size: courtyard || /\b(dense|beaucoup)\b/.test(tokens) ? 112 : 84,
    count: /dense|beaucoup/.test(lower) ? 6 : 4,
    lighting: /soir|sunset|golden|coucher/.test(lower) ? 'golden' : /gris|overcast|nuage/.test(lower) ? 'overcast' : 'day',
    buildingAssets: assets.filter((a) => a.entityType === 'BUILDING' && a.id.startsWith('kit.')).map((a) => a.id),
    vegetation: !/sans (arbre|végétation)|no (tree|vegetation)/.test(lower), missing,
  };
}

export function composeWorld(plan: WorldPlan, baseline: WorldDocument, assets: AssetRecord[]): WorldDocument {
  if (plan.missing.length) throw new Error('Ce brief ne peut pas être construit avec le contenu disponible : ' + plan.missing.join(' '));
  if (!plan.name.trim() || !plan.brief.trim()) throw new Error('Nom et description requis');
  if (!Number.isFinite(plan.size) || plan.size < 60 || plan.size > 140) throw new Error('Taille : 60 à 140 mètres');
  if (!Number.isInteger(plan.count) || plan.count < 2 || plan.count > 8) throw new Error('Nombre de bâtiments : 2 à 8');
  const buildings = plan.buildingAssets.map((id) => assets.find((a) => a.id === id));
  if (!buildings.length || buildings.some((a) => !a || a.entityType !== 'BUILDING' || !a.bounds))
    throw new Error('Choisis un bâtiment avec des dimensions connues');
  const size = plan.size, half = size / 2;
  const doc: WorldDocument = {
    format: 'cws-world', version: 2, id: `world.${crypto.randomUUID()}`, name: plan.name.trim(),
    environment: { hdri: baseline.environment.hdri, exposure: plan.lighting === 'overcast' ? 0.8 : 0.95,
      sun: { azimuth: -25, elevation: plan.lighting === 'golden' ? 18 : 55, intensity: plan.lighting === 'overcast' ? 0.9 : 3.4 } },
    spawn: { position: [0, 0, -8], heading: 0 },
    entities: [], zones: [{ id: 'zone.main', name: plan.layout === 'street' ? 'Rue centrale' : 'Cour centrale', kind: plan.layout === 'street' ? 'street' : 'square', bounds: [-half, -half, half, half], tags: ['walkable', 'composed'] }],
    shots: [], worldState: { timeOfDay: plan.lighting },
    composition: { brief: plan.brief, layout: plan.layout, size, cells: [], dependencies: [], missing: [...plan.missing] },
  };
  const actor = baseline.entities.find((e) => e.type === 'ACTOR');
  if (!actor) throw new Error('Acteur de référence absent');
  const hero = structuredClone(actor);
  hero.transform.position = [...doc.spawn.position]; hero.transform.rotation = [0, 0, 0, 1];
  doc.entities.push(hero);
  doc.entities.push({ id: 'surface.main', name: 'Sol pavé', type: 'ROAD', tags: ['surface', 'walkable'], capabilities: ['walkable'], locked: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, metadata: { surface: { width: size, depth: size, material: 'Cobblestone_Small' } } });

  // Rectangular rows / courtyard perimeter. Bounds are validated before committing a package.
  const boxes: THREE.Box2[] = [];
  for (let i = 0; i < plan.count; i++) {
    const rec = buildings[i % buildings.length]!;
    const [width, , depth] = rec.bounds!;
    // Preserve the authored scale; every pair occupies a lot outside the central path.
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2), rows = Math.ceil(plan.count / 2);
    const spacing = Math.max(...buildings.map((a) => a!.bounds![0])) + 3;
    let z = (row - (rows - 1) / 2) * spacing;
    let x = side * (7 + depth / 2);
    let yaw = side === -1 ? 90 : -90;
    let fx = depth, fz = width;
    if (plan.layout === 'courtyard') {
      if (plan.count > 4) throw new Error('La cour accueille 2 à 4 bâtiments.');
      const radius = 16 + depth / 2;
      x = [0, radius, 0, -radius][i]; z = [radius, 0, -radius, 0][i];
      yaw = [0, -90, 180, 90][i];
      if (i % 2 === 0) { fx = width; fz = depth; }
    }
    const footprint = new THREE.Box2(new THREE.Vector2(x - fx / 2, z - fz / 2), new THREE.Vector2(x + fx / 2, z + fz / 2));
    if (footprint.min.x < -half + 1 || footprint.max.x > half - 1 || footprint.min.y < -half + 1 || footprint.max.y > half - 1)
      throw new Error('Ces bâtiments ne tiennent pas dans ce terrain. Agrandis le monde ou réduis leur nombre.');
    if (boxes.some((b) => b.intersectsBox(footprint))) throw new Error('Des bâtiments se chevauchent. Change le plan.');
    boxes.push(footprint);
    const e = assetEntity(rec, `building.${i}`, [x, 0, z], yaw);
    e.metadata = { ...e.metadata, structure: { footprint: [footprint.min.x, footprint.min.y, footprint.max.x, footprint.max.y], interiorAccess: false, entrances: [], levels: Math.max(1, Math.round(rec.bounds![1] / 3)) } };
    doc.entities.push(e);
  }
  // An authored interaction area in the open path: no fake primitives in place of furniture.
  const chair = assets.find((a) => a.id === 'khr.chairdamaskpurplegold');
  const lamp = assets.find((a) => a.id === 'khr.lantern');
  const cone = assets.find((a) => a.id === 'khr.trafficcone');
  if (chair) doc.entities.push(assetEntity(chair, 'chair.main', [-3, 0, 0], 180));
  if (lamp) doc.entities.push(assetEntity(lamp, 'light.main', [3, 0, 0]));
  if (cone) doc.entities.push(assetEntity(cone, 'prop.main', [2, 0, -3]));
  if (plan.vegetation) {
    const tree = assets.find((a) => a.id === 'kit.tree');
    if (tree) for (let i = 0; i < 2; i++) doc.entities.push(assetEntity(tree, `tree.${i}`, [i ? 5 : -5, 0, half - 9]));
  }
  doc.composition!.dependencies = [...new Set(doc.entities.flatMap((e) => e.assetId ? [e.assetId] : []).concat('env.bistro', doc.environment.hdri))];
  for (let x = -half; x < half; x += 20) for (let z = -half; z < half; z += 20) {
    const entities = doc.entities.filter((e) => e.transform.position[0] >= x && e.transform.position[0] < x + 20 && e.transform.position[2] >= z && e.transform.position[2] < z + 20);
    doc.composition!.cells.push({ id: `cell.${x}.${z}`, bounds: [x, z, Math.min(x + 20, half), Math.min(z + 20, half)], entities: entities.map((e) => e.id), dependencies: [...new Set(entities.flatMap((e) => e.assetId ? [e.assetId] : []))] });
  }
  return doc;
}

export function assetEntity(rec: AssetRecord, id: string, position: Entity['transform']['position'], yaw = 0): Entity {
  const capabilities: Entity['capabilities'] = ['selectable', 'movable', 'rotatable', 'scalable', 'collidable'];
  if (rec.entityType === 'LIGHT') capabilities.push('interactable', 'toggleable');
  if (rec.entityType === 'CHAIR' && rec.runtime?.interaction) capabilities.push('interactable', 'sittable');
  const inter = structuredClone(rec.runtime?.interaction ?? {}) as Record<string, unknown>;
  if (inter.pickable) capabilities.push('interactable', 'pickable');
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw * Math.PI / 180).toArray() as Entity['transform']['rotation'];
  return { id, name: rec.name, type: rec.entityType!, assetId: rec.id, transform: { position, rotation, scale: [1, 1, 1] }, tags: [...rec.tags], capabilities, metadata: { interaction: inter } };
}

/** Recompute package spatial records after transforms; these records are data, not a stale creation log. */
export function refreshSpatialData(doc: WorldDocument, assets: AssetRecord[]) {
  const pkg = doc.composition;
  if (!pkg) return;
  const half = pkg.size / 2;
  const footprints = new Map<string, [number, number, number, number]>();
  for (const e of doc.entities) {
    if (e.type === 'BUILDING') {
      const size = assets.find((a) => a.id === e.assetId)?.bounds;
      if (!size) throw new Error(`Dimensions inconnues : ${e.name}`);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...e.transform.position), new THREE.Quaternion(...e.transform.rotation), new THREE.Vector3(...e.transform.scale));
      const box = new THREE.Box3(new THREE.Vector3(-size[0]/2, 0, -size[2]/2), new THREE.Vector3(size[0]/2, size[1], size[2]/2)).applyMatrix4(matrix);
      const footprint: [number, number, number, number] = [box.min.x, box.min.z, box.max.x, box.max.z];
      footprints.set(e.id, footprint);
      ((e.metadata ??= {}).structure ??= {} as Record<string, unknown>);
      (e.metadata!.structure as Record<string, unknown>).footprint = footprint;
    }
  }
  pkg.dependencies = [...new Set(doc.entities.flatMap((e) => e.assetId ? [e.assetId] : []).concat('env.bistro', doc.environment.hdri))];
  pkg.cells = [];
  for (let x=-half; x<half; x+=20) for (let z=-half; z<half; z+=20) {
    const entities = doc.entities.filter((e) => {
      if (e.metadata?.surface) return true;
      const f = footprints.get(e.id);
      if (f) return f[0] < x+20 && f[2] > x && f[1] < z+20 && f[3] > z;
      return e.transform.position[0] >= x && e.transform.position[0] < x+20 && e.transform.position[2] >= z && e.transform.position[2] < z+20;
    });
    pkg.cells.push({id:`cell.${x}.${z}`, bounds:[x,z,Math.min(x+20,half),Math.min(z+20,half)], entities:entities.map((e)=>e.id), dependencies:[...new Set(entities.flatMap((e)=>e.assetId ? [e.assetId] : []))]});
  }
}
